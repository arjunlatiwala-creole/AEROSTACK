import json
import os
import boto3
import logging
import base64
import io
import requests
import concurrent.futures
import gzip
from datetime import datetime, timedelta
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
import httplib2
import urllib3
import certifi
from google.auth.transport.requests import Request

def load_env_vars():
    """Load environment variables from env.json for local development"""
    try:
        env_path = os.path.join(os.path.dirname(__file__), 'env.json')
        if os.path.exists(env_path):
            with open(env_path) as f:
                env_vars = json.load(f)
                # Get variables from ZoomToGDriveFunction object
                function_vars = env_vars.get('ZoomToGDriveFunction', {})
                for key, value in function_vars.items():
                    os.environ[key] = value if isinstance(value, str) else json.dumps(value)
            print("Successfully loaded environment variables from env.json")
    except Exception as e:
        print(f"Warning: Could not load env.json: {str(e)}")

# Load environment variables at module import
load_env_vars()

print("\n" + "*"*50)
print("*** RUNNING LATEST CODE VERSION - ZOOM OAUTH TEST ***")
print("*"*50 + "\n")

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def log_event(message, data=None, level="INFO", error=None):
    """Helper function for structured logging"""
    separator = "\n" + "="*80 + "\n"
    formatted_message = f"{separator}🔷 {message}"
    timestamp = logging.Formatter().formatTime(logging.LogRecord("", 0, "", 0, "", [], None))
    formatted_message += f"\n⏰ Time: {timestamp}"
    
    if data:
        formatted_message += "\n📄 Data:"
        if isinstance(data, dict):
            for key, value in data.items():
                # Mask sensitive data
                if any(sensitive in key.lower() for sensitive in ['secret', 'token', 'password', 'key']):
                    formatted_message += f"\n   • {key}: ****MASKED****"
                else:
                    formatted_message += f"\n   • {key}: {json.dumps(value, indent=2)}"
        else:
            formatted_message += f"\n   {json.dumps(data, indent=2)}"
    
    if error:
        formatted_message += f"\n❌ Error: {str(error)}"
        formatted_message += f"\n❌ Error Type: {type(error).__name__}"
    
    formatted_message += separator
    
    if level == "ERROR":
        logger.error(formatted_message)
    else:
        logger.info(formatted_message)


def get_zoom_oauth_token():
    """Get Zoom OAuth token using Server-to-Server OAuth with a local session."""
    try:
        log_event("Starting Zoom Server-to-Server OAuth token retrieval")
        
        # Get credentials from environment
        client_id = os.environ['ZOOM_CLIENT_ID']
        client_secret = os.environ['ZOOM_CLIENT_SECRET']
        account_id = os.environ['ZOOM_ACCOUNT_ID']
        
        log_event("Retrieved Zoom credentials", {
            "client_id": client_id,
            "has_secret": bool(client_secret),
            "account_id": account_id
        })
        
        # Create authorization header
        auth_string = f"{client_id}:{client_secret}"
        auth_bytes = auth_string.encode('ascii')
        base64_auth = base64.b64encode(auth_bytes).decode('ascii')
        
        headers = {
            'Authorization': f'Basic {base64_auth}',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        data = {
            'grant_type': 'account_credentials',
            'account_id': account_id
        }
        
        log_event("Sending token request to Zoom", {
            "url": "https://zoom.us/oauth/token",
            "headers": {k: v for k, v in headers.items() if k != 'Authorization'},
            "account_id": account_id
        })
        
        # Use a local session for the POST request
        with requests.Session() as local_session:
            local_session.verify = certifi.where()
            local_session.timeout = 120
            response = local_session.post(
                'https://zoom.us/oauth/token',
                headers=headers,
                data=data
            )
            response.raise_for_status()
        
        token_data = response.json()
        log_event("Successfully retrieved Zoom access token", {
            "token_type": token_data.get('token_type'),
            "expires_in": token_data.get('expires_in'),
            "scope": token_data.get('scope')
        })
        
        return token_data.get('access_token')
        
    except Exception as e:
        log_event("Error getting Zoom OAuth token", error=e, level="ERROR")
        return None


def get_drive_service():
    """Build a new Google Drive service each time (no caching)."""
    try:
        log_event("Starting Google Drive service initialization")
        
        # Get service account JSON from environment variable
        service_account_json = os.environ.get('GCP_SERVICE_ACCOUNT_JSON')
        if not service_account_json:
            raise ValueError("GCP_SERVICE_ACCOUNT_JSON environment variable not set")
        
        service_account_info = json.loads(service_account_json)
        log_event("Successfully read service account info", {
            "available_keys": list(service_account_info.keys())
        })

        # Create credentials
        log_event("Creating Google credentials")
        credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=['https://www.googleapis.com/auth/drive'],
            subject=os.environ['G_SUITE_USER_EMAIL']
        )
        log_event("Successfully created Google credentials")

        # Build the service
        log_event("Building Google Drive service")
        credentials.refresh(Request())
        drive_service = build('drive', 'v3', credentials=credentials)
        log_event("Successfully built Google Drive service")
        
        return drive_service
    except Exception as e:
        log_event("Error in get_drive_service", error=e, level="ERROR", data={"step": "service_initialization"})
        raise


