import { SquidService, executable } from '@squidcloud/backend';
import { mongodb, ObjectId } from '../lib/mongodb';

/**
 * RevOps Service - Local MongoDB Version
 * Uses local MongoDB container for development
 */
export class RevopsLocalService extends SquidService {
  
  private generateId(): string {
    return `deal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  @executable()
  async localPing(): Promise<{ message: string; timestamp: string; service: string }> {
    console.log('🔔 RevopsLocalService.localPing() called');
    return {
      message: 'RevOps Local service is alive!',
      timestamp: new Date().toISOString(),
      service: 'RevopsLocalService'
    };
  }
  
  @executable()
  async createLocalDeal(data: any) {
    console.log('🔔 RevopsLocalService.createLocalDeal() called with:', data);
    
    const now = new Date().toISOString();
    const dealId = this.generateId();
    
    const dealData = {
      deal_id: dealId,
      name: data.name,
      company: data.company,
      description: data.description || null,
      phase: data.phase || 'LEAD',
      stage: data.stage || 'New Lead',
      health_status: data.health_status || 'GREEN',
      owner_email: data.owner_email,
      contact_email: data.contact_email || null,
      amount: data.amount || 0,
      currency: data.currency || 'USD',
      expected_close_date: data.expected_close_date || null,
      priority: data.priority || 3,
      confidence_score: data.confidence_score || 50,
      hubspot_deal_id: data.hubspot_deal_id || null,
      tags: data.tags || [],
      custom_fields: data.custom_fields || {},
      created_at: now,
      updated_at: now,
    };
    
    // Insert into local MongoDB
    const collection = await mongodb.getCollection('deals');
    await collection.insertOne(dealData as any);
    
    console.log('✅ Deal created in local MongoDB:', dealId);
    return dealData;
  }

  @executable()
  async listLocalDeals(filters?: any) {
    console.log('🔔 RevopsLocalService.listLocalDeals() called');
    
    const collection = await mongodb.getCollection('deals');
    const deals = await collection.find({}).sort({ created_at: -1 }).limit(100).toArray();
    
    console.log(`✅ Found ${deals.length} deals in local MongoDB`);
    return deals;
  }

  @executable()
  async getLocalDeal(deal_id: string) {
    console.log('🔔 RevopsLocalService.getLocalDeal() called:', deal_id);
    
    const collection = await mongodb.getCollection('deals');
    const deal = await collection.findOne({ deal_id });
    
    if (!deal) {
      throw new Error(`Deal ${deal_id} not found`);
    }
    
    return deal;
  }

  @executable()
  async deleteLocalDeal(deal_id: string) {
    console.log('🔔 RevopsLocalService.deleteLocalDeal() called:', deal_id);
    
    const collection = await mongodb.getCollection('deals');
    const result = await collection.deleteOne({ deal_id });
    
    return { success: result.deletedCount > 0 };
  }

  @executable()
  async clearLocalDeals() {
    console.log('🔔 RevopsLocalService.clearLocalDeals() called');
    
    const collection = await mongodb.getCollection('deals');
    const result = await collection.deleteMany({});
    
    console.log(`✅ Cleared ${result.deletedCount} deals from local MongoDB`);
    return { deleted: result.deletedCount };
  }
}


