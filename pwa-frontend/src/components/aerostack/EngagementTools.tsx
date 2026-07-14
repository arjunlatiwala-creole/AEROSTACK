import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Megaphone,
  Users,
  MessageSquare,
  Sparkles,
  Copy,
  Globe,
  Star,
  Presentation,
  UserCircle,
  Blocks,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface EngagementToolsProps {
  loopId?: string;
  loopTitle?: string;
}

export default function EngagementTools({ loopId, loopTitle }: EngagementToolsProps) {
  const [activeTab, setActiveTab] = useState('visibility');

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <CardTitle>Comms & Syndication Tools</CardTitle>
        </div>
        <CardDescription>
          Aligned communications — visibility posts, announcements, customer stories, team updates, and community blocks
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="visibility" className="gap-1 text-xs">
              <Megaphone className="w-3.5 h-3.5" /> Visibility
            </TabsTrigger>
            <TabsTrigger value="announcement" className="gap-1 text-xs">
              <Globe className="w-3.5 h-3.5" /> Announce
            </TabsTrigger>
            <TabsTrigger value="customer" className="gap-1 text-xs">
              <Star className="w-3.5 h-3.5" /> Customer
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-1 text-xs">
              <UserCircle className="w-3.5 h-3.5" /> Team
            </TabsTrigger>
            <TabsTrigger value="community" className="gap-1 text-xs">
              <Blocks className="w-3.5 h-3.5" /> Community
            </TabsTrigger>
          </TabsList>

          <VisibilityTab loopTitle={loopTitle} />
          <AnnouncementTab />
          <CustomerTab loopId={loopId} />
          <TeamTab />
          <CommunityTab />
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ── Visibility Tab — aligned to posting for selected audience ─────
function VisibilityTab({ loopTitle }: { loopTitle?: string }) {
  const [form, setForm] = useState({
    loopTitle: loopTitle ?? '',
    achievement: '',
    audience: 'community_advocates' as string,
    platform: 'linkedin' as string,
    tone: 'conversational' as string,
  });

  const handleGenerate = () => {
    if (!form.achievement) {
      toast.error('Describe the achievement first');
      return;
    }
    const prompt = `Visibility post for ${form.audience.replace(/_/g, ' ')} on ${form.platform}:\n${form.loopTitle ? `Loop: ${form.loopTitle}\n` : ''}Achievement: ${form.achievement}\nTone: ${form.tone}`;
    navigator.clipboard.writeText(prompt);
    toast.success('Prompt copied — paste into Content Creator for AI generation');
  };

  return (
    <TabsContent value="visibility" className="space-y-4 mt-4">
      <p className="text-xs text-muted-foreground">
        Generate visibility posts aligned to your target audience and platform. Use Content Creator for AI-powered drafts.
      </p>
      <div className="space-y-2">
        <Label className="text-xs">Achievement / Win</Label>
        <Textarea
          value={form.achievement}
          onChange={(e) => setForm((p) => ({ ...p, achievement: e.target.value }))}
          placeholder="What was accomplished? Be specific..."
          rows={3}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Audience</Label>
          <Select value={form.audience} onValueChange={(v) => setForm((p) => ({ ...p, audience: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tech_leaders">Tech Leaders</SelectItem>
              <SelectItem value="smb_owners">SMB Owners</SelectItem>
              <SelectItem value="aws_sellers">AWS Sellers</SelectItem>
              <SelectItem value="potential_clients">Potential Clients</SelectItem>
              <SelectItem value="community_advocates">Community Advocates</SelectItem>
              <SelectItem value="org_leaders">Org Leaders</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Platform</Label>
          <Select value={form.platform} onValueChange={(v) => setForm((p) => ({ ...p, platform: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="x">X (Twitter)</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
              <SelectItem value="meetup">Meetup</SelectItem>
              <SelectItem value="blog">Blog</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tone</Label>
          <Select value={form.tone} onValueChange={(v) => setForm((p) => ({ ...p, tone: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inspirational">Inspirational</SelectItem>
              <SelectItem value="informative">Informative</SelectItem>
              <SelectItem value="conversational">Conversational</SelectItem>
              <SelectItem value="fun">Fun</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={handleGenerate} disabled={!form.achievement} className="w-full bg-purple-600 hover:bg-purple-700">
        <Copy className="w-4 h-4 mr-2" /> Copy Prompt for Content Creator
      </Button>
    </TabsContent>
  );
}

// ── Announcement Tab — aligned to website + LinkedIn / PR ─────────
function AnnouncementTab() {
  const [form, setForm] = useState({
    title: '',
    content: '',
    channel: 'website_linkedin' as string,
    includePointers: true,
  });

  const channelLabels: Record<string, string> = {
    website_linkedin: 'Website + LinkedIn',
    pr_release: 'Press Release',
    blog_post: 'Blog Post',
    newsletter: 'Newsletter',
  };

  const handleCopy = () => {
    if (!form.title || !form.content) {
      toast.error('Title and content required');
      return;
    }
    const text = [
      `📢 ${form.title}`,
      '',
      form.content,
      '',
      `Channel: ${channelLabels[form.channel] ?? form.channel}`,
      form.includePointers ? '\n🔗 Include pointers to: enterprise.io, LinkedIn company page' : '',
    ].join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Announcement copied');
  };

  return (
    <TabsContent value="announcement" className="space-y-4 mt-4">
      <p className="text-xs text-muted-foreground">
        Announcements aligned to website + LinkedIn pointers, or PR channels.
      </p>
      <div className="space-y-2">
        <Label className="text-xs">Title</Label>
        <Input
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder="e.g., enterprise Achieves AWS Advanced Partner Status"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Content</Label>
        <Textarea
          value={form.content}
          onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
          placeholder="Write the announcement..."
          rows={5}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select value={form.channel} onValueChange={(v) => setForm((p) => ({ ...p, channel: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="website_linkedin">Website + LinkedIn</SelectItem>
              <SelectItem value="pr_release">Press Release</SelectItem>
              <SelectItem value="blog_post">Blog Post</SelectItem>
              <SelectItem value="newsletter">Newsletter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.includePointers}
              onChange={(e) => setForm((p) => ({ ...p, includePointers: e.target.checked }))}
              className="rounded"
            />
            <span className="text-xs">Include LI / website pointers</span>
          </label>
        </div>
      </div>
      <Button onClick={handleCopy} disabled={!form.title || !form.content} className="w-full bg-blue-600 hover:bg-blue-700">
        <Copy className="w-4 h-4 mr-2" /> Copy Announcement
      </Button>
    </TabsContent>
  );
}

// ── Customer Tab — aligned to STAR library + enterprise.io/gdac presentations ──
function CustomerTab({ loopId }: { loopId?: string }) {
  const [form, setForm] = useState({
    customerName: '',
    situation: '',
    task: '',
    action: '',
    result: '',
    presentationFormat: 'star_story' as string,
  });

  const handleCopy = () => {
    if (!form.customerName) {
      toast.error('Customer name required');
      return;
    }
    const text = [
      `⭐ Customer STAR Story: ${form.customerName}`,
      '',
      `Situation: ${form.situation}`,
      `Task: ${form.task}`,
      `Action: ${form.action}`,
      `Result: ${form.result}`,
      '',
      `Format: ${form.presentationFormat.replace(/_/g, ' ')}`,
      loopId ? `Loop: ${loopId}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text);
    toast.success('STAR story copied');
  };

  return (
    <TabsContent value="customer" className="space-y-4 mt-4">
      <p className="text-xs text-muted-foreground">
        Build customer STAR stories for the story library and enterprise.io/gdac presentation structures.
      </p>
      <div className="space-y-2">
        <Label className="text-xs">Customer Name</Label>
        <Input
          value={form.customerName}
          onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))}
          placeholder="e.g., Acme Corp"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Situation</Label>
          <Textarea
            value={form.situation}
            onChange={(e) => setForm((p) => ({ ...p, situation: e.target.value }))}
            placeholder="What was the customer's challenge?"
            rows={2}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Task</Label>
          <Textarea
            value={form.task}
            onChange={(e) => setForm((p) => ({ ...p, task: e.target.value }))}
            placeholder="What needed to be done?"
            rows={2}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Action</Label>
          <Textarea
            value={form.action}
            onChange={(e) => setForm((p) => ({ ...p, action: e.target.value }))}
            placeholder="What did enterprise do?"
            rows={2}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Result</Label>
          <Textarea
            value={form.result}
            onChange={(e) => setForm((p) => ({ ...p, result: e.target.value }))}
            placeholder="What was the outcome? Metrics?"
            rows={2}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Presentation Format</Label>
        <Select value={form.presentationFormat} onValueChange={(v) => setForm((p) => ({ ...p, presentationFormat: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="star_story">STAR Story (KB entry)</SelectItem>
            <SelectItem value="gdac_deck">enterprise.io/gdac Deck Structure</SelectItem>
            <SelectItem value="case_study">Case Study (blog/website)</SelectItem>
            <SelectItem value="pitch_slide">Pitch Slide Summary</SelectItem>
            <SelectItem value="showcase_flow">showcase Flow Narrative</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleCopy} disabled={!form.customerName} className="w-full bg-green-600 hover:bg-green-700">
        <Star className="w-4 h-4 mr-2" /> Copy STAR Story
      </Button>
    </TabsContent>
  );
}

// ── Team Tab — aligned to people/person ───────────────────────────
function TeamTab() {
  const [form, setForm] = useState({
    person: '',
    commType: 'shoutout' as string,
    subject: '',
    details: '',
  });

  const handleCopy = () => {
    if (!form.subject) {
      toast.error('Subject required');
      return;
    }
    const emoji = form.commType === 'shoutout' ? '🎉' : form.commType === 'blocker' ? '🚨' : '📋';
    const text = [
      `${emoji} ${form.commType.replace(/_/g, ' ').toUpperCase()}: ${form.subject}`,
      form.person ? `Person: ${form.person}` : '',
      '',
      form.details,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Team comm copied');
  };

  return (
    <TabsContent value="team" className="space-y-4 mt-4">
      <p className="text-xs text-muted-foreground">
        Team communications aligned to people — shoutouts, updates, blockers.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Person (optional)</Label>
          <Input
            value={form.person}
            onChange={(e) => setForm((p) => ({ ...p, person: e.target.value }))}
            placeholder="Team member name"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={form.commType} onValueChange={(v) => setForm((p) => ({ ...p, commType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="shoutout">Shoutout</SelectItem>
              <SelectItem value="standup">Standup Update</SelectItem>
              <SelectItem value="blocker">Blocker Alert</SelectItem>
              <SelectItem value="retro">Retrospective</SelectItem>
              <SelectItem value="announcement">Announcement</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Subject</Label>
        <Input
          value={form.subject}
          onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
          placeholder="e.g., Sprint 23 shipped early"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Details</Label>
        <Textarea
          value={form.details}
          onChange={(e) => setForm((p) => ({ ...p, details: e.target.value }))}
          placeholder="Context, action items, notes..."
          rows={4}
        />
      </div>
      <Button onClick={handleCopy} disabled={!form.subject} className="w-full bg-orange-600 hover:bg-orange-700">
        <UserCircle className="w-4 h-4 mr-2" /> Copy Team Comm
      </Button>
    </TabsContent>
  );
}

// ── Community Tab — story holders, shapes, blocks for quick assembly ──
function CommunityTab() {
  const [blocks, setBlocks] = useState<{ id: string; type: string; title: string; content: string }[]>([]);
  const [newBlock, setNewBlock] = useState({ type: 'story_shape', title: '', content: '' });
  const [showAdd, setShowAdd] = useState(false);

  const BLOCK_TYPES = [
    { id: 'story_shape', label: 'Story Shape', description: 'Narrative arc for meetup talks or posts' },
    { id: 'content_block', label: 'Content Block', description: 'Reusable paragraph, stat, or quote' },
    { id: 'meetup_template', label: 'Meetup Template', description: 'Event description, agenda, follow-up' },
    { id: 'community_pattern', label: 'Community Pattern', description: 'Engagement pattern — icebreaker, showcase, Q&A' },
    { id: 'aws_accreditation', label: 'AWS Accreditation', description: 'Certification post, badge announcement, APN content' },
  ];

  const handleAdd = () => {
    if (!newBlock.title || !newBlock.content) {
      toast.error('Title and content required');
      return;
    }
    setBlocks((prev) => [
      ...prev,
      { id: `block-${Date.now()}`, ...newBlock },
    ]);
    setNewBlock({ type: 'story_shape', title: '', content: '' });
    setShowAdd(false);
    toast.success('Block added');
  };

  const handleCopyAll = () => {
    if (blocks.length === 0) {
      toast.error('No blocks to copy');
      return;
    }
    const text = blocks
      .map((b) => `[${b.type.replace(/_/g, ' ').toUpperCase()}] ${b.title}\n${b.content}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
    toast.success('All blocks copied');
  };

  return (
    <TabsContent value="community" className="space-y-4 mt-4">
      <p className="text-xs text-muted-foreground">
        Story holders, shapes, and content blocks for quick community content assembly. Build reusable pieces for meetups, posts, and presentations.
      </p>

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Blocks ({blocks.length})</span>
        <div className="flex gap-2">
          {blocks.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleCopyAll}>
              <Copy className="w-3 h-3 mr-1" /> Copy All
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)}>
            <Blocks className="w-3 h-3 mr-1" /> Add Block
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card className="shadow-none border-purple-200">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Block Type</Label>
              <Select value={newBlock.type} onValueChange={(v) => setNewBlock((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BLOCK_TYPES.map((bt) => (
                    <SelectItem key={bt.id} value={bt.id}>{bt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {BLOCK_TYPES.find((bt) => bt.id === newBlock.type)?.description}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                value={newBlock.title}
                onChange={(e) => setNewBlock((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g., The 3-Act Meetup Talk"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Content</Label>
              <Textarea
                value={newBlock.content}
                onChange={(e) => setNewBlock((p) => ({ ...p, content: e.target.value }))}
                placeholder="The reusable content block..."
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>Save Block</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {blocks.length === 0 && !showAdd ? (
        <div className="text-center py-8 text-muted-foreground">
          <Blocks className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No blocks yet. Add story shapes, content blocks, and templates for quick assembly.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((block) => (
            <div key={block.id} className="p-3 rounded-lg border bg-white">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{block.type.replace(/_/g, ' ')}</Badge>
                  <span className="text-sm font-semibold">{block.title}</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`[${block.type}] ${block.title}\n${block.content}`);
                      toast.success('Copied');
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                    className="text-red-400"
                  >
                    ×
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">{block.content}</p>
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  );
}