class FileProcessor:
    """Helper class for parallel file processing."""
    def __init__(self, access_token, meeting_data):
        self.access_token = access_token
        self.meeting_data = meeting_data
        self.s3 = boto3.client('s3')
        self.bucket_name = os.environ.get('S3_BUCKET')
        self.gdrive_folder_id = os.environ['GDRIVE_FOLDER_ID']
        # Create folder structure once during initialization
        self._setup_folder_structure()

    def _setup_folder_structure(self):
        """Setup Google Drive folder structure once for all files."""
        try:
            self.drive_service = get_drive_service()
            # Remove special characters from meeting name
            meeting_name = self.meeting_data['meeting_details']['topic'].replace('/', '-').replace("'", "")
            
            # Get meeting start time and convert to EST
            if self.meeting_data.get('recording_files'):
                first_recording = self.meeting_data['recording_files'][0]
                utc_time = datetime.strptime(first_recording['recording_start'], "%Y-%m-%dT%H:%M:%SZ")
                # Convert UTC to EST (UTC-5)
                est_time = utc_time - timedelta(hours=5)
            else:
                utc_time = datetime.utcnow()
                est_time = utc_time - timedelta(hours=5)
            
            # Create main meeting folder with meeting ID
            meeting_id = self.meeting_data['meeting_details']['id']
            folder_name = f"{meeting_name} ({meeting_id})"
            
            # Check if meeting folder exists
            query = (
                f"name = '{folder_name}' "
                f"and '{self.gdrive_folder_id}' in parents "
                f"and mimeType = 'application/vnd.google-apps.folder' "
                f"and trashed = false"
            )
            results = self.drive_service.files().list(
                q=query,
                spaces='drive',
                fields='files(id)',
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            
            if results.get('files', []):
                self.meeting_folder_id = results['files'][0]['id']
                log_event("Found existing meeting folder", {"folder_id": self.meeting_folder_id})
            else:
                folder_metadata = {
                    'name': folder_name,
                    'mimeType': 'application/vnd.google-apps.folder',
                    'parents': [self.gdrive_folder_id]
                }
                folder = self.drive_service.files().create(
                    body=folder_metadata,
                    fields='id',
                    supportsAllDrives=True
                ).execute()
                self.meeting_folder_id = folder.get('id')
                log_event("Created new meeting folder", {"folder_id": self.meeting_folder_id})
            
            # Create date folder using EST date
            date_folder_name = est_time.strftime("%Y-%m-%d")
            query = (
                f"name = '{date_folder_name}' "
                f"and '{self.meeting_folder_id}' in parents "
                f"and mimeType = 'application/vnd.google-apps.folder' "
                f"and trashed = false"
            )
            results = self.drive_service.files().list(
                q=query,
                spaces='drive',
                fields='files(id)',
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            
            if results.get('files', []):
                self.date_folder_id = results['files'][0]['id']
                log_event("Found existing date folder", {"folder_id": self.date_folder_id})
            else:
                folder_metadata = {
                    'name': date_folder_name,
                    'mimeType': 'application/vnd.google-apps.folder',
                    'parents': [self.meeting_folder_id]
                }
                folder = self.drive_service.files().create(
                    body=folder_metadata,
                    fields='id',
                    supportsAllDrives=True
                ).execute()
                self.date_folder_id = folder.get('id')
                log_event("Created new date folder", {"folder_id": self.date_folder_id})
            
            # Create time folder with AM/PM format
            time_folder_name = est_time.strftime("%I:%M%p").lower().lstrip('0')
            query = (
                f"name = '{time_folder_name}' "
                f"and '{self.date_folder_id}' in parents "
                f"and mimeType = 'application/vnd.google-apps.folder' "
                f"and trashed = false"
            )
            results = self.drive_service.files().list(
                q=query,
                spaces='drive',
                fields='files(id)',
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            
            if results.get('files', []):
                self.time_folder_id = results['files'][0]['id']
                log_event("Found existing time folder", {"folder_id": self.time_folder_id})
            else:
                folder_metadata = {
                    'name': time_folder_name,
                    'mimeType': 'application/vnd.google-apps.folder',
                    'parents': [self.date_folder_id]
                }
                folder = self.drive_service.files().create(
                    body=folder_metadata,
                    fields='id',
                    supportsAllDrives=True
                ).execute()
                self.time_folder_id = folder.get('id')
                log_event("Created new time folder", {"folder_id": self.time_folder_id})
            
            log_event("Successfully setup folder structure", {
                "meeting_folder_id": self.meeting_folder_id,
                "date_folder_id": self.date_folder_id,
                "time_folder_id": self.time_folder_id,
                "meeting_id": meeting_id,
                "start_time": est_time.isoformat(),
                "time_folder": time_folder_name
            })
        except Exception as e:
            log_event("Error setting up folder structure", error=e, level="ERROR")
            raise

    def download_file(self, recording_info):
        """Download file from Zoom with a fresh session, thread-safe."""
        with requests.Session() as local_session:
            local_session.verify = False  # Temporarily disable SSL verification
            local_session.timeout = 120
            headers = {
                'Authorization': f'Bearer {self.access_token}',
                'Content-Type': 'application/json'
            }
            response = local_session.get(
                recording_info['download_url'],
                headers=headers,
                stream=True,
                timeout=120
            )
            response.raise_for_status()
            return response.raw.read()

    def process_file(self, recording_info):
        """Process a single file - download and upload to both services."""
        try:
            log_event("Processing file in parallel", {
                "file_type": recording_info['file_type'],
                "recording_type": recording_info['recording_type'],
                "recording_id": recording_info['id']
            })

            log_event("Starting file download", {
                "download_url": recording_info['download_url'],
                "recording_id": recording_info['id']
            })
            file_data = self.download_file(recording_info)
            log_event("File download completed", {
                "file_size": len(file_data),
                "recording_id": recording_info['id']
            })
            
            # Sequential upload to avoid resource contention
            gdrive_result = self.upload_to_gdrive(file_data, recording_info)
            log_event("Google Drive upload completed", gdrive_result)
            
            s3_result = self.upload_to_s3(file_data, recording_info)
            log_event("S3 upload completed", s3_result)

            return {
                'gdrive': gdrive_result,
                's3': s3_result,
                'recording_id': recording_info['id'],
                'file_type': recording_info['file_type']
            }

        except Exception as e:
            log_event(
                "Error processing file",
                error=e,
                level="ERROR",
                data={
                    "file_type": recording_info['file_type'],
                    "recording_type": recording_info['recording_type'],
                    "recording_id": recording_info['id']
                }
            )
            raise

    def upload_to_gdrive(self, file_data, recording_info):
        """Upload file to Google Drive."""
        try:
            # Refresh drive service and verify folder structure
            self.drive_service = get_drive_service()
            
            # First verify we can access the time folder
            try:
                folder = self.drive_service.files().get(
                    fileId=self.time_folder_id,
                    supportsAllDrives=True,
                    fields='id, name, capabilities'
                ).execute()
                log_event("Verified time folder access", {
                    "folder_id": folder['id'],
                    "folder_name": folder['name'],
                    "can_add_children": folder.get('capabilities', {}).get('canAddChildren', False)
                })
            except Exception as folder_error:
                log_event("Error accessing time folder", {
                    "folder_id": self.time_folder_id,
                    "error": str(folder_error)
                }, level="ERROR")
                raise
            
            # Verify file doesn't already exist
            query = (
                f"name = '{recording_info['recording_type']}_{recording_info['id']}.{recording_info['file_extension']}' "
                f"and '{self.time_folder_id}' in parents "
                f"and trashed = false"
            )
            results = self.drive_service.files().list(
                q=query,
                spaces='drive',
                fields='files(id)',
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            
            # If file already exists, return its info
            if results.get('files', []):
                return {
                    "file_id": results['files'][0]['id'],
                    "folder_id": self.time_folder_id,
                    "file_name": f"{recording_info['recording_type']}_{recording_info['id']}.{recording_info['file_extension']}"
                }
            
            file_metadata = {
                'name': f"{recording_info['recording_type']}_{recording_info['id']}.{recording_info['file_extension']}",
                'parents': [self.time_folder_id],
                'mimeType': self._get_mime_type(recording_info)
            }
            
            media = MediaIoBaseUpload(
                io.BytesIO(file_data),
                mimetype=self._get_mime_type(recording_info),
                resumable=True
            )
            
            # Create the file
            file = self.drive_service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id',
                supportsAllDrives=True
            ).execute()
            
            # Verify the file was created and is accessible
            try:
                created_file = self.drive_service.files().get(
                    fileId=file.get('id'),
                    supportsAllDrives=True,
                    fields='id, name, size'
                ).execute()
                log_event("Verified uploaded file", {
                    "file_id": created_file['id'],
                    "file_name": created_file['name'],
                    "file_size": created_file.get('size', 'unknown')
                })
            except Exception as verify_error:
                log_event("Error verifying uploaded file", {
                    "file_id": file.get('id'),
                    "error": str(verify_error)
                }, level="ERROR")
                raise
            
            return {
                "file_id": file.get('id'),
                "folder_id": self.time_folder_id,
                "file_name": file_metadata['name']
            }
        except Exception as e:
            log_event("Error uploading to Google Drive", error=e, level="ERROR")
            raise

    def upload_to_s3(self, file_data, recording_info):
        """Upload file to S3."""
        try:
            # Log AWS account info before S3 upload
            sts = boto3.client('sts')
            try:
                identity = sts.get_caller_identity()
                log_event("AWS Account Info before S3 upload", {
                    "account_id": identity['Account'],
                    "user_arn": identity['Arn'],
                    "user_id": identity['UserId'],
                    "has_access_key": bool(os.environ.get('AWS_ACCESS_KEY_ID')),
                    "has_secret_key": bool(os.environ.get('AWS_SECRET_ACCESS_KEY')),
                    "region": os.environ.get('AWS_DEFAULT_REGION'),
                    "bucket": os.environ.get('S3_BUCKET')
                })
            except Exception as e:
                log_event("Error getting AWS account info", error=e, level="ERROR")

            # Escape special characters in meeting name consistently with Google Drive
            meeting_name = self.meeting_data['meeting_details']['topic'].replace('/', '-').replace("'", "")
            meeting_id = self.meeting_data['meeting_details']['id']
            utc_time = datetime.strptime(recording_info['recording_start'], "%Y-%m-%dT%H:%M:%SZ")
            # Convert UTC to EST (UTC-5)
            est_time = utc_time - timedelta(hours=5)
            
            # Create S3 key with meeting ID and EST timestamp
            s3_key = f"{meeting_name} ({meeting_id})/{est_time.strftime('%Y-%m-%d')}/{est_time.strftime('%I:%M%p').lower().lstrip('0')}/{recording_info['recording_type']}_{recording_info['id']}.{recording_info['file_extension']}"
            
            log_event("Attempting S3 upload", {
                "bucket": self.bucket_name,
                "key": s3_key,
                "file_size": len(file_data)
            })
            
            self.s3.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=file_data
            )
            
            return {
                "bucket": self.bucket_name,
                "key": s3_key
            }
        except Exception as e:
            log_event("Error uploading to S3", error=e, level="ERROR")
            raise

    def _get_mime_type(self, recording_info):
        ext = recording_info['file_extension'].lower()
        if ext in ['mp4', 'mkv']:
            return f"video/{ext}"
        elif ext == 'vtt':
            return "text/vtt"
        elif ext == 'json':
            return "application/json"
        return "application/octet-stream"

    def delete_recording(self, recording_id):
        """Delete a specific recording from Zoom after successful storage."""
        try:
            if not recording_id:
                log_event("No recording ID provided for deletion", level="ERROR")
                return False
                
            log_event("Starting deletion of specific recording from Zoom", {
                "recording_id": recording_id,
                "meeting_id": self.meeting_data['meeting_details']['id']
            })
            
            headers = {
                'Authorization': f'Bearer {self.access_token}',
                'Content-Type': 'application/json'
            }
            
            # Use the recording-specific deletion endpoint
            delete_url = f'https://api.zoom.us/v2/meetings/{self.meeting_data["meeting_details"]["id"]}/recordings/{recording_id}'
            log_event("Sending delete request to Zoom", {
                "url": delete_url,
                "meeting_id": self.meeting_data["meeting_details"]["id"],
                "recording_id": recording_id
            })
            
            with requests.Session() as local_session:
                local_session.verify = certifi.where()
                local_session.timeout = 120
                response = local_session.delete(delete_url, headers=headers)
                
                log_event("Received delete response from Zoom", {
                    "status_code": response.status_code,
                    "response_text": response.text,
                    "recording_id": recording_id
                })
                
                # Check if deletion was successful (204 is success with no content)
                if response.status_code in [200, 204]:
                    log_event("Successfully deleted specific recording from Zoom", {
                        "recording_id": recording_id,
                        "status_code": response.status_code
                    })
                    return True
                else:
                    log_event("Unexpected status code from Zoom delete request", {
                        "status_code": response.status_code,
                        "response_text": response.text,
                        "recording_id": recording_id
                    }, level="ERROR")
                    response.raise_for_status()
            
        except Exception as e:
            log_event(
                "Error deleting specific recording from Zoom",
                error=e,
                level="ERROR",
                data={
                    "recording_id": recording_id,
                    "meeting_id": self.meeting_data['meeting_details']['id'],
                    "error_details": str(e),
                    "error_type": type(e).__name__
                }
            )
            return False
