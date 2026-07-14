import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Globe,
  Loader2,
  RefreshCw,
  Plus,
  Send,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  Database,
  ArrowRight,
  Wand2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Copy,
  RotateCcw,
  ArrowLeft,
  Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/api/client';

const TOOLS_API_URL = import.meta.env.VITE_TOOLS_API_URL;

interface BuilderModel {
  id: string;
  name: string;
  kind: string;
  fields: { name: string; type: string; required: boolean }[];
  entry_count: number;
}

interface BuilderEntry {
  id: string;
  name: string;
  published: string;
  created_at: string;
  updated_at: string;
  data: Record<string, unknown>;
}

interface ModelSchema {
  name: string;
  type: string;
  required: boolean;
  subFields: { name: string; type: string }[];
}

async function builderAction(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await apiClient.post(`${TOOLS_API_URL}/builder`, { action, ...payload });
  return res.data as Record<string, unknown>;
}

async function publisherAction(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await apiClient.post(`${TOOLS_API_URL}/content-publisher`, { action, ...payload });
  return res.data as Record<string, unknown>;
}

type CreatePhase = 'input' | 'detecting' | 'transforming' | 'preview' | 'publishing' | 'done';

export default function BuilderTools() {
  const [activeTab, setActiveTab] = useState('models');
  const [selectedModel, setSelectedModel] = useState('');

  const navigateToEntries = useCallback((modelName: string) => {
    setSelectedModel(modelName);
    setActiveTab('entries');
  }, []);

  const navigateToCreate = useCallback((modelName: string) => {
    setSelectedModel(modelName);
    setActiveTab('create');
  }, []);

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-600" />
            <CardTitle>Builder.io Content Tools</CardTitle>
          </div>
          <CardDescription>
            Push content to your website data models — list models, manage entries, AI-powered publishing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="models" className="gap-1.5 text-xs sm:text-sm">
                <Database className="w-4 h-4" /> Models
              </TabsTrigger>
              <TabsTrigger value="entries" className="gap-1.5 text-xs sm:text-sm">
                <FileText className="w-4 h-4" /> Entries
              </TabsTrigger>
              <TabsTrigger value="create" className="gap-1.5 text-xs sm:text-sm">
                <Wand2 className="w-4 h-4" /> Publish
              </TabsTrigger>
            </TabsList>
            <ModelsTab onViewEntries={navigateToEntries} onCreateEntry={navigateToCreate} />
            <EntriesTab selectedModel={selectedModel} onModelChange={setSelectedModel} />
            <CreateTab selectedModel={selectedModel} onModelChange={setSelectedModel} />
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}


interface ModelsTabProps {
  onViewEntries: (modelName: string) => void;
  onCreateEntry: (modelName: string) => void;
}

