# Squid + Lyzr: Equal Agentic Layers

**Understanding how Squid and Lyzr work as peer agent frameworks in Aerostack**

## 🎯 Core Principle

**Squid and Lyzr are EQUAL agentic layers** - they are both agent frameworks that:
- ✅ Execute independently
- ✅ Share MongoDB as state store
- ✅ Are both stateless
- ✅ Can call each other if needed
- ✅ Both called directly from frontend

Neither orchestrates the other - they're peers.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│            Frontend (React PWA)                   │
│                                                   │
│  User creates loop ──► Call Squid executable     │
│  User asks AI question ──► Call Lyzr agent       │
└───────────────┬──────────────────┬───────────────┘
                │                  │
                │                  │
      ┌─────────▼─────────┐  ┌────▼────────────┐
      │   Squid Agents    │  │  Lyzr Agents    │
      │   (Stateless)     │  │  (Stateless)    │
      │                   │  │                 │
      │ • createLoop()    │  │ • analyzeLesson│
      │ • scoreLoop()     │  │ • recommend()  │
      │ • listLoops()     │  │ • summarize()  │
      │ • updateLoop()    │  │ • chat()       │
      └─────────┬─────────┘  └────┬────────────┘
                │                  │
                │   Both write     │
                │   to same DB     │
                │                  │
         ┌──────▼──────────────────▼──────┐
         │         MongoDB                 │
         │    (Single Source of Truth)     │
         │                                 │
         │  Collections:                   │
         │  • loops                        │
         │  • agent_contexts (both!)       │
         │  • agent_results (both!)        │
         │  • people                       │
         └─────────────────────────────────┘
```

---

## 🔄 How They Interact

### **Option 1: Independent (Most Common)**

```typescript
// Frontend calls Squid agent directly
const loop = await squidClient.executeFunction('createLoop', {
  title: 'Build feature X',
  owner: 'john@enterprise.io'
});

