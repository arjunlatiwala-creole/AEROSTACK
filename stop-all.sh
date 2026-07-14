#!/bin/bash

# Stop All Aerostack Services - Nuclear Option
# This script kills everything related to Aerostack development

echo "🛑 Stopping All Aerostack Services"
echo "=============================="
echo ""

# Function to safely kill processes
safe_kill() {
  local pids=$1
  local name=$2
  if [ -n "$pids" ]; then
    echo "   Killing $name..."
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "   ✓ $name stopped"
  else
    echo "   - No $name processes running"
  fi
}

# 1. Kill Node/Turbo processes
echo "1. Stopping Node processes..."
TURBO_PIDS=$(ps aux | grep -E "(turbo dev|make dev)" | grep -v grep | awk '{print $2}')
safe_kill "$TURBO_PIDS" "Turbo"

NODE_PIDS=$(ps aux | grep -E "node.*(pwa-frontend|noshowcasen)" | grep -v grep | awk '{print $2}')
safe_kill "$NODE_PIDS" "Node dev servers"

# 2. Kill processes on specific ports
echo ""
echo "2. Freeing up ports..."
for port in 8020 5173 5174; do
  PORT_PIDS=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$PORT_PIDS" ]; then
    echo "   Killing process on port $port..."
    echo "$PORT_PIDS" | xargs kill -9 2>/dev/null
    echo "   ✓ Port $port freed"
  else
    echo "   - Port $port already free"
  fi
done

# 3. Stop Docker containers
echo ""
echo "3. Stopping Docker containers..."
if docker ps -q &>/dev/null; then
  RUNNING=$(docker-compose ps -q 2>/dev/null)
  if [ -n "$RUNNING" ]; then
    docker-compose down
    echo "   ✓ Docker containers stopped"
  else
    echo "   - No Docker containers running"
  fi
else
  echo "   - Docker not running"
fi

# 4. Kill any orphaned MCP server processes
echo ""
echo "4. Stopping MCP servers..."
MCP_PIDS=$(ps aux | grep -E "mcp.*server" | grep -v grep | awk '{print $2}')
safe_kill "$MCP_PIDS" "MCP servers"

# 5. Clean up turbo cache (optional)
echo ""
echo "5. Cleaning up caches..."
rm -rf .turbo/cookies/* 2>/dev/null
echo "   ✓ Turbo cookies cleared"

# 6. Final port check
echo ""
echo "6. Final port check..."
for port in 8020 5173 5174 27017; do
  if lsof -ti :$port &>/dev/null; then
    echo "   ⚠️  Port $port still in use (may be intentional)"
  else
    echo "   ✓ Port $port is free"
  fi
done

echo ""
echo "============================================"
echo "✅ All Aerostack services stopped"
echo ""
echo "To restart:"
echo "  make dev              # Start backend + frontend"
echo "  make start-storage    # Start MongoDB/Redis/etc"
echo ""
echo "To clean everything (including data):"
echo "  ./cleanup.sh --full"
echo "============================================"

