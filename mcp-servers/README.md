# MCP Servers for Aerostack

Sample MCP servers that expose business functionality as tools accessible to humans and AI agents.

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-servers
pnpm install
```

### 2. Run a Server

```bash
# Aerostack API Server (sample tools)
pnpm aerostack-api

# Or use the quick start script
./start-sample.sh
```

### 3. Register in Aerostack

1. Open http://localhost:5173 → **🔌 MCP** tab
2. Click **"➕ Add MCP Server"**
3. Fill in:
   - **Name**: `Aerostack API Server`
   - **Description**: `Sample Aerostack operations`
   - **Endpoint**: `node /path/to/mcp-servers/aerostack-api-server.ts`
   - **Type**: `stdio`
4. Click **"Add Server"**

The server will appear in the list, and its tools will be available!

## Available Servers

### ✅ aerostack-api-server.ts

**Tools:**
- `list_loops` - List Aerostack loops with filters
- `create_loop` - Create new loop
- `score_loop` - Score loop effort/outcome
- `get_velocity` - Get person velocity

**Run:**
```bash
pnpm aerostack-api
```

### 🚧 hubspot-server.ts (Template)

**Tools (planned):**
- `search_deals` - Search HubSpot deals
- `create_deal` - Create new deal
- `sync_deal` - Sync to Aerostack loop

**Setup:**
```bash
HUBSPOT_API_KEY=your-key pnpm hubspot
```

### 🚧 slack-server.ts (Template)

**Tools (planned):**
- `send_message` - Send Slack message
- `notify_channel` - Notify about loop updates

**Setup:**
```bash
SLACK_TOKEN=your-token pnpm slack
```

## Creating Your Own MCP Server

### Basic Template

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Create server
const server = new Server(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'my_tool',
        description: 'What this tool does',
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: 'First parameter' },
            param2: { type: 'number', description: 'Second parameter' },
          },
          required: ['param1'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'my_tool') {
    // Your tool logic here
    const result = await doSomething(args.param1, args.param2);
    
    return {
      content: [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Server running on stdio');
}

main().catch(console.error);
```

### Add to package.json

```json
{
  "scripts": {
    "my-server": "tsx my-server.ts"
  }
}
```

### Run and Register

```bash
pnpm my-server
```

Then register in Aerostack UI with endpoint: `node /path/to/my-server.ts`

## Connection Types

### STDIO (Recommended for local dev)
- Server runs as CLI process
- Communicates via stdin/stdout
- Good for: Local development, CLI tools
- Example: `node server.ts` or `npx @my/mcp-server`

### HTTP (Recommended for production)
- Server runs as REST API
- Communicates via HTTP requests
- Good for: Production, cloud deployments, microservices
- Example: `http://api.example.com/mcp`

### WebSocket (For streaming)
- Server maintains persistent connection
- Bidirectional communication
- Good for: Real-time updates, long-running operations
- Example: `ws://api.example.com/mcp`

## Deployment Options

### Local (Dev)
Run in separate terminal:
```bash
pnpm aerostack-api
```

### Docker
Add to `docker-compose.yml` (see `MCP-DOCKER-SETUP.md`)

### Serverless (Production)
Deploy as AWS Lambda, Google Cloud Functions, etc.

### Kubernetes
Deploy as pods alongside Aerostack stack

## Documentation

- **`../MCP-SYSTEM.md`** - Complete system architecture
- **`../MCP-QUICKSTART.md`** - Get started guide
- **`../MCP-CHECKIN-GUIDE.md`** - How to register servers
- **`../MCP-DOCKER-SETUP.md`** - Docker integration options

## Tips

1. **Start simple**: Use STDIO mode for development
2. **Test locally**: Run server in terminal, test in Aerostack UI
3. **Add HTTP**: Create HTTP wrapper for production
4. **Monitor calls**: View call history in MCP dashboard
5. **Version tools**: Include version in tool names for breaking changes

## Troubleshooting

**Server not connecting:**
- Check endpoint path is correct
- Verify server is running
- Check logs in Aerostack backend console

**Tools not appearing:**
- Ensure `ListToolsRequestSchema` is implemented
- Check tool schemas are valid JSON Schema
- Restart server and re-register

**Tool calls failing:**
- Check input matches tool's input schema
- Verify `CallToolRequestSchema` handler exists
- Check server logs for errors

## Next Steps

1. Install dependencies: `pnpm install`
2. Run sample server: `pnpm aerostack-api`
3. Register in Aerostack UI
4. Test tools in MCP dashboard
5. Create your own server for HubSpot, Jira, etc.

---

**🎉 Now you have a universal tool integration layer!**

Any system can be exposed as MCP tools and accessed by humans and AI agents through a single interface.

