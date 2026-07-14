# MongoDB + Stateless Agent Architecture

**Aerostack architecture using MongoDB as the primary data store with stateless agentic layers**

## 🎯 Architecture Philosophy

### Why MongoDB + Stateless Agents?

**✅ Flexible Schema**
- Agents can store arbitrary metadata without schema changes
- Perfect for evolving AI/ML features
- Easy to add new agent-generated fields

**✅ Document-Oriented**
- Natural fit for complex nested data (conversations, context, results)
- Store entire agent contexts as single documents
- Easy serialization/deserialization for agent state

**✅ Stateless Agents**
- Agents don't maintain internal state
- All state stored in MongoDB
- Scale agents horizontally without session affinity
- Any agent instance can handle any request

**✅ Performance**
- Fast document retrieval
- Built-in indexing for agent queries
- Excellent for real-time agent operations

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Frontend (PWA)                      │
└──────────────────────┬──────────────────────────────┘
                       │ API Calls
                       │
         ┌─────────────┴─────────────┐
         │                           │
    ┌────▼────────┐         ┌───────▼─────────┐
    │   Squid     │         │     Lyzr        │
    │  Agents     │         │    Agents       │
    │ (Stateless) │         │  (Stateless)    │
    └────┬────────┘         └───────┬─────────┘
         │                           │
         │  Equal Agentic Layers     │
         │  Both interact with DB    │
         │                           │
         └─────────────┬─────────────┘
                       │
              ┌────────▼────────┐
              │    MongoDB      │ (Single Source of Truth)
              │                 │
              │  • Loops        │
              │  • Contexts     │
              │  • Results      │
              │  • People       │
              │                 │
              │ Both frameworks │
              │ store state here│
              └─────────────────┘
