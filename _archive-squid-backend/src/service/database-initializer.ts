import { SquidService, executable } from '@squidcloud/backend';
import type { HubspotDeal, LoopDealLink, PersonCost, Person } from '@enterprise/common';

const CATEGORY_PILLAR_MAP: Record<string, string> = {
  ENG: 'TECHOPS',
  MSP: 'TECHOPS',
  GTM: 'REVOPS',
  BD: 'REVOPS',
  'OPS:Finance': 'ADMINOPS',
  'OPS:HR': 'ADMINOPS',
  'OPS:SalesOps': 'REVOPS',
  LND: 'CROSS',
  ADVISORY: 'CROSS',
};

export class DatabaseInitializer extends SquidService {
  
  @executable()
  async initializeDatabase(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('Initializing Aerostack database...');
      
      // Check if we already have data
      const existingPeople = await this.squid.collection<Person>('people').query().snapshot();
      
      if (existingPeople.length > 0) {
        return { 
          success: true, 
          message: `Database already initialized with ${existingPeople.length} people` 
        };
      }

      // Create initial people
      const initialPeople: Omit<Person, '__id'>[] = [
        {
          person_id: this.generateId(),
          name: 'Will Horn',
          email: 'will@enterprise.io',
          role_title: 'CEO',
          area: 'CROSS' as const,
          level_numeric: 10,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          person_id: this.generateId(),
          name: 'Daria Doe',
          email: 'daria@enterprise.io', 
          role_title: 'CTO',
          area: 'TECHOPS' as const,
          level_numeric: 9,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          person_id: this.generateId(),
          name: 'Alex Smith',
          email: 'alex@enterprise.io',
          role_title: 'VP Engineering',
          area: 'TECHOPS' as const,
          level_numeric: 8,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          person_id: this.generateId(),
          name: 'Sam Johnson',
          email: 'sam@enterprise.io',
          role_title: 'VP Sales',
          area: 'REVOPS' as const,
          level_numeric: 8,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      // Insert people
      for (const person of initialPeople) {
        await this.squid.collection<Person>('people').doc(person.person_id).insert(person as any);
      }

      // Seed integration stubs
      const exampleDeal: HubspotDeal = {
        deal_id: this.generateId(),
        name: 'ACME Phase 1',
        amount: 50000,
        currency: 'USD',
        stage: 'closed-won',
        close_date: new Date().toISOString().slice(0,10),
        owner_email: 'sam@enterprise.io',
        company: 'ACME Co',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await this.squid.collection<HubspotDeal>('hubspot_deals').doc(exampleDeal.deal_id).insert(exampleDeal);

      // Seed a cost row for a person
      const cost: PersonCost = {
        id: this.generateId(),
        person_id: (initialPeople[0] as any).person_id,
        month: new Date().toISOString().slice(0,7),
        total_cost_usd: 15000,
        created_at: new Date().toISOString(),
      };
      await this.squid.collection<PersonCost>('person_costs').doc(cost.id).insert(cost);

      console.log(`Inserted integration stubs: 1 hubspot deal, 1 person cost`)

      console.log(`Inserted ${initialPeople.length} initial people`);

      return { 
        success: true, 
        message: `Database initialized with ${initialPeople.length} people` 
      };
    } catch (error: any) {
      console.error('Error initializing database:', error);
      return { 
        success: false, 
        message: `Failed to initialize database: ${error.message}` 
      };
    }
  }

  @executable()
  async getCategoryPillarMapping(): Promise<Record<string, string>> {
    return CATEGORY_PILLAR_MAP;
  }

  @executable()
  async getCollectionCounts(): Promise<Record<string, number>> {
    try {
      const collections = ['people', 'loops', 'loop_ownership', 'lessons', 'resume_items', 'velocity_snapshots'];
      const counts: Record<string, number> = {};

      for (const collection of collections) {
        try {
          const items = await this.squid.collection(collection).query().snapshot();
          counts[collection] = items.length;
        } catch (error) {
          counts[collection] = 0;
        }
      }

      return counts;
    } catch (error: any) {
      console.error('Error getting collection counts:', error);
      return {};
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
