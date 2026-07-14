import type { APIGatewayProxyResult } from "aws-lambda";

export function ok(data: any, code = 200): APIGatewayProxyResult {
  return {
    statusCode: code,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify({ success: true, data }),
  };
}

export function err(message: string, code = 500): APIGatewayProxyResult {
  return {
    statusCode: code,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify({
      success: false,
      error: message || "An internal error occurred. Please try again later.",
    }),
  };
}
