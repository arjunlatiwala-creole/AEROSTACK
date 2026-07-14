import { SquidService, executable } from '@squidcloud/backend';
import { 
  SlackModalNewLoop, 
  SlackModalScoreLoop,
  CreateLoopRequest,
  ScoreOutcomeRequest,
  LoopTabular,
  SlackWorkflowTrigger,
  SlackNotification,
  Loop,
  EngineeringWorkItem,
  LoopFinancials,
} from '@enterprise/common';
import { AerostackService } from './aerostack-service';

interface SlackUser {
  id: string;
  email: string;
  name: string;
}

interface SlackCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

interface SlackInteraction {
  type: string;
  callback_id: string;
  user: SlackUser;
  trigger_id: string;
  submission?: Record<string, string>;
}

export class SlackService extends SquidService {
  private aerostackService = new AerostackService();

  @executable()
  async handleSlashCommand(payload: SlackCommand): Promise<any> {
    try {
      const { command, text, user_id, trigger_id, user_name } = payload;

      // Get user email from Slack user info
      const userEmail = await this.getSlackUserEmail(user_id);

      switch (command) {
        case '/aerostack':
          return this.handleAerostackCommand(text, trigger_id, userEmail, user_name);
        default:
          return this.createErrorResponse(`Unknown command: ${command}`);
      }
    } catch (error: any) {
      console.error('Error handling slash command:', error);
      return this.createErrorResponse('Failed to process command');
    }
  }