```

### Key Principles

1. **MongoDB = Source of Truth**: All data lives in MongoDB
2. **Stateless Agents**: No in-memory state; fetch/store from DB
3. **Session-Based**: Use sessionId to track multi-turn interactions
4. **TTL Cleanup**: Old contexts auto-expire
5. **Idempotent**: Same input = same output (no hidden state)

---

## 📦 Data Model

### 1. **Loops Collection** (Core Business Data)

```javascript
{
  _id: ObjectId("..."),
  title: "Implement user authentication",
  owner: "john@enterprise.io",
  category: "ENG",
  pillar: "Security",
  status: "active",
  priority: "P0",
  effortScore: 7.5,
  outcomeScore: 8.2,
  lesson: "OAuth 2.0 integration was smoother than expected",
  contributors: [
    { email: "jane@enterprise.io", merit: 0.30 }
  ],
  tags: ["auth", "security", "p0"],
  
  // Agent-generated metadata (flexible!)
  metadata: {
    aiGenerated: false,
    complexity: "high",
    similarLoops: ["loop-123", "loop-456"],
    recommendations: [...],
    sentiment: "positive",
    riskFactors: ["tight timeline", "external dependencies"]
  },
  
  createdAt: ISODate("2025-01-15T10:00:00Z"),
  updatedAt: ISODate("2025-01-20T15:30:00Z"),
  completedAt: ISODate("2025-01-20T15:30:00Z")
}
```

### 2. **Agent Contexts Collection** (Stateless Agent State)

```javascript
{
  _id: ObjectId("..."),
  agentId: "lesson-analyzer",
  sessionId: "sess_abc123",  // For multi-turn conversations
  contextType: "analysis",
  
  // Current agent state
  state: {
    currentStep: "gathering_context",
    loopId: "loop-123",
    previousInsights: [...],
    conversationHistory: [...]
  },
  
  // Conversation messages (for LLM context)
  messages: [
    {
      role: "system",
      content: "You are a lesson analyzer...",
      timestamp: ISODate("...")
    },
    {
      role: "user",
      content: "Analyze this loop...",
      timestamp: ISODate("...")
    },
    {
      role: "assistant",
      content: "Based on the loop data...",
      timestamp: ISODate("...")
    }
  ],
  
  metadata: {
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 2000
  },
  
  createdAt: ISODate("..."),
  updatedAt: ISODate("..."),
  expiresAt: ISODate("...")  // Auto-cleanup after 24 hours
}
```

### 3. **Agent Results Collection** (Agent Outputs)

```javascript
{
  _id: ObjectId("..."),
  agentId: "lesson-analyzer",
  sessionId: "sess_abc123",
  resultType: "analysis",
  loopId: "loop-123",
  
  // Actual result from agent
  result: {
    insights: [
      "Team velocity improved due to clear requirements",
      "External API delays caused 2-day slip"
    ],
    recommendations: [
      "Buffer external dependencies by 20%",
      "Continue current requirements process"
    ],
    rootCauses: ["unclear_requirements", "external_delays"],
    confidence: 0.85
  },
  
  confidence: 0.85,
  
  metadata: {
    processingTime: 3.2,  // seconds
    tokensUsed: 1250,
    model: "gpt-4"
  },
  
  createdAt: ISODate("...")
}
```

### 4. **People Collection** (Users/Team Members)

```javascript
{
  _id: ObjectId("..."),
  email: "john@enterprise.io",
  name: "John Doe",
  role: "Engineering Lead",
  
  velocityScore: {
    current: 0.78,
    trend: "up",
    lastUpdated: ISODate("...")
  },
  
  metadata: {
    skills: ["backend", "architecture", "ai"],
    timezone: "America/Los_Angeles",
    preferredWorkingHours: "9-17"
  },
  
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

---

## 💻 Implementation Guide

### 1. Local Development Setup

```bash
# Start MongoDB with docker-compose
docker-compose up -d mongodb redis rabbitmq

# Verify MongoDB is running
docker exec -it enterprise-aerostack-mongodb-1 mongosh -u agent -p agentpass

# In mongosh:
> use aerostack
> db.loops.find()
> db.agent_contexts.find()
```

### 2. Connect from Squid Backend

**Install MongoDB driver:**

```bash
cd squid-backend
npm install mongodb
```

**Create MongoDB client:**

```typescript
// squid-backend/src/lib/mongodb.ts
import { MongoClient, Db, ObjectId } from 'mongodb';

class MongoDBClient {
  private client: MongoClient;
  private db: Db | null = null;

  constructor() {
    const url = process.env.MONGODB_URL || 'mongodb://agent:agentpass@localhost:27017';
    this.client = new MongoClient(url);
  }

  async connect(): Promise<Db> {
    if (!this.db) {
      await this.client.connect();
      this.db = this.client.db('aerostack');
      console.log('✅ Connected to MongoDB');
    }
    return this.db;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.db = null;
    }
  }

  // Helper to get database
  getDb(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }
}

// Singleton instance
export const mongodb = new MongoDBClient();
export { ObjectId };
```

### 3. Create Squid Service with MongoDB

```typescript
// squid-backend/src/service/aerostack-service.ts
import { SquidService, executable } from '@squidcloud/backend';
import { mongodb, ObjectId } from '../lib/mongodb';

export class AerostackService extends SquidService {
  
  async onReady() {
    // Connect to MongoDB when service starts
    await mongodb.connect();
  }

  @executable()
  async createLoop(request: {
    title: string;
    owner: string;
    category: string;
    priority: string;
    pillar?: string;
  }): Promise<{ loopId: string }> {
    const db = mongodb.getDb();
    
    const loop = {
      title: request.title,
      owner: request.owner,
      category: request.category,
      priority: request.priority,
      pillar: request.pillar,
      status: 'active',
      tags: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('loops').insertOne(loop);
    
    return { loopId: result.insertedId.toString() };
  }

  @executable()
  async getLoop(request: { loopId: string }) {
    const db = mongodb.getDb();
    
    const loop = await db.collection('loops').findOne({
      _id: new ObjectId(request.loopId)
    });
    
    if (!loop) {
      throw new Error(`Loop not found: ${request.loopId}`);
    }
    
    return loop;
  }

  @executable()
  async listLoops(request: {
    owner?: string;
    category?: string;
    status?: string;
    limit?: number;
  }) {
    const db = mongodb.getDb();
    
    const filter: any = {};
    if (request.owner) filter.owner = request.owner;
    if (request.category) filter.category = request.category;
    if (request.status) filter.status = request.status;

    const loops = await db.collection('loops')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(request.limit || 100)
      .toArray();

    return loops;
  }

  @executable()
  async updateLoop(request: {
    loopId: string;
    updates: any;
  }) {
    const db = mongodb.getDb();
    
    const result = await db.collection('loops').updateOne(
      { _id: new ObjectId(request.loopId) },
      { 
        $set: {
          ...request.updates,
          updatedAt: new Date()
        }
      }
    );

    return { success: result.modifiedCount > 0 };
  }
}
```

### 4. Implement Stateless Agent Pattern

```typescript
// squid-backend/src/service/stateless-agent.ts
import { mongodb, ObjectId } from '../lib/mongodb';
import { LyzrAutomata, Agent } from 'lyzr-automata';

export class StatelessLessonAnalyzer {
  private lyzr: LyzrAutomata;
  private agentId = 'lesson-analyzer';

  constructor() {
    this.lyzr = new LyzrAutomata({
      llm: process.env.OPENAI_API_KEY ? 'openai' : 'bedrock'
    });
  }

  /**
   * Analyze a loop's lesson (stateless)
   * All context loaded from MongoDB, result saved to MongoDB
   */
  async analyzeLesson(params: {
    loopId: string;
    lesson: string;
    sessionId?: string;
  }): Promise<any> {
    const db = mongodb.getDb();
    const sessionId = params.sessionId || new ObjectId().toString();

    // 1. Load context from MongoDB (stateless!)
    const context = await this.loadContext(sessionId);
    
    // 2. Load loop data for additional context
    const loop = await db.collection('loops').findOne({
      _id: new ObjectId(params.loopId)
    });

    // 3. Load historical lessons for pattern matching
    const historicalLessons = await db.collection('loops')
      .find({ 
        lesson: { $exists: true },
        category: loop?.category 
      })
      .limit(10)
      .toArray();

    // 4. Build messages for LLM (from stored context)
    const messages = [
      {
        role: 'system',
        content: `You are an expert at analyzing project lessons and extracting insights.
                  Analyze patterns, root causes, and actionable recommendations.`
      },
      ...context.messages,  // Previous conversation turns
      {
        role: 'user',
        content: `Analyze this lesson from loop "${loop?.title}":
                  
                  Lesson: ${params.lesson}
                  
                  Category: ${loop?.category}
                  Owner: ${loop?.owner}
                  
                  Historical context: ${historicalLessons.length} similar lessons in this category.
                  
                  Provide:
                  1. Key insights
                  2. Root causes
                  3. Actionable recommendations
                  4. Similar patterns from history
                  
                  Format as JSON.`
      }
    ];

    // 5. Call LLM (agent is stateless - no internal memory)
    const agent = this.lyzr.createAgent({
      name: 'LessonAnalyzer',
      role: 'Lesson analysis expert'
    });

    const llmResponse = await agent.chat({
      message: messages[messages.length - 1].content,
      context: { historicalLessons }
    });

    // 6. Parse result
    const result = this.parseAnalysis(llmResponse);

    // 7. Save context back to MongoDB (for next turn)
    await this.saveContext(sessionId, {
      messages: [...messages, {
        role: 'assistant',
        content: JSON.stringify(result),
        timestamp: new Date()
      }],
      state: {
        currentStep: 'completed',
        loopId: params.loopId
      }
    });

    // 8. Save result to MongoDB
    await db.collection('agent_results').insertOne({
      agentId: this.agentId,
      sessionId,
      resultType: 'analysis',
      loopId: params.loopId,
      result,
      confidence: result.confidence || 0.8,
      metadata: {
        processingTime: Date.now(),
        model: 'gpt-4'
      },
      createdAt: new Date()
    });

    // 9. Update loop with insights (denormalized for quick access)
    await db.collection('loops').updateOne(
      { _id: new ObjectId(params.loopId) },
      {
        $set: {
          'metadata.aiInsights': result,
          'metadata.lastAnalyzed': new Date(),
          updatedAt: new Date()
        }
      }
    );

    return result;
  }

  /**
   * Load agent context from MongoDB (stateless architecture)
   */
  private async loadContext(sessionId: string): Promise<any> {
    const db = mongodb.getDb();
    
    let context = await db.collection('agent_contexts').findOne({
      agentId: this.agentId,
      sessionId
    });

    // If no context exists, create new session
    if (!context) {
      context = {
        agentId: this.agentId,
        sessionId,
        contextType: 'analysis',
        state: {},
        messages: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };
      
      await db.collection('agent_contexts').insertOne(context);
    }

    return context;
  }

  /**
   * Save agent context to MongoDB (for next interaction)
   */
  private async saveContext(sessionId: string, updates: any): Promise<void> {
    const db = mongodb.getDb();
    
    await db.collection('agent_contexts').updateOne(
      { agentId: this.agentId, sessionId },
      {
        $set: {
          ...updates,
          updatedAt: new Date()
        }
      }
    );
  }

  private parseAnalysis(response: any): any {
    // Parse LLM response into structured format
    try {
      return typeof response === 'string' ? JSON.parse(response) : response;
    } catch {
      return {
        insights: [response],
        recommendations: [],
        rootCauses: [],
        confidence: 0.5
      };
    }
  }
}
```

### 5. Use Stateless Agent in Squid Executable

```typescript
// squid-backend/src/service/aerostack-service.ts
import { StatelessLessonAnalyzer } from './stateless-agent';

export class AerostackService extends SquidService {
  private lessonAnalyzer: StatelessLessonAnalyzer;

  constructor() {
    super();
    this.lessonAnalyzer = new StatelessLessonAnalyzer();
  }

  @executable()
  async scoreLoop(request: {
    loopId: string;
    effortScore: number;
    outcomeScore: number;
    lesson?: string;
    sessionId?: string;  // For multi-turn conversations
  }): Promise<{ success: boolean; insights?: any }> {
    const db = mongodb.getDb();

    // Update scores
    await db.collection('loops').updateOne(
      { _id: new ObjectId(request.loopId) },
      {
        $set: {
          effortScore: request.effortScore,
          outcomeScore: request.outcomeScore,
          lesson: request.lesson,
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    // Analyze with stateless agent
    let insights = null;
    if (request.lesson) {
      insights = await this.lessonAnalyzer.analyzeLesson({
        loopId: request.loopId,
        lesson: request.lesson,
        sessionId: request.sessionId
      });
    }

    return { success: true, insights };
  }
}
```

---

## 🚀 Local Development Workflow

### 1. Start MongoDB

```bash
# Start MongoDB + Redis + RabbitMQ
docker-compose up -d

# Verify MongoDB is running and initialized
docker logs enterprise-aerostack-mongodb-1 | grep "initialized"

# Connect to MongoDB shell
docker exec -it enterprise-aerostack-mongodb-1 mongosh -u agent -p agentpass

# In mongosh
> use aerostack
> show collections
> db.loops.find().pretty()
```

### 2. Configure Environment

```bash
# squid-backend/.env.local
MONGODB_URL=mongodb://agent:agentpass@localhost:27017/aerostack
REDIS_URL=redis://:agentpass@localhost:6379
RABBITMQ_URL=amqp://agent:agentpass@localhost:5672

# AI/LLM Config
OPENAI_API_KEY=sk-your-key
# OR for AWS Bedrock:
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

### 3. Start Backend & Frontend

```bash
# Terminal 1: Backend
cd squid-backend
npm install mongodb  # Add MongoDB driver
squid start

# Terminal 2: Frontend
cd pwa-frontend
npm run dev

# Access
# Frontend: http://localhost:5173
# Backend: http://localhost:8000
# MongoDB: localhost:27017
# RabbitMQ UI: http://localhost:15672
```

### 4. Test Stateless Agents

```bash
# Create a loop
curl -X POST http://localhost:8000/api/createLoop \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test stateless agent",
    "owner": "test@enterprise.io",
    "category": "ENG",
    "priority": "P0"
  }'

