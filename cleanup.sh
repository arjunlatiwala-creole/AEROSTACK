#!/bin/bash

# Aerostack Cleanup Script - Full nuclear option with data deletion

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_header() {
  echo -e "${GREEN}================================${NC}"
  echo -e "${GREEN}$1${NC}"
  echo -e "${GREEN}================================${NC}"
  echo ""
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

# Parse arguments
FULL_CLEANUP=false
if [ "$1" = "--full" ] || [ "$1" = "-f" ]; then
  FULL_CLEANUP=true
fi

print_header "Aerostack Cleanup Script"

if [ "$FULL_CLEANUP" = true ]; then
  print_warning "FULL CLEANUP MODE"
  print_warning "This will delete ALL data including MongoDB, node_modules, build artifacts"
  echo ""
  read -p "Are you ABSOLUTELY sure? Type 'yes' to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi
  echo ""
fi

# 1. Stop all services
print_header "Step 1: Stopping Services"
./stop-all.sh

# 2. Stop and remove Docker containers/volumes
if [ "$FULL_CLEANUP" = true ]; then
  echo ""
  print_header "Step 2: Removing Docker Containers & Volumes"
  
  if docker ps -q &>/dev/null; then
    echo "Stopping and removing containers..."
    docker-compose down -v --remove-orphans 2>/dev/null || true
    
    # Also clean up any deprecated containers
    echo "Checking for deprecated containers (RabbitMQ, etc.)..."
    ./scripts/check-legacy-containers.sh 2>/dev/null || true
    
    print_success "Docker containers and volumes removed"
  else
    echo "Docker not running, skipping..."
  fi
fi

# 3. Clean node_modules
if [ "$FULL_CLEANUP" = true ]; then
  echo ""
  print_header "Step 3: Removing node_modules"
  
  echo "Removing node_modules directories..."
  rm -rf node_modules
  rm -rf common/node_modules
  rm -rf pwa-frontend/node_modules
  rm -rf mcp-servers/node_modules
  print_success "node_modules removed"
fi

# 4. Clean build artifacts
echo ""
print_header "Step 4: Cleaning Build Artifacts"

echo "Removing build directories..."
rm -rf pwa-frontend/dist
rm -rf common/dist
rm -rf .turbo
print_success "Build artifacts removed"

# 5. Clean lock files (optional, only in full mode)
if [ "$FULL_CLEANUP" = true ]; then
  echo ""
  print_header "Step 5: Cleaning Lock Files"
  
  echo "Removing lock files..."
  rm -f pnpm-lock.yaml
  rm -f package-lock.json
  rm -f common/package-lock.json
  rm -rf .pnpm-store
  print_success "Lock files removed"
fi

# 6. Clean MongoDB data
if [ "$FULL_CLEANUP" = true ]; then
  echo ""
  print_header "Step 6: Cleaning MongoDB Data"
  
  print_warning "This will DELETE ALL your data!"
  read -p "Delete MongoDB data? (yes/no): " confirm_mongo
  if [ "$confirm_mongo" = "yes" ]; then
    echo "Removing MongoDB data..."
    rm -rf mongodata/*
    print_success "MongoDB data removed"
  else
    echo "Skipping MongoDB data deletion"
  fi
fi

# 7. Clean PostgreSQL data (if exists)
if [ "$FULL_CLEANUP" = true ] && [ -d "pgdata" ]; then
  echo ""
  print_header "Step 7: Cleaning PostgreSQL Data"
  
  read -p "Delete PostgreSQL data? (yes/no): " confirm_pg
  if [ "$confirm_pg" = "yes" ]; then
    echo "Removing PostgreSQL data..."
    rm -rf pgdata/*
    print_success "PostgreSQL data removed"
  else
    echo "Skipping PostgreSQL data deletion"
  fi
fi

# 8. Clean logs and temp files
echo ""
print_header "Step 8: Cleaning Logs & Temp Files"

echo "Removing logs and temp files..."
rm -rf *.log
rm -rf logs/
rm -rf .dev-local/
rm -rf .cursor/
rm -rf .DS_Store
find . -name ".DS_Store" -delete 2>/dev/null || true
print_success "Logs and temp files removed"

# 9. Clean TypeScript build info
echo ""
print_header "Step 9: Cleaning TypeScript Build Info"

echo "Removing tsconfig build info..."
find . -name "tsconfig.tsbuildinfo" -delete 2>/dev/null || true
find . -name "*.tsbuildinfo" -delete 2>/dev/null || true
print_success "TypeScript build info removed"

# Final summary
echo ""
print_header "Cleanup Complete!"

if [ "$FULL_CLEANUP" = true ]; then
  echo ""
  print_success "Full cleanup completed"
  echo ""
  echo "To get started again:"
  echo "  1. pnpm install                # Reinstall dependencies"
  echo "  2. make start-storage          # Start MongoDB/Redis/etc"
  echo "  3. make dev                    # Start backend + frontend"
else
  echo ""
  print_success "Basic cleanup completed"
  echo ""
  echo "To fully clean (including data):"
  echo "  ./cleanup.sh --full"
  echo ""
  echo "To restart services:"
  echo "  make dev"
fi

echo ""

