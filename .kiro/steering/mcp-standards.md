---
title: MCP Best Practices
inclusion: always
---

# enterprise MCP (Model Context Protocol) Standards

## Overview
MCP servers extend AI assistant capabilities with tool access. Proper configuration ensures reliable, secure AI-assisted development workflows.

## Approved MCP Servers
| Server | Purpose | Source |
|--------|---------|--------|
| `context7-mcp-server` | Library documentation lookup | uvx |
| `aws-documentation-mcp-server` | AWS service documentation | uvx (awslabs) |
| `github-mcp-server` | Repository operations | Official GitHub |

## Configuration Pattern
```json
{
  "mcpServers": {
    "context7": {
      "command": "uvx",
      "args": ["context7-mcp-server@latest"],
      "autoApprove": ["check_compatibility"]
    },
    "aws-knowledge": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "autoApprove": ["search_documentation"]
    }
  }
}
```

## Security Rules
- Only use MCP servers from trusted sources (official publishers, awslabs)
- Never auto-approve write operations (file creation, deployment, git push)
- Read-only operations may be auto-approved after team review
- MCP server versions should be pinned in production configurations
- Review MCP server permissions before adding to project

## Custom MCP Servers
When building custom MCP servers for client integrations:
- Follow the MCP specification strictly
- Implement proper authentication for external service access
- Log all tool invocations for audit trail
- Rate limit tool calls to prevent abuse
- Document all available tools with clear descriptions
- Test with multiple AI assistants for compatibility