// Frontend calls Lyzr agent directly
const analysis = await lyzrClient.chat('analyze this loop', {
  loopId: loop.loopId
});
```

### **Option 2: Squid Calls Lyzr (When Needed)**

```typescript
// Squid agent
@executable()
async scoreLoop(request: {
  loopId: string;
  lesson: string;
}) {
  // 1. Update scores in MongoDB
  await mongodb.getCollection('loops').updateOne(...);

  // 2. Call Lyzr agent for AI analysis
  const lyzrAnalysis = await this.lyzrAgent.analyzeLesson({
    lesson: request.lesson
  });

  // 3. Save result to MongoDB
  await mongodb.getCollection('agent_results').insertOne({
    agentId: 'lyzr-analyzer',
    result: lyzrAnalysis
  });

  return { success: true, analysis: lyzrAnalysis };
}
```

### **Option 3: Lyzr Calls Squid (When Needed)**

```typescript
// Lyzr agent
async analyzeAndCreateRecommendations(params: {
  loopId: string;
}) {
  // 1. Load loop from MongoDB
  const loop = await mongodb.getCollection('loops').findOne({
    _id: new ObjectId(params.loopId)
  });

  // 2. Analyze with LLM
  const recommendations = await this.llm.chat(...);

  // 3. Use Squid agent to create new loops from recommendations
  for (const rec of recommendations) {
    await squidClient.executeFunction('createLoop', {
      title: rec.title,
      owner: loop.owner,
      category: loop.category
    });
  }
}
```

---

## 📝 Real-World Example

**Scenario:** User completes a loop and provides a lesson learned

### **Step 1: Frontend calls Squid**

```typescript
// Frontend
const result = await squidClient.executeFunction('scoreLoop', {
  loopId: '123',
  effortScore: 7,
  outcomeScore: 8,
  lesson: 'OAuth integration was smoother than expected'
});
```

### **Step 2: Squid agent updates MongoDB**

```typescript
// Squid agent (squid-backend/src/service/aerostack-service.ts)
@executable()
async scoreLoop(request) {
  // Update loop in MongoDB
  await mongodb.getCollection('loops').updateOne(
    { _id: new ObjectId(request.loopId) },
    {
      $set: {
        effortScore: request.effortScore,
        outcomeScore: request.outcomeScore,
        lesson: request.lesson,
        status: 'completed'
      }
    }
  );

  return { success: true, loopId: request.loopId };
}
```

### **Step 3: Frontend calls Lyzr agent**

```typescript
// Frontend
const insights = await lyzrClient.chat(
  'Analyze this lesson and find patterns',
  {
    loopId: '123',
    lesson: result.lesson
  }
);
```

### **Step 4: Lyzr agent analyzes and saves to MongoDB**

```typescript
// Lyzr agent
async analyzeLesson(params) {
  // 1. Load loop from MongoDB
  const loop = await mongodb.getCollection('loops').findOne({
    _id: new ObjectId(params.loopId)
  });

  // 2. Load historical lessons for context
  const historical = await mongodb.getCollection('loops')
    .find({ category: loop.category, lesson: { $exists: true } })
    .limit(10)
    .toArray();

  // 3. Analyze with LLM
  const analysis = await this.llm.chat({
    message: `Analyze: ${params.lesson}`,
    context: historical
  });

  // 4. Save result to MongoDB
  await mongodb.getCollection('agent_results').insertOne({
    agentId: 'lyzr-lesson-analyzer',
    loopId: params.loopId,
    resultType: 'analysis',
    result: analysis,
    createdAt: new Date()
  });

  // 5. Update loop with insights
  await mongodb.getCollection('loops').updateOne(
    { _id: new ObjectId(params.loopId) },
    {
      $set: {
        'metadata.aiInsights': analysis,
        'metadata.lastAnalyzed': new Date()
      }
    }
  );

  return analysis;
}
```

---

## 🎨 When to Use Which?

### **Use Squid Agents For:**
- ✅ CRUD operations (create, read, update, delete)
- ✅ Data validation and business logic
- ✅ Workflow orchestration
- ✅ Database queries and aggregations
- ✅ Real-time updates via WebSocket
- ✅ Authentication and authorization

**Examples:**
- `createLoop()` - Create new loops
- `updateLoop()` - Update loop fields
- `listLoops()` - Query and filter loops
- `scoreLoop()` - Record scores
- `getVelocity()` - Calculate metrics

### **Use Lyzr Agents For:**
- ✅ Natural language processing
- ✅ AI/ML analysis and insights
- ✅ LLM-powered reasoning
- ✅ Pattern recognition
- ✅ Recommendations and predictions
- ✅ Summarization and extraction

**Examples:**
- `analyzeLesson()` - Extract insights from text
- `recommendSimilar()` - Find similar loops
- `predictOutcome()` - Forecast results
- `generateSummary()` - Summarize data
- `chatWithContext()` - Conversational AI

---

## 💾 State Management (Both Equal)

Both frameworks store state in MongoDB the same way:

### **Squid Agent State**

```typescript
// Store Squid agent context
await mongodb.getCollection('agent_contexts').insertOne({
  agentId: 'squid-workflow-orchestrator',
  sessionId: 'session-123',
  contextType: 'workflow',
  state: {
    currentStep: 'awaiting-approval',
    loopId: 'loop-123'
  },
  createdAt: new Date()
});
```

### **Lyzr Agent State**

```typescript
// Store Lyzr agent context
await mongodb.getCollection('agent_contexts').insertOne({
  agentId: 'lyzr-lesson-analyzer',
  sessionId: 'session-456',
  contextType: 'conversation',
  state: {
    currentAnalysis: 'in-progress',
    loopId: 'loop-123'
  },
  messages: [
    { role: 'user', content: 'Analyze this...', timestamp: new Date() },
    { role: 'assistant', content: 'Based on...', timestamp: new Date() }
  ],
  createdAt: new Date()
});
```

Both follow the same pattern!

---

## 🔄 Communication Patterns

### **Pattern 1: Frontend orchestrates (Recommended)**

```
Frontend ──► Squid Agent ──► MongoDB
         └─► Lyzr Agent ──► MongoDB
```

Frontend decides which agent to call based on task.

### **Pattern 2: Agents collaborate via MongoDB**

```
Squid Agent ──► MongoDB ──► Lyzr Agent
                  ▲            │
                  └────────────┘
```

Agents communicate by reading/writing shared MongoDB collections.

### **Pattern 3: Direct agent-to-agent**

```
Squid Agent ──► calls ──► Lyzr Agent
    │                          │
    └──► MongoDB ◄─────────────┘
