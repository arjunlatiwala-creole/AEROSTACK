import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail, ArrowRight, Check, X, Plus, Loader2, Save, Trash2, RefreshCw,
  AlertCircle, Database, Edit2, Inbox, Users, Shield, Send, Search,
  ChevronDown, ChevronRight, Terminal, Play, Copy, BookOpen,
} from "lucide-react";

const TOOLS_API = import.meta.env.VITE_TOOLS_API_URL;
const API = `${TOOLS_API}/workspace-admin`;

/* ─── Types ──────────────────────────────────────────────────────── */

interface Alias {
  sk: string; alias: string; current_mailbox: string; category: string;
  recommended_mailbox: string; action: string; notes: string;
  priority: string; status: string; updated_at?: string;
}

interface MailboxSummary {
  mailbox: string; total: number; unread: number;
  categories: Record<string, number>;
  recent: { id: string; subject: string; from: string; date: string; category: string; unread: boolean }[];
  error?: string;
}

interface GUser {
  email: string; name: string; suspended: boolean; admin: boolean;
  last_login: string; org_unit: string; aliases: string[];
}

interface GGroup {
  email: string; name: string; description: string; member_count: string;
}

/* ─── API helpers ────────────────────────────────────────────────── */

const fetchAliases = async (): Promise<Alias[]> => {
  const r = await fetch(`${API}?action=list_aliases`); const d = await r.json(); return d.items || [];
};
const seedAliases = async (force = false) => {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed", force }) }); return r.json();
};
const upsertAlias = async (a: Partial<Alias>) => {
  await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upsert", entity: "alias", id: a.sk || a.alias, data: a }) });
};
const deleteAlias = async (id: string) => {
  await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", entity: "alias", id }) });
};
const executeAliasMove = async (alias: string, from_mb: string, to_mb: string) => {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "execute_alias_move", alias, from_mailbox: from_mb, to_mailbox: to_mb }) });
  return r.json();
};
const markExecuted = async (id: string) => {
  await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "execute_change", id }) });
};
const fetchInboxSummary = async (hours = 24): Promise<{ mailboxes: MailboxSummary[] }> => {
  const r = await fetch(`${API}?action=inbox_summary&hours=${hours}`); return r.json();
};
const fetchUsers = async (): Promise<GUser[]> => {
  const r = await fetch(`${API}?action=list_users`); const d = await r.json(); return d.users || [];
};
const fetchGroups = async (): Promise<GGroup[]> => {
  const r = await fetch(`${API}?action=list_groups`); const d = await r.json(); return d.groups || [];
};
const notifySlack = async (channel: string, text: string, mailbox: string) => {
  await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify_slack", channel, text, mailbox }) });
};

const MAILBOXES = ["accounting", "adminops", "revops", "techops", "engineering", "catch-all", "aidlc", "—"];
const ACTIONS = ["Keep", "Move", "Review", "Remove"];
const PRIORITIES = ["High", "Medium", "Low", "—"];
const CATEGORIES = ["AI/Dev Tools", "Finance", "Infrastructure", "Marketing", "Marketing/Sales", "General", "Sales", "Security", "Support", "System/Dev", "System/Noreply", "Vendor", "Vendor/Integration", "Product/Project", "Personal/Unknown"];

/* ─── Shared components ──────────────────────────────────────────── */

