import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  Database,
  Tag,
  Workflow,
  BookOpen,
  Shield,
  Cpu,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  Users,
  Zap,
  Server,
  Globe,
} from 'lucide-react';

const AGENTS = [
  { id: 'content-config-agent', phase: 0, name: 'Configuration & Setup', purpose: 'Initialize brand parameters, team permissions, and platform targets', kbAccess: '—', outputs: 'org_config, permissions, calendar', status: 'planned' as const },
  { id: 'strategic-context-agent', phase: 1, name: 'Strategic Context', purpose: 'Convert organizational goals and ICPs into thematic content tracks', kbAccess: 'brand_voice, icp, okr', outputs: 'themes, audience_matrix, calendar_blocks', status: 'active' as const },
  { id: 'scheduler-agent', phase: 2, name: 'Scheduler', purpose: 'Generate sequenced editorial calendar linked to strategic intent', kbAccess: 'performance, platform', outputs: 'editorial_calendar, post_metadata', status: 'active' as const },
  { id: 'content-generator-agent', phase: 3, name: 'Content Generator', purpose: 'Create first-pass drafts aligned with tone, theme, and platform norms', kbAccess: 'brand_voice, platform', outputs: 'post_drafts, review_flags', status: 'active' as const },
  { id: 'media-agent', phase: 3.5, name: 'Media Association', purpose: 'Suggest or generate brand-aligned visuals for posts', kbAccess: '—', outputs: 'asset_link', status: 'planned' as const },
  { id: 'review-agent', phase: 4, name: 'Review & Approval', purpose: 'Provide advisory flags and quality insights to human reviewers', kbAccess: 'brand_voice, editorial', outputs: 'approval_status, final_post', status: 'active' as const },
  { id: 'publishing-agent', phase: 5, name: 'Publisher', purpose: 'Route approved posts to platform schedulers or publishing queue', kbAccess: 'platform', outputs: 'publish_log', status: 'planned' as const },
  { id: 'feedback-agent', phase: 6, name: 'Performance Feedback', purpose: 'Assess engagement and feed insights back into scheduling and generation', kbAccess: 'performance (r/w)', outputs: 'theme_insights, format_insights', status: 'v2' as const },
];

const KB_DOMAINS = [
  { domain: 'Brand Voice & Tone', source: 'S3 (curated docs)', indexType: 'Vector (Titan Embeddings)', refresh: 'On update' },
  { domain: 'ICP & Personas', source: 'S3 (persona guides)', indexType: 'Vector + structured', refresh: 'Monthly' },
  { domain: 'OKRs & Campaign Goals', source: 'S3 / Google Drive sync', indexType: 'Vector', refresh: 'Quarterly' },
  { domain: 'Past Post Performance', source: 'DynamoDB (metrics)', indexType: 'Structured query', refresh: 'Real-time (v2)' },
  { domain: 'Platform Guidelines', source: 'S3 (format specs)', indexType: 'Vector', refresh: 'On update' },
  { domain: 'Editorial History', source: 'DynamoDB (post archive)', indexType: 'Structured + vector', refresh: 'Continuous' },
  { domain: 'Customer STAR Library', source: 'DynamoDB (KB table)', indexType: 'Structured', refresh: 'On entry' },
  { domain: 'Community Blocks', source: 'DynamoDB (KB table)', indexType: 'Structured', refresh: 'On entry' },
  { domain: 'AWS Accreditations', source: 'DynamoDB (KB table)', indexType: 'Structured', refresh: 'On entry' },
];

