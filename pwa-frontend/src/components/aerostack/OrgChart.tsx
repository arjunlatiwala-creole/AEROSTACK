import { useState, useEffect } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Mail,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Circle,
  Shield,
  Cpu,
  TrendingUp,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TOOLS_API = import.meta.env.VITE_TOOLS_API_URL || "";

interface SyncStatus {
  deel: boolean;
  google: boolean;
  slack: boolean;
}

interface OrgPerson {
  person_id: string;
  name: string;
  email: string;
  title: string;
  level: string;
  pillar: string;
  google_ou: string;
  google_workspace_email: string;
  slack_user_id: string;
  deel_employee_id: string;
  status: string;
  sync_status: SyncStatus;
}

interface SyncCheckResult {
  total: number;
  active: number;
  by_pillar: Record<string, number>;
  issues: Array<{ person_id: string; name: string; issue: string; severity: string }>;
  issue_count: number;
}

const PILLAR_CONFIG: Record<string, { icon: typeof Shield; color: string; bg: string }> = {
  Admin: { icon: Shield, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
  TechOps: { icon: Cpu, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30" },
  RevOps: { icon: TrendingUp, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/30" },
};

function SyncDot({ synced, label }: { synced: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1 text-xs" title={`${label}: ${synced ? "synced" : "not synced"}`}>
      {synced
        ? <CheckCircle2 className="h-3 w-3 text-green-500" />
        : <AlertCircle className="h-3 w-3 text-amber-500" />
      }
      {label}
    </span>
  );
}

function PersonCard({ person, onSelect }: { person: OrgPerson; onSelect: (p: OrgPerson) => void }) {
  const sync = person.sync_status ?? { deel: false, google: false, slack: false };
  const isActive = person.status === "active";

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
        isActive ? "border-l-green-500" : "border-l-amber-400"
      }`}
      onClick={() => onSelect(person)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{person.name}</p>
            <p className="text-xs text-muted-foreground truncate">{person.title || "No title"}</p>
            {person.google_workspace_email && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Mail className="h-3 w-3" /> {person.google_workspace_email}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 ml-2">
            <Badge variant="outline" className="text-[10px] px-1.5">{person.level || "—"}</Badge>
            <Badge variant={isActive ? "default" : "secondary"} className="text-[10px] px-1.5">
              {person.status}
            </Badge>
          </div>
        </div>
        <div className="flex gap-3 mt-2 pt-2 border-t">
          <SyncDot synced={sync.deel} label="Deel" />
          <SyncDot synced={sync.google} label="GW" />
          <SyncDot synced={sync.slack} label="Slack" />
        </div>
      </CardContent>
    </Card>
  );
}

function PillarSection({ pillar, people, onSelect }: {
  pillar: string;
  people: OrgPerson[];
  onSelect: (p: OrgPerson) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const config = PILLAR_CONFIG[pillar] ?? { icon: User, color: "text-gray-600", bg: "bg-gray-50 dark:bg-gray-950/30" };
  const Icon = config.icon;

  return (
    <div className={`rounded-lg ${config.bg} p-4`}>
      <button
        className="flex items-center gap-2 w-full text-left mb-3"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Icon className={`h-5 w-5 ${config.color}`} />
        <span className="font-semibold text-lg">{pillar}</span>
        <Badge variant="outline" className="ml-2">{people.length}</Badge>
      </button>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {people.map((p) => (
            <PersonCard key={p.person_id} person={p} onSelect={onSelect} />
          ))}
          {people.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full text-center py-4">No members in this pillar</p>
          )}
        </div>
      )}
    </div>
  );
}

function PersonDetail({ person, onClose }: { person: OrgPerson; onClose: () => void }) {
  const sync = person.sync_status ?? { deel: false, google: false, slack: false };
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{person.name}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Title</p>
            <p className="font-medium">{person.title || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Level</p>
            <p className="font-medium">{person.level || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pillar</p>
            <p className="font-medium">{person.pillar}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Google OU</p>
            <p className="font-mono text-xs">{person.google_ou || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Personal Email</p>
            <p className="font-medium">{person.email || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Workspace Email</p>
            <p className="font-medium">{person.google_workspace_email || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Deel ID</p>
            <p className="font-mono text-xs">{person.deel_employee_id || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Slack ID</p>
            <p className="font-mono text-xs">{person.slack_user_id || "—"}</p>
          </div>
        </div>
        <div className="pt-3 border-t">
          <p className="text-xs text-muted-foreground mb-2">Sync Status</p>
          <div className="flex gap-4">
            <SyncDot synced={sync.deel} label="Deel" />
            <SyncDot synced={sync.google} label="Google Workspace" />
            <SyncDot synced={sync.slack} label="Slack" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OrgChart() {
  const [roster, setRoster] = useState<OrgPerson[]>([]);
  const [syncCheck, setSyncCheck] = useState<SyncCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<OrgPerson | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const [rosterRes, syncRes] = await Promise.all([
        fetch(`${TOOLS_API}/org-sync/roster`).then((r) => r.json()),
        fetch(`${TOOLS_API}/org-sync/sync-check`).then((r) => r.json()),
      ]);
      setRoster(rosterRes.roster ?? []);
      setSyncCheck(syncRes);
    } catch (err) {
      console.error("Failed to load org data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function syncFromGoogle() {
    setSyncing(true);
    try {
      const res = await fetch(`${TOOLS_API}/org-sync/sync-from-google`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      await loadData();
    } catch (err) {
      console.error("Google sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const byPillar = roster.reduce<Record<string, OrgPerson[]>>((acc, p) => {
    const key = p.pillar || "Unassigned";
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  const pillarOrder = ["Admin", "TechOps", "RevOps"];
  const allPillars = [...new Set([...pillarOrder, ...Object.keys(byPillar)])];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6" />
          <div>
            <h2 className="text-2xl font-bold">Org Chart</h2>
            <p className="text-sm text-muted-foreground">
              {syncCheck ? `${syncCheck.active} active across ${Object.keys(syncCheck.by_pillar).length} pillars` : "Loading..."}
              {syncCheck && syncCheck.issue_count > 0 && (
                <span className="text-amber-500 ml-2">• {syncCheck.issue_count} sync issues</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={syncFromGoogle} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">{syncing ? "Syncing..." : "Sync from Google"}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {syncCheck && syncCheck.issue_count > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
              {syncCheck.issue_count} sync {syncCheck.issue_count === 1 ? "issue" : "issues"} detected
            </p>
            <div className="space-y-1">
              {syncCheck.issues.slice(0, 5).map((issue, i) => (
                <p key={i} className="text-xs text-amber-600 dark:text-amber-500">
                  {issue.name}: {issue.issue}
                </p>
              ))}
              {syncCheck.issues.length > 5 && (
                <p className="text-xs text-amber-500">+ {syncCheck.issues.length - 5} more</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selected && (
        <PersonDetail person={selected} onClose={() => setSelected(null)} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : roster.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No org data yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Add people to the org roster via the API or import from the hiring pipeline.
              The org chart auto-populates from Google Workspace OU membership.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {allPillars.map((pillar) => (
            <PillarSection
              key={pillar}
              pillar={pillar}
              people={byPillar[pillar] ?? []}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}
    </div>
  );
}
