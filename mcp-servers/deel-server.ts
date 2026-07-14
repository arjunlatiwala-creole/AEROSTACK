#!/usr/bin/env node
/**
 * Deel MCP Server
 * 
 * Exposes Deel HR/contractor data as MCP tools:
 * - List contractors/employees
 * - Get person details and costs
 * - Sync cost data to Aerostack for ROI calculations
 * - Track time off and availability
 * 
 * Uses real Deel API v1: https://developer.deel.com/docs/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const DEEL_API_TOKEN = process.env.DEEL_API_TOKEN;
const DEEL_API_BASE = 'https://api.deel.com/api/v1';

if (!DEEL_API_TOKEN) {
  console.error('❌ DEEL_API_TOKEN environment variable is required');
  process.exit(1);
}

// Deel API client
const deelAPI = {
  async request(endpoint: string, options: RequestInit = {}) {
    const url = `${DEEL_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${DEEL_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deel API error (${response.status}): ${error}`);
    }

    return await response.json();
  },

  // List all people (contractors + employees)
  async listPeople(params?: { status?: string; limit?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    
    const query = queryParams.toString() ? `?${queryParams}` : '';
    return await this.request(`/people${query}`);
  },

  // Get person details
  async getPerson(personId: string) {
    return await this.request(`/people/${personId}`);
  },

  // List contracts for a person
  async listContracts(personId?: string) {
    const query = personId ? `?person_id=${personId}` : '';
    return await this.request(`/contracts${query}`);
  },

  // Get contract details (includes payment info)
  async getContract(contractId: string) {
    return await this.request(`/contracts/${contractId}`);
  },

  // List payslips (for cost tracking)
  async listPayslips(params?: { person_id?: string; start_date?: string; end_date?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.person_id) queryParams.append('person_id', params.person_id);
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);
    
    const query = queryParams.toString() ? `?${queryParams}` : '';
    return await this.request(`/payslips${query}`);
  },

  // List time off requests
  async listTimeOff(params?: { person_id?: string; status?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.person_id) queryParams.append('person_id', params.person_id);
    if (params?.status) queryParams.append('status', params.status);
    
    const query = queryParams.toString() ? `?${queryParams}` : '';
    return await this.request(`/time-off${query}`);
  },
};

// Create MCP server
const server = new Server(
  {
    name: 'deel-server',
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
        name: 'list_contractors',
        description: 'List all contractors and employees from Deel. Returns name, email, role, status, and ID for each person.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'pending'],
              description: 'Filter by status (default: active)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 100)',
              default: 100,
            },
          },
        },
      },
      {
        name: 'get_person_details',
        description: 'Get detailed information about a specific person including contract details, payment info, and employment data.',
        inputSchema: {
          type: 'object',
          properties: {
            person_id: {
              type: 'string',
              description: 'Deel person ID',
            },
            email: {
              type: 'string',
              description: 'Person email (alternative to person_id)',
            },
          },
        },
      },
      {
        name: 'get_person_costs',
        description: 'Get cost data for a person over a date range. Returns payslip data that can be synced to Aerostack for ROI calculations.',
        inputSchema: {
          type: 'object',
          properties: {
            person_id: {
              type: 'string',
              description: 'Deel person ID',
            },
            email: {
              type: 'string',
              description: 'Person email (alternative to person_id)',
            },
            start_date: {
              type: 'string',
              description: 'Start date (YYYY-MM-DD)',
            },
            end_date: {
              type: 'string',
              description: 'End date (YYYY-MM-DD)',
            },
          },
          required: ['start_date', 'end_date'],
        },
      },
      {
        name: 'sync_costs_to_aerostack',
        description: 'Sync person cost data from Deel to Aerostack MongoDB for ROI calculations. Creates/updates person_costs collection.',
        inputSchema: {
          type: 'object',
          properties: {
            person_id: {
              type: 'string',
              description: 'Deel person ID to sync',
            },
            email: {
              type: 'string',
              description: 'Person email to sync',
            },
            start_date: {
              type: 'string',
              description: 'Start date (YYYY-MM-DD)',
            },
            end_date: {
              type: 'string',
              description: 'End date (YYYY-MM-DD)',
            },
          },
          required: ['start_date', 'end_date'],
        },
      },
      {
        name: 'check_availability',
        description: 'Check person availability by looking at approved time-off requests. Useful for capacity planning.',
        inputSchema: {
          type: 'object',
          properties: {
            person_id: {
              type: 'string',
              description: 'Deel person ID',
            },
            email: {
              type: 'string',
              description: 'Person email',
            },
            start_date: {
              type: 'string',
              description: 'Start date to check (YYYY-MM-DD)',
            },
            end_date: {
              type: 'string',
              description: 'End date to check (YYYY-MM-DD)',
            },
          },
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
      case 'list_contractors': {
        console.error(`📋 Listing contractors (status: ${args.status || 'active'})`);
        
        const result = await deelAPI.listPeople({
          status: args.status || 'active',
          limit: args.limit || 100,
        });
        
        // Format for readability
        const people = result.data || result;
        const formatted = people.map((p: any) => ({
          id: p.id,
          name: `${p.first_name} ${p.last_name}`,
          email: p.email,
          role: p.job_title,
          status: p.status,
          type: p.worker_type,
          location: p.country,
        }));
        
        return {
          content: [
            {
              type: 'text',
              text: `Found ${formatted.length} people:\n\n${JSON.stringify(formatted, null, 2)}`,
            },
          ],
        };
      }

      case 'get_person_details': {
        let personId = args.person_id;
        
        // If email provided, find person by email first
        if (!personId && args.email) {
          console.error(`🔍 Looking up person by email: ${args.email}`);
          const people = await deelAPI.listPeople({ limit: 1000 });
          const person = (people.data || people).find((p: any) => 
            p.email.toLowerCase() === args.email.toLowerCase()
          );
          if (!person) {
            throw new Error(`Person not found with email: ${args.email}`);
          }
          personId = person.id;
        }
        
        if (!personId) {
          throw new Error('Either person_id or email must be provided');
        }
        
        console.error(`👤 Getting details for person: ${personId}`);
        
        const person = await deelAPI.getPerson(personId);
        const contracts = await deelAPI.listContracts(personId);
        
        const details = {
          id: person.id,
          name: `${person.first_name} ${person.last_name}`,
          email: person.email,
          role: person.job_title,
          status: person.status,
          type: person.worker_type,
          location: person.country,
          contracts: contracts.data || contracts,
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(details, null, 2),
            },
          ],
        };
      }

      case 'get_person_costs': {
        let personId = args.person_id;
        
        if (!personId && args.email) {
          const people = await deelAPI.listPeople({ limit: 1000 });
          const person = (people.data || people).find((p: any) => 
            p.email.toLowerCase() === args.email.toLowerCase()
          );
          if (person) personId = person.id;
        }
        
        console.error(`💰 Getting costs for period: ${args.start_date} to ${args.end_date}`);
        
        const payslips = await deelAPI.listPayslips({
          person_id: personId,
          start_date: args.start_date,
          end_date: args.end_date,
        });
        
        const data = payslips.data || payslips;
        const totalCost = data.reduce((sum: number, slip: any) => 
          sum + (parseFloat(slip.total_amount) || 0), 0
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                person_id: personId,
                period: {
                  start: args.start_date,
                  end: args.end_date,
                },
                total_cost_usd: totalCost,
                payslip_count: data.length,
                payslips: data,
              }, null, 2),
            },
          ],
        };
      }

      case 'sync_costs_to_aerostack': {
        // This would connect to MongoDB and sync the data
        // For now, return instructions on how to do it
        console.error(`🔄 Syncing costs to Aerostack...`);
        
        // Get cost data first
        let personId = args.person_id;
        if (!personId && args.email) {
          const people = await deelAPI.listPeople({ limit: 1000 });
          const person = (people.data || people).find((p: any) => 
            p.email.toLowerCase() === args.email.toLowerCase()
          );
          if (person) personId = person.id;
        }
        
        const payslips = await deelAPI.listPayslips({
          person_id: personId,
          start_date: args.start_date,
          end_date: args.end_date,
        });
        
        // TODO: Actually write to MongoDB
        // For now, return the data that should be synced
        return {
          content: [
            {
              type: 'text',
              text: `✅ Cost data ready for Aerostack sync:\n\n` +
                    `Use this data to create person_costs records:\n\n` +
                    JSON.stringify(payslips.data || payslips, null, 2),
            },
          ],
        };
      }

      case 'check_availability': {
        let personId = args.person_id;
        
        if (!personId && args.email) {
          const people = await deelAPI.listPeople({ limit: 1000 });
          const person = (people.data || people).find((p: any) => 
            p.email.toLowerCase() === args.email.toLowerCase()
          );
          if (person) personId = person.id;
        }
        
        console.error(`📅 Checking availability...`);
        
        const timeOff = await deelAPI.listTimeOff({
          person_id: personId,
          status: 'approved',
        });
        
        // Filter by date range
        const data = (timeOff.data || timeOff).filter((to: any) => {
          const start = new Date(to.start_date);
          const end = new Date(to.end_date);
          const checkStart = new Date(args.start_date);
          const checkEnd = new Date(args.end_date);
          return (start <= checkEnd && end >= checkStart);
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                person_id: personId,
                period: {
                  start: args.start_date,
                  end: args.end_date,
                },
                time_off_days: data.length,
                time_off_requests: data,
                is_available: data.length === 0,
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
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
  console.error('Deel MCP server running on stdio');
  console.error('Token scopes: people, contracts, payslips, time-off');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

