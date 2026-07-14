# Zoom to Google Drive & S3 Lambda Function

Serverless Lambda function that downloads Zoom recordings and uploads them to Google Drive and S3.

## What It Does

- Receives Zoom `recording.completed` webhook events
- Downloads all recording files (video, audio, transcripts, VTT)
- Uploads to Google Drive with folder hierarchy: `Meeting Name (ID) / YYYY-MM-DD / HH:MMam/`
- Uploads to S3 with matching folder structure
- Stores meeting metadata JSON in both GDrive and S3
- Deletes recordings from Zoom after successful storage
- Lists meetings with recordings from the past 30 days

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOOM_CLIENT_ID` | Zoom Server-to-Server OAuth Client ID |
| `ZOOM_CLIENT_SECRET` | Zoom OAuth Client Secret |
| `ZOOM_ACCOUNT_ID` | Zoom Account ID |
| `ZOOM_WEBHOOK_SECRET` | Zoom Webhook Secret (for HMAC validation) |
| `GCP_SERVICE_ACCOUNT_JSON` | GCP service account credentials JSON |
| `G_SUITE_USER_EMAIL` | G Suite user email for Google Drive access |
| `GDRIVE_FOLDER_ID` | Google Drive folder ID for storing recordings |
| `S3_BUCKET` | S3 bucket name for storing recordings |

## Local Development

```bash
cd tools-api/functions/zoom-recording-automation
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sam build
sam local invoke -e events/test-event.json --env-vars env.json
```

## Deployment

Deployed via SAM template integrated into the tools-api CDK stack.
