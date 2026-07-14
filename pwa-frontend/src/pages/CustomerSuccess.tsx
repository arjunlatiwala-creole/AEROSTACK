import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import "@cloudscape-design/global-styles/index.css";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Badge from "@cloudscape-design/components/badge";
import Alert from "@cloudscape-design/components/alert";
import { csApi, centsToUsd, type CsAccount, type SupportTicket } from "@/lib/modules-api";

const priorityColor = (p: string) => (p === "P0" ? "red" : p === "P1" ? "red" : p === "P2" ? "blue" : "grey");
const statusType = (s: string) =>
  s === "resolved" || s === "closed" ? "success" : s === "waiting" ? "pending" : s === "in_progress" ? "in-progress" : "info";
const healthType = (h: string) =>
  h === "GREEN" ? "success" : h === "RED" ? "error" : h === "ORANGE" ? "warning" : "in-progress";

function NewTicket({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState({ label: "P2", value: "P2" });
  const create = useMutation({
    mutationFn: () => csApi.createTicket({ subject, priority: priority.value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs", "tickets"] });
      onClose();
    },
  });
  return (
    <Modal
      visible
      onDismiss={onClose}
      header="Open a support ticket"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} disabled={!subject} onClick={() => create.mutate()}>
              Create
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {create.isError && <Alert type="error">{String((create.error as Error)?.message)}</Alert>}
        <FormField label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.detail.value)} placeholder="Short summary" />
        </FormField>
        <FormField label="Priority">
          <Select
            selectedOption={priority}
            onChange={(e) => setPriority(e.detail.selectedOption as any)}
            options={[
              { label: "P0", value: "P0" },
              { label: "P1", value: "P1" },
              { label: "P2", value: "P2" },
              { label: "P3", value: "P3" },
            ]}
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}

export default function CustomerSuccess() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const tickets = useQuery({ queryKey: ["cs", "tickets"], queryFn: () => csApi.tickets() });
  const accounts = useQuery({ queryKey: ["cs", "accounts"], queryFn: () => csApi.accounts() });
  const seed = useMutation({
    mutationFn: () => csApi.seedAccounts(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cs", "accounts"] }),
  });
  const renewals = useQuery({ queryKey: ["cs", "renewals"], queryFn: () => csApi.renewals() });
  const escalations = useQuery({ queryKey: ["cs", "escalations"], queryFn: () => csApi.escalations() });
  const csat = useQuery({ queryKey: ["cs", "csat"], queryFn: () => csApi.csatTrends() });

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="Support ticketing, account health, and renewals — the managed-services value surface.">
          Customer Success
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Tabs
          tabs={[
            {
              id: "tickets",
              label: "Tickets",
              content: (
                <Table<SupportTicket>
                  variant="container"
                  loading={tickets.isLoading}
                  items={tickets.data?.tickets ?? []}
                  empty={<Box>No tickets yet</Box>}
                  header={
                    <Header
                      counter={`(${tickets.data?.count ?? 0})`}
                      actions={<Button variant="primary" iconName="add-plus" onClick={() => setShowNew(true)}>Open ticket</Button>}
                    >
                      Support queue
                    </Header>
                  }
                  columnDefinitions={[
                    { id: "subject", header: "Subject", cell: (t) => t.subject },
                    { id: "priority", header: "Priority", cell: (t) => <Badge color={priorityColor(t.priority)}>{t.priority}</Badge> },
                    { id: "status", header: "Status", cell: (t) => <StatusIndicator type={statusType(t.status) as any}>{t.status}</StatusIndicator> },
                    { id: "assignee", header: "Assignee", cell: (t) => t.assignee_email ?? "—" },
                    { id: "sla", header: "SLA", cell: (t) => t.sla_breached ? <StatusIndicator type="error">breached</StatusIndicator> : <StatusIndicator type="success">on track</StatusIndicator> },
                    { id: "created", header: "Created", cell: (t) => new Date(t.created_at).toLocaleString() },
                  ]}
                />
              ),
            },
            {
              id: "accounts",
              label: "Accounts",
              content: (
                <Table<CsAccount>
                  variant="container"
                  loading={accounts.isLoading}
                  items={accounts.data?.accounts ?? []}
                  empty={
                    <SpaceBetween size="s">
                      <Box>No accounts yet — seed from the HubSpot companies mirror.</Box>
                      <Button loading={seed.isPending} onClick={() => seed.mutate()}>Seed accounts</Button>
                    </SpaceBetween>
                  }
                  header={
                    <Header
                      counter={`(${accounts.data?.count ?? 0})`}
                      actions={<Button loading={seed.isPending} onClick={() => seed.mutate()}>Seed from HubSpot</Button>}
                    >
                      Account portfolio
                    </Header>
                  }
                  columnDefinitions={[
                    { id: "company", header: "Company", cell: (a) => a.company_name },
                    { id: "health", header: "Health", cell: (a) => <StatusIndicator type={healthType(a.health) as any}>{a.health}{a.health_score != null ? ` (${a.health_score})` : ""}</StatusIndicator> },
                    { id: "csm", header: "CSM", cell: (a) => a.csm_email ?? "—" },
                    { id: "segment", header: "Segment", cell: (a) => a.segment },
                    { id: "arr", header: "ARR", cell: (a) => centsToUsd(a.arr_cents) },
                  ]}
                />
              ),
            },
          ]}
        />
        <Container header={<Header variant="h3">Renewals · CSAT · Escalations</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Renewals</Box>
              <Box fontSize="display-l" fontWeight="bold">{renewals.data?.count ?? 0}</Box>
              <Box color="text-body-secondary" fontSize="body-s">
                {(renewals.data?.renewals ?? []).filter((r: any) => r.status === "at_risk").length} at risk
              </Box>
            </div>
            <div>
              <Box variant="awsui-key-label">CSAT (avg)</Box>
              <Box fontSize="display-l" fontWeight="bold">{csat.data?.avg_csat ?? "—"}</Box>
              <Box color="text-body-secondary" fontSize="body-s">{csat.data?.count ?? 0} responses</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Open escalations</Box>
              <Box fontSize="display-l" fontWeight="bold">
                {(escalations.data?.escalations ?? []).filter((e: any) => e.status === "open").length}
              </Box>
              <Box color="text-body-secondary" fontSize="body-s">{escalations.data?.count ?? 0} total</Box>
            </div>
          </ColumnLayout>
          <Box color="text-body-secondary" padding={{ top: "s" }}>
            Renewals/CSAT/escalations APIs are live (<code>/cs/renewals</code>, <code>/cs/csat/*</code>, <code>/cs/escalations</code>); full list/detail views land next. Cost/security/compliance provider surfaces (<code>/cs/cost|security|compliance</code>) are stubbed pending integrations.
          </Box>
        </Container>
      </SpaceBetween>
      {showNew && <NewTicket onClose={() => setShowNew(false)} />}
    </ContentLayout>
  );
}
