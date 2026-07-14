#!/bin/bash

# Partner Central API Integration Test Script
# Usage: ./test-partner-central.sh [local|dev|prod] [entity-type]

set -e

ENV=${1:-local}
ENTITY_TYPE=${2:-opportunities}
STACK_NAME="Aerostack-ApiStack"

echo "🧪 Testing Partner Central Integration"
echo "Environment: $ENV"
echo "Entity Type: $ENTITY_TYPE"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Step 1: Validate entity type
case $ENTITY_TYPE in
    opportunities|engagements|solutions|resources)
        print_success "Valid entity type: $ENTITY_TYPE"
        ;;
    *)
        print_error "Invalid entity type. Must be: opportunities, engagements, solutions, or resources"
        exit 1
        ;;
esac

if [ "$ENV" == "local" ]; then
    echo ""
    echo "📍 Testing Locally with SAM"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Check if Docker is running
    if ! docker ps > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    print_success "Docker is running"
    
    # Check if local DynamoDB is running
    if ! docker ps | grep -q dynamodb-local; then
        print_warning "Local DynamoDB not running. Starting..."
        pnpm run local:setup
    else
        print_success "Local DynamoDB is running"
    fi
    
    # Synthesize CDK stack
    echo ""
    echo "📦 Synthesizing CDK stack..."
    pnpm run synth > /dev/null 2>&1
    print_success "CDK stack synthesized"
    
    # Find Lambda function name in template
    LAMBDA_LOGICAL_ID=$(cat cdk.out/$STACK_NAME.template.json | jq -r '.Resources | to_entries[] | select(.value.Type == "AWS::Lambda::Function" and (.value.Properties.Handler | contains("ingest"))) | .key' | head -1)
    
    if [ -z "$LAMBDA_LOGICAL_ID" ]; then
        print_error "Could not find ingest Lambda function in template"
        exit 1
    fi
    print_success "Found Lambda: $LAMBDA_LOGICAL_ID"
    
    # Invoke Lambda locally
    echo ""
    echo "🚀 Invoking Lambda locally..."
    echo "Event file: events/partner-central-ingest-${ENTITY_TYPE}.json"
    
    sam local invoke "$LAMBDA_LOGICAL_ID" \
        -t cdk.out/$STACK_NAME.template.json \
        --env-vars env/local.json \
        --event "events/partner-central-ingest-${ENTITY_TYPE}.json" \
        --docker-network aerostack-local-net
    
    echo ""
    print_success "Local test completed"
    
    # Check DynamoDB for data
    echo ""
    echo "🔍 Checking local DynamoDB for ingested data..."
    RECORDS=$(aws dynamodb scan \
        --table-name aerostack-dev-integrations-raw \
        --endpoint-url http://localhost:8000 \
        --no-cli-pager \
        --query 'Items[?entity.S==`'$ENTITY_TYPE'`]' \
        2>/dev/null | jq length)
    
    if [ "$RECORDS" -gt 0 ]; then
        print_success "Found $RECORDS records in integrations-raw table"
    else
        print_warning "No records found in integrations-raw table"
    fi

