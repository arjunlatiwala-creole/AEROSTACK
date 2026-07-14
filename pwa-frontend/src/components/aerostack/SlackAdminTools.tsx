import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Hash,
  UserPlus,
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  UserMinus,
  RefreshCw,
  Link2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/api/client';

const TOOLS_API_URL = import.meta.env.VITE_TOOLS_API_URL;

async function slackAction(action: string, payload: Record<string, unknown> = {}) {
  const res = await apiClient.post(`${TOOLS_API_URL}/slack-admin`, { action, ...payload });
  return res.data;
}

export default function SlackAdminTools() {
  const [activeTab, setActiveTab] = useState('channels');

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-purple-600" />
            <CardTitle>Slack Admin Tools</CardTitle>
          </div>
          <CardDescription>
            Channel management, user invites, guest access, Slack Connect, and offboarding
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="channels" className="gap-2">
                <Hash className="w-4 h-4" /> Channels
              </TabsTrigger>
              <TabsTrigger value="invites" className="gap-2">
                <UserPlus className="w-4 h-4" /> Invites
              </TabsTrigger>
              <TabsTrigger value="users" className="gap-2">
                <Users className="w-4 h-4" /> Users
              </TabsTrigger>
            </TabsList>
            <ChannelsTab />
            <InvitesTab />
            <UsersTab />
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}


// ── Channels Tab ───────────────────────────────────────────────

