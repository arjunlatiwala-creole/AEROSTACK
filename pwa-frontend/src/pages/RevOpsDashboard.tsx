import { useQuery } from "@tanstack/react-query";
import "@cloudscape-design/global-styles/index.css";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Spinner from "@cloudscape-design/components/spinner";
import Alert from "@cloudscape-design/components/alert";
import Badge from "@cloudscape-design/components/badge";
import {
  centsToUsd,
  fetchRevOpsSummary,
  revopsApi,
  type RepRow,
  type ForecastEntry,
  type RevOpsAlert,
  type CadenceOverlay,
} from "@/lib/modules-api";

// Will's intent (call 2026-06-29): the dashboard is the operating surface for the
// weekly RevOps meeting. Five sections — Customer Defects & Risks (CoE) up front,
// then Collections, Opportunities, Transitions, SalesOps Mechanisms. The data must
// be a source of clarity, at-a-glance, so we don't get dragged into individual deals.
// See docs/inputs/revops-productivity-feedback-2026-06-29.md.

const AGING_DAYS = 14; // anything not touched in >14 days flags (Will's rule)

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <Box fontSize="display-l" fontWeight="bold">{value}</Box>
      {sub && <Box color="text-body-secondary" fontSize="body-s">{sub}</Box>}
    </div>
  );
}

const healthColor = (h: string) =>
  h === "GREEN" ? "success" : h === "RED" ? "error" : h === "ORANGE" ? "warning" : "in-progress";

const ALERT_LABEL: Record<string, string> = {
  stalled_deal: "Stalled deal",
  coverage_shortfall: "Coverage shortfall",
};

