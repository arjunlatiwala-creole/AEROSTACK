# Infra: CDK + SAM + OpenAPI Quick Setup

This folder provides a CDK API stack with OpenAPI fragments for local development and testing using AWS SAM.

## Prerequisites

- **Docker** (running)
- **Node.js** (v18+) + **pnpm**
- **AWS CLI** (configured)
- **AWS SAM CLI**
- **AWS CDK** (optional, can use npx)

## Initial AWS Setup

### 1. Configure AWS Credentials

First-time setup requires configuring your AWS credentials:

```bash
# Configure AWS CLI with your credentials
aws configure

# You'll be prompted for:
# AWS Access Key ID: <YOUR_ACCESS_KEY>
# AWS Secret Access Key: <YOUR_SECRET_KEY>
# Default region name: us-east-1 (or your preferred region)
# Default output format: json
```

**Alternative: Use AWS SSO**
```bash
aws configure sso
```

**Verify Configuration:**
```bash
# Check your current identity
aws sts get-caller-identity

# Output should show:
# {
#     "UserId": "...",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/your-user"
# }
```

**Multiple Profiles:**
```bash
# Configure additional profile
aws configure --profile production

# Use specific profile
export AWS_PROFILE=production
# Or prefix commands: aws --profile production ...
```

### 2. Install AWS SAM CLI

**Linux x86_64:**
```bash
curl -L https://github.com/aws/aws-sam-cli/releases/latest/download/aws-sam-cli-linux-x86_64.zip -o aws-sam-cli.zip
unzip aws-sam-cli.zip -d sam-installation
sudo ./sam-installation/install
sam --version
```

**macOS:**
```bash
brew install aws-sam-cli
sam --version
```

**Windows:**
```bash
# Using MSI installer from:
# https://github.com/aws/aws-sam-cli/releases/latest
```

### 3. Install AWS CDK (Optional)

```bash
# Install globally
npm install -g aws-cdk

# Verify installation
cdk --version

# Or use with npx (no global install needed)
npx cdk --version
```

## Project Setup

### Install Dependencies

```bash
cd infra
pnpm install
```

### Bootstrap CDK (First Time Only)

Bootstrap creates the necessary S3 bucket and IAM roles for CDK deployments:

```bash
# Bootstrap default environment
pnpm run bootstrap

# Or manually:
cdk bootstrap aws://ACCOUNT-NUMBER/REGION

# Bootstrap for production
pnpm run bootstrap:prod
```

### Synthesize CloudFormation Templates

```bash
# Development environment
pnpm run synth

# Production environment
pnpm run synth:prod

# This creates: cdk.out/Aerostack-ApiStack.template.json
# This creates: cdk.out/Aerostack-ApiStack.template.json
```

## Key Files & Constructs

### Stacks
- **`Aerostack-ApiStack`** ([src/lib/stacks/api-stack.ts](src/lib/stacks/api-stack.ts))  
  Main API stack with Lambda integrations and API Gateway

- **`TablesStack`** ([src/lib/stacks/table-stack.ts](src/lib/stacks/table-stack.ts))  
  DynamoDB tables (Person, BFPM, Loops, etc.)

### Constructs
- **`BfpmApiConstruct`** ([src/lib/constructs/bfpm/bfpm-api.ts](src/lib/constructs/bfpm/bfpm-api.ts))  
  BFPM API endpoints with Lambda integration

- **`DynamoTable`** ([src/lib/constructs/database/dynamodb.ts](src/lib/constructs/database/dynamodb.ts))  
  Reusable DynamoDB table construct

### Lambda Functions
- [src/functions/bfpm/create.ts](src/functions/bfpm/create.ts) - BFPM session/data handlers
- [src/functions/hubspot/deals.ts](src/functions/hubspot/deals.ts) - HubSpot deals handler
- [src/functions/post-signup-confirmation/index.ts](src/functions/post-signup-confirmation/index.ts) - Cognito post-signup trigger

### Shared Utilities
- [src/functions/shared/dynamodb-client.ts](src/functions/shared/dynamodb-client.ts) - **Shared DynamoDB client** (use this!)
- [src/functions/shared/auth-utils.ts](src/functions/shared/auth-utils.ts) - Authentication utilities
- [src/functions/shared/logger.ts](src/functions/shared/logger.ts) - Logging utilities
- [src/functions/shared/response.ts](src/functions/shared/response.ts) - Response helpers

### Configuration Files
- [src/bin/app.ts](src/bin/app.ts) - CDK app entry point
- [src/lib/config.ts](src/lib/config.ts) - Environment configuration
- [cdk.json](cdk.json) - CDK configuration
- [package.json](package.json) - Dependencies and scripts

