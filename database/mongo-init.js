// MongoDB initialization script for Aerostack
// This script runs on first container start

// Switch to Aerostack database
db = db.getSiblingDB("aerostack");

// Create collections with validation schemas
db.createCollection("loops", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["title", "owner", "category", "status", "createdAt"],
      properties: {
        title: {
          bsonType: "string",
          description: "Loop title - required",
        },
        owner: {
          bsonType: "string",
          description: "Owner email - required",
        },
        category: {
          enum: ["ENG", "MSP", "BD", "GTM", "ADVISORY"],
          description: "Category - must be one of enum values",
        },
        pillar: {
          bsonType: "string",
          description: "Strategic pillar",
        },
        status: {
          enum: ["active", "in_progress", "completed", "adapted", "handed_off"],
          description: "Current status",
        },
        priority: {
          enum: ["P0", "P1", "P2", "P3"],
          description: "Priority level",
        },
        effortScore: {
          bsonType: "double",
          minimum: 0,
          maximum: 10,
          description: "Effort score 0-10",
        },
        outcomeScore: {
          bsonType: "double",
          minimum: 0,
          maximum: 10,
          description: "Outcome score 0-10",
        },
        lesson: {
          bsonType: "string",
          description: "Lesson learned",
        },
        contributors: {
          bsonType: "array",
          items: {
            bsonType: "object",
            properties: {
              email: { bsonType: "string" },
              merit: { bsonType: "double", minimum: 0.25, maximum: 0.5 },
            },
          },
        },
        tags: {
          bsonType: "array",
          items: { bsonType: "string" },
        },
        metadata: {
          bsonType: "object",
          description: "Flexible metadata for agent-generated data",
        },
        createdAt: {
          bsonType: "date",
          description: "Creation timestamp",
        },
        updatedAt: {
          bsonType: "date",
          description: "Last update timestamp",
        },
        completedAt: {
          bsonType: "date",
          description: "Completion timestamp",
        },
      },
    },
  },
});

// Create collection for agent state/context
db.createCollection("agent_contexts", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["agentId", "contextType", "createdAt"],
      properties: {
        agentId: {
          bsonType: "string",
          description: "Agent identifier",
        },
        sessionId: {
          bsonType: "string",
          description: "Session identifier for stateless agents",
        },
        contextType: {
          enum: ["conversation", "analysis", "recommendation", "workflow"],
          description: "Type of context",
        },
        state: {
          bsonType: "object",
          description: "Agent state data",
        },
        messages: {
          bsonType: "array",
          items: {
            bsonType: "object",
            properties: {
              role: { enum: ["user", "assistant", "system"] },
              content: { bsonType: "string" },
              timestamp: { bsonType: "date" },
            },
          },
        },
        metadata: {
          bsonType: "object",
          description: "Additional context metadata",
        },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        expiresAt: { bsonType: "date", description: "TTL for cleanup" },
      },
    },
  },
});

// Create collection for agent results/artifacts
db.createCollection("agent_results", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["agentId", "resultType", "createdAt"],
      properties: {
        agentId: {
          bsonType: "string",
          description: "Agent that produced this result",
        },
        sessionId: {
          bsonType: "string",
          description: "Associated session",
        },
        resultType: {
          enum: ["analysis", "recommendation", "summary", "report", "insight"],
          description: "Type of result",
        },
        loopId: {
          bsonType: "string",
          description: "Associated loop if applicable",
        },
        result: {
          bsonType: "object",
          description: "Actual result data",
        },
        confidence: {
          bsonType: "double",
          minimum: 0,
          maximum: 1,
          description: "Confidence score",
        },
        metadata: {
          bsonType: "object",
          description: "Result metadata",
        },
        createdAt: { bsonType: "date" },
      },
    },
  },
});

// Create collection for people/users
db.createCollection("people", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "name", "createdAt"],
      additionalProperties: true, // Allow additional fields not defined in schema
      properties: {
        email: { bsonType: "string" },
        name: { bsonType: "string" },
        user_id: { bsonType: "string" },
        is_verified: { bsonType: "bool" },
        role: { bsonType: "string" },
        velocityScore: {
          bsonType: "object",
          additionalProperties: true, // Allow additional fields in nested object
          properties: {
            current: { bsonType: ["double", "int"] }, // Accept both double and int
            trend: { bsonType: "string" },
            lastUpdated: { bsonType: "date" },
          },
        },
        metadata: { bsonType: "object" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
});

// Create indexes for performance
db.loops.createIndex({ owner: 1, status: 1 });
db.loops.createIndex({ category: 1, priority: 1 });
db.loops.createIndex({ tags: 1 });
db.loops.createIndex({ createdAt: -1 });
db.loops.createIndex({ "metadata.aiGenerated": 1 }); // For agent-generated data

db.agent_contexts.createIndex({ agentId: 1, sessionId: 1 });
db.agent_contexts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
db.agent_contexts.createIndex({ createdAt: -1 });

db.agent_results.createIndex({ agentId: 1, resultType: 1 });
db.agent_results.createIndex({ loopId: 1 });
db.agent_results.createIndex({ sessionId: 1 });
db.agent_results.createIndex({ createdAt: -1 });

db.people.createIndex({ email: 1 }, { unique: true });
db.people.createIndex({ name: 1 });

// Insert sample data
db.loops.insertMany([
  {
    _id: new ObjectId(),
    title: "Setup MongoDB for stateless agents",
    owner: "team@enterprise.io",
    category: "ENG",
    pillar: "Infrastructure",
    status: "completed",
    priority: "P0",
    effortScore: 8,
    outcomeScore: 9,
    lesson: "MongoDB provides excellent flexibility for agent-generated data",
    tags: ["database", "agents", "architecture"],
    metadata: {
      aiGenerated: false,
      complexity: "medium",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
  },
]);

db.people.insertMany([
  {
    _id: new ObjectId(),
    email: "team@enterprise.io",
    name: "Enterprise Team",
    role: "Engineering",
    velocityScore: {
      current: 0.75,
      trend: "up",
      lastUpdated: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]);

print("✅ Aerostack MongoDB initialized successfully");
print("📊 Collections created: loops, agent_contexts, agent_results, people");
print("🔍 Indexes created for optimal query performance");
print("📝 Sample data inserted");
