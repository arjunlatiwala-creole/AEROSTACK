/**
 * Magic-link tokens for the Aerostack-hosted signing page.
 *
 * The token is an HMAC-signed compact string of the form:
 *   <base64url(payload)>.<base64url(hmac-sha256(payload, secret))>
 *
 * It's intentionally NOT a JWT — we don't need claims interop and a tiny
 * custom format keeps URL length manageable inside email templates.
 *
 * The HMAC secret is reused from DOCUSIGN_CONNECT_HMAC_SECRET when set, or
 * falls back to a deterministic per-env value. In production prefer setting
 * SIGN_LINK_SECRET explicitly via Secrets Manager.
 */

import * as crypto from "node:crypto";

export interface SignLinkPayload {
  envelope_id: string;
  document_id: string;
  signer_email: string;
  recipient_id: string;
  /** ISO timestamp at which the link expires. */
  exp: string;
  /** Random nonce so identical payloads don't collide. */
  nonce: string;
}

const DEFAULT_TTL_DAYS = 14;

function getSecret(): string {
  return (
    process.env.SIGN_LINK_SECRET
    ?? process.env.DOCUSIGN_CONNECT_HMAC_SECRET
    ?? "aerostack-sign-link-fallback-secret-change-me"
  );
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function createSignLinkToken(
  payload: Omit<SignLinkPayload, "exp" | "nonce">,
  ttlDays = DEFAULT_TTL_DAYS,
): string {
  const expMs = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
  const full: SignLinkPayload = {
    ...payload,
    exp: new Date(expMs).toISOString(),
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = b64urlEncode(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifySignLinkToken(token: string): SignLinkPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Malformed sign-link token");
  const [body, sig] = parts;

  const expected = b64urlEncode(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  // Length-safe comparison
  if (sig.length !== expected.length) throw new Error("Invalid sign-link signature");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid sign-link signature");
  }

  const payload = JSON.parse(b64urlDecode(body).toString()) as SignLinkPayload;
  if (new Date(payload.exp).getTime() < Date.now()) {
    throw new Error("Sign-link has expired");
  }
  return payload;
}
