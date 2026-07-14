import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Mail,
  Target,
  Users,
  Copy,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/api/client';

interface TabConfig {
  label: string;
  columns: readonly string[];
  defaults: Record<string, string>;
}

const TABS: Record<string, TabConfig> = {
  opp: {
    label: 'Opp Control',
    columns: [
      'Aerostack Lifecycle', 'Opp Class', 'enterprise Owner', 'Customer Owner', 'Customer',
      'Opportunity Name', 'Est. Revenue', 'Target Close',
      'Verbal Contours Confirmed?', 'Funding Needed?', 'Funding Status',
      'Next Step', 'Next Step Owner', 'Next Step Date', 'Notes',
    ],
    defaults: {
      'Aerostack Lifecycle': 'Lead',
      'Opp Class': 'RevGen',
      'Verbal Contours Confirmed?': 'N',
      'Funding Needed?': 'N',
      'Funding Status': 'None',
    },
  },
  aws: {
    label: 'AWS Channel Control',
    columns: [
      'AWS Contact Name', 'Role Type', 'Segment / Coverage', 'Influence Type',
      'Relationship Health', 'Strength (1-5)', 'Opps Shared (30d)',
      'Opps Shared (YTD)', 'Last Opp Shared Date', 'Opp Quality (1-3)',
      'enterprise Relationship Owner', 'Last Interaction Date', 'Next Action',
      'Next Action Date', 'Escalation Path', 'Notes',
    ],
    defaults: {
      'Relationship Health': 'New / Unproven',
      'Strength (1-5)': '1',
      'Opps Shared (30d)': '0',
      'Opps Shared (YTD)': '0',
      'Opp Quality (1-3)': '',
      'enterprise Relationship Owner': 'Prathik',
    },
  },
} as const;

export default function EmailExtractorTools() {
  const [activeTab, setActiveTab] = useState<'opp' | 'aws'>('opp');
  const [emailText, setEmailText] = useState('');
  const [extracted, setExtracted] = useState<Record<string, string> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);

  const tab = TABS[activeTab];

  function handleTabChange(value: string) {
    setActiveTab(value as 'opp' | 'aws');
    setExtracted(null);
  }

  async function handleExtract() {
    if (!emailText.trim()) {
      toast.error('Paste an email first');
      return;
    }

    setIsLoading(true);
    setExtracted(null);

    try {
      const toolsApiUrl = import.meta.env.VITE_TOOLS_API_URL;
      const res = await apiClient.post(`${toolsApiUrl}/email-extract`, {
        action: 'extract',
        tab: activeTab,
        email_text: emailText,
      });

      const data = res.data;
      if (data.extracted) {
        setExtracted(data.extracted);
        toast.success('Fields extracted — review and copy');
      } else {
        toast.error(data.error ?? 'Extraction failed');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  function copyRow() {
    if (!extracted) return;
    const row = tab.columns.map((c) => extracted[c] ?? '').join('\t');
    navigator.clipboard.writeText(row).then(
      () => toast.success('Row copied — paste into Google Sheets'),
      () => toast.error('Copy failed — use the text field below'),
    );
  }

  function updateField(col: string, val: string) {
    setExtracted((prev) => (prev ? { ...prev, [col]: val } : prev));
    setEditingField(null);
  }

  const emptyCount = extracted
    ? tab.columns.filter((c) => !extracted[c]).length
    : 0;

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-orange-600" />
            <CardTitle>Email → Sheet Row</CardTitle>
          </div>
          <CardDescription>
            Paste an email thread. Extract a row for Opp Control or AWS Channel Control. Copy into Google Sheets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="opp" className="gap-2">
                <Target className="w-4 h-4" /> Opp Control
              </TabsTrigger>
              <TabsTrigger value="aws" className="gap-2">
                <Users className="w-4 h-4" /> AWS Channel Control
              </TabsTrigger>
            </TabsList>

            <TabsContent value="opp" className="space-y-4 mt-4">
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-sm text-amber-800">
                Extracts Opp Control Sheet fields from email text — lifecycle, customer, revenue, next steps. Creates a tab-separated row you paste directly into the sheet.
              </div>
              <EmailInput
                emailText={emailText}
                setEmailText={setEmailText}
                isLoading={isLoading}
                onExtract={handleExtract}
                tabLabel={tab.label}
              />
            </TabsContent>

            <TabsContent value="aws" className="space-y-4 mt-4">
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-800">
                Extracts AWS Channel Control fields — contact name, role type, relationship health, opp sharing metrics. Same paste-to-sheets workflow.
              </div>
              <EmailInput
                emailText={emailText}
                setEmailText={setEmailText}
                isLoading={isLoading}
                onExtract={handleExtract}
                tabLabel={tab.label}
              />
            </TabsContent>
          </Tabs>

          {extracted && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Extracted Row</h3>
                  {emptyCount > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {emptyCount} empty
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Click any value to edit</span>
                  <Button size="sm" onClick={copyRow} className="gap-1">
                    <Copy className="w-3.5 h-3.5" /> Copy Row
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                {tab.columns.map((col) => {
                  const val = extracted[col] ?? '';
                  const isEmpty = !val;
                  const isEditing = editingField === col;

                  return (
                    <div
                      key={col}
                      className={`grid grid-cols-[200px_1fr] rounded border ${
                        isEmpty ? 'border-red-200 bg-red-50/30' : 'border-border'
                      }`}
                    >
                      <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-r flex items-center gap-1">
                        {col}
                        {isEmpty && (
                          <AlertCircle className="w-3 h-3 text-red-400" />
                        )}
                      </div>
                      {isEditing ? (
                        <Input
                          autoFocus
                          defaultValue={val}
                          className="border-0 rounded-none shadow-none h-auto py-2 text-sm"
                          onBlur={(e) => updateField(col, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateField(col, (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') setEditingField(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`px-3 py-2 text-sm text-left w-full hover:bg-muted/50 transition-colors ${
                            isEmpty ? 'text-muted-foreground italic' : ''
                          }`}
                          onClick={() => setEditingField(col)}
                        >
                          {val || 'click to fill'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <Button onClick={copyRow} className="w-full gap-2">
                <Copy className="w-4 h-4" /> Copy Row → Paste into Google Sheets
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                In Google Sheets: click the first cell of an empty row → Ctrl+V / Cmd+V. Tab-separated values fill across columns.
              </p>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Manual copy fallback — select all text below:
                </Label>
                <Textarea
                  readOnly
                  value={tab.columns.map((c) => extracted[c] ?? '').join('\t')}
                  onFocus={(e) => e.target.select()}
                  className="font-mono text-xs h-12 resize-none"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmailInput({
  emailText,
  setEmailText,
  isLoading,
  onExtract,
  tabLabel,
}: {
  emailText: string;
  setEmailText: (v: string) => void;
  isLoading: boolean;
  onExtract: () => void;
  tabLabel: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-xs">Email Text</Label>
        <Textarea
          value={emailText}
          onChange={(e) => setEmailText(e.target.value)}
          placeholder="Paste email text here — subject, body, whatever you've got. Include names, companies, amounts, dates, next steps..."
          className="min-h-[160px] resize-y"
        />
      </div>
      <Button
        onClick={onExtract}
        disabled={isLoading || !emailText.trim()}
        className="w-full gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Extracting...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4" /> Extract → {tabLabel} Row
          </>
        )}
      </Button>
    </div>
  );
}
