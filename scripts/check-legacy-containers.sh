#!/bin/bash

# Aerostack - Legacy Container Cleanup Script
# Automatically removes deprecated services that are no longer in docker-compose.yml

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# List of deprecated container names
DEPRECATED_CONTAINERS=(
  "enterprise-aerostack-rabbitmq-1"
  "rabbitmq"
)

echo -e "${BLUE}🔍 Checking for deprecated containers...${NC}"

FOUND_LEGACY=false

for container in "${DEPRECATED_CONTAINERS[@]}"; do
  # Check if container exists (running or stopped)
  if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
    FOUND_LEGACY=true
    echo -e "${YELLOW}⚠️  Found deprecated container: ${container}${NC}"
    
    # Stop if running
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
      echo -e "   Stopping ${container}..."
      docker stop "${container}" >/dev/null 2>&1
    fi
    
    # Remove container
    echo -e "   Removing ${container}..."
    docker rm "${container}" >/dev/null 2>&1
    echo -e "${GREEN}   ✅ Removed ${container}${NC}"
  fi
done

if [ "$FOUND_LEGACY" = false ]; then
  echo -e "${GREEN}✅ No deprecated containers found${NC}"
else
  echo -e "${GREEN}✅ Legacy containers cleaned up${NC}"
  echo -e "${BLUE}ℹ️  Note: RabbitMQ has been replaced with AWS SQS${NC}"
fi

echo ""
