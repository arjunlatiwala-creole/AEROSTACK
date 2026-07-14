# Technology Stack

## Infrastructure

- AWS Lambda (Node.js 18.x runtime)
- API Gateway (REST API)
- DynamoDB (3 tables: attendees, presenter-queue, events)
- CloudFront + S3 for static frontend hosting
- Serverless Framework for IaC

## Backend

- Node.js 18.x
- AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`)
- UUID generation (`uuid`)

## Frontend

- Vanilla HTML/CSS/JavaScript
- Google Sign-In SDK
- No build process required

## Key Libraries

- `serverless` - Infrastructure deployment
- `serverless-offline` - Local development
- `serverless-domain-manager` - Custom domain management

## Common Commands

```bash
# Install dependencies
npm install

# Deploy to AWS
npm run deploy

# Deploy to specific stage
npm run deploy -- --stage prod

# Local development
npm run local

# Remove deployment
npm run remove
```

## Environment Variables

Required in `.env`:
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth secret

## AWS Configuration

- Region: `us-east-1`
- Account: `730335467631`
- Domain: `a10dit.com`
- Certificate ARN in `serverless.yml`

## DynamoDB Tables

All tables use PAY_PER_REQUEST billing:

1. `attendees` - Primary key: `attendeeId`, GSIs: `eventId-index`, `meetupId-index`
2. `presenter-queue` - Primary key: `queueId`, GSI: `eventId-timestamp-index`
3. `events` - Primary key: `eventId` (exists but currently unused)