### Local Development
- [scripts/local-tables.ts](scripts/local-tables.ts) - Local table definitions
- [scripts/init-local-db.ts](scripts/init-local-db.ts) - Table initialization script
- [env/local.json](env/local.json) - Local environment variables
- [docker-compose.yml](docker-compose.yml) - DynamoDB Local container

### OpenAPI
- [openapi-specs/openapi-dev.json](openapi-specs/openapi-dev.json) - Generated OpenAPI spec (dev)
- [openapi-specs/openapi-prod.json](openapi-specs/openapi-prod.json) - Generated OpenAPI spec (prod)

## Local DynamoDB Development

This project includes a scalable local DynamoDB setup for development and testing.

### Quick Start

```bash
# Create Docker network (first time only)
docker network create aerostack-local-net

# One command to start DynamoDB and create all tables
pnpm run local:setup

# Start the local API (connects to local DynamoDB)
pnpm run local:api
```

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│  SAM Lambda         │────▶│  DynamoDB Local     │
│  (Docker container) │     │  (Docker container) │
└─────────────────────┘     └─────────────────────┘
         │                           │
         └───── sam-local network ───┘
```

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm run local:setup` | Start DynamoDB + create all tables |
| `pnpm run local:init` | Create tables only (if DynamoDB running) |
| `pnpm run local:reset` | Wipe and recreate everything |
| `pnpm run local:db` | Start DynamoDB container only |
| `pnpm run local:api` | Start SAM local API |

### Local Tables

The following tables are auto-created:

| Table Name | Description |
|------------|-------------|
| `local-person` | Person records |
| `local-integrations-raw` | Raw integration data |
| `local-bfpm-sessions` | BFPM sessions |
| `local-bfpm-data` | BFPM data |
| `local-loops` | Loops (with 4 GSIs) |

### Adding a New Table

1. **Add table definition** to `scripts/local-tables.ts`:

```typescript
{
  TableName: "local-new-table",
  KeySchema: [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: "pk", AttributeType: "S" },
    { AttributeName: "sk", AttributeType: "S" },
  ],
}
```

2. **Add env var** to `env/local.json`:

```json
"NEW_TABLE_NAME": "local-new-table"
```

3. **Run init script**:

```bash
pnpm run local:init
```

### Key Files

| File | Purpose |
|------|--------|
| `scripts/local-tables.ts` | Table definitions (single source of truth) |
| `scripts/init-local-db.ts` | Auto-creates all tables |
| `src/functions/shared/dynamodb-client.ts` | Shared DynamoDB client |
| `env/local.json` | Local environment configuration |
| `docker-compose.yml` | DynamoDB Local container |

### Shared DynamoDB Client

All Lambda functions should use the shared client:

```typescript
import { ddbClient } from "../shared/dynamodb-client";

// Use ddbClient for all DynamoDB operations
await ddbClient.send(new PutCommand({ ... }));
```

The client automatically switches between local and cloud endpoints based on the `DYNAMODB_LOCAL_ENDPOINT` environment variable.

### Verify Local Setup

```bash
# List tables
aws dynamodb list-tables --endpoint-url http://localhost:8000

# Scan a table
aws dynamodb scan --table-name local-bfpm-sessions --endpoint-url http://localhost:8000
```

### DynamoDB Admin UI

For a visual interface to inspect local tables:

```bash
# Set dummy AWS credentials (required for local DynamoDB)
export AWS_ACCESS_KEY_ID=dummy
export AWS_SECRET_ACCESS_KEY=dummy
export AWS_REGION=us-east-1

# Start DynamoDB Admin on http://localhost:8001
DYNAMO_ENDPOINT=http://localhost:8000 npx dynamodb-admin
```

Access the admin UI at: `http://localhost:8001`

## Local API Development with SAM

### 1. Start Local API Server

```bash
# Recommended: Use local:api (includes DynamoDB connection)
pnpm run local:api

# Or manually with environment:
export AWS_SAM_LOCAL=true

# Start SAM local API
sam local start-api -t cdk.out/Aerostack-ApiStack.template.json

# Or start on custom port
sam local start-api -t cdk.out/Aerostack-ApiStack.template.json -p 3001

# With hot reload
sam local start-api -t cdk.out/Aerostack-ApiStack.template.json --warm-containers EAGER
```

**Default URL:** `http://127.0.0.1:3000`

### 2. Test Endpoints

**POST Request with JSON:**
```bash
curl -X POST http://127.0.0.1:3000/hubspot/deals \
  -H "Content-Type: application/json" \
  -d '{"dealId":"123","payload":{"name":"Test Deal"}}'
```

**GET Request:**
```bash
curl http://127.0.0.1:3000/hubspot/deals/123
```

