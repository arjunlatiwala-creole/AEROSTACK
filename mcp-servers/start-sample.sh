#!/bin/bash

# Quick start script for running sample MCP servers

echo "🔌 Starting Sample MCP Servers"
echo "================================"
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  pnpm install
  echo ""
fi

# Show available servers
echo "Available servers:"
echo "  1. Aerostack API Server (list/create/score loops)"
echo "  2. HubSpot Server (deals, contacts) [requires API key]"
echo "  3. Slack Server (messages, notifications) [requires token]"
echo ""

# Run Aerostack API server as example
echo "🚀 Starting Aerostack API Server..."
echo "   This will run in STDIO mode"
echo "   Press Ctrl+C to stop"
echo ""
echo "To register in Aerostack:"
echo "  1. Go to http://localhost:5173 → 🔌 MCP"
echo "  2. Click 'Add MCP Server'"
echo "  3. Fill in:"
echo "     Name: Aerostack API Server"
echo "     Endpoint: node $(pwd)/aerostack-api-server.ts"
echo "     Type: stdio"
echo ""

pnpm aerostack-api