function ModelsTab({ onViewEntries, onCreateEntry }: ModelsTabProps) {
  const [models, setModels] = useState<BuilderModel[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const data = await builderAction('list_models');
      setModels((data.models as BuilderModel[]) ?? []);
      toast.success(`Loaded ${(data.count as number) ?? 0} models`);
    } catch {
      toast.error('Failed to load models — check API key in Secrets Manager');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TabsContent value="models" className="space-y-4 mt-4">
      <Button variant="outline" size="sm" onClick={fetchModels} disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
        Load Models
      </Button>

      {models.length > 0 && (
        <div className="space-y-2">
          {models.map(m => (
            <Card key={m.id} className="shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-500" />
                    <span className="font-medium">{m.name}</span>
                    <Badge variant="secondary" className="text-xs">{m.kind}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => onViewEntries(m.name)}>
                      <FileText className="w-3.5 h-3.5" /> Entries <ArrowRight className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => onCreateEntry(m.name)}>
                      <Plus className="w-3.5 h-3.5" /> New
                    </Button>
                  </div>
                </div>
                {m.fields.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.fields.map(f => (
                      <Badge key={f.name} variant="outline" className="text-xs">
                        {f.name}
                        <span className="text-muted-foreground ml-1">({f.type})</span>
                        {f.required && <span className="text-red-400 ml-0.5">*</span>}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && models.length === 0 && (
        <p className="text-sm text-muted-foreground">Click "Load Models" to fetch your Builder.io data models.</p>
      )}
    </TabsContent>
  );
}


interface EntriesTabProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
}

function EntriesTab({ selectedModel, onModelChange }: EntriesTabProps) {
  const [modelName, setModelName] = useState(selectedModel);
  const [entries, setEntries] = useState<BuilderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const lastAutoLoaded = useRef('');

  const fetchEntries = useCallback(async (model?: string) => {
    const target = model ?? modelName;
    if (!target.trim()) { toast.error('Enter a model name'); return; }
    setLoading(true);
    try {
      const data = await builderAction('list_entries', { model: target });
      if (data.error) { toast.error(data.error as string); }
      else {
        setEntries((data.entries as BuilderEntry[]) ?? []);
        toast.success(`${(data.count as number) ?? 0} entries in ${target}`);
      }
    } catch { toast.error('Failed to load entries'); }
    finally { setLoading(false); }
  }, [modelName]);

  useEffect(() => {
    if (selectedModel && selectedModel !== lastAutoLoaded.current) {
      setModelName(selectedModel);
      lastAutoLoaded.current = selectedModel;
      fetchEntries(selectedModel);
    }
  }, [selectedModel, fetchEntries]);

  const handleModelInput = (value: string) => { setModelName(value); onModelChange(value); };

  const publishEntry = async (entryId: string) => {
    try {
      const data = await builderAction('publish_entry', { model: modelName, entry_id: entryId });
      if (data.published) { toast.success('Published'); fetchEntries(); }
      else { toast.error((data.error as string) ?? 'Publish failed'); }
    } catch { toast.error('Publish failed'); }
  };

  const unpublishEntry = async (entryId: string) => {
    try {
      const data = await builderAction('unpublish_entry', { model: modelName, entry_id: entryId });
      if (data.unpublished) { toast.success('Reverted to draft'); fetchEntries(); }
      else { toast.error((data.error as string) ?? 'Unpublish failed'); }
    } catch { toast.error('Unpublish failed'); }
  };

  const deleteEntry = async (entryId: string, entryName: string) => {
    if (!confirm(`Delete "${entryName || entryId}"? This cannot be undone.`)) return;
    try {
      const data = await builderAction('delete_entry', { model: modelName, entry_id: entryId });
      if (data.deleted) { toast.success('Deleted'); setEntries(prev => prev.filter(e => e.id !== entryId)); }
      else { toast.error((data.error as string) ?? 'Delete failed'); }
    } catch { toast.error('Delete failed'); }
  };

  return (
    <TabsContent value="entries" className="space-y-4 mt-4">
      <div className="flex gap-2">
        <Input
          value={modelName}
          onChange={e => handleModelInput(e.target.value)}
          placeholder="Model name (e.g. blog-post, job-posting)"
          className="flex-1"
          onKeyDown={e => e.key === 'Enter' && fetchEntries()}
        />
        <Button variant="outline" size="sm" onClick={() => fetchEntries()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      {entries.length > 0 && (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {entries.map(e => (
            <div key={e.id} className="border rounded p-3 text-sm hover:bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">{e.name || e.id}</span>
                  <Badge variant={e.published === 'published' ? 'default' : 'secondary'} className="text-xs">
                    {e.published === 'published' ? 'live' : 'draft'}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                  {e.published === 'published' ? (
                    <Button variant="ghost" size="sm" onClick={() => unpublishEntry(e.id)}>
                      <EyeOff className="w-3.5 h-3.5 text-yellow-500" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => publishEntry(e.id)}>
                      <Send className="w-3.5 h-3.5 text-green-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-600" onClick={() => deleteEntry(e.id, e.name)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {e.updated_at && (
                <div className="text-xs text-muted-foreground mt-1">Updated: {new Date(e.updated_at).toLocaleDateString()}</div>
              )}
              {expandedId === e.id && (
                <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-x-auto max-h-48">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && modelName && (
        <p className="text-sm text-muted-foreground">No entries loaded. Click refresh to fetch entries for "{modelName}".</p>
      )}
    </TabsContent>
  );
}


interface CreateTabProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
}

function CreateTab({ selectedModel, onModelChange }: CreateTabProps) {
  const [phase, setPhase] = useState<CreatePhase>('input');
  const [rawContent, setRawContent] = useState('');
  const [entryName, setEntryName] = useState('');
  const [modelOverride, setModelOverride] = useState(selectedModel);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [detectedModel, setDetectedModel] = useState('');
  const [schema, setSchema] = useState<ModelSchema[]>([]);
  const [transformedData, setTransformedData] = useState<Record<string, unknown>>({});
  const [editableJson, setEditableJson] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [publishedEntryId, setPublishedEntryId] = useState('');
  const [publishedLive, setPublishedLive] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);

  useEffect(() => {
    if (selectedModel && selectedModel !== modelOverride) {
      setModelOverride(selectedModel);
    }
  }, [selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadModels = async () => {
    try {
      const data = await publisherAction('list_models');
      setAvailableModels((data.models as string[]) ?? []);
    } catch { /* silent — models are optional */ }
  };

  useEffect(() => { loadModels(); }, []);

  const handleDetectAndTransform = async () => {
    if (!rawContent.trim()) { toast.error('Paste some content first'); return; }

    setPhase('detecting');
    try {
      const detectResult = await publisherAction('detect', { content: rawContent });
      const detected = (detectResult.detected_model as string) ?? '';
      const targetModel = modelOverride.trim() || detected;
      setDetectedModel(detected);

      if (!modelOverride.trim()) {
        setModelOverride(targetModel);
        onModelChange(targetModel);
      }

      setPhase('transforming');
      const transformResult = await publisherAction('transform', {
        content: rawContent,
        model: targetModel,
        name: entryName.trim() || undefined,
      });

      const data = (transformResult.data as Record<string, unknown>) ?? {};
      const resultSchema = (transformResult.schema as ModelSchema[]) ?? [];
      const resultName = (transformResult.name as string) ?? entryName;

      setTransformedData(data);
      setEditableJson(JSON.stringify(data, null, 2));
      setSchema(resultSchema);
      if (!entryName.trim()) setEntryName(resultName);
      setPhase('preview');
      toast.success(`Transformed for ${targetModel}`);
    } catch {
      toast.error('Transform failed — check content and try again');
      setPhase('input');
    }
  };

  const handlePublish = async (goLive: boolean) => {
    let dataToPublish = transformedData;

    if (isEditing) {
      try {
        dataToPublish = JSON.parse(editableJson);
        setTransformedData(dataToPublish);
        setIsEditing(false);
      } catch {
        toast.error('Invalid JSON — fix before publishing');
        return;
      }
    }

    setPhase('publishing');
    setPublishError('');
    try {
      const publishPayload: Record<string, unknown> = {
        model: modelOverride,
        name: entryName,
        data: dataToPublish,
        publish: goLive,
      };
      if (publishedEntryId) {
        publishPayload.entry_id = publishedEntryId;
      }
      const result = await publisherAction('publish', publishPayload);

      if (result.published) {
        setPublishedEntryId((result.entry_id as string) ?? '');
        setPublishedLive(goLive);
        setPhase('done');
        toast.success(goLive ? 'Published live' : 'Saved as draft');
      } else {
        setPublishError((result.error as string) ?? 'Publish failed');
        setPhase('preview');
        toast.error((result.error as string) ?? 'Publish failed');
      }
    } catch {
      setPublishError('Network error — try again');
      setPhase('preview');
      toast.error('Publish failed');
    }
  };

  const handlePullBack = async () => {
    if (!publishedEntryId) return;
    try {
      const data = await builderAction('unpublish_entry', {
        model: modelOverride,
        entry_id: publishedEntryId,
      });
      if (data.unpublished) {
        setPublishedLive(false);
        toast.success('Pulled back to draft');
      } else {
        toast.error((data.error as string) ?? 'Pull back failed');
      }
    } catch {
      toast.error('Pull back failed');
    }
  };

  const handleReset = () => {
    setPhase('input');
    setRawContent('');
    setEntryName('');
    setModelOverride('');
    setDetectedModel('');
    setSchema([]);
    setTransformedData({});
    setEditableJson('');
    setIsEditing(false);
    setPublishedEntryId('');
    setPublishedLive(false);
    setPublishError('');
    onModelChange('');
  };

  const handleBackToEdit = () => {
    setPhase('preview');
    setPublishedEntryId('');
    setPublishedLive(false);
  };

  return (
    <TabsContent value="create" className="space-y-4 mt-4">
      {/* Phase indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(['input', 'detecting', 'preview', 'publishing', 'done'] as const).map((p, i) => {
          const labels = { input: 'Paste', detecting: 'AI Detect', preview: 'Preview', publishing: 'Publish', done: 'Done' };
          const isActive = phase === p || (phase === 'transforming' && p === 'detecting');
          const isPast = ['input', 'detecting', 'transforming', 'preview', 'publishing', 'done'].indexOf(phase) >
            ['input', 'detecting', 'transforming', 'preview', 'publishing', 'done'].indexOf(p);
          return (
            <div key={p} className="flex items-center gap-1">
              {i > 0 && <ArrowRight className="w-3 h-3 text-slate-300" />}
              <span className={`px-2 py-0.5 rounded-full ${
                isPast ? 'bg-green-100 text-green-700' :
                isActive ? 'bg-indigo-100 text-indigo-700 font-semibold' :
                'bg-slate-100 text-slate-400'
              }`}>
                {labels[p]}
              </span>
            </div>
          );
        })}
      </div>

      {/* INPUT PHASE */}
      {phase === 'input' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Raw Content</Label>
            <Textarea
              value={rawContent}
              onChange={e => setRawContent(e.target.value)}
              rows={10}
              placeholder="Paste a job description, customer story, event details, blog draft, or any content you want to publish to Builder.io..."
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The AI agent will detect the best model and transform your content into the right schema.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Entry Name (optional)</Label>
              <Input
                value={entryName}
                onChange={e => setEntryName(e.target.value)}
                placeholder="Auto-generated if blank"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Model Override (optional)</Label>
              <div className="relative">
                <Input
                  value={modelOverride}
                  onChange={e => { setModelOverride(e.target.value); onModelChange(e.target.value); }}
                  placeholder="Auto-detect from content"
                  onFocus={() => setShowModelPicker(true)}
                  onBlur={() => setTimeout(() => setShowModelPicker(false), 200)}
                />
                {showModelPicker && availableModels.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {availableModels.map(m => (
                      <button
                        key={m}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors"
                        onMouseDown={() => { setModelOverride(m); onModelChange(m); setShowModelPicker(false); }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={handleDetectAndTransform}
            disabled={!rawContent.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Detect Model & Transform
          </Button>
        </div>
      )}

      {/* DETECTING / TRANSFORMING PHASE */}
      {(phase === 'detecting' || phase === 'transforming') && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">
            {phase === 'detecting' ? 'AI is detecting the best model...' : 'Transforming content into model schema...'}
          </p>
        </div>
      )}

      {/* PREVIEW PHASE */}
      {phase === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm font-semibold">Transformed Preview</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPhase('input')}>
              <ArrowLeft className="w-3 h-3 mr-1" /> Back
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target Model</Label>
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-100 text-indigo-700">{modelOverride}</Badge>
                {detectedModel && detectedModel !== modelOverride && (
                  <span className="text-xs text-muted-foreground">(detected: {detectedModel})</span>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Entry Name</Label>
              <Input
                value={entryName}
                onChange={e => setEntryName(e.target.value)}
                className="text-sm h-8"
              />
            </div>
          </div>

          {schema.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {schema.map(f => (
                <Badge key={f.name} variant="outline" className="text-xs">
                  {f.name} <span className="text-muted-foreground ml-1">({f.type})</span>
                  {f.required && <span className="text-red-400 ml-0.5">*</span>}
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Data</Label>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(isEditing ? editableJson : JSON.stringify(transformedData, null, 2));
                    toast.success('Copied');
                  }}
                >
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (isEditing) {
                      try {
                        const parsed = JSON.parse(editableJson);
                        setTransformedData(parsed);
                        setIsEditing(false);
                        toast.success('Changes saved');
                      } catch { toast.error('Invalid JSON'); }
                    } else {
                      setEditableJson(JSON.stringify(transformedData, null, 2));
                      setIsEditing(true);
                    }
                  }}
                >
                  <Pencil className="w-3 h-3 mr-1" /> {isEditing ? 'Save' : 'Edit'}
                </Button>
              </div>
            </div>
            {isEditing ? (
              <Textarea
                value={editableJson}
                onChange={e => setEditableJson(e.target.value)}
                rows={14}
                className="font-mono text-xs"
              />
            ) : (
              <pre className="p-3 bg-slate-50 rounded-lg border text-xs whitespace-pre-wrap wrap-break-word max-h-72 overflow-y-auto">
                {JSON.stringify(transformedData, null, 2)}
              </pre>
            )}
          </div>

          {publishError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-2 rounded">
              <AlertCircle className="w-4 h-4" /> {publishError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => handlePublish(false)}
              variant="outline"
              className="gap-2"
            >
              <FileText className="w-4 h-4" /> Save as Draft
            </Button>
            <Button
              onClick={() => handlePublish(true)}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              <Send className="w-4 h-4" /> Publish Live
            </Button>
          </div>
        </div>
      )}

      {/* PUBLISHING PHASE */}
      {phase === 'publishing' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-green-500" />
          <p className="text-sm text-muted-foreground">Publishing to Builder.io...</p>
        </div>
      )}

      {/* DONE PHASE */}
      {phase === 'done' && (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-8 gap-3 max-w-full">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <p className="text-lg font-semibold">
              {publishedLive ? 'Published Live' : 'Saved as Draft'}
            </p>
            <Badge className="bg-indigo-100 text-indigo-700 shrink-0">{modelOverride}</Badge>
            <p className="text-sm text-center text-muted-foreground wrap-break-word max-w-full px-4">
              {entryName}
            </p>
            {publishedEntryId && (
              <p className="text-xs text-muted-foreground break-all">Entry ID: {publishedEntryId}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Entry Name (edit before republishing)</Label>
            <Input
              value={entryName}
              onChange={e => setEntryName(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            {publishedLive && (
              <Button variant="outline" onClick={handlePullBack} className="flex-1 min-w-[140px] gap-2 text-yellow-600 border-yellow-300 hover:bg-yellow-50">
                <EyeOff className="w-4 h-4" /> Pull Back
              </Button>
            )}
            <Button variant="outline" onClick={handleBackToEdit} className="flex-1 min-w-[140px] gap-2">
              <Pencil className="w-4 h-4" /> Edit & Republish
            </Button>
            <Button onClick={handleReset} className="flex-1 min-w-[140px] gap-2 bg-indigo-600 hover:bg-indigo-700">
              <RotateCcw className="w-4 h-4" /> New Content
            </Button>
          </div>
        </div>
      )}
    </TabsContent>
  );
}