**With Authorization Header:**
```bash
curl -X POST http://127.0.0.1:3000/hubspot/deals \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

**Using JSON file:**
```bash
# Create payload.json
echo '{"dealId":"456","payload":{"amount":1000}}' > payload.json

# Send request
curl -X POST http://127.0.0.1:3000/hubspot/deals \
  -H "Content-Type: application/json" \
  -d @payload.json
```

### 3. Direct Lambda Invocation

```bash
# Create test event
cat > event.json <<EOF
{
  "body": "{\"dealId\":\"789\",\"payload\":{}}",
  "headers": {
    "Content-Type": "application/json"
  },
  "httpMethod": "POST"
}
EOF

# Invoke specific Lambda function
sam local invoke "DealsFunction" \
  -e event.json \
  -t cdk.out/Aerostack-ApiStack.template.json

# With environment variables
sam local invoke "DealsFunction" \
  -e event.json \
  -t cdk.out/Aerostack-ApiStack.template.json \
  --env-vars env.json
```

**Find Lambda Logical IDs:**
```bash
# List all functions in template
grep -A 5 '"Type": "AWS::Lambda::Function"' cdk.out/Aerostack-ApiStack.template.json

# Or use jq
jq '.Resources | to_entries | map(select(.value.Type == "AWS::Lambda::Function")) | .[].key' \
  cdk.out/Aerostack-ApiStack.template.json
```

## OpenAPI Specification

### Generate and View OpenAPI Specs

```bash
# Generate and display dev spec
pnpm run openapi:local

# Generate and display prod spec
pnpm run openapi:local:prod

# Serve with Swagger UI
pnpm run openapi:serve

# Validate OpenAPI spec
pnpm run openapi:validate
```

### Extract OpenAPI from CDK Outputs

```bash
# Extract OpenAPI JSON from outputs
jq '.Outputs | to_entries[] | select(.key | contains("OpenApi")) | .value.Value' \
  cdk.out/Aerostack-ApiStack.template.json > openapi-extracted.json
```

## Deployment

### Deploy to AWS

```bash
# Deploy to development
pnpm run deploy

# Deploy to production
pnpm run deploy:prod

# Deploy specific stack
cdk deploy IntegrationApiStack

# Deploy with approval required
cdk deploy --require-approval never

# Deploy all stacks
cdk deploy --all
```

### View Deployment Differences

```bash
# Show what will change
pnpm run diff

# Compare specific stack
cdk diff IntegrationApiStack
```

### Destroy Infrastructure

```bash
# Destroy all resources
cdk destroy

# Destroy specific stack
cdk destroy IntegrationApiStack

# Destroy without confirmation
cdk destroy --force
```

## Available NPM Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Compile TypeScript to JavaScript |
| `pnpm run bootstrap` | Bootstrap CDK (development) |
| `pnpm run bootstrap:prod` | Bootstrap CDK (production) |
| `pnpm run synth` | Synthesize CloudFormation template (dev) |
| `pnpm run synth:prod` | Synthesize CloudFormation template (prod) |
| `pnpm run deploy` | Deploy to AWS (development) |
| `pnpm run deploy:prod` | Deploy to AWS (production) |
| `pnpm run diff` | Show deployment differences |
| `pnpm run openapi:local` | Generate and display dev OpenAPI spec |
| `pnpm run openapi:local:prod` | Generate and display prod OpenAPI spec |
| `pnpm run openapi:serve` | Serve OpenAPI with Swagger UI |
| `pnpm run openapi:validate` | Validate OpenAPI specification |
| `pnpm run local:setup` | Start DynamoDB + create all tables |
| `pnpm run local:init` | Create tables only |
| `pnpm run local:reset` | Wipe and recreate everything |
| `pnpm run local:db` | Start DynamoDB container |
| `pnpm run local:api` | Start SAM local API with DynamoDB |

## Useful Commands & Tips

### CDK Commands

```bash
# List all stacks
cdk list

# View synthesized template
cdk synth IntegrationApiStack

# View deployment metadata
cdk metadata

# View CDK context
cdk context

# Clear CDK context
cdk context --clear
```

### SAM Commands

```bash
# Generate SAM configuration
sam init

# Build SAM application
sam build

# Package for deployment
sam package --output-template-file packaged.yaml --s3-bucket <bucket-name>

# List local endpoints
sam local start-api --help
```

### Viewing Stack Outputs

```bash
# Pretty print entire template
jq '.' cdk.out/Aerostack-ApiStack.template.json

# Extract specific outputs
jq '.Outputs' cdk.out/Aerostack-ApiStack.template.json

# Get API URL
jq '.Outputs | to_entries[] | select(.key | contains("ApiUrl")) | .value.Value' \
  cdk.out/Aerostack-ApiStack.template.json