# Score with AI analysis (stateless agent)
curl -X POST http://localhost:8000/api/scoreLoop \
  -H "Content-Type: application/json" \
  -d '{
    "loopId": "...",
    "effortScore": 7,
    "outcomeScore": 8,
    "lesson": "Stateless architecture provides better scalability",
    "sessionId": "test-session-123"
  }'

# Check MongoDB for results
docker exec -it enterprise-aerostack-mongodb-1 mongosh -u agent -p agentpass
> use aerostack
> db.agent_results.find().pretty()
> db.agent_contexts.find().pretty()
```

---

## 🎯 Stateless Agent Benefits

### ✅ **Horizontal Scaling**
```
┌─────────┐ ┌─────────┐ ┌─────────┐
│Agent    │ │Agent    │ │Agent    │
│Instance1│ │Instance2│ │Instance3│
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     └───────────┼───────────┘
                 │
          ┌──────▼──────┐
          │   MongoDB   │
          │(Shared State)│
          └─────────────┘
```
Any agent instance can handle any request!

### ✅ **No Session Affinity**
- Load balancer can route to any agent
- No sticky sessions required
- Agents can crash and restart

### ✅ **Easy Debugging**
```bash
# All agent state visible in MongoDB
db.agent_contexts.find({ sessionId: "debug-session" })

