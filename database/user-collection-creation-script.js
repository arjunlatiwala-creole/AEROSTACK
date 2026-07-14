// Switch to Aerostack database
db = db.getSiblingDB('aerostack');

print('🚀 Starting creation of users collection...');


// Create 'users' collection with validation schema
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'status', 'createdAt', 'updatedAt'],
      properties: {
        _id: {
          bsonType: 'string',
          description: 'AWS Cognito User Sub ID (UUID) used as primary key'
        },
        email: {
          bsonType: 'string',
          pattern: "^.+@.+$",
          description: 'User email - Primary key linking to AWS Cognito'
        },
        profile: {
          bsonType: 'object',
          description: 'User profile information',
          properties: {
            firstName: { bsonType: 'string' },
            lastName: { bsonType: 'string' },
            displayName: { bsonType: 'string' },
            phoneNumber: { bsonType: 'string' },
            avatarUrl: { bsonType: 'string' }
          }
        },
        roles: {
          bsonType: 'array',
          description: 'Application roles for RBAC',
          items: {
            enum: ['admin', 'editor', 'viewer', 'contributor'],
            bsonType: 'string'
          }
        },
        status: {
          enum: ['active', 'inactive', 'pending_verification', 'suspended'],
          description: 'Current account status'
        },
        preferences: {
          bsonType: 'object',
          description: 'UI/UX preferences (theme, notifications, etc.)'
        },
        lastLoginAt: {
          bsonType: 'date',
          description: 'Timestamp of last successful login via AuthContext'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Record creation timestamp'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        }
      }
    }
  }
});

// Create Indexes
// 1. Unique index on email (critical for AuthContext lookup)
db.users.createIndex({ email: 1 }, { unique: true });

// 3. Index for querying by status (e.g., find all active users)
db.users.createIndex({ status: 1 });

// 4. Text index for searching users by name or email
db.users.createIndex({
  email: "text",
  "profile.firstName": "text",
  "profile.lastName": "text",
  "profile.displayName": "text"
});

// 6. Index for lastLoginAt (for sorting by recent activity)
db.users.createIndex({ lastLoginAt: -1 });

print('✅ Users collection created successfully');