function Sel({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white w-full">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
}

function TabBtn({ active, label, icon: Icon, onClick }: { active: boolean; label: string; icon: typeof Mail; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${active ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100"}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

/* ─── Alias Audit Tab ────────────────────────────────────────────── */

function AliasRow({ alias, onSave, onDelete, onExecuteMove }: { alias: Alias; onSave: (a: Alias) => void; onDelete: (id: string) => void; onExecuteMove: (alias: string, from: string, to: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias);
  const ac: Record<string, string> = { Keep: "bg-green-100 text-green-700", Move: "bg-amber-100 text-amber-700", Review: "bg-blue-100 text-blue-700", Remove: "bg-red-100 text-red-700" };
  const pc: Record<string, string> = { High: "text-red-600", Medium: "text-amber-600", Low: "text-gray-500", "—": "text-gray-300" };
  const sc: Record<string, string> = { pending: "bg-gray-100 text-gray-600", executed: "bg-green-100 text-green-700", skipped: "bg-gray-100 text-gray-400 line-through" };

  if (editing) {
    return (
      <tr className="bg-blue-50/50">
        <td className="px-2 py-1.5"><input className="text-xs border rounded px-1.5 py-1 w-full font-mono" value={draft.alias} onChange={(e) => setDraft({ ...draft, alias: e.target.value })} /></td>
        <td className="px-2 py-1.5"><Sel value={draft.current_mailbox} options={MAILBOXES} onChange={(v) => setDraft({ ...draft, current_mailbox: v })} /></td>
        <td className="px-2 py-1.5"><Sel value={draft.recommended_mailbox} options={MAILBOXES} onChange={(v) => setDraft({ ...draft, recommended_mailbox: v })} /></td>
        <td className="px-2 py-1.5"><Sel value={draft.action} options={ACTIONS} onChange={(v) => setDraft({ ...draft, action: v })} /></td>
        <td className="px-2 py-1.5"><Sel value={draft.priority} options={PRIORITIES} onChange={(v) => setDraft({ ...draft, priority: v })} /></td>
        <td className="px-2 py-1.5"><input className="text-xs border rounded px-1.5 py-1 w-full" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></td>
        <td className="px-2 py-1.5"><div className="flex gap-1"><button onClick={() => { onSave(draft); setEditing(false); }} className="p-1 text-green-600 hover:bg-green-100 rounded"><Save className="w-3.5 h-3.5" /></button><button onClick={() => { setDraft(alias); setEditing(false); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-3.5 h-3.5" /></button></div></td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50 border-b border-gray-100">
      <td className="px-2 py-1.5 text-xs font-mono text-gray-800">{alias.alias}</td>
      <td className="px-2 py-1.5 text-xs">{alias.action === "Move" ? <span className="flex items-center gap-1"><span className="text-gray-400">{alias.current_mailbox}</span><ArrowRight className="w-3 h-3 text-amber-500" /><span className="font-medium text-amber-700">{alias.recommended_mailbox}</span></span> : <span className="text-gray-500">{alias.current_mailbox}</span>}</td>
      <td className="px-2 py-1.5 text-xs text-gray-500">{alias.recommended_mailbox}</td>
      <td className="px-2 py-1.5"><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ac[alias.action] || "bg-gray-100"}`}>{alias.action}</span></td>
      <td className={`px-2 py-1.5 text-xs font-medium ${pc[alias.priority] || "text-gray-400"}`}>{alias.priority}</td>
      <td className="px-2 py-1.5 text-xs text-gray-500 max-w-[180px] truncate" title={alias.notes}>{alias.notes}</td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1 items-center">
          <span className={`text-xs px-1.5 py-0.5 rounded ${sc[alias.status] || sc.pending}`}>{alias.status}</span>
          <button onClick={() => setEditing(true)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><Edit2 className="w-3 h-3" /></button>
          {alias.status === "pending" && alias.action === "Move" && (
            <button onClick={() => onExecuteMove(alias.alias, alias.current_mailbox, alias.recommended_mailbox)} className="p-1 text-indigo-500 hover:bg-indigo-100 rounded" title="Execute move via Admin SDK"><Play className="w-3 h-3" /></button>
          )}
          {alias.status === "pending" && <button onClick={() => onDelete(alias.sk)} className="p-1 text-red-400 hover:bg-red-100 rounded"><Trash2 className="w-3 h-3" /></button>}
        </div>
      </td>
    </tr>
  );
}

function AliasAuditTab() {
  const qc = useQueryClient();
  const [filterAction, setFilterAction] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { data: aliases, isLoading } = useQuery({ queryKey: ["ws-aliases"], queryFn: fetchAliases, staleTime: 30_000 });
  const seedMut = useMutation({ mutationFn: (f: boolean) => seedAliases(f), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-aliases"] }) });
  const saveMut = useMutation({ mutationFn: upsertAlias, onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-aliases"] }) });
  const delMut = useMutation({ mutationFn: deleteAlias, onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-aliases"] }) });
  const execMut = useMutation({ mutationFn: ({ a, f, t }: { a: string; f: string; t: string }) => executeAliasMove(a, f, t), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-aliases"] }) });

  const filtered = (aliases || []).filter((a) => (filterAction === "all" || a.action === filterAction) && (filterStatus === "all" || a.status === filterStatus));
  const stats = { total: aliases?.length || 0, pending: aliases?.filter((a) => a.status === "pending").length || 0, executed: aliases?.filter((a) => a.status === "executed").length || 0 };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500">Action:</span>
          {["all", ...ACTIONS].map((a) => <button key={a} onClick={() => setFilterAction(a)} className={`text-xs px-2 py-1 rounded ${filterAction === a ? "bg-indigo-100 text-indigo-700 font-medium" : "bg-gray-50 text-gray-500"}`}>{a === "all" ? "All" : a}</button>)}
          <span className="text-xs text-gray-500 ml-2">Status:</span>
          {["all", "pending", "executed"].map((s) => <button key={s} onClick={() => setFilterStatus(s)} className={`text-xs px-2 py-1 rounded ${filterStatus === s ? "bg-indigo-100 text-indigo-700 font-medium" : "bg-gray-50 text-gray-500"}`}>{s === "all" ? "All" : s}</button>)}
        </div>
        <div className="flex gap-2">
          {stats.total === 0 && <button onClick={() => seedMut.mutate(false)} disabled={seedMut.isPending} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg disabled:opacity-50">{seedMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />} Seed</button>}
          <span className="text-xs text-gray-400">{stats.pending} pending / {stats.executed} done / {stats.total} total</span>
        </div>
      </div>
      {isLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div> : filtered.length > 0 ? (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b"><tr>{["Alias", "Current → Target", "Target", "Action", "Priority", "Notes", ""].map((h) => <th key={h} className="px-2 py-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody>{filtered.map((a) => <AliasRow key={a.sk} alias={a} onSave={(u) => saveMut.mutate(u)} onDelete={(id) => delMut.mutate(id)} onExecuteMove={(al, f, t) => execMut.mutate({ a: al, f, t })} />)}</tbody>
          </table>
        </div>
      ) : <p className="text-center text-sm text-gray-400 py-8">No aliases match filters.</p>}
    </div>
  );
}

/* ─── Mailbox Monitor Tab ────────────────────────────────────────── */

function MailboxMonitorTab() {
  const [hours, setHours] = useState(24);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["ws-inbox", hours], queryFn: () => fetchInboxSummary(hours), staleTime: 60_000 });

  const catColors: Record<string, string> = { billing: "bg-amber-100 text-amber-700", alert: "bg-red-100 text-red-700", onboarding: "bg-green-100 text-green-700", automated: "bg-gray-100 text-gray-500", support: "bg-blue-100 text-blue-700", calendar: "bg-purple-100 text-purple-700", general: "bg-gray-100 text-gray-600" };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Period:</span>
        {[6, 12, 24, 48, 72].map((h) => <button key={h} onClick={() => setHours(h)} className={`text-xs px-2 py-1 rounded ${hours === h ? "bg-indigo-100 text-indigo-700 font-medium" : "bg-gray-50 text-gray-500"}`}>{h}h</button>)}
        <button onClick={() => refetch()} className="ml-auto p-1.5 text-gray-400 hover:bg-gray-100 rounded"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-indigo-500 mr-2" /><span className="text-sm text-gray-500">Checking mailboxes...</span></div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{(error as Error).message}</div>}

      {data && (
        <div className="space-y-4">
          {data.mailboxes.map((mb) => (
            <div key={mb.mailbox} className="border border-gray-200 rounded-lg bg-white">
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-medium text-gray-800">{mb.mailbox}</span>
                </div>
                <div className="flex items-center gap-3">
                  {mb.error ? <span className="text-xs text-red-500">{mb.error.slice(0, 60)}</span> : (
                    <>
                      <span className="text-xs text-gray-500">{mb.total} total</span>
                      {mb.unread > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">{mb.unread} unread</span>}
                    </>
                  )}
                </div>
              </div>
              {!mb.error && mb.recent && mb.recent.length > 0 && (
                <div className="px-4 py-2 space-y-1">
                  {mb.categories && Object.keys(mb.categories).length > 0 && (
                    <div className="flex gap-1 mb-2">{Object.entries(mb.categories).map(([cat, count]) => <span key={cat} className={`text-xs px-1.5 py-0.5 rounded ${catColors[cat] || catColors.general}`}>{cat}: {count}</span>)}</div>
                  )}
                  {mb.recent.slice(0, 5).map((e) => (
                    <div key={e.id} className="flex items-center gap-2 py-1 text-xs">
                      {e.unread && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                      <span className="text-gray-500 w-32 truncate shrink-0">{e.from?.split("<")[0]?.trim()}</span>
                      <span className={`text-gray-800 flex-1 truncate ${e.unread ? "font-medium" : ""}`}>{e.subject}</span>
                      <span className={`px-1.5 py-0.5 rounded shrink-0 ${catColors[e.category] || catColors.general}`}>{e.category}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Users & Groups Tab ─────────────────────────────────────────── */

function UsersGroupsTab() {
  const [view, setView] = useState<"users" | "groups">("users");
  const { data: users, isLoading: loadingUsers } = useQuery({ queryKey: ["ws-users"], queryFn: fetchUsers, staleTime: 120_000 });
  const { data: groups, isLoading: loadingGroups } = useQuery({ queryKey: ["ws-groups"], queryFn: fetchGroups, staleTime: 120_000 });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={() => setView("users")} className={`text-xs px-3 py-1.5 rounded-lg font-medium ${view === "users" ? "bg-indigo-100 text-indigo-700" : "bg-gray-50 text-gray-500"}`}>Users ({users?.length || "..."})</button>
        <button onClick={() => setView("groups")} className={`text-xs px-3 py-1.5 rounded-lg font-medium ${view === "groups" ? "bg-indigo-100 text-indigo-700" : "bg-gray-50 text-gray-500"}`}>Groups ({groups?.length || "..."})</button>
      </div>

      {view === "users" && (loadingUsers ? <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mx-auto" /> : users && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b"><tr>{["Email", "Name", "OU", "Admin", "Last Login", "Aliases"].map((h) => <th key={h} className="px-2 py-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.email} className="hover:bg-gray-50 border-b border-gray-100">
                <td className="px-2 py-1.5 text-xs font-mono text-gray-800">{u.email}</td>
                <td className="px-2 py-1.5 text-xs text-gray-600">{u.name}</td>
                <td className="px-2 py-1.5 text-xs text-gray-500">{u.org_unit}</td>
                <td className="px-2 py-1.5">{u.admin && <Shield className="w-3 h-3 text-amber-500" />}{u.suspended && <span className="text-xs text-red-500">suspended</span>}</td>
                <td className="px-2 py-1.5 text-xs text-gray-400">{u.last_login ? new Date(u.last_login).toLocaleDateString() : "—"}</td>
                <td className="px-2 py-1.5 text-xs text-gray-400">{u.aliases?.length || 0}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {view === "groups" && (loadingGroups ? <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mx-auto" /> : groups && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b"><tr>{["Email", "Name", "Description", "Members"].map((h) => <th key={h} className="px-2 py-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody>{groups.map((g) => (
              <tr key={g.email} className="hover:bg-gray-50 border-b border-gray-100">
                <td className="px-2 py-1.5 text-xs font-mono text-gray-800">{g.email}</td>
                <td className="px-2 py-1.5 text-xs text-gray-600">{g.name}</td>
                <td className="px-2 py-1.5 text-xs text-gray-500 max-w-[200px] truncate">{g.description}</td>
                <td className="px-2 py-1.5 text-xs text-gray-500">{g.member_count}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */

export default function WorkspaceAdminTools() {
  const [tab, setTab] = useState<"aliases" | "mailboxes" | "directory">("aliases");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-100 rounded-lg"><Mail className="w-5 h-5 text-indigo-600" /></div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">GWorkspace Admin</h2>
          <p className="text-sm text-gray-500">enterprise.io — aliases, shared mailboxes, users &amp; groups</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <TabBtn active={tab === "aliases"} label="Alias Audit" icon={ArrowRight} onClick={() => setTab("aliases")} />
        <TabBtn active={tab === "mailboxes"} label="Mailbox Monitor" icon={Inbox} onClick={() => setTab("mailboxes")} />
        <TabBtn active={tab === "directory"} label="Users & Groups" icon={Users} onClick={() => setTab("directory")} />
      </div>

      {/* Tab content */}
      {tab === "aliases" && <AliasAuditTab />}
      {tab === "mailboxes" && <MailboxMonitorTab />}
      {tab === "directory" && <UsersGroupsTab />}
    </div>
  );
}
