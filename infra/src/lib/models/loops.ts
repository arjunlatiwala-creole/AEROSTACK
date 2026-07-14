import type * as apigw from "aws-cdk-lib/aws-apigateway";
import { z } from "zod";
import {
    AdaptLoopBodySchema,
    CreateLoopInputSchema,
    DeleteLoopInputSchema,
    ScoreBodySchema,
    ScoreEffortBodySchema,
    ScoreOutcomeBodySchema,
    UpdateLoopInputSchema,
} from "../../shared/validation/loop.schema";

export interface ModelDef {
    name: string;
    schema: apigw.JsonSchema;
    example?: any;
}

function zodToApiGatewaySchema(zodSchema: z.ZodTypeAny): apigw.JsonSchema {
    const jsonSchema = z.toJSONSchema(zodSchema, {
        target: "openapi-3.0", // AWS API Gateway uses OpenAPI 3.0
    });
    return jsonSchema as apigw.JsonSchema;
}

export const loopsModels: Record<string, ModelDef> = {
    createLoop: {
        name: "CreateLoopRequest",
        schema: zodToApiGatewaySchema(CreateLoopInputSchema),
        example: {
            title: "Implement user authentication system",
            description: "Build secure authentication with OAuth 2.0 and JWT tokens",
            loop_type: "KEY_RESULT",
            category: "ENG",
            owner_email: "john.doe@company.com",
            target_completion_date: "2026-03-15",
            priority: 3,
            tags: ["security", "authentication", "backend"],
            // jira_key: "ENG-123",
        },
    },
    updateLoop: {
        name: "UpdateLoopRequest",
        schema: zodToApiGatewaySchema(UpdateLoopInputSchema),
        example: {
            loop_id: "loop_12345",
            title: "Implement user authentication system - Updated",
            description:
                "Build secure authentication with OAuth 2.0, JWT tokens, and MFA",
            phase: "FOCUS",
            status: "IN_PROGRESS",
            priority: 2,
            tags: ["security", "authentication", "backend", "mfa"],
        },
    },
    score: {
        name: "ScoreRequest",
        schema: zodToApiGatewaySchema(ScoreBodySchema),
        example: {
            effort_score: 4,
        },
    },
    scoreEffort: {
        name: "ScoreEffortRequest",
        schema: zodToApiGatewaySchema(ScoreEffortBodySchema),
        example: {
            effort_score: 4,
        },
    },
    scoreOutcome: {
        name: "ScoreOutcomeRequest",
        schema: zodToApiGatewaySchema(ScoreOutcomeBodySchema),
        example: {
            outcome_score: 5,
            contributors: [
                {
                    email: "jane.smith@company.com",
                    share: 0.4,
                },
                {
                    email: "bob.wilson@company.com",
                    share: 0.3,
                },
                {
                    email: "alice.jones@company.com",
                    share: 0.3,
                },
            ],
            lesson: {
                abstract:
                    "Implementing OAuth early in the project saved significant refactoring time. Starting with security-first architecture was crucial.",
                tags: ["security-first", "early-planning", "architecture"],
                reuse_notes:
                    "Consider this approach for all authentication projects. The modular design can be reused across microservices.",
            },
        },
    },
    adaptLoop: {
        name: "AdaptLoopRequest",
        schema: zodToApiGatewaySchema(AdaptLoopBodySchema),
        example: {
            why: "Additional security requirements discovered during security audit. Need to implement additional OAuth providers and MFA.",
            what: "Scope expanded to include Google and Microsoft OAuth providers plus SMS-based MFA",
            new_target_completion_date: "2026-04-30",
            create_follow_on: true,
            follow_on_title: "Implement biometric authentication",
            follow_on_priority: 4,
        },
    },
};