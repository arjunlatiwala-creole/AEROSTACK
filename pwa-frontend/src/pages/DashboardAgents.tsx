import { useState, useEffect } from 'react';
import {
  Bot,
  ExternalLink,
  Package,
  DollarSign,
  Users,
  GitBranch,
  Compass,
  Wrench,
  Brain,
  Crown,
  CheckCircle2,
  Clock,
  Hammer,
  Pause,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Zap,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Aerostack_AGENT_CATALOG,
  Aerostack_DOMAINS,
  getAgentsByDomain,
  type AerostackAgent,
  type AgentDomain,
  type AgentStatus,
  type AgentTier,
} from '@/lib/aerostack-agents';
import { agentsApi, type RegistryAgent } from '@/lib/tools-api';
import toast from 'react-hot-toast';

const DOMAIN_ICONS: Record<AgentDomain, typeof Package> = {
  delivery: Package,
  revenue: DollarSign,
  people: Users,
  devops: GitBranch,
  strategy: Compass,
};

const TIER_ICONS: Record<AgentTier, typeof Wrench> = {
  foundation: Wrench,
  intelligence: Brain,
  executive: Crown,
};

const STATUS_CONFIG: Record<
  AgentStatus,
  { icon: typeof CheckCircle2; label: string; className: string }
> = {
  active: { icon: CheckCircle2, label: 'Active', className: 'bg-green-100 text-green-800' },
  planned: { icon: Clock, label: 'Planned', className: 'bg-slate-100 text-slate-600' },
  building: { icon: Hammer, label: 'Building', className: 'bg-amber-100 text-amber-800' },
  paused: { icon: Pause, label: 'Paused', className: 'bg-gray-100 text-gray-600' },
  error: { icon: AlertTriangle, label: 'Error', className: 'bg-red-100 text-red-800' },
};

const DOMAIN_COLORS: Record<AgentDomain, string> = {
  delivery: 'from-blue-500 to-blue-700',
  revenue: 'from-green-500 to-green-700',
  people: 'from-purple-500 to-purple-700',
  devops: 'from-orange-500 to-orange-700',
  strategy: 'from-rose-500 to-rose-700',
};

