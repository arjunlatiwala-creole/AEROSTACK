import { SquidService, executable } from '@squidcloud/backend';
import { mongodb } from '../lib/mongodb';
import type {
  McpServer,
  McpTool,
  McpToolCall,
  McpConnection,
  McpResource,
  RegisterMcpServerRequest,
  RegisterMcpServerResponse,
  CallMcpToolRequest,
  CallMcpToolResponse,
  ListMcpServersParams,
  ListMcpToolsParams,
  ApiError,
} from '@enterprise/common';

/**
 * MCP Service - Model Context Protocol Integration
 * 
 * Manages MCP servers, tools, and provides a unified interface for:
 * - Human users to discover and call tools via UI
 * - AI agents to access tools programmatically
 * - Monitoring and analytics of tool usage
 */
export class McpService extends SquidService {
  
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // =============================================
  // Server Management
  // =============================================

  @executable()
  async registerServer(request: RegisterMcpServerRequest): Promise<RegisterMcpServerResponse> {
    try {
      console.log('🔌 Registering MCP server:', request.name);
      
      const serverId = this.generateId('mcp_srv');
      const now = new Date().toISOString();
      
      const server: McpServer = {
        server_id: serverId,
        name: request.name,
        description: request.description,
        protocol_version: '1.0.0',
        endpoint: request.endpoint,
        connection_type: request.connection_type,
        status: 'initializing',
        capabilities: {
          tools: false,
          resources: false,
          prompts: false,
          sampling: false,
        },
        metadata: request.metadata || {},
        created_at: now,
        updated_at: now,
      };

      // Store in MongoDB
      const collection = await mongodb.getCollection('mcp_servers');
      await collection.insertOne(server as any);

      // Try to discover capabilities
      let discoveredTools: McpTool[] = [];
      try {
        const capabilities = await this.discoverCapabilities(server);
        server.capabilities = capabilities;
        server.status = 'connected';
        
        // Discover tools if capability exists
        if (capabilities.tools) {
          discoveredTools = await this.discoverTools(server);
        }
        
        // Update status
        await collection.updateOne(
          { server_id: serverId },
          { $set: { capabilities, status: 'connected', last_ping: now } }
        );
      } catch (error: any) {
        console.error('⚠️  Server registered but discovery failed:', error.message);
        await collection.updateOne(
          { server_id: serverId },
          { $set: { status: 'error', metadata: { ...server.metadata, error: error.message } } }
        );
      }

      console.log(`✅ Server registered: ${serverId} (${discoveredTools.length} tools)`);
      
      return {
        server_id: serverId,
        status: server.status === 'connected' ? 'registered' : 'error',
        capabilities: server.capabilities,
        tools: discoveredTools,
      };
    } catch (error: any) {
      console.error('❌ Error registering MCP server:', error);
      throw {
        error: {
          code: 'REGISTER_SERVER_FAILED',
          message: 'Failed to register MCP server',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async listServers(params: ListMcpServersParams = {}): Promise<McpServer[]> {
    try {
      const collection = await mongodb.getCollection('mcp_servers');
      const query: any = {};
      
      if (params.status) query.status = params.status;
      if (params.connection_type) query.connection_type = params.connection_type;
      if (params.has_capability) query[`capabilities.${params.has_capability}`] = true;
      
      const servers = await collection
        .find(query)
        .sort({ created_at: -1 })
        .toArray();
      
      return servers as unknown as McpServer[];
    } catch (error: any) {
      console.error('❌ Error listing MCP servers:', error);
      throw {
        error: {
          code: 'LIST_SERVERS_FAILED',
          message: 'Failed to list MCP servers',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getServer(server_id: string): Promise<McpServer> {
    try {
      const collection = await mongodb.getCollection('mcp_servers');
      const server = await collection.findOne({ server_id });
      
      if (!server) {
        throw new Error(`Server ${server_id} not found`);
      }
      
      return server as unknown as McpServer;
    } catch (error: any) {
      console.error('❌ Error getting MCP server:', error);
      throw {
        error: {
          code: 'GET_SERVER_FAILED',
          message: 'Failed to get MCP server',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async pingServer(server_id: string): Promise<{ alive: boolean; latency_ms: number }> {
    try {
      const start = Date.now();
      const server = await this.getServer(server_id);
      
      // TODO: Implement actual ping based on connection_type
      // For now, just check if endpoint is reachable
      const alive = true; // Placeholder
      const latency_ms = Date.now() - start;
      
      // Update last_ping
      const collection = await mongodb.getCollection('mcp_servers');
      await collection.updateOne(
        { server_id },
        { $set: { last_ping: new Date().toISOString(), status: alive ? 'connected' : 'error' } }
      );
      
      return { alive, latency_ms };
    } catch (error: any) {
      return { alive: false, latency_ms: -1 };
    }
  }

  @executable()
  async deleteServer(server_id: string): Promise<{ success: boolean }> {
    try {
      const collection = await mongodb.getCollection('mcp_servers');
      const result = await collection.deleteOne({ server_id });
      
      // Also delete associated tools and calls
      const toolsCollection = await mongodb.getCollection('mcp_tools');
      await toolsCollection.deleteMany({ server_id });
      
      return { success: result.deletedCount > 0 };
    } catch (error: any) {
      console.error('❌ Error deleting MCP server:', error);
      return { success: false };
    }
  }

  // =============================================
  // Tool Discovery & Management
  // =============================================

  @executable()
  async listTools(params: ListMcpToolsParams = {}): Promise<McpTool[]> {
    try {
      const collection = await mongodb.getCollection('mcp_tools');
      const query: any = {};
      
      if (params.server_id) query.server_id = params.server_id;
      if (params.category) query.category = params.category;
      if (params.tag) query.tags = params.tag;
      if (params.search) {
        query.$or = [
          { name: { $regex: params.search, $options: 'i' } },
          { description: { $regex: params.search, $options: 'i' } },
        ];
      }
      
      const tools = await collection
        .find(query)
        .sort({ usage_count: -1, name: 1 })
        .toArray();
      
      return tools as unknown as McpTool[];
    } catch (error: any) {
      console.error('❌ Error listing MCP tools:', error);
      throw {
        error: {
          code: 'LIST_TOOLS_FAILED',
          message: 'Failed to list MCP tools',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getTool(tool_id: string): Promise<McpTool> {
    try {
      const collection = await mongodb.getCollection('mcp_tools');
      const tool = await collection.findOne({ tool_id });
      
      if (!tool) {
        throw new Error(`Tool ${tool_id} not found`);
      }
      
      return tool as unknown as McpTool;
    } catch (error: any) {
      console.error('❌ Error getting MCP tool:', error);
      throw {
        error: {
          code: 'GET_TOOL_FAILED',
          message: 'Failed to get MCP tool',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Tool Execution
  // =============================================

  @executable()
  async callTool(request: CallMcpToolRequest): Promise<CallMcpToolResponse> {
    const callId = this.generateId('mcp_call');
    const startTime = Date.now();
    
    try {
      console.log(`🔧 Calling MCP tool: ${request.tool_id}`);
      
      // Get tool and server info
      const tool = await this.getTool(request.tool_id);
      const server = await this.getServer(tool.server_id);
      
      // Record call in progress
      const call: McpToolCall = {
        call_id: callId,
        tool_id: request.tool_id,
        server_id: tool.server_id,
        caller_type: request.caller_type,
        caller_id: request.caller_id,
        input: request.input,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      
      const callsCollection = await mongodb.getCollection('mcp_tool_calls');
      await callsCollection.insertOne(call as any);
      
      // Execute the tool call
      const output = await this.executeToolCall(server, tool, request.input, request.timeout_ms);
      const durationMs = Date.now() - startTime;
      
      // Update call record
      await callsCollection.updateOne(
        { call_id: callId },
        {
          $set: {
            output,
            status: 'success',
            duration_ms: durationMs,
            completed_at: new Date().toISOString(),
          },
        }
      );
      
      // Update tool stats
      const toolsCollection = await mongodb.getCollection('mcp_tools');
      await toolsCollection.updateOne(
        { tool_id: request.tool_id },
        {
          $inc: { usage_count: 1 },
          $set: { updated_at: new Date().toISOString() },
        }
      );
      
      console.log(`✅ Tool call completed: ${callId} (${durationMs}ms)`);
      
      return {
        call_id: callId,
        output,
        duration_ms: durationMs,
        status: 'success',
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      console.error('❌ Error calling MCP tool:', error);
      
      // Update call record with error
      const callsCollection = await mongodb.getCollection('mcp_tool_calls');
      await callsCollection.updateOne(
        { call_id: callId },
        {
          $set: {
            status: 'error',
            error_message: error.message,
            duration_ms: durationMs,
            completed_at: new Date().toISOString(),
          },
        }
      );
      
      return {
        call_id: callId,
        output: {},
        duration_ms: durationMs,
        status: 'error',
        error_message: error.message,
      };
    }
  }

  @executable()
  async getToolCallHistory(params: { tool_id?: string; caller_id?: string; limit?: number } = {}): Promise<McpToolCall[]> {
    try {
      const collection = await mongodb.getCollection('mcp_tool_calls');
      const query: any = {};
      
      if (params.tool_id) query.tool_id = params.tool_id;
      if (params.caller_id) query.caller_id = params.caller_id;
      
      const calls = await collection
        .find(query)
        .sort({ created_at: -1 })
        .limit(params.limit || 50)
        .toArray();
      
      return calls as unknown as McpToolCall[];
    } catch (error: any) {
      console.error('❌ Error getting tool call history:', error);
      return [];
    }
  }

  // =============================================
  // Private Helper Methods
  // =============================================

  private async discoverCapabilities(server: McpServer): Promise<McpServer['capabilities']> {
    // TODO: Implement actual MCP protocol capability discovery
    // For now, return stub based on server metadata
    return {
      tools: true,
      resources: server.metadata?.supports_resources || false,
      prompts: server.metadata?.supports_prompts || false,
      sampling: false,
    };
  }

  private async discoverTools(server: McpServer): Promise<McpTool[]> {
    // TODO: Implement actual MCP protocol tool discovery
    // For now, return empty array - tools will be registered manually or via protocol
    console.log(`🔍 Discovering tools for server: ${server.name}`);
    
    // Stub: In real implementation, this would call the MCP server's list_tools method
    const stubTools: McpTool[] = [];
    
    if (stubTools.length > 0) {
      const toolsCollection = await mongodb.getCollection('mcp_tools');
      await toolsCollection.insertMany(stubTools as any);
    }
    
    return stubTools;
  }

  private async executeToolCall(
    server: McpServer,
    tool: McpTool,
    input: Record<string, any>,
    timeoutMs?: number
  ): Promise<Record<string, any>> {
    // TODO: Implement actual MCP protocol tool execution
    // This should:
    // 1. Connect to the MCP server (http, stdio, or websocket)
    // 2. Send tool call request with input
    // 3. Wait for response
    // 4. Return output
    
    console.log(`⚙️  Executing tool ${tool.name} on ${server.name}`);
    console.log(`   Input:`, JSON.stringify(input, null, 2));
    
    // Stub implementation - return mock response
    return {
      message: `Tool ${tool.name} executed successfully (stub)`,
      input_received: input,
      timestamp: new Date().toISOString(),
    };
  }

  // =============================================
  // Analytics & Monitoring
  // =============================================

  @executable()
  async getServerStats(server_id: string): Promise<any> {
    try {
      const toolsCollection = await mongodb.getCollection('mcp_tools');
      const callsCollection = await mongodb.getCollection('mcp_tool_calls');
      
      const tools = await toolsCollection.find({ server_id }).toArray();
      const calls = await callsCollection.find({ server_id }).toArray();
      
      const successCalls = calls.filter((c: any) => c.status === 'success');
      const errorCalls = calls.filter((c: any) => c.status === 'error');
      
      const avgDuration = calls.length > 0
        ? calls.reduce((sum: number, c: any) => sum + (c.duration_ms || 0), 0) / calls.length
        : 0;
      
      return {
        server_id,
        total_tools: tools.length,
        total_calls: calls.length,
        success_calls: successCalls.length,
        error_calls: errorCalls.length,
        success_rate: calls.length > 0 ? (successCalls.length / calls.length) * 100 : 0,
        avg_duration_ms: Math.round(avgDuration),
        last_call: calls.length > 0 ? calls[0].created_at : null,
      };
    } catch (error: any) {
      console.error('❌ Error getting server stats:', error);
      return null;
    }
  }
}