```

## Debugging Tips

### Common Issues

**SAM won't start?**
- Verify Docker is running: `docker ps`
- Check SAM version: `sam --version`
- Ensure template exists: `ls cdk.out/Aerostack-ApiStack.template.json`

**Authorization blocking requests?**
- Set environment variable: `export AWS_SAM_LOCAL=true`
- This enables dev mode in `auth-utils.ts` to bypass JWT validation

**Lambda function not found?**
- Check logical IDs in synthesized template
- Verify function names match your construct definitions

**TypeScript compilation errors?**
- Run `pnpm run build` to check for type errors
- Ensure all dependencies are installed: `pnpm install`

**Port already in use?**
- Use different port: `sam local start-api -p 3001`
- Or kill existing process: `lsof -ti:3000 | xargs kill`

**Lambda timeout?**
- Increase timeout in construct definition
- Check CloudWatch logs for errors

### Environment Variables for Local Development

Use the pre-configured `env/local.json` for local Lambda invocations:

```bash
# Start local API with environment variables
pnpm run local:api

# Or invoke a specific function
sam local invoke BfpmCreateLambda -e event.json \
  -t cdk.out/Aerostack-ApiStack.template.json \
  --env-vars env/local.json \
  --docker-network sam-local
```

To add custom environment variables, edit `env/local.json`:

```json
{
  "Parameters": {
    "DYNAMODB_LOCAL_ENDPOINT": "http://dynamodb-local:8000",
    "AWS_SAM_LOCAL": "true",
    "BFPM_SESSIONS_TABLE_NAME": "local-bfpm-sessions",
    "LOG_LEVEL": "debug"
  }
}
```

## Project Structure

```
infra/
├── cdk.out/                    # CDK synthesized templates
├── dist/                       # Compiled JavaScript output
├── env/
│   └── local.json              # Local environment variables
├── openapi-specs/              # Generated OpenAPI specifications
│   ├── openapi-dev.json
│   └── openapi-prod.json
├── scripts/
│   ├── local-tables.ts         # Local DynamoDB table definitions
│   └── init-local-db.ts        # Table initialization script
├── src/
│   ├── bin/
│   │   └── app.ts              # CDK app entry point
│   ├── functions/              # Lambda function handlers
│   │   ├── bfpm/
│   │   │   └── create.ts       # BFPM API handlers
│   │   ├── hubspot/
│   │   │   ├── deals.ts
│   │   │   ├── formatters.ts
│   │   │   └── shared.ts
│   │   ├── post-signup-confirmation/
│   │   │   └── index.ts        # Cognito trigger
│   │   └── shared/
│   │       ├── auth-utils.ts   # Authentication utilities
│   │       ├── dynamodb-client.ts  # Shared DynamoDB client
│   │       ├── logger.ts       # Logging utilities
│   │       └── response.ts     # Response helpers
│   ├── lib/
│   │   ├── constructs/         # Reusable CDK constructs
│   │   │   ├── auth/
│   │   │   ├── bfpm/
│   │   │   ├── database/
│   │   │   ├── hubspot/
│   │   │   └── openapi/
│   │   ├── config.ts           # Environment configuration
│   │   ├── models/             # TypeScript models/types
│   │   └── stacks/             # CDK stack definitions
│   │       ├── api-stack.ts
│   │       └── table-stack.ts
│   ├── schemas/                # Validation schemas
│   └── shared/                 # Shared validation schemas
├── docker-compose.yml          # DynamoDB Local container
├── cdk.json                    # CDK configuration
├── package.json                # NPM dependencies and scripts
├── tsconfig.json               # TypeScript configuration
└── README.md                   # This file
```

## Next Steps & TODOs

- [ ] **Test Individual Lambdas:** Use `sam local invoke <LogicalId> -e event.json`
- [ ] **Test All Endpoints:** Create Postman collection from OpenAPI spec
- [ ] **Multi-Stack Development:** Synthesize multiple stacks and run SAM on different ports
- [ ] **OpenAPI Documentation:** Deploy OpenAPI spec to S3 or documentation site
- [ ] **CI/CD Pipeline:** Set up GitHub Actions or AWS CodePipeline
- [ ] **Monitoring:** Add CloudWatch dashboards and alarms
- [ ] **Unit Tests:** Add Jest tests for Lambda functions
- [ ] **Integration Tests:** Add end-to-end API tests
- [ ] **Environment Variables:** Set up Parameter Store or Secrets Manager
- [ ] **Custom Domain:** Add Route53 and ACM certificate

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html)
- [OpenAPI Specification](https://swagger.io/specification/)
- [HubSpot API Documentation](https://developers.hubspot.com/docs/api/overview)

## Support & Contributing

For issues or questions:
1. Check the debugging tips above
2. Review AWS CloudWatch logs
3. Consult AWS CDK/SAM documentation
4. Open an issue in the project repository 
