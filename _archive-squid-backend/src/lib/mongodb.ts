/**
 * MongoDB Client for Aerostack
 * Singleton pattern for connection management
 */

import { MongoClient, Db, ObjectId, Collection } from "mongodb";

class MongoDBClient {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connecting: Promise<Db> | null = null;

  constructor() {
    // Initialize client on import
    this.connect();
  }

  /**
   * Connect to MongoDB
   * Uses singleton pattern - only one connection
   */
  async connect(): Promise<Db> {
    // Return existing connection
    if (this.db) {
      return this.db;
    }

    // Wait for in-progress connection
    if (this.connecting) {
      return this.connecting;
    }

    // Create new connection
    this.connecting = this._doConnect();
    const db = await this.connecting;
    this.connecting = null;
    return db;
  }

  private async _doConnect(): Promise<Db> {
    try {
      const url =
        process.env.MONGODB_URL || "mongodb://agent:agentpass@localhost:27017";

      this.client = new MongoClient(url, {
        maxPoolSize: 10,
        minPoolSize: 5,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      await this.client.connect();
      this.db = this.client.db("aerostack");

      console.log("✅ Connected to MongoDB");

      // Test connection
      await this.db.admin().ping();

      return this.db;
    } catch (error) {
      console.error("❌ MongoDB connection failed:", error);
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   * Call on application shutdown
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log("🔌 Disconnected from MongoDB");
    }
  }

  /**
   * Get database instance
   * Automatically connects if not connected
   */
  async getDb(): Promise<Db> {
    if (!this.db) {
      return await this.connect();
    }
    return this.db;
  }

  /**
   * Get collection with type safety
   */
  async getCollection(name: string): Promise<Collection> {
    const db = await this.getDb();
    return db.collection(name);
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const db = await this.getDb();
      await db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const mongodb = new MongoDBClient();

// Re-export ObjectId for convenience
export { ObjectId };

// Type definitions for collections
export interface Loop {
  _id?: ObjectId;
  title: string;
  owner: string;
  category: "ENG" | "MSP" | "BD" | "GTM" | "ADVISORY";
  pillar?: string;
  status: "active" | "in_progress" | "completed" | "adapted" | "handed_off";
  priority: "P0" | "P1" | "P2" | "P3";
  effortScore?: number;
  outcomeScore?: number;
  lesson?: string;
  contributors?: Array<{ email: string; merit: number }>;
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface AgentContext {
  _id?: ObjectId;
  agentId: string;
  sessionId: string;
  contextType: "conversation" | "analysis" | "recommendation" | "workflow";
  state: Record<string, any>;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
  }>;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface AgentResult {
  _id?: ObjectId;
  agentId: string;
  sessionId: string;
  resultType: "analysis" | "recommendation" | "summary" | "report" | "insight";
  loopId?: string;
  result: Record<string, any>;
  confidence: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface Person {
  _id?: ObjectId;
  email: string;
  name: string;
  user_id?: string;
  is_verified?: boolean;
  role?: string;
  velocityScore?: {
    current: number;
    trend: string;
    lastUpdated: Date;
  };
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
