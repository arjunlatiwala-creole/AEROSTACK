import { SquidService, executable } from '@squidcloud/backend';

/**
 * RevOps Service V2
 * Flexible pipeline tracking with dynamic fields
 */
export class RevopsService extends SquidService {
  
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }
  
  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }
  
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
  
  // =============================================
  // Test Endpoints
  // =============================================
  
  @executable()
  async ping(): Promise<{ message: string; timestamp: string; service: string }> {
    console.log('🔔 RevopsService.ping() called at', new Date().toISOString());
    return {
      message: 'RevOps service is alive!',
      timestamp: new Date().toISOString(),
      service: 'RevopsService'
    };
  }
  
  @executable()
  async testWebhook(data: any): Promise<{ received: any; timestamp: string }> {
    console.log('🔔 RevopsService.testWebhook() called with:', JSON.stringify(data, null, 2));
    return {
      received: data,
      timestamp: new Date().toISOString()
    };
  }
  
  // =============================================
  // Deal Management
  // =============================================
  
  @executable()
  async listDeals(filters?: any) {
    const collection = this.squid.collection('deals');
    let query = collection.query();
    
    // Apply filters if provided
    if (filters?.phase) query = query.eq('phase', filters.phase);
    if (filters?.health_status) query = query.eq('health_status', filters.health_status);
    if (filters?.owner_email) query = query.eq('owner_email', filters.owner_email);
    
    const docs = await query.snapshot();
    return this.toArrayData(docs);
  }
  
  @executable()
  async getDeal(deal_id: string) {
    const doc = await this.squid.collection('deals').doc(deal_id).snapshot();
    if (!doc) throw new Error(`Deal ${deal_id} not found`);
    return this.toData(doc);
  }
  
  @executable()
  async createDeal(data: any) {
    const now = new Date().toISOString();
    const dealId = this.generateId();
    
    const dealData = {
      deal_id: dealId,
      name: data.name,
      company: data.company || '',
      description: data.description || '',
      
      // Lifecycle
      phase: data.phase || 'LEAD',
      stage: data.stage || 'New Lead',
      health_status: data.health_status || 'GREEN',
      
      // Ownership
      owner_email: data.owner_email || '',
      contact_email: data.contact_email || '',
      
      // Financials
      amount: data.amount || 0,
      currency: data.currency || 'USD',
      expected_close_date: data.expected_close_date || null,
      
      // Priority
      priority: data.priority || 3,
      confidence_score: data.confidence_score || 50,
      
      // Integration
      hubspot_deal_id: data.hubspot_deal_id || null,
      
      // Flexible fields
      tags: data.tags || [],
      custom_fields: data.custom_fields || {},
      
      // Metadata
      created_at: now,
      updated_at: now,
    };
    
    await this.squid.collection('deals').doc(dealId).insert(dealData);
    
    // Log creation event
    await this.logDealEvent(dealId, 'CREATED', null, {
      description: `Deal created: ${data.name}`,
      after_value: { phase: dealData.phase, stage: dealData.stage }
    });
    
    return dealData;
  }
  
  @executable()
  async updateDeal(deal_id: string, updates: any) {
    const docRef = this.squid.collection('deals').doc(deal_id);
    const before = await docRef.snapshot();
    
    if (!before) throw new Error(`Deal ${deal_id} not found`);
    
    const updateData: any = {
      ...updates,
      updated_at: new Date().toISOString()
    };
    
    await docRef.update(updateData);
    
    // Log phase changes
    if (updates.phase && updates.phase !== before.data.phase) {
      await this.logDealEvent(deal_id, 'PHASE_CHANGE', null, {
        description: `Phase changed from ${before.data.phase} to ${updates.phase}`,
        before_value: { phase: before.data.phase },
        after_value: { phase: updates.phase }
      });
    }
    
    return { success: true, deal_id };
  }
  
  @executable()
  async updateDealHealth(deal_id: string, health_status: string, reason?: string) {
    const docRef = this.squid.collection('deals').doc(deal_id);
    const before = await docRef.snapshot();
    
    if (!before) throw new Error(`Deal ${deal_id} not found`);
    
    await docRef.update({
      health_status,
      updated_at: new Date().toISOString()
    });
    
    await this.logDealEvent(deal_id, 'HEALTH_CHANGE', null, {
      description: reason || `Health changed to ${health_status}`,
      before_value: { health_status: before.data.health_status },
      after_value: { health_status }
    });
    
    return { success: true };
  }
  
  @executable()
  async moveDealPhase(deal_id: string, new_phase: string, new_stage?: string, reason?: string) {
    const updates: any = {
      phase: new_phase,
      updated_at: new Date().toISOString()
    };
    
    if (new_stage) updates.stage = new_stage;
    
    // Set close date if moving to closed
    if (new_phase === 'CLOSED_WON' || new_phase === 'CLOSED_LOST' || new_phase === 'LAUNCHED') {
      updates.actual_close_date = new Date().toISOString().split('T')[0];
    }
    
    return this.updateDeal(deal_id, updates);
  }
  
  @executable()
  async deleteDeal(deal_id: string) {
    await this.squid.collection('deals').doc(deal_id).delete();
    return { success: true };
  }
  
  // =============================================
  // Pipeline Views
  // =============================================
  
  @executable()
  async getPipelineByPhase() {
    const allDeals = await this.listDeals();
    
    // Group by phase
    const phases = ['LEAD', 'DEVELOPING', 'ACTIVELY_FUNDING', 'CLOSED_WON', 'CLOSED_LOST', 'LAUNCHED'];
    const pipeline: any[] = [];
    
    for (const phase of phases) {
      const deals = allDeals.filter((d: any) => d.phase === phase);
      
      // Calculate metrics
      const total_value = deals.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);
      const health_dist = deals.reduce((acc: any, d: any) => {
        acc[d.health_status] = (acc[d.health_status] || 0) + 1;
        return acc;
      }, {});
      
      pipeline.push({
        phase,
        phase_label: this.getPhaseLabel(phase),
        deal_count: deals.length,
        total_value,
        health_distribution: health_dist,
        deals: deals
      });
    }
    
    return pipeline;
  }
  
  @executable()
  async getRevOpsDashboard() {
    const pipeline = await this.getPipelineByPhase();
    const recentEvents = await this.getRecentActivity(10);
    
    // Calculate summary
    const allDeals = pipeline.flatMap((p: any) => p.deals);
    const summary = {
      total_deals: allDeals.length,
      total_pipeline_value: allDeals.reduce((sum: number, d: any) => sum + (d.amount || 0), 0),
      deals_by_phase: pipeline.reduce((acc: any, p: any) => {
        acc[p.phase] = p.deal_count;
        return acc;
      }, {}),
      health_distribution: allDeals.reduce((acc: any, d: any) => {
        acc[d.health_status] = (acc[d.health_status] || 0) + 1;
        return acc;
      }, {})
    };
    
    return {
      pipeline,
      summary,
      recent_activity: recentEvents
    };
  }
  
  // =============================================
  // Notes & Events
  // =============================================
  
  @executable()
  async addDealNote(deal_id: string, content: string, note_type?: string, author_email?: string) {
    const noteId = this.generateId();
    const noteData = {
      note_id: noteId,
      deal_id,
      content,
      note_type: note_type || 'INTERNAL',
      author_email: author_email || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    await this.squid.collection('deal_notes').doc(noteId).insert(noteData);
    
    // Log event
    await this.logDealEvent(deal_id, 'NOTE_ADDED', author_email, {
      description: 'Note added',
      after_value: { note_type }
    });
    
    return noteData;
  }
  
  @executable()
  async getDealNotes(deal_id: string) {
    const docs = await this.squid.collection('deal_notes')
      .query()
      .eq('deal_id', deal_id)
      .snapshot();
    
    return this.toArrayData(docs);
  }
  
  @executable()
  async getDealEvents(deal_id: string, limit = 50) {
    const docs = await this.squid.collection('deal_events')
      .query()
      .eq('deal_id', deal_id)
      .limit(limit)
      .snapshot();
    
    return this.toArrayData(docs);
  }
  
  @executable()
  async getRecentActivity(limit = 20) {
    const docs = await this.squid.collection('deal_events')
      .query()
      .limit(limit)
      .snapshot();
    
    return this.toArrayData(docs);
  }
  
  // =============================================
  // HubSpot Integration
  // =============================================
  
  @executable()
  async syncHubSpotDeal(hubspot_deal_id: string, deal_properties: any) {
    // deal_properties should be passed from HubSpot directly or fetched separately
    
    // Check if already synced
    const existing = await this.squid.collection('deals')
      .query()
      .eq('hubspot_deal_id', hubspot_deal_id)
      .snapshot();
    
    const existingDeals = this.toArrayData(existing);
    
    if (existingDeals.length > 0) {
      // Update existing
      const deal = existingDeals[0] as any;
      await this.updateDeal(deal.deal_id, {
        name: deal_properties.dealname || 'Untitled',
        amount: parseFloat(deal_properties.amount || '0'),
        expected_close_date: deal_properties.closedate || null,
        phase: this.mapHubSpotStageToPhase(deal_properties.dealstage),
        custom_fields: {
          ...(deal.custom_fields || {}),
          hubspot_pipeline: deal_properties.pipeline,
          hubspot_stage: deal_properties.dealstage
        }
      });
      
      return { deal_id: deal.deal_id, synced: true, updated: true };
    } else {
      // Create new
      const newDeal = await this.createDeal({
        name: deal_properties.dealname || 'Untitled',
        amount: parseFloat(deal_properties.amount || '0'),
        expected_close_date: deal_properties.closedate || null,
        phase: this.mapHubSpotStageToPhase(deal_properties.dealstage),
        hubspot_deal_id: hubspot_deal_id,
        custom_fields: {
          hubspot_pipeline: deal_properties.pipeline,
          hubspot_stage: deal_properties.dealstage
        }
      });
      
      return { deal_id: newDeal.deal_id, synced: true, created: true };
    }
  }
  
  @executable()
  async importHubSpotDeals(hsDealsData: any[]) {
    const results: any[] = [];
    for (const hsDeal of hsDealsData) {
      try {
        const result = await this.syncHubSpotDeal(hsDeal.id, hsDeal.properties);
        results.push(result);
      } catch (error: any) {
        results.push({ deal_id: hsDeal.id, error: error.message });
      }
    }
    
    return { synced_count: results.length, results };
  }
  
  // =============================================
  // Helper Methods
  // =============================================
  
  private async logDealEvent(deal_id: string, event_type: string, actor_email?: string | null, details?: any) {
    const eventId = this.generateId();
    const eventData = {
      event_id: eventId,
      deal_id,
      event_type,
      actor_email: actor_email || null,
      description: details?.description || '',
      before_value: details?.before_value || null,
      after_value: details?.after_value || null,
      created_at: new Date().toISOString()
    };
    
    await this.squid.collection('deal_events').doc(eventId).insert(eventData);
  }
  
  private getPhaseLabel(phase: string): string {
    const labels: any = {
      'LEAD': 'Leads',
      'DEVELOPING': 'Developing Deals',
      'ACTIVELY_FUNDING': 'Actively Funding Deals',
      'CLOSED_WON': 'Closed Won (Last 30d)',
      'CLOSED_LOST': 'Closed Lost (Last 30d)',
      'LAUNCHED': 'Launched (Last 30d)'
    };
    return labels[phase] || phase;
  }
  
  private mapHubSpotStageToPhase(dealstage?: string): string {
    if (!dealstage) return 'LEAD';
    
    const stage = dealstage.toLowerCase();
    
    if (stage.includes('closedwon')) return 'CLOSED_WON';
    if (stage.includes('closedlost')) return 'CLOSED_LOST';
    if (stage.includes('contract') || stage.includes('closing')) return 'ACTIVELY_FUNDING';
    if (stage.includes('proposal') || stage.includes('negotiation')) return 'DEVELOPING';
    
    return 'LEAD';
  }
}