function AgentCard({ agent, registryData }: { agent: AerostackAgent; registryData?: RegistryAgent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[agent.status];
  const StatusIcon = statusCfg.icon;
  const TierIcon = TIER_ICONS[agent.tier];

  return (
    <Card className="shadow-none hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5">
              <TierIcon className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{agent.name}</span>
                <Badge variant="outline" className={`text-xs ${statusCfg.className}`}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {statusCfg.label}
                </Badge>
                {agent.reusesFrom && (
                  <Badge variant="outline" className="text-xs bg-cyan-50 text-cyan-700">
                    reuses {agent.reusesFrom}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {agent.description}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{agent.tools.length} tools</span>
                <span>{agent.workflows.length} workflows</span>
                {agent.model && <span>{agent.model}</span>}
                <span className="italic">replaces: {agent.replaces}</span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 shrink-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t space-y-3">
            {agent.tools.length > 0 && (
              <div>
                <span className="text-xs font-semibold uppercase text-muted-foreground">Tools</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {agent.tools.map((t) => (
                    <Badge key={t.name} variant="secondary" className="text-xs font-mono">
                      {t.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {agent.workflows.length > 0 && (
              <div>
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Workflows
                </span>
                <div className="mt-1 space-y-1">
                  {agent.workflows.map((w) => (
                    <div key={w.id} className="text-xs flex items-center gap-2">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span className="font-medium">{w.name}</span>
                      <span className="text-muted-foreground">
                        {w.schedule ?? w.trigger ?? 'manual'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(agent.consumes.length > 0 || agent.feeds.length > 0) && (
              <div>
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Data Flow
                </span>
                <div className="mt-1 flex items-center gap-2 text-xs flex-wrap">
                  {agent.consumes.length > 0 && (
                    <>
                      <span className="text-muted-foreground">reads:</span>
                      {agent.consumes.map((c) => (
                        <Badge key={c} variant="outline" className="text-xs">
                          {c}
                        </Badge>
                      ))}
                    </>
                  )}
                  {agent.consumes.length > 0 && agent.feeds.length > 0 && (
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  )}
                  {agent.feeds.length > 0 && (
                    <>
                      <span className="text-muted-foreground">feeds:</span>
                      {agent.feeds.map((f) => (
                        <Badge key={f} variant="outline" className="text-xs">
                          {f}
                        </Badge>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
            {registryData && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Registry: {registryData.status} · v{registryData.version} ·
                updated {new Date(registryData.updated_at).toLocaleDateString()}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DomainSection({ domain }: { domain: AgentDomain }) {
  const config = Aerostack_DOMAINS[domain];
  const agents = getAgentsByDomain(domain);
  const DomainIcon = DOMAIN_ICONS[domain];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <DomainIcon className="w-5 h-5" />
        <h2 className="text-lg font-semibold">{config.label}</h2>
        <span className="text-sm text-muted-foreground">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{config.description}</p>
      <div className="space-y-3">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}

export default function DashboardAgents() {
  const [registryAgents, setRegistryAgents] = useState<RegistryAgent[]>([]);
  const [isSeeding, setIsSeeding] = useState(false);
  const [registryLoaded, setRegistryLoaded] = useState(false);

  useEffect(() => {
    loadRegistry();
  }, []);

  async function loadRegistry() {
    const result = await agentsApi.list();
    if (result.success && result.data) {
      setRegistryAgents(result.data.agents);
    }
    setRegistryLoaded(true);
  }

  async function seedCatalogToRegistry() {
    setIsSeeding(true);
    let created = 0;
    let skipped = 0;

    for (const agent of Aerostack_AGENT_CATALOG) {
      const existing = registryAgents.find(
        (r) => r.name === agent.name || r.tags.includes(`catalog:${agent.id}`),
      );
      if (existing) {
        skipped++;
        continue;
      }

      const result = await agentsApi.create({
        name: agent.name,
        description: agent.description,
        status: agent.status === 'active' ? 'active' : 'inactive',
        agent_type: agent.tier === 'executive' ? 'autonomous' : 'tool',
        endpoint: agent.apiRoute ?? '',
        version: '0.1.0',
        capabilities: agent.tools.map((t) => t.name),
        config: {
          domain: agent.domain,
          tier: agent.tier,
          replaces: agent.replaces,
          model: agent.model ?? '',
          consumes: [...agent.consumes],
          feeds: [...agent.feeds],
        },
        owner: 'enterprise',
        tags: [`catalog:${agent.id}`, `domain:${agent.domain}`, `tier:${agent.tier}`],
      });

      if (result.success) {
        created++;
      }
    }

    await loadRegistry();
    setIsSeeding(false);
    toast.success(`Seeded ${created} agents, skipped ${skipped} existing`);
  }

  const domains: AgentDomain[] = ['revenue', 'delivery', 'people', 'devops', 'strategy'];
  const activeCount = Aerostack_AGENT_CATALOG.filter((a) => a.status === 'active').length;
  const buildingCount = Aerostack_AGENT_CATALOG.filter((a) => a.status === 'building').length;
  const plannedCount = Aerostack_AGENT_CATALOG.filter((a) => a.status === 'planned').length;
  const totalTools = Aerostack_AGENT_CATALOG.reduce((sum, a) => sum + a.tools.length, 0);
  const totalWorkflows = Aerostack_AGENT_CATALOG.reduce((sum, a) => sum + a.workflows.length, 0);

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Aerostack Agent Fleet</h1>
          <p className="text-sm text-muted-foreground">
            {Aerostack_AGENT_CATALOG.length} agents · {totalTools} tools · {totalWorkflows} workflows
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={seedCatalogToRegistry}
            disabled={isSeeding}
          >
            {isSeeding ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Bot className="h-4 w-4 mr-1" />
            )}
            {isSeeding ? 'Seeding...' : 'Seed Registry'}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/agents"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4 mr-1" /> Bedrock Console
            </a>
          </Button>
        </div>
      </div>

      {registryLoaded && registryAgents.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Registry: {registryAgents.length} agents registered in DynamoDB
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="shadow-none bg-gradient-to-br from-green-500 to-green-700 text-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-normal text-green-100">Active</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-3xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none bg-gradient-to-br from-amber-500 to-amber-700 text-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-normal text-amber-100">Building</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-3xl font-bold">{buildingCount}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none bg-gradient-to-br from-slate-500 to-slate-700 text-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-normal text-slate-200">Planned</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-3xl font-bold">{plannedCount}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none bg-gradient-to-br from-blue-500 to-blue-700 text-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-normal text-blue-100">Tools</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-3xl font-bold">{totalTools}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none bg-gradient-to-br from-purple-500 to-purple-700 text-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-normal text-purple-100">Workflows</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-3xl font-bold">{totalWorkflows}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-8">
        {domains.map((domain) => (
          <DomainSection key={domain} domain={domain} />
        ))}
      </div>
    </div>
  );
}
