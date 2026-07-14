import { SquidService, executable } from '@squidcloud/backend';
import type {
  IntegrationConfig,
  IntegrationSyncHistory,
  IntegrationHealthCheck,
  IntegrationsOverview,
  IntegrationType,
  SaveIntegrationConfigRequest,
  TriggerSyncRequest,
  TriggerSyncResponse,
  GetSyncHistoryRequest,
  TestIntegrationRequest,
  TestIntegrationResponse,
  ApiError,
} from '@enterprise/common';

export class IntegrationsManagementService extends SquidService {
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }

  // =============================================
  // Overview & Status
  // =============================================

  @executable()
  async getIntegrationsOverview(): Promise<IntegrationsOverview> {
    try {
      // Fetch all integration configs
      const configsQuery = this.squid.collection<IntegrationConfig>('integration_configs').query();
      const configsSnapshot = await configsQuery.snapshot();
      const configs = this.toArrayData<IntegrationConfig>(configsSnapshot);

      const integrations = configs.map(config => ({
        type: config.integration_type,
        name: config.name,
        status: config.status,
        enabled: config.enabled,
        last_sync: config.last_sync_at,
        sync_status: config.sync_status,
        error_message: config.status === 'error' ? 'Configuration error' : undefined
      }));

      // Get recent syncs
      const syncsQuery = this.squid.collection<IntegrationSyncHistory>('integration_sync_history').query();
      const syncsSnapshot = await syncsQuery.snapshot();
      const allSyncs = this.toArrayData<IntegrationSyncHistory>(syncsSnapshot);
      const recentSyncs = allSyncs
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 10);

      // Perform health checks
      const healthChecks = await Promise.all(
        configs.map(config => this.checkIntegrationHealth(config))
      );

      return {
        total_integrations: configs.length,
        connected_count: configs.filter(c => c.status === 'connected').length,
        error_count: configs.filter(c => c.status === 'error').length,
        integrations,
        recent_syncs: recentSyncs,
        health_checks: healthChecks
      };
    } catch (error: any) {
      console.error('Error getting integrations overview:', error);
      throw {
        error: {
          code: 'GET_OVERVIEW_FAILED',
          message: 'Failed to get integrations overview',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Configuration Management
  // =============================================

  @executable()
  async getIntegrationConfig(integrationType: IntegrationType): Promise<IntegrationConfig | null> {
    try {
      const query = this.squid.collection<IntegrationConfig>('integration_configs').query();
      const snapshot = await query.eq('integration_type', integrationType).snapshot();
      
      if (snapshot.length === 0) {
        // Return default config
        return this.createDefaultConfig(integrationType);
      }
      
      return this.toData<IntegrationConfig>(snapshot[0]);
    } catch (error: any) {
      console.error(`Error getting ${integrationType} config:`, error);
      return null;
    }
  }

  @executable()
  async saveIntegrationConfig(request: SaveIntegrationConfigRequest): Promise<IntegrationConfig> {
    try {
      const { integration_type, enabled, sync_enabled, sync_frequency, settings } = request;

      // Check if config exists
      const existingConfig = await this.getIntegrationConfig(integration_type);
      
      if (existingConfig && existingConfig.integration_id !== integration_type) {
        // Update existing
        const updates: Partial<IntegrationConfig> = {
          updated_at: new Date().toISOString(),
        } as any;

        if (enabled !== undefined) updates.enabled = enabled;
        if (sync_enabled !== undefined) updates.sync_enabled = sync_enabled;
        if (sync_frequency) updates.sync_frequency = sync_frequency as any;
        if (settings) {
          updates.settings = { ...existingConfig.settings, ...settings };
          // Update API key if provided
          if (settings.api_key) updates.api_key = settings.api_key;
          if (settings.webhook_url) updates.webhook_url = settings.webhook_url;
        }

        // Determine status based on configuration
        updates.status = this.determineStatus(updates as IntegrationConfig);

        await this.squid.collection<IntegrationConfig>('integration_configs')
          .doc(existingConfig.integration_id)
          .update(updates as any);

        return { ...existingConfig, ...updates } as IntegrationConfig;
      } else {
        // Create new
        const newConfig: Omit<IntegrationConfig, '__id'> = {
          integration_id: integration_type,
          integration_type,
          name: this.getIntegrationName(integration_type),
          description: this.getIntegrationDescription(integration_type),
          status: 'configuring',
          enabled: enabled ?? false,
          sync_enabled: sync_enabled ?? false,
          sync_frequency: (sync_frequency as any) ?? 'manual',
          settings: settings || {},
          api_key: settings?.api_key,
          webhook_url: settings?.webhook_url,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any;

        newConfig.status = this.determineStatus(newConfig as IntegrationConfig);

        await this.squid.collection<IntegrationConfig>('integration_configs')
          .doc(integration_type)
          .insert(newConfig);

        return newConfig as IntegrationConfig;
      }
    } catch (error: any) {
      console.error('Error saving integration config:', error);
      throw {
        error: {
          code: 'SAVE_CONFIG_FAILED',
          message: 'Failed to save integration configuration',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async deleteIntegrationConfig(integrationType: IntegrationType): Promise<{ success: boolean }> {
    try {
      await this.squid.collection<IntegrationConfig>('integration_configs').doc(integrationType).delete();
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting integration config:', error);
      return { success: false };
    }
  }

  // =============================================
  // Sync Management
  // =============================================

  @executable()
  async triggerSync(request: TriggerSyncRequest): Promise<TriggerSyncResponse> {
    try {
      const { integration_type, sync_type = 'full', options } = request;
      
      const syncId = this.generateId();
      const startedAt = new Date().toISOString();

      // Create sync history record
      const syncHistory: Omit<IntegrationSyncHistory, '__id'> = {
        sync_id: syncId,
        integration_type,
        sync_type: 'manual',
        status: 'success',
        started_at: startedAt,
        records_synced: 0,
        records_created: 0,
        records_updated: 0,
        records_failed: 0,
        errors: [],
      } as any;

      await this.squid.collection<IntegrationSyncHistory>('integration_sync_history')
        .doc(syncId)
        .insert(syncHistory);

      // Update config last sync time
      const config = await this.getIntegrationConfig(integration_type);
      if (config) {
        await this.squid.collection<IntegrationConfig>('integration_configs')
          .doc(config.integration_id)
          .update({
            last_sync_at: startedAt,
            sync_status: 'syncing',
            updated_at: startedAt,
          } as any);
      }

      // Trigger actual sync based on type
      this.performSync(integration_type, sync_type, syncId, options);

      return {
        sync_id: syncId,
        integration_type,
        status: 'started',
        estimated_duration_seconds: 30,
      };
    } catch (error: any) {
      console.error('Error triggering sync:', error);
      throw {
        error: {
          code: 'TRIGGER_SYNC_FAILED',
          message: 'Failed to trigger sync',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getSyncHistory(request: GetSyncHistoryRequest = {}): Promise<IntegrationSyncHistory[]> {
    try {
      let query = this.squid.collection<IntegrationSyncHistory>('integration_sync_history').query();
      
      if (request.integration_type) {
        query = query.eq('integration_type', request.integration_type);
      }

      if (request.status_filter) {
        query = query.eq('status', request.status_filter);
      }

      const snapshot = await query.snapshot();
      let syncs = this.toArrayData<IntegrationSyncHistory>(snapshot);

      // Filter by date if provided
      if (request.since) {
        const sinceDate = new Date(request.since);
        syncs = syncs.filter(s => new Date(s.started_at) >= sinceDate);
      }

      // Sort by most recent first
      syncs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

      // Apply limit
      if (request.limit) {
        syncs = syncs.slice(0, request.limit);
      }

      return syncs;
    } catch (error: any) {
      console.error('Error getting sync history:', error);
      return [];
    }
  }

  // =============================================
  // Testing & Health
  // =============================================

  @executable()
  async testIntegration(request: TestIntegrationRequest): Promise<TestIntegrationResponse> {
    try {
      const { integration_type, settings } = request;

      // Perform basic validation
      const checks = await this.validateIntegrationSettings(integration_type, settings);
      
      const allPassed = checks.every(check => check.passed);

      return {
        success: allPassed,
        message: allPassed 
          ? `${integration_type} integration test passed` 
          : `${integration_type} integration test failed`,
        details: { checks },
        errors: checks.filter(c => !c.passed).map(c => c.message || 'Check failed')
      };
    } catch (error: any) {
      console.error('Error testing integration:', error);
      return {
        success: false,
        message: 'Integration test failed',
        errors: [error.message]
      };
    }
  }

  @executable()
  async checkAllIntegrationsHealth(): Promise<IntegrationHealthCheck[]> {
    try {
      const configsQuery = this.squid.collection<IntegrationConfig>('integration_configs').query();
      const configsSnapshot = await configsQuery.snapshot();
      const configs = this.toArrayData<IntegrationConfig>(configsSnapshot);

      return await Promise.all(
        configs.map(config => this.checkIntegrationHealth(config))
      );
    } catch (error: any) {
      console.error('Error checking integrations health:', error);
      return [];
    }
  }

  // =============================================
  // Helper Methods
  // =============================================

  private async checkIntegrationHealth(config: IntegrationConfig): Promise<IntegrationHealthCheck> {
    const checks: IntegrationHealthCheck['checks'] = [];

    // Check if enabled
    checks.push({
      check_name: 'Enabled',
      passed: config.enabled,
      message: config.enabled ? 'Integration is enabled' : 'Integration is disabled'
    });

    // Check if API key is configured (for integrations that need it)
    if (['deel', 'linear', 'motion', 'hubspot', 'jira'].includes(config.integration_type)) {
      checks.push({
        check_name: 'API Key',
        passed: !!config.api_key || !!config.settings.api_key,
        message: (config.api_key || config.settings.api_key) ? 'API key configured' : 'API key missing'
      });
    }

    // Check if webhook URL is configured (for Slack)
    if (config.integration_type === 'slack') {
      checks.push({
        check_name: 'Webhook URL',
        passed: !!config.webhook_url || !!config.settings.webhook_url,
        message: (config.webhook_url || config.settings.webhook_url) ? 'Webhook configured' : 'Webhook missing'
      });
    }

    // Check last sync (if sync is enabled)
    if (config.sync_enabled && config.last_sync_at) {
      const lastSync = new Date(config.last_sync_at);
      const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      const isRecent = hoursSinceSync < 48; // Less than 2 days

      checks.push({
        check_name: 'Recent Sync',
        passed: isRecent,
        message: isRecent 
          ? `Last synced ${Math.round(hoursSinceSync)} hours ago` 
          : `Last sync was ${Math.round(hoursSinceSync / 24)} days ago`
      });
    }

    const isHealthy = checks.every(check => check.passed);
    const recommendations: string[] = [];

    if (!config.enabled) {
      recommendations.push('Enable integration to start using it');
    }

    checks.forEach(check => {
      if (!check.passed && check.check_name !== 'Enabled') {
        recommendations.push(`Fix: ${check.message}`);
      }
    });

    return {
      integration_type: config.integration_type,
      is_healthy: isHealthy,
      status: config.status,
      last_check_at: new Date().toISOString(),
      checks,
      recommendations: recommendations.length > 0 ? recommendations : undefined
    };
  }

  private async validateIntegrationSettings(
    integrationType: IntegrationType,
    settings: Record<string, any>
  ): Promise<Array<{ check_name: string; passed: boolean; message?: string }>> {
    const checks: Array<{ check_name: string; passed: boolean; message?: string }> = [];

    switch (integrationType) {
      case 'deel':
        checks.push({
          check_name: 'API Key',
          passed: !!settings.api_key,
          message: settings.api_key ? 'API key provided' : 'API key required'
        });
        break;

      case 'linear':
        checks.push({
          check_name: 'API Key',
          passed: !!settings.api_key,
          message: settings.api_key ? 'API key provided' : 'API key required'
        });
        checks.push({
          check_name: 'Team ID',
          passed: !!settings.team_id,
          message: settings.team_id ? 'Team ID provided' : 'Team ID required'
        });
        break;

      case 'motion':
        checks.push({
          check_name: 'API Key',
          passed: !!settings.api_key,
          message: settings.api_key ? 'API key provided' : 'API key required'
        });
        checks.push({
          check_name: 'Workspace ID',
          passed: !!settings.workspace_id,
          message: settings.workspace_id ? 'Workspace ID provided' : 'Workspace ID required'
        });
        break;

      case 'slack':
        checks.push({
          check_name: 'Webhook URL',
          passed: !!settings.webhook_url,
          message: settings.webhook_url ? 'Webhook URL provided' : 'Webhook URL required'
        });
        break;

      case 'hubspot':
        checks.push({
          check_name: 'API Key',
          passed: !!settings.api_key,
          message: settings.api_key ? 'API key provided' : 'API key required'
        });
        break;

      case 'jira':
        checks.push({
          check_name: 'API Key',
          passed: !!settings.api_key,
          message: settings.api_key ? 'API key provided' : 'API key required'
        });
        checks.push({
          check_name: 'Domain',
          passed: !!settings.domain,
          message: settings.domain ? 'Domain provided' : 'Domain required'
        });
        checks.push({
          check_name: 'Email',
          passed: !!settings.email,
          message: settings.email ? 'Email provided' : 'Email required'
        });
        break;
    }

    return checks;
  }

  private async performSync(
    integrationType: IntegrationType,
    syncType: string,
    syncId: string,
    options?: Record<string, any>
  ): Promise<void> {
    // This would call the appropriate service to perform the actual sync
    // For now, we'll just update the sync history to mark it complete
    
    setTimeout(async () => {
      try {
        const completedAt = new Date().toISOString();
        const duration = 5000; // Mock 5 seconds

        await this.squid.collection<IntegrationSyncHistory>('integration_sync_history')
          .doc(syncId)
          .update({
            status: 'success',
            completed_at: completedAt,
            duration_ms: duration,
            records_synced: 10,
            records_created: 5,
            records_updated: 5,
          } as any);

        // Update config
        const config = await this.getIntegrationConfig(integrationType);
        if (config) {
          await this.squid.collection<IntegrationConfig>('integration_configs')
            .doc(config.integration_id)
            .update({
              sync_status: 'success',
              last_sync_at: completedAt,
              updated_at: completedAt,
            } as any);
        }

        console.log(`[IntegrationsManagement] Sync completed for ${integrationType}`);
      } catch (error) {
        console.error(`[IntegrationsManagement] Sync failed for ${integrationType}:`, error);
      }
    }, 5000);
  }

  private createDefaultConfig(integrationType: IntegrationType): IntegrationConfig {
    return {
      integration_id: integrationType,
      integration_type: integrationType,
      name: this.getIntegrationName(integrationType),
      description: this.getIntegrationDescription(integrationType),
      status: 'disconnected',
      enabled: false,
      sync_enabled: false,
      sync_frequency: 'manual',
      settings: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private getIntegrationName(type: IntegrationType): string {
    const names: Record<IntegrationType, string> = {
      deel: 'Deel',
      linear: 'Linear',
      motion: 'Motion',
      slack: 'Slack',
      hubspot: 'HubSpot',
      jira: 'Jira'
    };
    return names[type];
  }

  private getIntegrationDescription(type: IntegrationType): string {
    const descriptions: Record<IntegrationType, string> = {
      deel: 'Sync employees, org chart, and HR data from Deel',
      linear: 'Sync issues and projects with Linear',
      motion: 'Sync tasks and projects with Motion',
      slack: 'Send notifications and enable slash commands in Slack',
      hubspot: 'Sync deals, companies, and contacts from HubSpot',
      jira: 'Sync epics and stories with Jira'
    };
    return descriptions[type];
  }

  private determineStatus(config: Partial<IntegrationConfig>): 'connected' | 'disconnected' | 'error' | 'configuring' {
    if (!config.enabled) return 'disconnected';
    
    const hasApiKey = config.api_key || config.settings?.api_key;
    const hasWebhook = config.webhook_url || config.settings?.webhook_url;
    
    if (config.integration_type === 'slack') {
      return hasWebhook ? 'connected' : 'configuring';
    }
    
    return hasApiKey ? 'connected' : 'configuring';
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

