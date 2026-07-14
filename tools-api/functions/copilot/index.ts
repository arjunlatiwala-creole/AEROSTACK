import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  CopilotRuntime,
  BedrockAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import serverless from "serverless-http";

const MODEL_ID =
  process.env.COPILOT_MODEL_ID ??
  "us.anthropic.claude-sonnet-4-20250514-v1:0";
const REGION = process.env.AWS_REGION ?? "us-east-1";

const serviceAdapter = new BedrockAdapter({
  model: MODEL_ID,
  region: REGION,
});

const runtime = new CopilotRuntime();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const copilotHandler = copilotRuntimeNodeHttpEndpoint({
  endpoint: "/",
  runtime,
  serviceAdapter,
});

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    });
    res.end(
      JSON.stringify({
        message: "Aerostack Copilot Runtime",
        status: "ok",
        model: MODEL_ID,
        region: REGION,
        runtime: "copilotkit",
      }),
    );
    return;
  }

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  copilotHandler(req, res);
});

// serverless-http types expect express Application but work fine with http.Server
export const handler = serverless(server as unknown as Parameters<typeof serverless>[0]);