const AWS_SERVICES = [
  { service: 'Bedrock AgentCore', role: 'Agent runtime, tool-use orchestration, guardrails' },
  { service: 'Bedrock Knowledge Bases', role: 'Vector-indexed RAG for brand voice, personas, guidelines' },
  { service: 'DynamoDB', role: 'All state, drafts, calendar, approvals, performance metrics' },
  { service: 'S3', role: 'KB source documents, media assets, prompt templates' },
  { service: 'Step Functions', role: 'Pipeline orchestration and retry/loop logic' },
  { service: 'EventBridge', role: 'Event routing, schedule triggers, manual overrides' },
  { service: 'EventBridge Scheduler', role: 'Time-delayed post publishing' },
  { service: 'Lambda', role: 'KB sync, API handlers, analytics ingestion' },
  { service: 'API Gateway', role: 'Dashboard API, override endpoints' },
  { service: 'CloudFront', role: 'Dashboard hosting' },
  { service: 'CloudWatch', role: 'Observability, agent execution logs, cost monitoring' },
];

const AIDLC_TAGS = [
  { key: 'engagement', example: 'enterprise-content-system', description: 'Which engagement/project' },
  { key: 'cost-center', example: 'internal-ops', description: 'Cost attribution center' },
  { key: 'env', example: 'prod / staging', description: 'Deployment environment' },
  { key: 'managed-by', example: 'iac-cdk', description: 'Infrastructure management tool' },
  { key: 'agent-phase', example: 'phase-3-generator', description: 'Which pipeline phase owns this resource' },
  { key: 'enterprise:customer', example: 'enterprise-internal', description: 'Customer identifier' },
  { key: 'enterprise:solution', example: 'content-agent', description: 'enterprise solution name' },
  { key: 'enterprise:workload', example: 'content-pipeline', description: 'Workload/service name' },
];

