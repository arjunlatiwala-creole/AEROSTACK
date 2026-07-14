import React, { useState, useEffect, useReducer } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Plug,
  Plus,
  X,
  Radio,
  Trash2,
  RefreshCw,
  Play,
  Check,
  AlertCircle
} from 'lucide-react';

import { executable } from '../lib/squidClient';
import type { McpServer, McpTool, McpToolCall, RegisterMcpServerRequest, CallMcpToolRequest } from '@enterprise/common';
import toast from 'react-hot-toast';
import Loader from '@/components/Loader';
import { useWriteAccess } from '@/hooks/useWriteAccess';

type State = {
  servers: McpServer[];
  tools: McpTool[];
  toolCalls: McpToolCall[];
  selectedServer: McpServer | null;
  selectedTool: McpTool | null;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: 'SET_SERVERS'; payload: McpServer[] }
  | { type: 'SET_TOOLS'; payload: McpTool[] }
  | { type: 'SET_TOOL_CALLS'; payload: McpToolCall[] }
  | { type: 'SELECT_SERVER'; payload: McpServer | null }
  | { type: 'SELECT_TOOL'; payload: McpTool | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_ERROR' };

const initialState: State = {
  servers: [],
  tools: [],
  toolCalls: [],
  selectedServer: null,
  selectedTool: null,
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_SERVERS':
      return { ...state, servers: action.payload };
    case 'SET_TOOLS':
      return { ...state, tools: action.payload };
    case 'SET_TOOL_CALLS':
      return { ...state, toolCalls: action.payload };
    case 'SELECT_SERVER':
      return { ...state, selectedServer: action.payload, tools: [], selectedTool: null };
    case 'SELECT_TOOL':
      return { ...state, selectedTool: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}
type DialogType = 'add-server' | 'call-tool' | 'delete-server' | null;

export default function DashboardMcp() {
  const { canWrite } = useWriteAccess();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);

  const [serverForm, setServerForm] = useState({
    name: '',
    description: '',
    endpoint: '',
    type: 'http' as 'http' | 'stdio' | 'websocket'
  });
  const [toolInput, setToolInput] = useState('{}');
  const [serverToDelete, setServerToDelete] = useState<McpServer | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  useEffect(() => {
    if (state.selectedServer) {
      loadTools(state.selectedServer.server_id);
    }
  }, [state.selectedServer]);

  const loadServers = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const listServers = executable('McpService', 'listServers');
      const serverList = await listServers({});
      dispatch({ type: 'SET_SERVERS', payload: serverList });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to load servers' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const loadTools = async (serverId: string) => {
    try {
      const listTools = executable('McpService', 'listTools');
      const toolList = await listTools({ server_id: serverId });
      dispatch({ type: 'SET_TOOLS', payload: toolList });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to load tools' });
    }
  };

  const loadToolCalls = async (toolId: string) => {
    try {
      const getHistory = executable('McpService', 'getToolCallHistory');
      const history = await getHistory({ tool_id: toolId, limit: 20 });
      dispatch({ type: 'SET_TOOL_CALLS', payload: history });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to load call history' });
    }
  };

  const addServer = async () => {
    if (!serverForm.name.trim() || !serverForm.endpoint.trim()) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const registerServer = executable('McpService', 'registerServer');
      const request: RegisterMcpServerRequest = {
        name: serverForm.name,
        description: serverForm.description,
        endpoint: serverForm.endpoint,
        connection_type: serverForm.type,
        metadata: {},
      };
      await registerServer(request);
      await loadServers();
      setActiveDialog(null);
      setServerForm({ name: '', description: '', endpoint: '', type: 'http' });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to add server' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const pingServer = async (serverId: string) => {
    try {
      const ping = executable('McpService', 'pingServer');
      const result = await ping(serverId);
      toast.success(`Server ${result.alive ? 'is alive' : 'is dead'}\nLatency: ${result.latency_ms}ms`);
      await loadServers();
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to ping server' });
    }
  };

  const deleteServer = async () => {
    if (!serverToDelete) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const del = executable('McpService', 'deleteServer');
      await del(serverToDelete.server_id);
      await loadServers();
      if (state.selectedServer?.server_id === serverToDelete.server_id) {
        dispatch({ type: 'SELECT_SERVER', payload: null });
      }
      setActiveDialog(null);
      setServerToDelete(null);
      toast.success('Server deleted successfully');
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to delete server' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const callTool = async () => {
    if (!state.selectedTool) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      let input: Record<string, any>;
      try {
        input = JSON.parse(toolInput);
      } catch {
        dispatch({ type: 'SET_ERROR', payload: 'Invalid JSON input' });
        return;
      }

      const call = executable('McpService', 'callTool');
      const request: CallMcpToolRequest = {
        tool_id: state.selectedTool.tool_id,
        input,
        caller_type: 'human',
        caller_id: 'will@enterprise.io',
        timeout_ms: 30000,
      };
      const result = await call(request);
      if (result.status === 'success') {
        toast.success(`Tool executed successfully!\n\nOutput:\n${JSON.stringify(result.output, null, 2)}`);
      } else {
        dispatch({ type: 'SET_ERROR', payload: `Tool execution failed: ${result.error_message}` });
      }

      await loadToolCalls(state.selectedTool.tool_id);
      setActiveDialog(null);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to call tool' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const getStatusColor = (status: McpServer['status']) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'disconnected': return 'bg-gray-400';
      case 'error': return 'bg-red-500';
      case 'initializing': return 'bg-orange-500';
      default: return 'bg-gray-400';
    }
  };

  const openDeleteDialog = (server: McpServer, e: React.MouseEvent) => {
    e.stopPropagation();
    setServerToDelete(server);
    setActiveDialog('delete-server');
  };

  return (
    <div className="container mx-auto p-10 max-w-[1400px]">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold flex gap-2 items-center">
            <Plug className="w-6 h-6" aria-hidden="true" /> MCP Tool Hub
          </h1>
          <p className="text-muted-foreground mt-1">Model Context Protocol - Universal Tool Integration</p>
        </div>
        {canWrite && (
          <Button onClick={() => setActiveDialog('add-server')} aria-label="Add new MCP server">
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            Add MCP Server
          </Button>
        )}
      </div>

      {state.error && (
        <Alert variant="destructive" className="mb-5" role="alert" aria-live="assertive">
          <AlertDescription className="flex justify-between items-center">
            <span><strong>Error:</strong> {state.error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
              aria-label="Dismiss error message"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-[350px_1fr] gap-8">
        <div>
          <Card className="shadow-none min-h-44">
            <CardHeader>
              <CardTitle>MCP Servers ({state.servers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {state.loading && state.servers.length === 0 ? (
                <Loader/>
              ) : state.servers.length === 0 ? (
                <p className="text-center text-muted-foreground">No servers registered</p>
              ) : (
                <div className="space-y-2" role="list" aria-label="MCP servers">
                  {state.servers.map(server => (
                    <div
                      key={server.server_id}
                      onClick={() => dispatch({ type: 'SELECT_SERVER', payload: server })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          dispatch({ type: 'SELECT_SERVER', payload: server });
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={state.selectedServer?.server_id === server.server_id}
                      aria-label={`${server.name}, status: ${server.status}, connection type: ${server.connection_type}`}
                      className={`p-3 rounded-md cursor-pointer border-l-4 ${
                        state.selectedServer?.server_id === server.server_id ? 'bg-blue-50' : 'bg-gray-50'
                      }`}
                      style={{ borderLeftColor: getStatusColor(server.status).replace('bg-', '#') }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-semibold mb-1">{server.name}</div>
                          <div className="text-xs text-muted-foreground">{server.description}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {server.connection_type} • {server.status}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {canWrite && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 w-7 p-0"
                                onClick={(e) => { e.stopPropagation(); pingServer(server.server_id); }}
                                aria-label={`Ping ${server.name} server`}
                              >
                                <Radio className="w-3 h-3" aria-hidden="true" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 w-7 p-0"
                                onClick={(e) => openDeleteDialog(server, e)}
                                aria-label={`Delete ${server.name} server`}
                              >
                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {state.selectedServer && (
            <Card className="mt-5 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Capabilities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2" role="list" aria-label="Server capabilities">
                  {Object.entries(state.selectedServer.capabilities).map(([key, value]) => (
                    <div key={key} className="flex justify-between py-1.5" role="listitem">
                      <span className="capitalize">{key}</span>
                      <span
                        className={value ? 'text-green-600' : 'text-gray-400'}
                        aria-label={value ? 'Enabled' : 'Disabled'}
                      >
                        {value ? <Check className="w-4 h-4" aria-hidden="true" /> : <X className="w-4 h-4" aria-hidden="true" />}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          {state.selectedServer ? (
            <>
              <Card className="shadow-none ">
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Tools ({state.tools.length})</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadTools(state.selectedServer!.server_id)}
                      disabled={state.loading}
                      aria-label="Refresh tools list"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {state.tools.length === 0 ? (
                    <p className="text-center text-muted-foreground py-5">
                      No tools discovered for this server
                    </p>
                  ) : (
                    <div className="space-y-3" role="list" aria-label="Available tools">
                      {state.tools.map(tool => (
                        <div
                          key={tool.tool_id}
                          onClick={() => {
                            dispatch({ type: 'SELECT_TOOL', payload: tool });
                            loadToolCalls(tool.tool_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              dispatch({ type: 'SELECT_TOOL', payload: tool });
                              loadToolCalls(tool.tool_id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={state.selectedTool?.tool_id === tool.tool_id}
                          aria-label={`${tool.name}, ${tool.description}`}
                          className={`p-4 rounded-lg cursor-pointer border ${
                            state.selectedTool?.tool_id === tool.tool_id ? 'bg-green-50' : 'bg-gray-50'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-semibold text-base mb-1.5">{tool.name}</div>
                              <div className="text-sm text-muted-foreground mb-2">{tool.description}</div>
                              <div className="flex gap-1 flex-wrap" role="list" aria-label="Tool tags">
                                {tool.category && (
                                  <Badge variant="secondary" className="text-xs">{tool.category}</Badge>
                                )}
                                {tool.tags?.map(tag => (
                                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                                ))}
                              </div>
                            </div>
                            {canWrite && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dispatch({ type: 'SELECT_TOOL', payload: tool });
                                  setActiveDialog('call-tool');
                                }}
                                aria-label={`Call ${tool.name} tool`}
                              >
                                <Play className="w-3 h-3 mr-1" aria-hidden="true" />
                                Call
                              </Button>
                            )}
                          </div>

                          {tool.usage_count !== undefined && (
                            <div className="mt-2.5 text-xs text-muted-foreground" aria-label={`Tool statistics: ${tool.usage_count} calls, ${tool.avg_duration_ms || 0} milliseconds average, ${tool.success_rate?.toFixed(1) || 0} percent success rate`}>
                              Calls: {tool.usage_count} •
                              Avg: {tool.avg_duration_ms || 0}ms •
                              Success: {tool.success_rate?.toFixed(1) || 0}%
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {state.selectedTool && state.toolCalls.length > 0 && (
                <Card className="mt-5 shadow-none">
                  <CardHeader>
                    <CardTitle>Recent Calls</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2" role="list" aria-label="Recent tool calls">
                      {state.toolCalls.slice(0, 5).map(call => (
                        <div
                          key={call.call_id}
                          role="listitem"
                          aria-label={`${call.status} call by ${call.caller_type}, duration ${call.duration_ms} milliseconds, ${new Date(call.created_at).toLocaleString()}`}
                          className={`p-2.5 rounded-md text-xs ${
                            call.status === 'success' ? 'bg-green-50' : 'bg-red-50'
                          }`}
                        >
                          <div className="font-semibold mb-1 flex items-center gap-1">
                            {call.status === 'success' ?
                              <Check className="w-3 h-3" aria-hidden="true" /> :
                              <AlertCircle className="w-3 h-3" aria-hidden="true" />
                            }
                            {call.caller_type} • {call.duration_ms}ms
                          </div>
                          <div className="text-muted-foreground">
                            {new Date(call.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="text-center py-16 shadow-none">
              <CardContent>
                <CardTitle className="text-muted-foreground">Select a server to view tools</CardTitle>
                <CardDescription className="mt-2">
                  MCP servers provide tools that can be called by humans or AI agents
                </CardDescription>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Add Server Dialog */}
      <Dialog open={activeDialog === 'add-server'} onOpenChange={(open) => !open && setActiveDialog(null)}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className='space-y-2'>
              <Label htmlFor="server-name">Server Name *</Label>
              <Input
                id="server-name"
                value={serverForm.name}
                onChange={(e) => setServerForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., HubSpot MCP Server"
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor="server-description">Description</Label>
              <Textarea
                id="server-description"
                value={serverForm.description}
                onChange={(e) => setServerForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What does this server provide?"
                rows={3}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor="server-endpoint">Endpoint *</Label>
              <Input
                id="server-endpoint"
                value={serverForm.endpoint}
                onChange={(e) => setServerForm(prev => ({ ...prev, endpoint: e.target.value }))}
                placeholder="http://localhost:8080/mcp or npx @modelcontextprotocol/server-name"
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor="server-type">Connection Type</Label>
              <Select
                value={serverForm.type}
                onValueChange={(value: any) => setServerForm(prev => ({ ...prev, type: value }))}
              >
                <SelectTrigger id="server-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="stdio">STDIO</SelectItem>
                  <SelectItem value="websocket">WebSocket</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setActiveDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={addServer}
              disabled={state.loading || !serverForm.name.trim() || !serverForm.endpoint.trim()}
            >
              {state.loading ? 'Adding...' : 'Add Server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Call Tool Dialog */}
      <Dialog open={activeDialog === 'call-tool'} onOpenChange={(open) => !open && setActiveDialog(null)}>
        <DialogContent className="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Call Tool: {state.selectedTool?.name}</DialogTitle>
            <DialogDescription>{state.selectedTool?.description}</DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Label htmlFor="tool-input">Input (JSON)</Label>
            <Textarea
              id="tool-input"
              value={toolInput}
              onChange={(e) => setToolInput(e.target.value)}
              placeholder={JSON.stringify(state.selectedTool?.input_schema, null, 2)}
              rows={12}
              className="font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setActiveDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={callTool}
              disabled={state.loading}
              className="bg-green-600 hover:bg-green-700"
            >
              {state.loading ? 'Calling...' : (
                <>
                  <Play className="w-3 h-3 mr-2" aria-hidden="true" />
                  Execute
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Server Dialog */}
      <Dialog open={activeDialog === 'delete-server'} onOpenChange={(open) => !open && setActiveDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{serverToDelete?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setActiveDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteServer}
              disabled={state.loading}
            >
              {state.loading ? 'Deleting...' : 'Delete Server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