elif [ "$ENV" == "dev" ] || [ "$ENV" == "prod" ]; then
    echo ""
    echo "☁️  Testing in AWS Environment: $ENV"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Set context for prod environment
    CONTEXT_FLAG=""
    if [ "$ENV" == "prod" ]; then
        CONTEXT_FLAG="--context env=prod"
    fi
    
    # Get AWS account ID
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
    if [ -z "$AWS_ACCOUNT" ]; then
        print_error "Failed to get AWS account. Check your AWS credentials."
        exit 1
    fi
    print_success "AWS Account: $AWS_ACCOUNT"
    
    # Publish EventBridge event
    echo ""
    echo "📤 Publishing event to EventBridge..."
    
    EVENT_DETAIL="{\"integration_id\":\"test-partner-central-$(date +%s)\",\"integration_type\":\"partner_central\",\"entityType\":\"$ENTITY_TYPE\"}"
    
    aws events put-events --entries "[
        {
            \"Source\": \"manual.trigger\",
            \"DetailType\": \"Ingest Requested\",
            \"Detail\": \"$EVENT_DETAIL\"
        }
    ]"
    
    print_success "Event published to EventBridge"
    
    # Get Lambda function name
    LAMBDA_NAME=$(aws cloudformation describe-stack-resources \
        --stack-name $STACK_NAME \
        --query "StackResources[?contains(LogicalResourceId, 'Ingest')].PhysicalResourceId" \
        --output text 2>/dev/null | head -1)
    
    if [ -z "$LAMBDA_NAME" ]; then
        print_error "Could not find Lambda function in stack"
        exit 1
    fi
    print_success "Lambda: $LAMBDA_NAME"
    
    # Wait for execution
    echo ""
    echo "⏳ Waiting 10 seconds for Lambda execution..."
    sleep 10
    
    # Tail CloudWatch logs
    echo ""
    echo "📋 Recent CloudWatch logs:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    aws logs tail "/aws/lambda/$LAMBDA_NAME" --since 2m --format short --no-cli-pager | tail -20
    
    # Check DynamoDB for data
    echo ""
    echo "🔍 Checking DynamoDB for ingested data..."
    TABLE_NAME="aerostack-${ENV}-integrations-raw"
    
    RECORDS=$(aws dynamodb scan \
        --table-name "$TABLE_NAME" \
        --filter-expression "entity = :entity" \
        --expression-attribute-values "{\":entity\":{\"S\":\"$ENTITY_TYPE\"}}" \
        --select COUNT \
        --no-cli-pager \
        2>/dev/null | jq -r '.Count')
    
    if [ "$RECORDS" -gt 0 ]; then
        print_success "Found $RECORDS records in $TABLE_NAME"
    else
        print_warning "No records found in $TABLE_NAME"
    fi
    
    # Check entity tables
    echo ""
    echo "🔍 Checking entity-specific table..."
    
    case $ENTITY_TYPE in
        opportunities)
            ENTITY_TABLE="aerostack-${ENV}-partner-opportunities"
            ;;
        engagements)
            ENTITY_TABLE="aerostack-${ENV}-partner-engagements"
            ;;
        solutions)
            ENTITY_TABLE="aerostack-${ENV}-partner-solutions"
            ;;
        resources)
            ENTITY_TABLE="aerostack-${ENV}-partner-resources"
            ;;
    esac
    
    ENTITY_RECORDS=$(aws dynamodb scan \
        --table-name "$ENTITY_TABLE" \
        --select COUNT \
        --no-cli-pager \
        2>/dev/null | jq -r '.Count')
    
    if [ "$ENTITY_RECORDS" -gt 0 ]; then
        print_success "Found $ENTITY_RECORDS records in $ENTITY_TABLE"
        
        # Show sample record
        echo ""
        echo "📄 Sample record:"
        aws dynamodb scan \
            --table-name "$ENTITY_TABLE" \
            --limit 1 \
            --no-cli-pager \
            2>/dev/null | jq -r '.Items[0]' | jq '.'
    else
        print_warning "No records found in $ENTITY_TABLE"
        print_warning "Processing may still be in progress. Check again in 30 seconds."
    fi
    
    echo ""
    print_success "AWS test completed"

else
    print_error "Invalid environment. Use: local, dev, or prod"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Test Complete"
echo ""
echo "Next steps:"
echo "  • View logs: aws logs tail /aws/lambda/\$LAMBDA_NAME --follow"
echo "  • Query data: aws dynamodb scan --table-name aerostack-${ENV}-partner-${ENTITY_TYPE}"
echo "  • Monitor events: Check EventBridge console for 'Ingestion Complete' events"
echo ""