```

One agent directly invokes another when needed.

---

## 📋 Implementation Checklist

### **For Squid Agents:**

```typescript
// squid-backend/src/service/aerostack-service.ts
import { SquidService, executable } from '@squidcloud/backend';
import { mongodb, ObjectId } from '../lib/mongodb';

export class AerostackService extends SquidService {
  async onReady() {
    await mongodb.connect();
  }

  @executable()
  async createLoop(request) {
    const loops = await mongodb.getCollection('loops');
    const result = await loops.insertOne({
      ...request,
      createdAt: new Date()
    });
    return { loopId: result.insertedId.toString() };
  }

  @executable()
  async getLoop(request) {
    const loops = await mongodb.getCollection('loops');
    return await loops.findOne({ _id: new ObjectId(request.loopId) });
  }
}
```

### **For Lyzr Agents:**

```typescript
// lyzr-agents/lesson-analyzer.ts
import { LyzrAutomata, Agent } from 'lyzr-automata';
import { mongodb, ObjectId } from '../lib/mongodb';

export class LessonAnalyzer {
  private lyzr: LyzrAutomata;

  constructor() {
    this.lyzr = new LyzrAutomata({
      llm: process.env.OPENAI_API_KEY ? 'openai' : 'bedrock'
    });
  }

  async analyzeLesson(params: {
    loopId: string;
    lesson: string;
    sessionId: string;
  }) {
    // 1. Load context from MongoDB
    const context = await mongodb.getCollection('agent_contexts').findOne({
      agentId: 'lyzr-lesson-analyzer',
      sessionId: params.sessionId
    });

    // 2. Analyze with LLM
    const agent = this.lyzr.createAgent({
      name: 'LessonAnalyzer',
      role: 'Extract insights from lessons'
    });

    const result = await agent.chat({
      message: params.lesson,
      context: context?.messages || []
    });

    // 3. Save to MongoDB
    await mongodb.getCollection('agent_results').insertOne({
      agentId: 'lyzr-lesson-analyzer',
      sessionId: params.sessionId,
      loopId: params.loopId,
      result,
      createdAt: new Date()
    });

    return result;
  }
}
```

---

## 🚀 Deployment

Both agent types deploy the same way:

```bash
# Local development
docker-compose up -d mongodb
cd squid-backend && npm install && squid start
cd lyzr-agents && npm install && npm start

# Kubernetes
make deploy-local      # Both agents included
make deploy-production # Both scale independently
```

In K8s, you can scale each agent type independently:

```bash
# Scale Squid agents
kubectl scale deployment aerostack-squid --replicas=10

# Scale Lyzr agents  
kubectl scale deployment aerostack-lyzr --replicas=5
```

---

## ✅ Best Practices

1. **Keep agents stateless** - Store everything in MongoDB
2. **Let frontend orchestrate** - Frontend decides which agent to call
3. **Use MongoDB for communication** - Agents read/write shared collections
4. **Separate concerns** - Squid for data, Lyzr for AI
5. **Share data models** - Use same MongoDB schemas
6. **Log to same collections** - Unified observability

---

## 📊 Monitoring

Query agent activity (both types):

```javascript
// Agent usage by type
db.agent_results.aggregate([
  {
    $group: {
      _id: "$agentId",
      count: { $sum: 1 },
      avgConfidence: { $avg: "$confidence" }
    }
  }
])

// Results:
// { _id: "squid-loop-creator", count: 150, avgConfidence: null }
// { _id: "lyzr-lesson-analyzer", count: 75, avgConfidence: 0.85 }
```

---

## 🎓 Summary

| Aspect | Squid Agents | Lyzr Agents |
|--------|-------------|-------------|
| **Purpose** | Data operations, workflows | AI/ML, reasoning |
| **State Storage** | MongoDB | MongoDB |
| **Stateless** | ✅ Yes | ✅ Yes |
| **Called By** | Frontend, other agents | Frontend, other agents |
| **Scales** | Horizontally | Horizontally |
| **Good For** | CRUD, validation, queries | NLP, analysis, predictions |

**Key Takeaway:** Squid and Lyzr are **peer agent frameworks** that both use MongoDB as their state store. Neither orchestrates the other - they work side-by-side as equal agentic layers.