  private async handleAerostackCommand(
    text: string, 
    triggerId: string, 
    userEmail: string, 
    userName: string
  ): Promise<any> {
    const args = text.trim().split(' ');
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'new':
        return this.openNewLoopModal(triggerId, userEmail);
      
      case 'score':
        const loopId = args[1];
        if (!loopId) {
          return this.createTextResponse('Usage: /aerostack score <loop_id>');
        }
        return this.openScoreLoopModal(triggerId, loopId, userEmail);
      
      case 'list':
        return this.listOpenLoops(userEmail);
      
      default:
        return this.createTextResponse(
          'Available commands:\n' +
          '• `/aerostack new` - Create a new loop\n' +
          '• `/aerostack score <loop_id>` - Score a loop outcome\n' +
          '• `/aerostack list` - List your open loops'
        );
    }
  }

  private async openNewLoopModal(triggerId: string, userEmail: string): Promise<any> {
    const modal = {
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'new_loop_modal',
        title: {
          type: 'plain_text',
          text: 'Create New Loop'
        },
        submit: {
          type: 'plain_text',
          text: 'Create'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'title',
            label: {
              type: 'plain_text',
              text: 'Title'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'title_input',
              placeholder: {
                type: 'plain_text',
                text: 'MVP Launch in a Box – ACME'
              }
            }
          },
          {
            type: 'input',
            block_id: 'description',
            label: {
              type: 'plain_text',
              text: 'Description'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'description_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Scope, infra, showcase by EOW'
              }
            },
            optional: true
          },
          {
            type: 'input',
            block_id: 'loop_type',
            label: {
              type: 'plain_text',
              text: 'Type'
            },
            element: {
              type: 'static_select',
              action_id: 'type_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select loop type'
              },
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: 'Objective'
                  },
                  value: 'OBJECTIVE'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Key Result'
                  },
                  value: 'KEY_RESULT'
                }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'category',
            label: {
              type: 'plain_text',
              text: 'Category'
            },
            element: {
              type: 'static_select',
              action_id: 'category_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select category'
              },
              options: [
                { text: { type: 'plain_text', text: 'Engineering' }, value: 'ENG' },
                { text: { type: 'plain_text', text: 'MSP' }, value: 'MSP' },
                { text: { type: 'plain_text', text: 'Go-to-Market' }, value: 'GTM' },
                { text: { type: 'plain_text', text: 'Business Development' }, value: 'BD' },
                { text: { type: 'plain_text', text: 'Finance' }, value: 'OPS:Finance' },
                { text: { type: 'plain_text', text: 'HR' }, value: 'OPS:HR' },
                { text: { type: 'plain_text', text: 'Sales Operations' }, value: 'OPS:SalesOps' },
                { text: { type: 'plain_text', text: 'Learning & Development' }, value: 'LND' },
                { text: { type: 'plain_text', text: 'Advisory' }, value: 'ADVISORY' }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'priority',
            label: {
              type: 'plain_text',
              text: 'Priority'
            },
            element: {
              type: 'static_select',
              action_id: 'priority_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select priority'
              },
              initial_option: {
                text: { type: 'plain_text', text: '3 - Normal' },
                value: '3'
              },
              options: [
                { text: { type: 'plain_text', text: '1 - Critical' }, value: '1' },
                { text: { type: 'plain_text', text: '2 - High' }, value: '2' },
                { text: { type: 'plain_text', text: '3 - Normal' }, value: '3' },
                { text: { type: 'plain_text', text: '4 - Low' }, value: '4' },
                { text: { type: 'plain_text', text: '5 - Deferred' }, value: '5' }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'target_date',
            label: {
              type: 'plain_text',
              text: 'Target Completion Date'
            },
            element: {
              type: 'datepicker',
              action_id: 'target_date_picker',
              placeholder: {
                type: 'plain_text',
                text: 'Select target date'
              }
            },
            optional: true
          },
          {
            type: 'input',
            block_id: 'tags',
            label: {
              type: 'plain_text',
              text: 'Tags'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'tags_input',
              placeholder: {
                type: 'plain_text',
                text: 'revgen, channel/aws (comma-separated)'
              }
            },
            optional: true
          },
          {
            type: 'input',
            block_id: 'jira_key',
            label: {
              type: 'plain_text',
              text: 'Jira Key'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'jira_key_input',
              placeholder: {
                type: 'plain_text',
                text: 'Aerostack-123 (optional - will auto-generate)'
              }
            },
            optional: true
          }
        ]
      }
    };

    return this.openModal(modal);
  }

  private async openScoreLoopModal(triggerId: string, loopId: string, userEmail: string): Promise<any> {
    try {
      // Verify loop exists and user has permission
      const loop = await this.aerostackService.getLoop(loopId);
      
      const modal = {
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'score_loop_modal',
          private_metadata: loopId,
          title: {
            type: 'plain_text',
            text: 'Score Loop Outcome'
          },
          submit: {
            type: 'plain_text',
            text: 'Score'
          },
          close: {
            type: 'plain_text',
            text: 'Cancel'
          },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${loop.title}*\nLoop ID: ${loopId}`
              }
            },
            {
              type: 'input',
              block_id: 'outcome_score',
              label: {
                type: 'plain_text',
                text: 'Outcome Score (1-5)'
              },
              element: {
                type: 'static_select',
                action_id: 'outcome_score_select',
                placeholder: {
                  type: 'plain_text',
                  text: 'Select outcome score'
                },
                options: [
                  { text: { type: 'plain_text', text: '1 - Poor' }, value: '1' },
                  { text: { type: 'plain_text', text: '2 - Below Average' }, value: '2' },
                  { text: { type: 'plain_text', text: '3 - Average' }, value: '3' },
                  { text: { type: 'plain_text', text: '4 - Good' }, value: '4' },
                  { text: { type: 'plain_text', text: '5 - Excellent' }, value: '5' }
                ]
              }
            },
            {
              type: 'input',
              block_id: 'contributors',
              label: {
                type: 'plain_text',
                text: 'Contributors'
              },
              element: {
                type: 'plain_text_input',
                action_id: 'contributors_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'email1@enterprise.io:0.25, email2@enterprise.io:0.25'
                }
              },
              optional: true
            },
            {
              type: 'input',
              block_id: 'lesson_abstract',
              label: {
                type: 'plain_text',
                text: 'Lesson Abstract (≤280 chars)'
              },
              element: {
                type: 'plain_text_input',
                action_id: 'lesson_abstract_input',
                multiline: true,
                max_length: 280,
                placeholder: {
                  type: 'plain_text',
                  text: 'Cut ETL cost 40% via S3 events; zero downtime.'
                }
              },
              optional: true
            },
            {
              type: 'input',
              block_id: 'lesson_tags',
              label: {
                type: 'plain_text',
                text: 'Lesson Tags'
              },
              element: {
                type: 'plain_text_input',
                action_id: 'lesson_tags_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'aws, cost-optimization (comma-separated)'
                }
              },
              optional: true
            },
            {
              type: 'input',
              block_id: 'lesson_reuse',
              label: {
                type: 'plain_text',
                text: 'Reuse Notes'
              },
              element: {
                type: 'plain_text_input',
                action_id: 'lesson_reuse_input',
                multiline: true,
                placeholder: {
                  type: 'plain_text',
                  text: 'Template IaC module; replicate to Customer-123.'
                }
              },
              optional: true
            }
          ]
        }
      };

      return this.openModal(modal);
    } catch (error: any) {
      return this.createErrorResponse(`Failed to open score modal: ${error.message}`);
    }
  }

  @executable()
  async handleModalSubmission(payload: SlackInteraction): Promise<any> {
    try {
      const { callback_id, submission, user } = payload;

      switch (callback_id) {
        case 'new_loop_modal':
          return this.handleNewLoopSubmission(submission!, user.email);
        
        case 'score_loop_modal':
          const loopId = payload.submission?.loop_id || '';
          return this.handleScoreLoopSubmission(submission!, loopId, user.email);
        
        default:
          return this.createErrorResponse(`Unknown modal: ${callback_id}`);
      }
    } catch (error: any) {
      console.error('Error handling modal submission:', error);
      return this.createErrorResponse('Failed to process modal submission');
    }
  }

  private async handleNewLoopSubmission(submission: Record<string, string>, userEmail: string): Promise<any> {
    try {
      const tags = submission.tags ? 
        submission.tags.split(',').map(tag => tag.trim()).filter(Boolean) : 
        [];

      const request: CreateLoopRequest = {
        title: submission.title,
        description: submission.description || undefined,
        loop_type: submission.loop_type as any,
        category: submission.category as any,
        owner_email: userEmail,
        target_completion_date: submission.target_date || undefined,
        priority: submission.priority ? parseInt(submission.priority) : 3,
        tags,
        jira_key: submission.jira_key || undefined,
      };

      const result = await this.aerostackService.createLoop(request);

      return {
        response_type: 'ephemeral',
        text: `✅ Loop created successfully!\n` +
              `• ID: ${result.loop_id}\n` +
              `• Pillar: ${result.pillar}\n` +
              `• Jira: ${result.jira_key || 'Auto-generated'}`
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to create loop: ${error.message}`);
    }
  }

  private async handleScoreLoopSubmission(
    submission: Record<string, string>, 
    loopId: string, 
    userEmail: string
  ): Promise<any> {
    try {
      const contributors = submission.contributors ? 
        submission.contributors.split(',').map(contrib => {
          const [email, share] = contrib.trim().split(':');
          return { email: email.trim(), share: parseFloat(share) };
        }).filter(c => c.email && !isNaN(c.share)) : 
        [];

      const lessonTags = submission.lesson_tags ? 
        submission.lesson_tags.split(',').map(tag => tag.trim()).filter(Boolean) : 
        [];

      const request: ScoreOutcomeRequest = {
        loop_id: loopId,
        outcome_score: parseInt(submission.outcome_score),
        contributors: contributors.length > 0 ? contributors : undefined,
        lesson: submission.lesson_abstract ? {
          abstract: submission.lesson_abstract,
          tags: lessonTags,
          reuse_notes: submission.lesson_reuse || undefined,
        } : undefined,
      };

      await this.aerostackService.scoreOutcome(request);

      return {
        response_type: 'ephemeral',
        text: `✅ Loop scored successfully!\n` +
              `• Outcome Score: ${submission.outcome_score}/5\n` +
              `• Contributors: ${contributors.length}\n` +
              `• Lesson: ${submission.lesson_abstract ? 'Added' : 'None'}`
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to score loop: ${error.message}`);
    }
  }

  private async listOpenLoops(userEmail: string): Promise<any> {
    try {
      const loops = await this.aerostackService.listLoops({
        owner_email: userEmail,
        status: 'IN_PROGRESS',
        page_size: 10,
      });

      if (loops.data.length === 0) {
        return this.createTextResponse('No open loops found.');
      }

      const loopList = loops.data.map((loop: LoopTabular) => 
        `• *${loop.title}* (${loop.loop_id.slice(-6)}) - Priority ${loop.priority} - ${loop.category}`
      ).join('\n');

      return this.createTextResponse(
        `*Your Open Loops (${loops.data.length}/${loops.total_count}):*\n${loopList}\n\n` +
        `Use \`/aerostack score <loop_id>\` to score a completed loop.`
      );
    } catch (error: any) {
      return this.createErrorResponse(`Failed to list loops: ${error.message}`);
    }
  }

  private async getSlackUserEmail(userId: string): Promise<string> {
    // TODO: Implement Slack API call to get user email
    // For now, return a placeholder - in production you'd call Slack's users.info API
    return `${userId}@enterprise.io`;
  }

  private openModal(modal: any): any {
    // TODO: Implement Slack modal opening
    // This would use Slack's views.open API
    return {
      response_type: 'ephemeral',
      text: 'Modal would open here (not implemented in showcase)'
    };
  }

  private createTextResponse(text: string): any {
    return {
      response_type: 'ephemeral',
      text
    };
  }

  private createErrorResponse(error: string): any {
    return {
      response_type: 'ephemeral',
      text: `❌ Error: ${error}`
    };
  }

  // =============================================
  // Slack Workflow Triggers & Notifications
  // =============================================

  @executable()
  async createTrigger(trigger: Omit<SlackWorkflowTrigger, 'trigger_id' | 'created_at'>): Promise<SlackWorkflowTrigger> {
    try {
      const triggerId = this.generateId();
      const newTrigger: Omit<SlackWorkflowTrigger, '__id'> = {
        trigger_id: triggerId,
        workflow_type: trigger.workflow_type,
        channel_id: trigger.channel_id,
        conditions: trigger.conditions,
        message_template: trigger.message_template,
        enabled: trigger.enabled !== undefined ? trigger.enabled : true,
        created_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<SlackWorkflowTrigger>('slack_triggers').doc(triggerId).insert(newTrigger);

      return newTrigger as SlackWorkflowTrigger;
    } catch (error: any) {
      console.error('Error creating Slack trigger:', error);
      throw error;
    }
  }

  @executable()
  async listTriggers(): Promise<SlackWorkflowTrigger[]> {
    try {
      const query = this.squid.collection<SlackWorkflowTrigger>('slack_triggers').query();
      const snapshot = await query.snapshot();
      return snapshot.map((doc: any) => (doc.data || doc) as SlackWorkflowTrigger);
    } catch (error: any) {
      console.error('Error listing Slack triggers:', error);
      return [];
    }
  }

  @executable()
  async updateTrigger(triggerId: string, updates: Partial<SlackWorkflowTrigger>): Promise<{ success: boolean }> {
    try {
      const triggerRef = this.squid.collection<SlackWorkflowTrigger>('slack_triggers').doc(triggerId);
      await triggerRef.update(updates as any);
      return { success: true };
    } catch (error: any) {
      console.error('Error updating Slack trigger:', error);
      return { success: false };
    }
  }

  @executable()
  async deleteTrigger(triggerId: string): Promise<{ success: boolean }> {
    try {
      const triggerRef = this.squid.collection<SlackWorkflowTrigger>('slack_triggers').doc(triggerId);
      await triggerRef.delete();
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting Slack trigger:', error);
      return { success: false };
    }
  }

  @executable()
  async sendNotification(
    workflowType: SlackWorkflowTrigger['workflow_type'],
    channelId: string,
    message: string,
    metadata: Record<string, any> = {}
  ): Promise<SlackNotification> {
    try {
      const notificationId = this.generateId();
      const notification: Omit<SlackNotification, '__id'> = {
        notification_id: notificationId,
        trigger_type: workflowType,
        channel_id: channelId,
        message,
        metadata,
        sent_at: new Date().toISOString(),
      } as any;

      // TODO: Actually send to Slack API here
      // For now, just store the notification
      await this.squid.collection<SlackNotification>('slack_notifications').doc(notificationId).insert(notification);

      console.log(`[SLACK] Would send to ${channelId}: ${message}`);

      return notification as SlackNotification;
    } catch (error: any) {
      console.error('Error sending Slack notification:', error);
      throw error;
    }
  }

  @executable()
  async checkAndFireTriggers(): Promise<{ fired_count: number }> {
    try {
      const triggers = await this.listTriggers();
      const enabledTriggers = triggers.filter(t => t.enabled);
      
      let firedCount = 0;

      for (const trigger of enabledTriggers) {
        const shouldFire = await this.evaluateTrigger(trigger);
        if (shouldFire) {
          await this.fireTrigger(trigger);
          firedCount++;
        }
      }

      return { fired_count: firedCount };
    } catch (error: any) {
      console.error('Error checking triggers:', error);
      return { fired_count: 0 };
    }
  }

  private async evaluateTrigger(trigger: SlackWorkflowTrigger): Promise<boolean> {
    try {
      switch (trigger.workflow_type) {
        case 'loop_complete':
          return await this.checkLoopComplete(trigger.conditions);
        
        case 'deal_won':
          return await this.checkDealWon(trigger.conditions);
        
        case 'eng_blocked':
          return await this.checkEngBlocked(trigger.conditions);
        
        case 'budget_alert':
          return await this.checkBudgetAlert(trigger.conditions);
        
        case 'okr_at_risk':
          return await this.checkOkrAtRisk(trigger.conditions);
        
        default:
          return false;
      }
    } catch (error: any) {
      console.error('Error evaluating trigger:', error);
      return false;
    }
  }

  private async checkLoopComplete(conditions: Record<string, any>): Promise<boolean> {
    // Check if any loops completed in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const query = this.squid.collection<Loop>('loops').query();
    const loops = await query.eq('status', 'COMPLETED').snapshot();
    
    return loops.some((loop: any) => {
      const loopData = loop.data || loop;
      return loopData.updated_at >= oneHourAgo;
    });
  }

  private async checkDealWon(conditions: Record<string, any>): Promise<boolean> {
    // Check for recently won deals
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const query = this.squid.collection<any>('deals').query();
    const deals = await query.eq('phase', 'CLOSED_WON').snapshot();
    
    return deals.some((deal: any) => {
      const dealData = deal.data || deal;
      return dealData.updated_at >= oneHourAgo;
    });
  }

  private async checkEngBlocked(conditions: Record<string, any>): Promise<boolean> {
    // Check for newly blocked engineering work
    const query = this.squid.collection<EngineeringWorkItem>('engineering_work').query();
    const work = await query.eq('status', 'blocked').snapshot();
    return work.length > 0;
  }

  private async checkBudgetAlert(conditions: Record<string, any>): Promise<boolean> {
    // Check for loops over budget
    const query = this.squid.collection<LoopFinancials>('loop_financials').query();
    const financials = await query.snapshot();
    
    return financials.some((fin: any) => {
      const finData = fin.data || fin;
      const budget = finData.budget_usd || 0;
      const actual = finData.actual_spend_usd || 0;
      return actual > budget * (conditions.threshold || 0.9);
    });
  }

  private async checkOkrAtRisk(conditions: Record<string, any>): Promise<boolean> {
    // Check for OKRs at risk (approaching deadline with low progress)
    const query = this.squid.collection<Loop>('loops').query();
    const loops = await query.eq('loop_type', 'OBJECTIVE').snapshot();
    
    return loops.some((loop: any) => {
      const loopData = loop.data || loop;
      // Simple heuristic: no effort score yet but within 2 weeks of target
      if (!loopData.effort_score && loopData.target_completion_date) {
        const targetDate = new Date(loopData.target_completion_date);
        const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        return targetDate <= twoWeeksFromNow;
      }
      return false;
    });
  }

  private async fireTrigger(trigger: SlackWorkflowTrigger): Promise<void> {
    try {
      const message = this.formatMessage(trigger.message_template, trigger.conditions);
      await this.sendNotification(
        trigger.workflow_type,
        trigger.channel_id,
        message,
        { trigger_id: trigger.trigger_id }
      );
    } catch (error: any) {
      console.error('Error firing trigger:', error);
    }
  }

  private formatMessage(template: string, data: Record<string, any>): string {
    // Simple template replacement
    let message = template;
    for (const [key, value] of Object.entries(data)) {
      message = message.replace(`{{${key}}}`, String(value));
    }
    return message;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
