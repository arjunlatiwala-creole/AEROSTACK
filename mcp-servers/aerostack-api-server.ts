#!/usr/bin/env node
/**
 * Aerostack API MCP Server
 * 
 * Exposes Aerostack functionality as MCP tools that can be called by:
 * - AI agents (Claude, GPT, Lyzr agents)
 * - Human users via MCP Dashboard
 * - Other systems via MCP protocol
 * 
 * Tools provided:
 * - list_loops: Get active loops
 * - create_loop: Create new loop
 * - score_loop: Score a loop's effort/outcome
 * - get_velocity: Get person velocity score
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Mock Aerostack API client (in production, this would call actual Aerostack backend)
const aerostackApiClient = {
  async listLoops(params: any) {
    return [
      {
        loop_id: 'loop_123',
        title: 'Implement MCP Integration',
        owner_email: 'will@enterprise.io',
        category: 'ENG',
        status: 'IN_PROGRESS',
        priority: 1,
        effort_score: 4,
        outcome_score: null,
      },
      {
        loop_id: 'loop_124',
        title: 'HubSpot Integration',
        owner_email: 'will@enterprise.io',
        category: 'BD',
        status: 'PLANNED',
        priority: 2,
      },
    ];
  },
  
  async createLoop(data: any) {
    return {
      loop_id: `loop_${Date.now()}`,
      ...data,
      created_at: new Date().toISOString(),
    };
  },
  
  async scoreLoop(loop_id: string, scores: any) {
    return {
      loop_id,
      ...scores,
      scored_at: new Date().toISOString(),
    };
  },
  
  async getVelocity(email: string) {
    return {
      email,
      velocity_score: 3.8,
      active_loops: 5,
      completed_loops: 23,
      avg_outcome: 4.2,
    };
  },
};

// Create MCP server
const server = new Server(
  {
    name: 'aerostack-api-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_loops',
        description: 'List active Aerostack loops with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            owner_email: {
              type: 'string',
              description: 'Filter by loop owner email',
            },
            category: {
              type: 'string',
              enum: ['ENG', 'MSP', 'BD', 'GTM', 'ADVISORY'],
              description: 'Filter by category',
            },
            status: {
              type: 'string',
              enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'],
              description: 'Filter by status',
            },
            limit: {
              type: 'number',
              description: 'Max number of loops to return',
              default: 20,
            },
          },
        },
      },
      {
        name: 'create_loop',
        description: 'Create a new Aerostack loop',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Loop title',
            },
            owner_email: {
              type: 'string',
              description: 'Owner email address',
            },
            category: {
              type: 'string',
              enum: ['ENG', 'MSP', 'BD', 'GTM', 'ADVISORY'],
              description: 'Loop category',
            },
            priority: {
              type: 'number',
              minimum: 1,
              maximum: 5,
              description: 'Priority (1=highest, 5=lowest)',
            },
            description: {
              type: 'string',
              description: 'Loop description',
            },
            target_completion_date: {
              type: 'string',
              description: 'Target completion date (ISO 8601)',
            },
          },
          required: ['title', 'owner_email', 'category'],
        },
      },
      {
        name: 'score_loop',
        description: 'Score a loop\'s effort and outcome',
        inputSchema: {
          type: 'object',
          properties: {
            loop_id: {
              type: 'string',
              description: 'Loop ID to score',
            },
            effort_score: {
              type: 'number',
              minimum: 1,
              maximum: 5,
              description: 'Effort score (1=minimal, 5=huge)',
            },
            outcome_score: {
              type: 'number',
              minimum: 1,
              maximum: 5,
              description: 'Outcome score (1=failed, 5=exceeded)',
            },
            lesson: {
              type: 'string',
              description: 'Lesson learned (required for outcome >= 3)',
            },
          },
          required: ['loop_id'],
        },
      },
      {
        name: 'get_velocity',
        description: 'Get velocity score and stats for a person',
        inputSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'Person email address',
            },
          },
          required: ['email'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_loops': {
        const loops = await aerostackApiClient.listLoops(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(loops, null, 2),
            },
          ],
        };
      }

      case 'create_loop': {
        const loop = await aerostackApiClient.createLoop(args);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Loop created successfully:\n${JSON.stringify(loop, null, 2)}`,
            },
          ],
        };
      }

      case 'score_loop': {
        const result = await aerostackApiClient.scoreLoop(args.loop_id, args);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Loop scored successfully:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'get_velocity': {
        const velocity = await aerostackApiClient.getVelocity(args.email);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(velocity, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Aerostack API MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