export default function RevOpsDashboard() {
  const summary = useQuery({ queryKey: ["revops", "summary"], queryFn: fetchRevOpsSummary });
  const reps = useQuery({ queryKey: ["revops", "reps"], queryFn: () => revopsApi.reps() });
  const forecast = useQuery({ queryKey: ["revops", "forecast"], queryFn: () => revopsApi.forecast() });
  const alerts = useQuery({ queryKey: ["revops", "alerts"], queryFn: () => revopsApi.alerts() });
  const cadence = useQuery({ queryKey: ["revops", "cadence"], queryFn: () => revopsApi.cadence() });

  const s = summary.data;
  const alertItems = alerts.data?.alerts ?? [];
  const opps = forecast.data?.forecast ?? [];
  const agingOpps = opps.filter((o) => o.stalled || o.days_in_stage > AGING_DAYS);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="The operating dashboard for the weekly RevOps meeting — clarity at a glance, not individual-deal firefighting."
        >
          RevOps Productivity
        </Header>
      }
    >
      <SpaceBetween size="l">
        {summary.isError && (
          <Alert type="error" header="Could not load summary">
            {String((summary.error as Error)?.message)}
          </Alert>
        )}

        {/* ---------- 1. Customer Defects & Risks (CoE) — right up front ---------- */}
        <Container
          header={
            <Header
              variant="h2"
              counter={`(${alertItems.length})`}
              description="Exceptions and anything scored bad — from the sections below or anywhere in the business."
            >
              Customer Defects &amp; Risks (CoE)
            </Header>
          }
        >
          {alerts.isLoading ? (
            <Spinner />
          ) : alertItems.length === 0 ? (
            <StatusIndicator type="success">No exceptions flagged right now.</StatusIndicator>
          ) : (
            <Table<RevOpsAlert>
              variant="borderless"
              items={alertItems}
              columnDefinitions={[
                { id: "type", header: "Exception", cell: (a) => <Badge color="red">{ALERT_LABEL[a.type] ?? a.type}</Badge> },
                { id: "deal", header: "Deal", cell: (a) => a.deal_id ?? "—" },
                { id: "rep", header: "Owner", cell: (a) => a.rep_email ?? "—" },
                { id: "days", header: "Days in stage", cell: (a) => a.days_in_stage ?? "—" },
                { id: "amt", header: "Amount", cell: (a) => (a.amount_cents != null ? centsToUsd(a.amount_cents) : "—") },
                { id: "cov", header: "Coverage", cell: (a) => (a.coverage_ratio != null ? `${a.coverage_ratio}x` : "—") },
              ]}
            />
          )}
        </Container>

        {/* ---------- At-a-glance KPIs ---------- */}
        <Container header={<Header variant="h2">Pipeline at a glance</Header>}>
          {summary.isLoading ? (
            <Spinner size="large" />
          ) : s ? (
            <ColumnLayout columns={4} variant="text-grid">
              <Kpi label="Total pipeline" value={centsToUsd(s.total_pipeline_value_cents)} sub={`${s.total_active_deals} active deals`} />
              <Kpi label="Win rate" value={`${s.win_rate_pct}%`} sub="closed-won / closed" />
              <Kpi label="Coverage" value={`${s.pipeline_coverage_ratio}x`} sub="open / target" />
              <Kpi label="As of" value={new Date(s.as_of).toLocaleDateString()} sub={s.tenant_id} />
            </ColumnLayout>
          ) : null}
        </Container>

        <Tabs
          tabs={[
            /* ---------- 2. Collections ---------- */
            {
              id: "collections",
              label: "Collections",
              content: (
                <SpaceBetween size="m">
                  <Alert type="info" header="Billing feed integration pending (not blocked on Creole)">
                    Invoice aging/health across customer, partner, and AWS FR billing reads from the
                    HubSpot→QuickBooks billing feed, which is being wired as a task-based hookup. Until
                    it lands, contract value below is sourced from the deal mirror; Billed/Paid show as
                    pending. Full revenue recognition stays in the QuickBooks RevRec module (backlog),
                    not this screen.
                  </Alert>
                  {s && (
                    <Container header={<Header variant="h2">Contract value vs realized</Header>}>
                      <ColumnLayout columns={3} variant="text-grid">
                        <Kpi label="Total contract value (pipeline)" value={centsToUsd(s.total_pipeline_value_cents)} sub="from deal mirror" />
                        <Kpi label="Billed" value="—" sub="pending billing feed" />
                        <Kpi label="Paid" value="—" sub="pending billing feed" />
                      </ColumnLayout>
                    </Container>
                  )}
                  <Table<ForecastEntry>
                    variant="container"
                    loading={forecast.isLoading}
                    items={opps}
                    empty={<Box>No open contracts</Box>}
                    header={<Header counter={`(${opps.length})`} description="Aging by time-in-stage; >14 days flags. Billed/Paid arrive with the billing feed.">Invoice aging (by contract)</Header>}
                    columnDefinitions={[
                      { id: "deal", header: "Contract / deal", cell: (f) => f.deal_id },
                      { id: "owner", header: "Owner", cell: (f) => f.rep_email ?? "—" },
                      { id: "tcv", header: "Contract value", cell: (f) => centsToUsd(f.amount_cents) },
                      { id: "billed", header: "Billed", cell: () => "—" },
                      { id: "paid", header: "Paid", cell: () => "—" },
                      { id: "aging", header: "Aging", cell: (f) => agingIndicator(f.days_in_stage, f.stalled) },
                    ]}
                  />
                </SpaceBetween>
              ),
            },
            /* ---------- 3. Transitions ---------- */
            {
              id: "transitions",
              label: "Transitions",
              content: (
                <SpaceBetween size="m">
                  <Alert type="info" header="Lifecycle: conversion → contract → handoff/onboarding → post-close (60–100%) → managed/offboarding">
                    Conversion funnel is from the deal mirror; the cadence board overlays where each
                    active loop sits in its transition (in-flight, handoff, managed, blocked, at-risk).
                  </Alert>
                  {s && (
                    <Container header={<Header variant="h2">Conversion funnel</Header>}>
                      <ColumnLayout columns={Math.max(2, Object.keys(s.deals_by_phase).length)} variant="text-grid">
                        {Object.entries(s.deals_by_phase).map(([phase, n]) => (
                          <Kpi key={phase} label={phase} value={String(n)} />
                        ))}
                      </ColumnLayout>
                    </Container>
                  )}
                  <Container
                    header={<Header variant="h2" counter={`(${cadence.data?.overlay_count ?? 0})`}>Transition board (cadence)</Header>}
                  >
                    {cadence.isLoading ? (
                      <Spinner />
                    ) : (cadence.data?.overlay_count ?? 0) === 0 ? (
                      <StatusIndicator type="info">
                        No loop transition overlays set yet — set cadence_state on loops to populate this board.
                      </StatusIndicator>
                    ) : (
                      <ColumnLayout columns={4}>
                        {["1", "2", "3", "4"].map((b) => (
                          <Container key={b} header={<Header variant="h3">Block {b}</Header>}>
                            <SpaceBetween size="xs">
                              {(cadence.data?.blocks?.[b] ?? []).map((o: CadenceOverlay) => (
                                <Box key={o.loop_id}>
                                  <Badge color="blue">{o.cadence_state}</Badge> {o.loop_id}
                                </Box>
                              ))}
                              {(cadence.data?.blocks?.[b] ?? []).length === 0 && <Box color="text-body-secondary">—</Box>}
                            </SpaceBetween>
                          </Container>
                        ))}
                      </ColumnLayout>
                    )}
                  </Container>
                </SpaceBetween>
              ),
            },
            /* ---------- 4. Opportunities ---------- */
            {
              id: "opportunities",
              label: `Opportunities`,
              content: (
                <SpaceBetween size="m">
                  {s && (
                    <Container header={<Header variant="h2">By phase &amp; health</Header>}>
                      <ColumnLayout columns={2}>
                        <SpaceBetween size="xs">
                          {Object.entries(s.deals_by_phase).map(([phase, n]) => (
                            <Box key={phase}><Badge>{n as number}</Badge> {phase}</Box>
                          ))}
                        </SpaceBetween>
                        <SpaceBetween size="xs">
                          {Object.entries(s.health_distribution).map(([h, n]) => (
                            <Box key={h}>
                              <StatusIndicator type={healthColor(h) as any}>{h}: {n as number}</StatusIndicator>
                            </Box>
                          ))}
                        </SpaceBetween>
                      </ColumnLayout>
                    </Container>
                  )}
                  <Table<ForecastEntry>
                    variant="container"
                    loading={forecast.isLoading}
                    items={agingOpps.length ? agingOpps : opps}
                    empty={<Box>No open opportunities</Box>}
                    header={
                      <Header
                        counter={`(${agingOpps.length} flagged / ${opps.length})`}
                        description="HubSpot staging, aging and blockers at a glance — flagged opps first, so we stay out of individual-deal detail."
                      >
                        Opportunities needing attention
                      </Header>
                    }
                    columnDefinitions={[
                      { id: "deal", header: "Deal", cell: (f) => f.deal_id },
                      { id: "rep", header: "Owner", cell: (f) => f.rep_email ?? "—" },
                      { id: "cat", header: "Forecast", cell: (f) => <Badge color={f.category === "commit" ? "green" : f.category === "best_case" ? "blue" : "grey"}>{f.category}</Badge> },
                      { id: "amt", header: "Amount", cell: (f) => centsToUsd(f.amount_cents) },
                      { id: "days", header: "Days in stage", cell: (f) => f.days_in_stage },
                      { id: "aging", header: "Status", cell: (f) => agingIndicator(f.days_in_stage, f.stalled) },
                    ]}
                  />
                </SpaceBetween>
              ),
            },
            /* ---------- 5. SalesOps Mechanisms & Process Improvement ---------- */
            {
              id: "salesops",
              label: "SalesOps Mechanisms",
              content: (
                <SpaceBetween size="m">
                  <Table<RepRow>
                    variant="container"
                    loading={reps.isLoading}
                    items={reps.data?.reps ?? []}
                    empty={<Box>No rep data</Box>}
                    header={<Header counter={`(${reps.data?.count ?? 0})`} description="Measured on MBO outcome targets + OKRs — no sales quotas.">Rep performance (MBO / OKR)</Header>}
                    columnDefinitions={[
                      { id: "rep", header: "Rep", cell: (r) => r.rep_email },
                      { id: "open", header: "Open pipeline", cell: (r) => centsToUsd(r.open_pipeline_cents) },
                      { id: "won", header: "Closed won", cell: (r) => centsToUsd(r.closed_won_cents) },
                      { id: "win", header: "Win rate", cell: (r) => `${r.win_rate_pct}%` },
                      { id: "cycle", header: "Avg cycle (days)", cell: (r) => r.avg_sales_cycle_days },
                    ]}
                  />
                  <Container header={<Header variant="h2">Process improvements (from cadence)</Header>}>
                    <SpaceBetween size="xs">
                      <Box><StatusIndicator type="success">Ownerless / PC3 deals route to a generic owner + automated digital-campaign pipeline — not a person's manual job.</StatusIndicator></Box>
                      <Box><StatusIndicator type="success">Deals untouched &gt;14 days flag automatically — every deal is process-owned or named-owner-owned, no orphans.</StatusIndicator></Box>
                      <Box><StatusIndicator type="info">Expectation-setting: surface "first invoice issued" so collections don't sit squishy for days.</StatusIndicator></Box>
                      <Box><StatusIndicator type="info">RevRec reconciliation = QuickBooks RevRec module (build-vs-buy → buy), tracked as backlog — not this screen.</StatusIndicator></Box>
                    </SpaceBetween>
                  </Container>
                </SpaceBetween>
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

function agingIndicator(daysInStage: number, stalled: boolean) {
  if (stalled) return <StatusIndicator type="error">stalled</StatusIndicator>;
  if (daysInStage > AGING_DAYS) return <StatusIndicator type="warning">aging ({daysInStage}d)</StatusIndicator>;
  return <StatusIndicator type="success">ok</StatusIndicator>;
}
