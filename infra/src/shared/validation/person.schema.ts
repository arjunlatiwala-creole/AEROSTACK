import { z } from "zod";

export const VelocityScoreSchema = z.object({
  current: z.number(),
  trend: z.string(),
  lastUpdated: z.string(),
});

export const PersonSchema = z.object({
  personId: z.string(),
  email: z.email(),
  name: z.string().min(1),
  userId: z.string().optional(),
  isVerified: z.boolean().default(false),
  role: z.string().optional(),
  velocityScore: VelocityScoreSchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export type Person = z.infer<typeof PersonSchema>;
