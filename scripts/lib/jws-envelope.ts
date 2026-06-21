/**
 * Reference helpers for the CDX detached-JWS signature envelope (Security
 * Extension §3.3). A CDX signature is a flattened JWS (RFC 7515) JSON
 * Serialization with an **unencoded, detached** payload (RFC 7797, `b64:false`):
 * the signed payload is `JCS(scope)` — the same canonical bytes the document-ID
 * and manifest-projection machinery already produce — while the readable `scope`
 * object is carried as a sibling member and is NOT part of the JOSE object.
 *
 * This is a JWS profiled toward JAdES (ETSI TS 119 182-1): the signed protected
 * header binds `alg`, `x5c`, `x5t#S256` and `sigT`. It deliberately does NOT
 * claim a JAdES baseline conformance level (B-B/B-T/B-LT/B-LTA): it omits `sigD`
 * (the detached payload is reconstructed as `JCS(scope)` per §3.3, not via a
 * JAdES `sigD` descriptor) and the long-term-validation properties land later.
 *
 * 3.2a-i (this increment) defines the ENVELOPE only — the construction of the
 * signed bytes and the header shape. It establishes NO trust semantics: a
 * verifier MUST NOT report a signature `valid` until the trust core is specified.
 * This module accordingly does not validate certificate chains, trust anchors,
 * revocation, or the cryptographic signature itself.
 *
 * Critical discipline (opposite of the repo's JCS-recompute rule): the JWS
 * protected header is signed as its EXACT stored bytes — JOSE does not
 * canonicalize it. The stored `protected` base64url string is authoritative; it
 * must never be decoded-and-re-encoded to derive the signed bytes. (The detached
 * payload, by contrast, IS recomputed as `JCS(scope)`.) `encodeProtectedHeader`
 * exists only to *produce* a header deterministically; verification consumes the
 * stored string via `jwsSigningInput`.
 */

import { jcsOf } from './canonicalize.js';

/** Thrown for a malformed JWS envelope or protected header. */
export class JwsEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwsEnvelopeError';
  }
}

/** Signature algorithms (mirrors security.schema.json `signatureAlgorithm`). */
export const SUPPORTED_ALGS: ReadonlySet<string> = new Set([
  'ES256',
  'ES384',
  'EdDSA',
  'PS256',
  'ML-DSA-65',
]);

// ---------------------------------------------------------------------------
// base64url (RFC 7515 §2 — no padding)
// ---------------------------------------------------------------------------

export function base64url(bytes: Buffer | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  return buf.toString('base64url');
}

export function base64urlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new JwsEnvelopeError(`value is not base64url: ${JSON.stringify(value)}`);
  }
  return Buffer.from(value, 'base64url');
}

// ---------------------------------------------------------------------------
// Protected header
// ---------------------------------------------------------------------------

/**
 * Deterministically encode a protected header to its base64url string. The
 * reference encoding serializes with RFC 8785 (JCS) so the bytes are stable
 * across producers; once produced, the *string* is authoritative (a verifier
 * uses the stored value, never a re-encoding — see module header).
 */
export function encodeProtectedHeader(header: Record<string, unknown>): string {
  return base64url(jcsOf(header));
}

/** Decode a stored protected header string to its JSON object. */
export function decodeProtectedHeader(protectedB64url: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(protectedB64url).toString('utf8'));
  } catch (err) {
    throw new JwsEnvelopeError(`protected header is not valid base64url JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JwsEnvelopeError('protected header is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Validate the SHAPE of a decoded protected header against the JAdES-inspired
 * profile (§3.3). This checks structure only — it establishes no trust and does
 * not parse `x5c` as a real certificate (that is the trust core's job).
 */
export function validateProtectedHeader(header: Record<string, unknown>): void {
  const alg = header.alg;
  if (typeof alg !== 'string' || !SUPPORTED_ALGS.has(alg)) {
    throw new JwsEnvelopeError(`protected header "alg" must be one of: ${[...SUPPORTED_ALGS].join(', ')}`);
  }
  // Unencoded detached payload (RFC 7797): b64 MUST be false and MUST be the
  // sole `crit` member. A registered JOSE/JAdES param (e.g. sigT) MUST NOT be in
  // crit (RFC 7515 §4.1.11).
  if (header.b64 !== false) {
    throw new JwsEnvelopeError('protected header "b64" must be false (unencoded detached payload)');
  }
  if (!Array.isArray(header.crit) || header.crit.length !== 1 || header.crit[0] !== 'b64') {
    throw new JwsEnvelopeError('protected header "crit" must be exactly ["b64"]');
  }
  // Signing certificate chain (base64 DER, leaf-first) + its JAdES thumbprint.
  if (!Array.isArray(header.x5c) || header.x5c.length === 0 || !header.x5c.every((c) => typeof c === 'string' && c.length > 0)) {
    throw new JwsEnvelopeError('protected header "x5c" must be a non-empty array of base64 DER certificate strings');
  }
  if (typeof header['x5t#S256'] !== 'string' || header['x5t#S256'].length === 0) {
    throw new JwsEnvelopeError('protected header "x5t#S256" (signing-certificate thumbprint) must be present');
  }
  if (typeof header.sigT !== 'string' || header.sigT.length === 0) {
    throw new JwsEnvelopeError('protected header "sigT" (signing time) must be present');
  }
}

// ---------------------------------------------------------------------------
// Signing input (RFC 7797 §3 — unencoded payload)
// ---------------------------------------------------------------------------

/**
 * The JWS signing input for an unencoded, detached payload:
 *   ASCII(BASE64URL(UTF8(protected)) || '.') || JCS(scope)
 * `protectedB64url` is the STORED header string (authoritative bytes); `scope`
 * is the readable sibling object whose `JCS(scope)` IS the detached payload.
 */
export function jwsSigningInput(protectedB64url: string, scope: unknown): string {
  return `${protectedB64url}.${jcsOf(scope)}`;
}