# Replay conversations
db.agent_contexts.findOne({ sessionId: "..." }).messages
```

### ✅ **Cost Effective**
- Scale agents independently
- Auto-scale based on workload
- No need to keep agents running 24/7

---

## 📊 Monitoring & Observability

### Query Agent Performance

```javascript
// Average processing time per agent
db.agent_results.aggregate([
  {
    $group: {
      _id: "$agentId",
      avgProcessingTime: { $avg: "$metadata.processingTime" },
      count: { $sum: 1 }
    }
  }
])

// Agent usage over time
db.agent_results.aggregate([
  {
    $group: {
      _id: {
        agent: "$agentId",
        date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
      },
      count: { $sum: 1 }
    }
  }
])

// Active sessions
db.agent_contexts.countDocuments({ 
  updatedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }  // Last hour
})
```

---

## 🎓 Next Steps

1. **Start local MongoDB**: `docker-compose up -d`
2. **Install MongoDB driver**: `npm install mongodb`
3. **Update Squid services** to use MongoDB
4. **Implement stateless agents** following patterns above
5. **Deploy to K8s** (MongoDB included in Helm chart)

See also:
- [LOCAL-DEVELOPMENT-GUIDE.md](./LOCAL-DEVELOPMENT-GUIDE.md)
- [k8s/DEPLOYMENT.md](../k8s/DEPLOYMENT.md)

