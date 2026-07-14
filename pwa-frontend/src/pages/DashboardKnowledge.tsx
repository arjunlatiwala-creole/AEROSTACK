import React, { useState, useEffect } from "react";
import { knowledgeClient } from "../lib/knowledgeClient";
import type { KbDefinition, KbEntry, SearchResult } from "../lib/knowledgeClient";
import {
  BookOpen, Briefcase, Cpu, Globe, Database, Plus, Search,
  Trash2, Loader2, Tag, FileText, Brain, User, Lock, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import Loader from "@/components/Loader";
import { useAuth } from "@/context/auth/AuthContext";

const KB_ICONS: Record<string, React.ReactNode> = {
  briefcase: <Briefcase className="w-4 h-4" />,
  cpu: <Cpu className="w-4 h-4" />,
  book: <BookOpen className="w-4 h-4" />,
  globe: <Globe className="w-4 h-4" />,
  database: <Database className="w-4 h-4" />,
  user: <User className="w-4 h-4" />,
};

export default function DashboardKnowledge() {
  const auth = useAuth();
  const userId = auth?.user?.userId ?? "";

  const [kbs, setKbs] = useState<KbDefinition[]>([]);
  const [selectedKb, setSelectedKb] = useState<KbDefinition | null>(null);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [searching, setSearching] = useState(false);

  const [showNewKb, setShowNewKb] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDesc, setNewKbDesc] = useState("");
  const [newKbAccess, setNewKbAccess] = useState<"team" | "private">("team");

  const [entryTitle, setEntryTitle] = useState("");
  const [entryContent, setEntryContent] = useState("");
  const [entryType, setEntryType] = useState("note");
  const [entryTags, setEntryTags] = useState("");
  const [autoClassify, setAutoClassify] = useState(false);
  const [addingEntry, setAddingEntry] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("all");
  const [activeTab, setActiveTab] = useState("browse");

  useEffect(() => { loadKbs(); }, []);

  const loadKbs = async () => {
    try {
      setLoading(true);
      const list = await knowledgeClient.listKbs(userId);
      setKbs(list);
      if (list.length > 0 && !selectedKb) await selectKb(list[0]!);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load KBs";
      if (!msg.includes("Failed to fetch")) toast.error(msg);
    } finally { setLoading(false); }
  };

  const selectKb = async (kb: KbDefinition) => {
    setSelectedKb(kb);
    setLoadingEntries(true);
    try {
      const list = await knowledgeClient.listEntries(kb.kbId);
      setEntries(list);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load entries");
    } finally { setLoadingEntries(false); }
  };

  const createKb = async () => {
    if (!newKbName.trim()) return;
    try {
      setLoading(true);
      await knowledgeClient.createKb({ name: newKbName, description: newKbDesc, access: newKbAccess, userId });
      setShowNewKb(false);
      setNewKbName(""); setNewKbDesc("");
      await loadKbs();
      toast.success("Knowledge base created");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create KB");
    } finally { setLoading(false); }
  };

  const addEntry = async () => {
    if (!entryTitle.trim() || !entryContent.trim()) return;
    try {
      setAddingEntry(true);
      const tags = entryTags.split(",").map((t) => t.trim()).filter(Boolean);
      const result = await knowledgeClient.addEntry({
        kbId: autoClassify ? undefined : selectedKb?.kbId,
        title: entryTitle, content: entryContent,
        entryType, tags: tags.length > 0 ? tags : undefined,
        source: "manual", userId, autoClassify,
      });
      setShowAddEntry(false);
      setEntryTitle(""); setEntryContent(""); setEntryTags("");
      toast.success(`Added to ${result.kbId}`);
      await loadKbs();
      if (selectedKb) await selectKb(selectedKb);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add entry");
    } finally { setAddingEntry(false); }
  };

  const deleteEntry = async (kbId: string, entryId: string) => {
    try {
      await knowledgeClient.deleteEntry(kbId, entryId);
      toast.success("Entry deleted");
      if (selectedKb) await selectKb(selectedKb);
      await loadKbs();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      setSearching(true);
      const kbIds = searchScope === "all" ? undefined
        : searchScope === "personal" ? [`personal-${userId}`]
        : [searchScope];
      const result = await knowledgeClient.search({ query: searchQuery, kbIds, userId, limit: 15 });
      setSearchResults(result.results);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally { setSearching(false); }
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar — KB list */}
      <div className="w-72 border-r bg-card flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Knowledge Bases</h2>
          <Button variant="ghost" size="icon" onClick={() => setShowNewKb(true)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {loading && kbs.length === 0 ? (
            <div className="p-4"><Loader /></div>
          ) : (
            <div className="p-2 space-y-1">
              {kbs.map((kb) => (
                <button
                  key={kb.kbId}
                  onClick={() => selectKb(kb)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                    selectedKb?.kbId === kb.kbId
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {KB_ICONS[kb.icon] ?? <Database className="w-4 h-4" />}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{kb.name}</div>
                    <div className={`text-xs ${selectedKb?.kbId === kb.kbId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {kb.entryCount} entries · {kb.access}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="p-6 pl-4 border-b bg-card">
          <h1 className="text-2xl font-bold tracking-tight mb-1 flex gap-2 items-center">
            <Brain className="w-6 h-6" /> Knowledge Base
          </h1>
          <p className="text-muted-foreground">
            Manage organizational and personal knowledge — searchable by AI agents
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-4">
            <TabsList>
              <TabsTrigger value="browse">Browse</TabsTrigger>
              <TabsTrigger value="search">Search</TabsTrigger>
            </TabsList>
          </div>

          {/* Browse tab */}
          <TabsContent value="browse" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full p-6">
              {!selectedKb ? (
                <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
                  <Database className="w-12 h-12 text-muted-foreground" />
                  <h3 className="text-xl font-semibold">Select a knowledge base</h3>
                  <p className="text-muted-foreground max-w-md">Choose a KB from the sidebar or create a new one.</p>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-6 pb-12">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold flex items-center gap-2">
                        {KB_ICONS[selectedKb.icon] ?? <Database className="w-5 h-5" />}
                        {selectedKb.name}
                      </h2>
                      <p className="text-muted-foreground mt-1">{selectedKb.description}</p>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline">
                          {selectedKb.access === "private" ? <Lock className="w-3 h-3 mr-1" /> : <Users className="w-3 h-3 mr-1" />}
                          {selectedKb.access}
                        </Badge>
                        <Badge variant="secondary">{selectedKb.entryCount} entries</Badge>
                        <Badge variant="secondary">{selectedKb.category}</Badge>
                      </div>
                    </div>
                    <Button onClick={() => setShowAddEntry(true)}>
                      <Plus className="w-4 h-4 mr-2" /> Add Entry
                    </Button>
                  </div>

                  {loadingEntries ? (
                    <Loader />
                  ) : entries.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center text-muted-foreground">
                        <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
                        <p>No entries yet. Add knowledge to this base.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {entries.map((entry) => (
                        <Card key={entry.entryId} className="group">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <CardTitle className="text-base">{entry.title}</CardTitle>
                                <CardDescription className="mt-1">
                                  {entry.entryType} · {entry.source} · {new Date(entry.createdAt).toLocaleDateString()}
                                </CardDescription>
                              </div>
                              <Button variant="ghost" size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => deleteEntry(entry.kbId, entry.entryId)}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground line-clamp-3">{entry.content}</p>
                            {entry.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {entry.tags.map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-xs">
                                    <Tag className="w-3 h-3 mr-1" />{tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Search tab */}
          <TabsContent value="search" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full p-6">
              <div className="max-w-4xl mx-auto space-y-6 pb-12">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Search className="w-5 h-5" /> Semantic Search
                    </CardTitle>
                    <CardDescription>
                      Search across knowledge bases using natural language. AI agents use this same search.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="e.g., AWS Lambda cold start optimization patterns"
                        onKeyDown={(e) => e.key === "Enter" && runSearch()}
                        className="flex-1"
                      />
                      <Select value={searchScope} onValueChange={setSearchScope}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Scope" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All KBs</SelectItem>
                          <SelectItem value="personal">My Personal KB</SelectItem>
                          {kbs.filter((kb) => kb.category === "system").map((kb) => (
                            <SelectItem key={kb.kbId} value={kb.kbId}>{kb.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={runSearch} disabled={searching || !searchQuery.trim()}>
                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {searchResults.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{searchResults.length} results</p>
                    {searchResults.map((r) => (
                      <Card key={`${r.kbId}-${r.entryId}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">{r.title}</CardTitle>
                            <Badge variant="secondary">{Math.round(r.score * 100)}% match</Badge>
                          </div>
                          <CardDescription>{r.kbId} · {r.entryType} · {r.source}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{r.content}</p>
                          {r.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {r.tags.map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* New KB Dialog */}
      <Dialog open={showNewKb} onOpenChange={setShowNewKb}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Knowledge Base</DialogTitle>
            <DialogDescription>Add a new custom knowledge base for your team or personal use.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="kb-name">Name</Label>
              <Input id="kb-name" value={newKbName} onChange={(e) => setNewKbName(e.target.value)} placeholder="e.g., Client Playbooks" />
            </div>
            <div>
              <Label htmlFor="kb-desc">Description</Label>
              <Textarea id="kb-desc" value={newKbDesc} onChange={(e) => setNewKbDesc(e.target.value)} placeholder="What kind of knowledge goes here?" rows={3} />
            </div>
            <div>
              <Label>Access</Label>
              <Select value={newKbAccess} onValueChange={(v) => setNewKbAccess(v as "team" | "private")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Team — visible to all</SelectItem>
                  <SelectItem value="private">Private — only you</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewKb(false)}>Cancel</Button>
            <Button onClick={createKb} disabled={!newKbName.trim() || loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Entry Dialog */}
      <Dialog open={showAddEntry} onOpenChange={setShowAddEntry}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Knowledge Entry</DialogTitle>
            <DialogDescription>
              {autoClassify
                ? "AI will classify this into the best matching KB."
                : `Adding to: ${selectedKb?.name ?? "—"}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="entry-title">Title</Label>
              <Input id="entry-title" value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="e.g., AWS Lambda best practices" />
            </div>
            <div>
              <Label htmlFor="entry-content">Content</Label>
              <Textarea id="entry-content" value={entryContent} onChange={(e) => setEntryContent(e.target.value)} placeholder="Paste or type knowledge content..." rows={6} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={entryType} onValueChange={setEntryType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="doc">Document</SelectItem>
                    <SelectItem value="snippet">Snippet</SelectItem>
                    <SelectItem value="reference">Reference</SelectItem>
                    <SelectItem value="process">Process</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="entry-tags">Tags (comma-separated)</Label>
                <Input id="entry-tags" value={entryTags} onChange={(e) => setEntryTags(e.target.value)} placeholder="aws, lambda, best-practices" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="auto-classify" checked={autoClassify} onCheckedChange={setAutoClassify} />
              <Label htmlFor="auto-classify">Auto-classify into best KB</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEntry(false)}>Cancel</Button>
            <Button onClick={addEntry} disabled={!entryTitle.trim() || !entryContent.trim() || addingEntry}>
              {addingEntry ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
