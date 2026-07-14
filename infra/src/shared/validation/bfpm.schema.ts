import { z } from "zod";

export const SessionTypeEnum = z.enum([
  "strategic",
  "tactical",
  "operational",
]);

export const SessionStatusEnum = z.enum([
  "beacon",
  "focus",
  "perspex",
  "move",
  "completed",
]);

export const SupportLevelEnum = z.enum([
  "low",
  "medium",
  "high",
]);

export const PerspexLevelEnum = z.enum([
  "individual",
  "systemic",
  "strategic",
]);

export const BfpmSessionSchema = z.object({
  sessionId: z.string(),
  title: z.string().min(1),
  sessionType: SessionTypeEnum,
  status: SessionStatusEnum,
  participants: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export type BfpmSession = z.infer<typeof BfpmSessionSchema>;

export const BeaconSessionSchema = z.object({
  beaconId: z.string(),
  sessionId: z.string(),
  statement: z.string().min(1),
  tags: z.array(z.string()),
  timeframe: z.string(),
  confidence: z.number().min(0).max(1),
  contextVector: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type BeaconSession = z.infer<typeof BeaconSessionSchema>;

export const FocusSessionSchema = z.object({
  focusId: z.string(),
  sessionId: z.string(),
  beaconId: z.string().optional(),
  challengeText: z.string().min(1),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export type FocusSession = z.infer<typeof FocusSessionSchema>;

export const PerspexInputSchema = z.object({
  inputId: z.string(),
  sessionId: z.string(),
  participantId: z.string(),
  top3: z.array(z.string()).length(3),
  risk: z.string().min(1),
  level: PerspexLevelEnum.optional(),
  createdAt: z.iso.datetime(),
});

export type PerspexInput = z.infer<typeof PerspexInputSchema>;

export const PerspexSummarySchema = z.object({
  summaryId: z.string(),
  sessionId: z.string(),
  focusId: z.string().optional(),
  beaconId: z.string().optional(),
  commonGround: z.array(z.string()),
  tensions: z.array(z.string()),
  mergedChallenge: z.string(),
  generalizedRisks: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export type PerspexSummary = z.infer<typeof PerspexSummarySchema>;

export const ActionPlanSchema = z.object({
  planId: z.string(),
  sessionId: z.string(),
  summaryId: z.string().optional(),
  objectives: z.array(z.string()).min(1),
  owners: z.array(z.string()),
  timeframe: z.string(),
  supportLevel: SupportLevelEnum,
  linkedBeacon: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export const SessionDataSchema = z.object({
  sessionId: z.string(),
  beacon: BeaconSessionSchema.optional(),
  focus: FocusSessionSchema.optional(),
  perspexInputs: z.array(PerspexInputSchema),
  perspexSummary: PerspexSummarySchema.optional(),
  actionPlan: ActionPlanSchema.optional(),
});

export type SessionData = z.infer<typeof SessionDataSchema>;