function StatusBadge({ status }: { status: 'active' | 'planned' | 'v2' }) {
  const styles = {
    active: 'bg-green-50 text-green-700 border-green-200',
    planned: 'bg-amber-50 text-amber-700 border-amber-200',
    v2: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return <Badge variant="outline" className={`text-xs ${styles[status]}`}>{status}</Badge>;
}

export default function ContentArchitecturePage() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Brain className="w-9 h-9 text-purple-600" />
          <h1 className="text-4xl font-bold">Content Agent Architecture</h1>
        </div>
        <p className="text-lg text-muted-foreground">
          enterprise Strategic Content Agent System — AWS Bedrock AgentCore | v1.0
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview" className="gap-1"><Eye className="w-4 h-4" /> Overview</TabsTrigger>
          <TabsTrigger value="agents" className="gap-1"><Cpu className="w-4 h-4" /> Agents</TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-1"><BookOpen className="w-4 h-4" /> Knowledge Bases</TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1"><Workflow className="w-4 h-4" /> Pipeline</TabsTrigger>
          <TabsTrigger value="infra" className="gap-1"><Server className="w-4 h-4" /> Infrastructure</TabsTrigger>
          <TabsTrigger value="tagging" className="gap-1"><Tag className="w-4 h-4" /> AIDLC Tagging</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsTab />
        </TabsContent>
        <TabsContent value="knowledge">
          <KnowledgeTab />
        </TabsContent>
        <TabsContent value="pipeline">
          <PipelineTab />
        </TabsContent>
        <TabsContent value="infra">
          <InfraTab />
        </TabsContent>
        <TabsContent value="tagging">
          <TaggingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>System Overview</CardTitle>
          <CardDescription>
            Event-driven agentic pipeline for strategic content planning, generation, and publishing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed">
            This system strategically plans, generates, and publishes content across platforms using an
            event-driven agentic pipeline built on AWS Bedrock AgentCore. Each phase is orchestrated through
            Step Functions, with all agent state, drafts, and metadata persisted in DynamoDB and exposed
            through a lightweight API for editorial control.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border bg-purple-50/50 border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-5 h-5 text-purple-600" />
                <span className="font-semibold text-sm">Core Principles</span>
              </div>
              <ul className="text-xs space-y-1.5 text-muted-foreground">
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                  All agent orchestration runs through Bedrock AgentCore with defined tool-use schemas
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                  Centralized KB Registry governs all RAG context
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                  State transitions are event-driven via EventBridge + Step Functions
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                  Every resource tagged per AIDLC standards for cost attribution
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                  No opaque automation — all outputs queryable and editable via API/dashboard
                </li>
              </ul>
            </div>

            <div className="p-4 rounded-lg border bg-blue-50/50 border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-sm">Current Status</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>Agents defined</span>
                  <span className="font-mono font-semibold">8</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Active (built)</span>
                  <span className="font-mono font-semibold text-green-600">4</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Planned</span>
                  <span className="font-mono font-semibold text-amber-600">3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>v2 Roadmap</span>
                  <span className="font-mono font-semibold text-blue-600">1</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Knowledge Base domains</span>
                  <span className="font-mono font-semibold">9</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Pipeline phases</span>
                  <span className="font-mono font-semibold">7 (0–6)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>AWS services</span>
                  <span className="font-mono font-semibold">11</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-slate-50">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-5 h-5 text-slate-600" />
              <span className="font-semibold text-sm">System Boundaries</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
              <span className="px-2 py-1 bg-white rounded border">Dashboard (React SPA)</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="px-2 py-1 bg-white rounded border">API Gateway + Lambda</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="px-2 py-1 bg-white rounded border">Bedrock AgentCore</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="px-2 py-1 bg-white rounded border">DynamoDB + S3</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono mt-2 flex-wrap">
              <span className="px-2 py-1 bg-white rounded border">EventBridge</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="px-2 py-1 bg-white rounded border">Step Functions</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="px-2 py-1 bg-white rounded border">Agent Phases 0–6</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="px-2 py-1 bg-white rounded border">Platform APIs</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentsTab() {
  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Agent Registry</CardTitle>
          <CardDescription>
            8 agents across 7 pipeline phases — all running on Bedrock AgentCore with defined tool-use schemas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {AGENTS.map((agent) => (
              <div key={agent.id} className="p-4 rounded-lg border bg-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-700">
                      {agent.phase}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{agent.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{agent.id}</div>
                    </div>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>
                <p className="text-xs text-muted-foreground mb-2">{agent.purpose}</p>
                <div className="flex gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">KB Access: </span>
                    <span className="font-mono">{agent.kbAccess}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Outputs: </span>
                    <span className="font-mono">{agent.outputs}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Human-in-the-Loop</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
              <span>Phase 4 Review Agent is advisory only — humans make all approval decisions via dashboard/API</span>
            </div>
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
              <span>"Needs Work" status loops back to Phase 3 Generator with reviewer comments as context (max 2 revisions)</span>
            </div>
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
              <span>Manual override path via EventBridge accepts ad hoc priority events (PR news, launches)</span>
            </div>
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
              <span>Phase 3.5 Media is manual in v1 — human selects/uploads media. Automated in v2.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KnowledgeTab() {
  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Knowledge Base Registry & Catalog</CardTitle>
          <CardDescription>
            Centralized data layer that all agents query — combination of Bedrock Knowledge Bases (vector RAG) and DynamoDB catalog
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-semibold text-xs">Domain</th>
                  <th className="text-left py-2 px-3 font-semibold text-xs">Source</th>
                  <th className="text-left py-2 px-3 font-semibold text-xs">Index Type</th>
                  <th className="text-left py-2 px-3 font-semibold text-xs">Refresh</th>
                </tr>
              </thead>
              <tbody>
                {KB_DOMAINS.map((kb) => (
                  <tr key={kb.domain} className="border-b last:border-0">
                    <td className="py-2 px-3 font-medium text-xs">{kb.domain}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground font-mono">{kb.source}</td>
                    <td className="py-2 px-3 text-xs"><Badge variant="secondary" className="text-xs">{kb.indexType}</Badge></td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{kb.refresh}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Catalog Schema</CardTitle>
          <CardDescription>DynamoDB catalog entry for each Knowledge Base</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-slate-900 rounded-lg text-green-400 font-mono text-xs leading-relaxed">
            <pre>{`{
  "kb_id": "kb-brand-voice-001",
  "domain": "brand_voice",
  "source_arn": "arn:aws:bedrock:us-east-1:...:knowledge-base/...",
  "version": "1.2.0",
  "last_synced": "2026-03-05T14:30:00Z",
  "access_policy": ["strategic-context-agent", "content-generator-agent", "review-agent"],
  "tags": {
    "engagement": "enterprise-content-system",
    "cost-center": "internal-ops",
    "env": "prod"
  }
}`}</pre>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Sync & Ingestion</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Database className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <span>S3 sources ingested into Bedrock Knowledge Bases via scheduled Lambda functions</span>
            </div>
            <div className="flex items-start gap-2">
              <Database className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <span>DynamoDB sources queried directly by agents via tool-use (no vector indexing needed)</span>
            </div>
            <div className="flex items-start gap-2">
              <Database className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <span>All sync events emit to EventBridge for observability and stale-KB alerting</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PipelineTab() {
  const phases = [
    { phase: 0, name: 'Configuration', color: 'bg-slate-500', description: 'Brand setup, team permissions, platform targets, calendar context' },
    { phase: 1, name: 'Strategic Context', color: 'bg-purple-500', description: 'OKRs + ICPs → thematic content tracks, audience matrix, calendar blocks' },
    { phase: 2, name: 'Scheduling', color: 'bg-blue-500', description: 'Sequenced editorial calendar with platform cadence and override support' },
    { phase: 3, name: 'Content Generation', color: 'bg-green-500', description: 'First-pass drafts with tone/theme/platform alignment, review flags' },
    { phase: 3.5, name: 'Media Association', color: 'bg-teal-500', description: 'Image suggestions (v1 manual) or brand-aligned generation (v2)' },
    { phase: 4, name: 'Review & Approval', color: 'bg-amber-500', description: 'Advisory agent + human review. Approve / Needs Work / Delay' },
    { phase: 5, name: 'Publishing', color: 'bg-red-500', description: 'Route to platform APIs, EventBridge Scheduler, or publishing queue' },
    { phase: 6, name: 'Performance Feedback', color: 'bg-indigo-500', description: 'Engagement analysis → insights fed back to Phases 2 & 3 (v2)' },
  ];

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Pipeline Phases</CardTitle>
          <CardDescription>
            Step Functions state machine orchestrating 8 phases with EventBridge triggers and human-in-the-loop review
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {phases.map((p, idx) => (
              <div key={p.phase} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full ${p.color} flex items-center justify-center text-white text-xs font-bold`}>
                    {p.phase}
                  </div>
                  {idx < phases.length - 1 && (
                    <div className="w-0.5 h-6 bg-slate-200 mt-1" />
                  )}
                </div>
                <div className="pt-1.5">
                  <div className="font-semibold text-sm">{p.name}</div>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>State Tracking</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Each post flows through the pipeline as a tracked record in the pipeline_state DynamoDB table:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {['post_id', 'theme', 'date', 'platform', 'draft_status', 'review_status', 'media_status', 'publish_status'].map((h) => (
                    <th key={h} className="text-left py-2 px-2 font-semibold font-mono">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2 px-2 font-mono">#72</td>
                  <td className="py-2 px-2">AI Ethics</td>
                  <td className="py-2 px-2">Mar 14</td>
                  <td className="py-2 px-2">LinkedIn</td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-green-50 text-green-700">✓</Badge></td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-green-50 text-green-700">✓</Badge></td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-amber-50 text-amber-700">manual</Badge></td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-green-50 text-green-700">✓</Badge></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 px-2 font-mono">#73</td>
                  <td className="py-2 px-2">SMB Cloud</td>
                  <td className="py-2 px-2">Mar 16</td>
                  <td className="py-2 px-2">X</td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-green-50 text-green-700">✓</Badge></td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">pending</Badge></td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-slate-50">—</Badge></td>
                  <td className="py-2 px-2"><Badge variant="outline" className="text-xs bg-slate-50">queued</Badge></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Revision Loop</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
            <span className="px-2 py-1 bg-green-50 rounded border border-green-200">Phase 3: Generator</span>
            <ArrowRight className="w-3 h-3" />
            <span className="px-2 py-1 bg-amber-50 rounded border border-amber-200">Phase 4: Review</span>
            <ArrowRight className="w-3 h-3" />
            <span className="px-2 py-1 bg-red-50 rounded border border-red-200">Needs Work?</span>
            <ArrowRight className="w-3 h-3" />
            <span className="px-2 py-1 bg-green-50 rounded border border-green-200">Phase 3 (with comments)</span>
            <ArrowRight className="w-3 h-3" />
            <span className="px-2 py-1 bg-purple-50 rounded border border-purple-200">Max 2 revisions</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfraTab() {
  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>AWS Services</CardTitle>
          <CardDescription>11 AWS services powering the content agent system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {AWS_SERVICES.map((svc) => (
              <div key={svc.service} className="p-3 rounded-lg border bg-white">
                <div className="font-semibold text-sm">{svc.service}</div>
                <p className="text-xs text-muted-foreground">{svc.role}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>v2 Roadmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              'Bedrock image generation for automated brand-aligned visuals',
              'Auto-injected evergreen post queue with decay scoring',
              'Semantic tagging pipeline for trend detection and SEO alignment',
              'Auto-generated campaign briefs triggered by theme activation',
              'Dynamic CTA A/B testing with feedback loop integration',
              'Cross-platform content repurposing (long-form → social snippets)',
              'Cost-per-post attribution through granular CloudWatch metrics + AIDLC tags',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TaggingTab() {
  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>AIDLC Resource Tagging</CardTitle>
          <CardDescription>
            Non-negotiable tagging standards for cost attribution and engagement profitability tracking
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-semibold text-xs">Tag Key</th>
                  <th className="text-left py-2 px-3 font-semibold text-xs">Example</th>
                  <th className="text-left py-2 px-3 font-semibold text-xs">Description</th>
                </tr>
              </thead>
              <tbody>
                {AIDLC_TAGS.map((tag) => (
                  <tr key={tag.key} className="border-b last:border-0">
                    <td className="py-2 px-3 font-mono text-xs font-semibold">{tag.key}</td>
                    <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{tag.example}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{tag.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Why Tagging Matters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Cost Attribution</span>
                <span className="text-muted-foreground"> — Every Lambda invocation, DynamoDB read, Bedrock call is traceable to a specific engagement and pipeline phase. No mystery AWS bills.</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Engagement Profitability</span>
                <span className="text-muted-foreground"> — Tags enable per-customer and per-project cost analysis. Know exactly what the content system costs per engagement.</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Environment Isolation</span>
                <span className="text-muted-foreground"> — Dev/staging/prod resources are clearly separated. No accidental cross-environment data access.</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Compliance & Audit</span>
                <span className="text-muted-foreground"> — Tags satisfy SOC 2 resource identification requirements and enable automated compliance reporting.</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>CDK Implementation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-slate-900 rounded-lg text-green-400 font-mono text-xs leading-relaxed">
            <pre>{`# Applied at CDK App level — inherited by all resources
cdk.Tags.of(app).add("engagement", "enterprise-content-system")
cdk.Tags.of(app).add("cost-center", "internal-ops")
cdk.Tags.of(app).add("env", stage)
cdk.Tags.of(app).add("managed-by", "iac-cdk")
cdk.Tags.of(app).add("enterprise:solution", "content-agent")
cdk.Tags.of(app).add("enterprise:workload", "content-pipeline")

# Phase-specific tags on individual resources
cdk.Tags.of(generator_lambda).add("agent-phase", "phase-3-generator")
cdk.Tags.of(review_lambda).add("agent-phase", "phase-4-review")`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
