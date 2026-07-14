#!/usr/bin/env node
/**
 * Engagement Tools MCP Server
 * 
 * Exposes engagement and visibility tools that can be called by:
 * - AI agents (Claude, GPT, etc.)
 * - Human users via MCP Dashboard
 * - Slack commands (/aerostack engage)
 * 
 * Tools provided:
 * - generate_visibility_post: Create visibility/engagement content
 * - format_slack_announcement: Format content for Slack posting
 * - create_customer_update: Generate customer-facing updates
 * - draft_team_communication: Create internal team communications
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Engagement tools implementation
const engagementTools = {
  /**
   * Generate visibility/engagement content based on Aerostack loop data
   */
  async generateVisibilityPost(params: {
    loop_id?: string;
    loop_title?: string;
    achievement?: string;
    audience: 'internal' | 'customer' | 'public';
    tone: 'professional' | 'casual' | 'technical';
    include_metrics?: boolean;
  }) {
    const { loop_title, achievement, audience, tone, include_metrics } = params;
    
    // In production, this would call your AI service or use templates
    const templates = {
      internal: {
        professional: `🎯 Achievement Update\n\n${loop_title ? `Loop: ${loop_title}\n` : ''}${achievement}\n\n${include_metrics ? 'Key Metrics:\n• [Metric 1]\n• [Metric 2]\n\n' : ''}Great work team! 💪`,
        casual: `Hey team! 🎉\n\n${achievement}\n\n${loop_title ? `(Part of: ${loop_title})\n\n` : ''}Keep crushing it! 🚀`,
        technical: `Technical Achievement:\n\n${achievement}\n\n${loop_title ? `Associated Loop: ${loop_title}\n` : ''}${include_metrics ? '\nPerformance Impact:\n• [Technical metric 1]\n• [Technical metric 2]' : ''}`
      },
      customer: {
        professional: `Dear valued customer,\n\nWe're excited to share an important update:\n\n${achievement}\n\nThis enhancement showcasenstrates our commitment to delivering exceptional value.\n\nBest regards,\nThe Team`,
        casual: `Hi there! 👋\n\nWe've got some exciting news to share:\n\n${achievement}\n\nWe hope you love it as much as we do!\n\nCheers! 🎉`,
        technical: `Product Update:\n\n${achievement}\n\n${include_metrics ? 'Impact:\n• [Customer-facing metric 1]\n• [Customer-facing metric 2]\n\n' : ''}For technical details, please refer to our documentation.`
      },
      public: {
        professional: `We're pleased to announce:\n\n${achievement}\n\n${loop_title ? `This milestone is part of our ${loop_title} initiative.\n\n` : ''}Learn more at [link]`,
        casual: `Exciting news! 🎊\n\n${achievement}\n\nWant to know more? Check out [link]`,
        technical: `Technical Announcement:\n\n${achievement}\n\n${include_metrics ? 'Key Improvements:\n• [Public metric 1]\n• [Public metric 2]\n\n' : ''}Documentation: [link]`
      }
    };
    
    const content = templates[audience][tone];
    
    return {
      content,
      audience,
      tone,
      character_count: content.length,
      suggested_channels: audience === 'internal' ? ['#team-updates', '#wins'] : 
                         audience === 'customer' ? ['#customer-announcements'] : 
                         ['#public-announcements'],
      metadata: {
        loop_id: params.loop_id,
        loop_title,
        generated_at: new Date().toISOString()
      }
    };
  },

  /**
   * Format content specifically for Slack with proper formatting
   */
  async formatSlackAnnouncement(params: {
    title: string;
    content: string;
    include_reactions?: boolean;
    mention_users?: string[];
    add_thread_prompt?: boolean;
  }) {
    const { title, content, include_reactions, mention_users, add_thread_prompt } = params;
    
    let formatted = `*${title}*\n\n${content}`;
    
    if (mention_users && mention_users.length > 0) {
      formatted = `${mention_users.map(u => `<@${u}>`).join(' ')} \n\n${formatted}`;
    }
    
    if (add_thread_prompt) {
      formatted += `\n\n_💬 Share your thoughts in the thread below!_`;
    }
    
    const suggestedReactions = include_reactions ? ['🎉', '👏', '🚀', '💪', '✅'] : [];
    
    return {
      formatted_message: formatted,
      suggested_reactions: suggestedReactions,
      estimated_length: formatted.length,
      slack_blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: title
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: content
          }
        }
      ]
    };
  },

  /**
   * Generate customer-facing update from loop completion
   */
  async createCustomerUpdate(params: {
    loop_id: string;
    customer_name: string;
    feature_description: string;
    benefits: string[];
    include_next_steps?: boolean;
  }) {
    const { customer_name, feature_description, benefits, include_next_steps } = params;
    
    const benefitsList = benefits.map(b => `• ${b}`).join('\n');
    
    const update = `Hi ${customer_name} team! 👋

We're excited to share that we've completed work on: ${feature_description}

Key Benefits:
${benefitsList}

${include_next_steps ? `Next Steps:
• We'll schedule a showcase session
• Documentation will be shared within 24 hours
• Our team is available for any questions

` : ''}Looking forward to your feedback!

Best regards,
Your Partner Team`;
    
    return {
      update,
      customer_name,
      word_count: update.split(' ').length,
      suggested_delivery: 'email',
      follow_up_actions: include_next_steps ? [
        'Schedule showcase',
        'Share documentation',
        'Set up feedback session'
      ] : []
    };
  },

  /**
   * Draft internal team communication
   */
  async draftTeamCommunication(params: {
    communication_type: 'standup' | 'retrospective' | 'announcement' | 'blocker';
    subject: string;
    details: string;
    action_items?: string[];
    urgent?: boolean;
  }) {
    const { communication_type, subject, details, action_items, urgent } = params;
    
    const urgencyFlag = urgent ? '🚨 URGENT: ' : '';
    const emoji = {
      standup: '📊',
      retrospective: '🔄',
      announcement: '📢',
      blocker: '🚧'
    }[communication_type];
    
    let message = `${urgencyFlag}${emoji} ${subject}\n\n${details}`;
    
    if (action_items && action_items.length > 0) {
      message += `\n\nAction Items:\n${action_items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
    }
    
    return {
      message,
      communication_type,
      urgent: urgent || false,
      suggested_channels: communication_type === 'blocker' ? ['#engineering', '#urgent'] :
                         communication_type === 'standup' ? ['#daily-standup'] :
                         communication_type === 'retrospective' ? ['#retros'] :
                         ['#general'],
      requires_response: communication_type === 'blocker' || urgent,
      metadata: {
        created_at: new Date().toISOString(),
        type: communication_type
      }
    };
  }
};

// Create MCP server
const server = new Server(
  {
    name: 'engagement-tools-server',
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
        name: 'generate_visibility_post',
        description: 'Generate visibility/engagement content based on Aerostack loop achievements. Perfect for sharing wins and updates.',
        inputSchema: {
          type: 'object',
          properties: {
            loop_id: {
              type: 'string',
              description: 'Aerostack loop ID (optional)',
            },
            loop_title: {
              type: 'string',
              description: 'Title of the loop or achievement',
            },
            achievement: {
              type: 'string',
              description: 'Description of what was achieved',
            },
            audience: {
              type: 'string',
              enum: ['internal', 'customer', 'public'],
              description: 'Target audience for the post',
            },
            tone: {
              type: 'string',
              enum: ['professional', 'casual', 'technical'],
              description: 'Tone of the communication',
            },
            include_metrics: {
              type: 'boolean',
              description: 'Whether to include metrics placeholders',
              default: false,
            },
          },
          required: ['achievement', 'audience', 'tone'],
        },
      },
      {
        name: 'format_slack_announcement',
        description: 'Format content for Slack with proper markdown, mentions, and blocks. Optimized for Slack posting.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Announcement title',
            },
            content: {
              type: 'string',
              description: 'Main content of the announcement',
            },
            include_reactions: {
              type: 'boolean',
              description: 'Suggest emoji reactions',
              default: true,
            },
            mention_users: {
              type: 'array',
              items: { type: 'string' },
              description: 'Slack user IDs to mention',
            },
            add_thread_prompt: {
              type: 'boolean',
              description: 'Add a prompt to encourage thread discussion',
              default: false,
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'create_customer_update',
        description: 'Generate professional customer-facing updates from loop completions. Includes benefits and next steps.',
        inputSchema: {
          type: 'object',
          properties: {
            loop_id: {
              type: 'string',
              description: 'Aerostack loop ID',
            },
            customer_name: {
              type: 'string',
              description: 'Customer or company name',
            },
            feature_description: {
              type: 'string',
              description: 'Description of the completed feature/work',
            },
            benefits: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of benefits for the customer',
            },
            include_next_steps: {
              type: 'boolean',
              description: 'Include next steps section',
              default: true,
            },
          },
          required: ['loop_id', 'customer_name', 'feature_description', 'benefits'],
        },
      },
      {
        name: 'draft_team_communication',
        description: 'Draft internal team communications for standups, retros, announcements, or blockers.',
        inputSchema: {
          type: 'object',
          properties: {
            communication_type: {
              type: 'string',
              enum: ['standup', 'retrospective', 'announcement', 'blocker'],
              description: 'Type of team communication',
            },
            subject: {
              type: 'string',
              description: 'Subject or title of the communication',
            },
            details: {
              type: 'string',
              description: 'Detailed content',
            },
            action_items: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of action items',
            },
            urgent: {
              type: 'boolean',
              description: 'Mark as urgent',
              default: false,
            },
          },
          required: ['communication_type', 'subject', 'details'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    
    switch (name) {
      case 'generate_visibility_post':
        result = await engagementTools.generateVisibilityPost(args as any);
        break;
      
      case 'format_slack_announcement':
        result = await engagementTools.formatSlackAnnouncement(args as any);
        break;
      
      case 'create_customer_update':
        result = await engagementTools.createCustomerUpdate(args as any);
        break;
      
      case 'draft_team_communication':
        result = await engagementTools.draftTeamCommunication(args as any);
        break;
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
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
  console.error('Engagement Tools MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
