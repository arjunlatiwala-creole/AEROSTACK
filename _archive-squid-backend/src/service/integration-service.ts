import { SquidService, executable } from '@squidcloud/backend';
import type {
  LinearIntegrationConfig,
  MotionIntegrationConfig,
  ExternalWorkSync,
  SyncExternalWorkRequest,
  EngineeringWorkItem,
  CreateEngWorkRequest,
  ApiError,
} from '@enterprise/common';

export class IntegrationService extends SquidService {
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }

  // =============================================
  // Linear Integration
  // =============================================

  @executable()
  async setLinearConfig(config: Partial<LinearIntegrationConfig>): Promise<{ success: boolean }> {
    try {
      const configId = 'linear-config'; // Singleton config
      const configRef = this.squid.collection<LinearIntegrationConfig>('integration_configs').doc(configId);
      
      const existingConfig = await configRef.snapshot();
      
      if (existingConfig) {
        await configRef.update(config as any);
      } else {
        await configRef.insert({
          api_key: config.api_key || '',
          team_id: config.team_id || '',
          workspace_id: config.workspace_id,
          sync_enabled: config.sync_enabled || false,
          sync_direction: config.sync_direction || 'linear_to_aerostack',
          project_mappings: config.project_mappings || [],
        } as any);
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error setting Linear config:', error);
      throw {
        error: {
          code: 'SET_LINEAR_CONFIG_FAILED',
          message: 'Failed to set Linear configuration',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getLinearConfig(): Promise<LinearIntegrationConfig | null> {
    try {
      const configRef = this.squid.collection<LinearIntegrationConfig>('integration_configs').doc('linear-config');
      const config = await configRef.snapshot();
      return config ? this.toData<LinearIntegrationConfig>(config) : null;
    } catch (error: any) {
      console.error('Error getting Linear config:', error);
      return null;
    }
  }

  @executable()
  async syncFromLinear(request: SyncExternalWorkRequest): Promise<{ synced_count: number; errors: string[] }> {
    try {
      const config = await this.getLinearConfig();
      
      if (!config || !config.sync_enabled) {
        throw {
          error: {
            code: 'LINEAR_NOT_CONFIGURED',
            message: 'Linear integration not configured or not enabled',
          },
        } as ApiError;
      }

      // In a real implementation, this would call Linear GraphQL API
      // For now, we'll create a mock sync flow
      
      const errors: string[] = [];
      let syncedCount = 0;

      // TODO: Implement actual Linear API integration
      // Example: Query Linear issues, create/update EngineeringWorkItems
      
      console.log('Linear sync would happen here with API key:', config.api_key.slice(0, 10) + '...');
      
      // Mock sync record
      const syncId = this.generateId();
      await this.squid.collection<ExternalWorkSync>('external_work_syncs').doc(syncId).insert({
        sync_id: syncId,
        system: 'linear',
        external_id: 'mock-linear-issue-123',
        aerostack_work_id: 'mock-work-456',
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced',
      } as any);

      return { synced_count: syncedCount, errors };
    } catch (error: any) {
      console.error('Error syncing from Linear:', error);
      throw error.error ? error : {
        error: {
          code: 'LINEAR_SYNC_FAILED',
          message: 'Failed to sync from Linear',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Motion Integration
  // =============================================

  @executable()
  async setMotionConfig(config: Partial<MotionIntegrationConfig>): Promise<{ success: boolean }> {
    try {
      const configId = 'motion-config'; // Singleton config
      const configRef = this.squid.collection<MotionIntegrationConfig>('integration_configs').doc(configId);
      
      const existingConfig = await configRef.snapshot();
      
      if (existingConfig) {
        await configRef.update(config as any);
      } else {
        await configRef.insert({
          api_key: config.api_key || '',
          workspace_id: config.workspace_id || '',
          sync_enabled: config.sync_enabled || false,
          auto_create_tasks: config.auto_create_tasks || false,
          task_mappings: config.task_mappings || [],
        } as any);
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error setting Motion config:', error);
      throw {
        error: {
          code: 'SET_MOTION_CONFIG_FAILED',
          message: 'Failed to set Motion configuration',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getMotionConfig(): Promise<MotionIntegrationConfig | null> {
    try {
      const configRef = this.squid.collection<MotionIntegrationConfig>('integration_configs').doc('motion-config');
      const config = await configRef.snapshot();
      return config ? this.toData<MotionIntegrationConfig>(config) : null;
    } catch (error: any) {
      console.error('Error getting Motion config:', error);
      return null;
    }
  }

  @executable()
  async syncFromMotion(request: SyncExternalWorkRequest): Promise<{ synced_count: number; errors: string[] }> {
    try {
      const config = await this.getMotionConfig();
      
      if (!config || !config.sync_enabled) {
        throw {
          error: {
            code: 'MOTION_NOT_CONFIGURED',
            message: 'Motion integration not configured or not enabled',
          },
        } as ApiError;
      }

      const errors: string[] = [];
      let syncedCount = 0;

      // TODO: Implement actual Motion API integration
      console.log('Motion sync would happen here with API key:', config.api_key.slice(0, 10) + '...');

      return { synced_count: syncedCount, errors };
    } catch (error: any) {
      console.error('Error syncing from Motion:', error);
      throw error.error ? error : {
        error: {
          code: 'MOTION_SYNC_FAILED',
          message: 'Failed to sync from Motion',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Generic External Work Sync
  // =============================================

  @executable()
  async getSyncHistory(system?: 'linear' | 'motion' | 'jira', limit: number = 50): Promise<ExternalWorkSync[]> {
    try {
      let query = this.squid.collection<ExternalWorkSync>('external_work_syncs').query();
      
      if (system) {
        query = query.eq('system', system);
      }

      const snapshot = await query.snapshot();
      const syncs = this.toArrayData<ExternalWorkSync>(snapshot);
      
      // Sort by last_synced_at descending
      syncs.sort((a, b) => new Date(b.last_synced_at).getTime() - new Date(a.last_synced_at).getTime());
      
      return syncs.slice(0, limit);
    } catch (error: any) {
      console.error('Error getting sync history:', error);
      return [];
    }
  }

  @executable()
  async createSyncRecord(
    system: 'linear' | 'motion' | 'jira',
    externalId: string,
    aerostackWorkId: string
  ): Promise<ExternalWorkSync> {
    try {
      const syncId = this.generateId();
      const sync: Omit<ExternalWorkSync, '__id'> = {
        sync_id: syncId,
        system,
        external_id: externalId,
        aerostack_work_id: aerostackWorkId,
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced',
      } as any;

      await this.squid.collection<ExternalWorkSync>('external_work_syncs').doc(syncId).insert(sync);

      return sync as ExternalWorkSync;
    } catch (error: any) {
      console.error('Error creating sync record:', error);
      throw {
        error: {
          code: 'CREATE_SYNC_RECORD_FAILED',
          message: 'Failed to create sync record',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async findSyncByExternalId(system: 'linear' | 'motion' | 'jira', externalId: string): Promise<ExternalWorkSync | null> {
    try {
      const query = this.squid.collection<ExternalWorkSync>('external_work_syncs').query();
      const results = await query.eq('system', system).eq('external_id', externalId).snapshot();
      
      if (results.length === 0) return null;
      
      return this.toData<ExternalWorkSync>(results[0]);
    } catch (error: any) {
      console.error('Error finding sync by external ID:', error);
      return null;
    }
  }

  @executable()
  async getIntegrationStatus(): Promise<{
    linear: { configured: boolean; sync_enabled: boolean; last_sync?: string };
    motion: { configured: boolean; sync_enabled: boolean; last_sync?: string };
  }> {
    try {
      const linearConfig = await this.getLinearConfig();
      const motionConfig = await this.getMotionConfig();

      // Get last sync times
      const linearSyncs = await this.getSyncHistory('linear', 1);
      const motionSyncs = await this.getSyncHistory('motion', 1);

      return {
        linear: {
          configured: !!linearConfig,
          sync_enabled: linearConfig?.sync_enabled || false,
          last_sync: linearSyncs[0]?.last_synced_at,
        },
        motion: {
          configured: !!motionConfig,
          sync_enabled: motionConfig?.sync_enabled || false,
          last_sync: motionSyncs[0]?.last_synced_at,
        },
      };
    } catch (error: any) {
      console.error('Error getting integration status:', error);
      return {
        linear: { configured: false, sync_enabled: false },
        motion: { configured: false, sync_enabled: false },
      };
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

