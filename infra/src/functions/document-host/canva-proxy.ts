import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

/**
 * Server-side Canva proxy. Replicates what the Vite dev-server proxy did so the
 * feature works in deployed environments (S3/CloudFront has no proxy layer).
 *
 * Two operations:
 *   GET /documents/canva/resolve?code=<shortCode>
 *     Follows a canva.link short URL and returns the redirect Location.
 *   GET /documents/canva/proxy?path=/design/<id>/<token>/view?mode=preview
 *     Fetches the Canva design page with a Googlebot UA (bypasses Cloudflare)
 *     and returns the raw HTML.
 */

// Googlebot UA lets us through Canva's Cloudflare bot challenge, same as the
// old Vite proxy header.
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/**
 * GET /documents/canva/resolve?code=<shortCode>
 * Returns { location } — the URL that canva.link/<code> redirects to.
 */
const _resolveHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const code = event.queryStringParameters?.code;
    if (!code) {
      return err("code query parameter is required", 400);
    }

    // Short codes are alphanumeric; reject anything else to avoid SSRF.
    if (!/^[A-Za-z0-9_-]+$/.test(code)) {
      return err("Invalid canva.link code", 400);
    }

    const res = await fetch(`https://canva.link/${code}`, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": GOOGLEBOT_UA },
    });

    // undici returns the real 3xx response under redirect:"manual"
    const location = res.headers.get("location");
    if (!location) {
      console.warn(`[CANVA-PROXY] No redirect Location for code=${code}, status=${res.status}`);
      return err("canva.link did not redirect", 502);
    }

    return ok({ location });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CANVA-PROXY] resolve error:", error);
    return err(message, 500);
  }
};

/**
 * GET /documents/canva/proxy?path=/design/<id>/<token>/view?mode=preview
 * Returns { html } — the raw HTML of the Canva design page.
 */
const _proxyHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const path = event.queryStringParameters?.path;
    if (!path) {
      return err("path query parameter is required", 400);
    }

    // Only allow Canva design view paths — prevents using us as an open proxy.
    if (!path.startsWith("/design/")) {
      return err("Only /design/ paths are allowed", 400);
    }

    const res = await fetch(`https://www.canva.com${path}`, {
      method: "GET",
      headers: { "User-Agent": GOOGLEBOT_UA },
    });

    if (!res.ok) {
      console.warn(`[CANVA-PROXY] Canva returned ${res.status} for path=${path}`);
      return err(`Canva returned ${res.status}`, 502);
    }

    const html = await res.text();
    return ok({ html });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CANVA-PROXY] proxy error:", error);
    return err(message, 500);
  }
};

export const resolveHandler = withPermissions(_resolveHandler);
export const proxyHandler = withPermissions(_proxyHandler);