function ChannelsTab() {
  const [channels, setChannels] = useState<{ id: string; name: string; num_members: number; topic: string; is_private: boolean; is_archived: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', topic: '', purpose: '', is_private: false });
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const fetchChannels = async () => {
    setLoading(true);
    try {
      const data = await slackAction('list_channels', { include_private: true, include_archived: showArchived });
      setChannels(data.channels ?? []);
      toast.success(`Loaded ${data.count ?? 0} channels`);
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setLoading(false);
    }
  };

  const createChannel = async () => {
    if (!createForm.name.trim()) {
      toast.error('Channel name is required');
      return;
    }
    setCreating(true);
    try {
      const data = await slackAction('create_channel', createForm);
      if (data.created) {
        toast.success(`#${data.name} created`);
        setCreateForm({ name: '', topic: '', purpose: '', is_private: false });
        setShowCreate(false);
        fetchChannels();
      } else {
        toast.error(data.message ?? 'Failed to create channel');
      }
    } catch {
      toast.error('Failed to create channel');
    } finally {
      setCreating(false);
    }
  };

  const archiveChannel = async (channelId: string, channelName: string) => {
    if (!confirm(`Archive #${channelName}? This can be undone in Slack.`)) return;
    try {
      const data = await slackAction('archive_channel', { channel_id: channelId });
      if (data.archived) {
        toast.success(`#${channelName} archived`);
        setChannels(prev => prev.filter(c => c.id !== channelId));
      } else {
        toast.error(data.message ?? 'Failed to archive');
      }
    } catch {
      toast.error('Failed to archive channel');
    }
  };

  return (
    <TabsContent value="channels" className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchChannels} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Load Channels
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="rounded"
            />
            Include archived
          </label>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Hash className="w-4 h-4 mr-1" /> New Channel
        </Button>
      </div>

      {showCreate && (
        <Card className="shadow-none border-purple-200">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Channel Name</Label>
                <Input
                  value={createForm.name}
                  onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="project-acme"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Private?</Label>
                <Select
                  value={createForm.is_private ? 'yes' : 'no'}
                  onValueChange={v => setCreateForm(p => ({ ...p, is_private: v === 'yes' }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">Public</SelectItem>
                    <SelectItem value="yes">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Topic</Label>
              <Input
                value={createForm.topic}
                onChange={e => setCreateForm(p => ({ ...p, topic: e.target.value }))}
                placeholder="Channel topic"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Purpose</Label>
              <Input
                value={createForm.purpose}
                onChange={e => setCreateForm(p => ({ ...p, purpose: e.target.value }))}
                placeholder="What is this channel for?"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={createChannel} disabled={creating} className="bg-purple-600 hover:bg-purple-700">
                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Hash className="w-4 h-4 mr-1" />}
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {channels.length > 0 && (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {channels.map(ch => (
            <div key={ch.id} className={`flex items-center justify-between p-2 rounded border text-sm hover:bg-slate-50 ${ch.is_archived ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{ch.name}</span>
                {ch.is_private && <Badge variant="secondary" className="text-xs">private</Badge>}
                {ch.is_archived && <Badge variant="destructive" className="text-xs">archived</Badge>}
                <span className="text-xs text-muted-foreground">{ch.num_members} members</span>
              </div>
              {!ch.is_archived && (
                <Button
                  variant="ghost" size="sm"
                  className="text-red-400 hover:text-red-600 shrink-0"
                  onClick={() => archiveChannel(ch.id, ch.name)}
                >
                  Archive
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  );
}


// ── Invites Tab ────────────────────────────────────────────────

function InvitesTab() {
  const [inviteType, setInviteType] = useState<'workspace' | 'guest' | 'connect' | 'bulk'>('workspace');
  const [email, setEmail] = useState('');
  const [channelId, setChannelId] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleInvite = async () => {
    setResult(null);
    setSubmitting(true);
    try {
      let data;
      if (inviteType === 'bulk') {
        const emails = bulkEmails.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
        if (emails.length === 0) { toast.error('Enter at least one email'); setSubmitting(false); return; }
        data = await slackAction('bulk_invite', { emails });
        setResult({ success: true, message: `${data.invited}/${data.total} invited, ${data.failed} failed` });
      } else if (inviteType === 'workspace') {
        if (!email.trim()) { toast.error('Email required'); setSubmitting(false); return; }
        data = await slackAction('invite_to_workspace', { email });
        setResult({ success: data.invited, message: data.message });
      } else if (inviteType === 'guest') {
        if (!email.trim() || !channelId.trim()) { toast.error('Email and channel ID required'); setSubmitting(false); return; }
        data = await slackAction('invite_guest', { email, channel_id: channelId });
        setResult({ success: data.invited, message: data.message });
      } else if (inviteType === 'connect') {
        if (!email.trim() || !channelId.trim()) { toast.error('Email and channel ID required'); setSubmitting(false); return; }
        data = await slackAction('invite_slack_connect', { email, channel_id: channelId });
        setResult({ success: data.invited, message: data.message });
      }
    } catch {
      toast.error('Invite failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TabsContent value="invites" className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label className="text-xs">Invite Type</Label>
        <Select value={inviteType} onValueChange={v => setInviteType(v as typeof inviteType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="workspace">Workspace (full member)</SelectItem>
            <SelectItem value="guest">Single-Channel Guest</SelectItem>
            <SelectItem value="connect">Slack Connect (external)</SelectItem>
            <SelectItem value="bulk">Bulk Workspace Invite</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {inviteType === 'bulk' ? (
        <div className="space-y-2">
          <Label className="text-xs">Emails (one per line, or comma-separated)</Label>
          <Textarea
            value={bulkEmails}
            onChange={e => setBulkEmails(e.target.value)}
            placeholder={"alice@example.com\nbob@example.com\ncharlie@example.com"}
            rows={5}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs">Email</Label>
          <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" />
        </div>
      )}

      {(inviteType === 'guest' || inviteType === 'connect') && (
        <div className="space-y-2">
          <Label className="text-xs">Channel ID</Label>
          <Input value={channelId} onChange={e => setChannelId(e.target.value)} placeholder="C0123456789" />
          <p className="text-xs text-muted-foreground">Find channel IDs in the Channels tab or Slack channel settings</p>
        </div>
      )}

      <Button onClick={handleInvite} disabled={submitting} className="w-full bg-purple-600 hover:bg-purple-700">
        {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
        {inviteType === 'bulk' ? 'Send Bulk Invites' :
         inviteType === 'connect' ? 'Send Slack Connect Invite' :
         inviteType === 'guest' ? 'Invite as Guest' : 'Invite to Workspace'}
      </Button>

      {result && (
        <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${result.success ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {result.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {result.message}
        </div>
      )}
    </TabsContent>
  );
}


// ── Users Tab ──────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<{
    id: string; real_name: string; email: string; title: string;
    is_admin: boolean; is_restricted: boolean; is_ultra_restricted: boolean;
    deleted: boolean; status_text: string;
  }[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ active: 0, guests: 0, deactivated: 0 });
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<Record<string, unknown> | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [filter, setFilter] = useState('active');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await slackAction('list_users', { include_deactivated: true });
      setUsers(data.users ?? []);
      setSummary({ active: data.active ?? 0, guests: data.guests ?? 0, deactivated: data.deactivated ?? 0 });
      toast.success(`Loaded ${data.count ?? 0} users`);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const lookupUser = async () => {
    if (!lookupEmail.trim()) { toast.error('Enter an email'); return; }
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const data = await slackAction('lookup_user', { email: lookupEmail });
      setLookupResult(data.found ? data.user : { not_found: true, email: lookupEmail });
    } catch {
      toast.error('Lookup failed');
    } finally {
      setLookupLoading(false);
    }
  };

  const deactivateUser = async (userId: string, name: string) => {
    if (!confirm(`Deactivate ${name}? They will lose access to the workspace.`)) return;
    try {
      const data = await slackAction('deactivate_user', { user_id: userId });
      if (data.deactivated) {
        toast.success(`${name} deactivated`);
        fetchUsers();
      } else {
        toast.error(data.message ?? 'Failed to deactivate');
      }
    } catch {
      toast.error('Deactivation failed');
    }
  };

  const filteredUsers = users.filter(u => {
    if (filter === 'active') return !u.deleted && !u.is_restricted && !u.is_ultra_restricted;
    if (filter === 'guests') return u.is_restricted || u.is_ultra_restricted;
    if (filter === 'deactivated') return u.deleted;
    return true;
  });

  return (
    <TabsContent value="users" className="space-y-4 mt-4">
      {/* Lookup */}
      <div className="flex gap-2">
        <Input
          value={lookupEmail}
          onChange={e => setLookupEmail(e.target.value)}
          placeholder="Lookup by email..."
          className="flex-1"
          onKeyDown={e => e.key === 'Enter' && lookupUser()}
        />
        <Button variant="outline" size="sm" onClick={lookupUser} disabled={lookupLoading}>
          {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {lookupResult && (
        <div className="p-3 rounded-lg border bg-slate-50 text-sm space-y-1">
          {(lookupResult as Record<string, unknown>).not_found ? (
            <span className="text-muted-foreground">No user found for {(lookupResult as Record<string, unknown>).email as string}</span>
          ) : (
            <>
              <div className="font-medium">{String(lookupResult.real_name ?? '')}</div>
              <div className="text-xs text-muted-foreground">{String(lookupResult.email ?? '')} · {String(lookupResult.title ?? '')}</div>
              <div className="flex gap-1 mt-1">
                <Badge variant="secondary" className="text-xs">ID: {String(lookupResult.id ?? '')}</Badge>
                {Boolean(lookupResult.is_admin) && <Badge className="text-xs bg-blue-500">Admin</Badge>}
                {Boolean(lookupResult.is_restricted) && <Badge className="text-xs bg-yellow-500">Guest</Badge>}
                {Boolean(lookupResult.deleted) && <Badge className="text-xs bg-red-500">Deactivated</Badge>}
              </div>
            </>
          )}
        </div>
      )}

      {/* User list */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Load Users
          </Button>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active ({summary.active})</SelectItem>
              <SelectItem value="guests">Guests ({summary.guests})</SelectItem>
              <SelectItem value="deactivated">Deactivated ({summary.deactivated})</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredUsers.length > 0 && (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {filteredUsers.map(u => (
            <div key={u.id} className="flex items-center justify-between p-2 rounded border text-sm hover:bg-slate-50">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{u.real_name || u.id}</span>
                  {u.is_admin && <Badge variant="secondary" className="text-xs">admin</Badge>}
                  {u.is_restricted && <Badge variant="secondary" className="text-xs">guest</Badge>}
                  {u.deleted && <Badge variant="destructive" className="text-xs">deactivated</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{u.email}{u.title ? ` · ${u.title}` : ''}</div>
              </div>
              {!u.deleted && (
                <Button
                  variant="ghost" size="sm"
                  className="text-red-400 hover:text-red-600 shrink-0"
                  onClick={() => deactivateUser(u.id, u.real_name)}
                >
                  <UserMinus className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  );
}
