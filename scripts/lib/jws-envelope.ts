/**
 * Reference helpers for the CDX detached-JWS signature envelope (Security
 * Extension §3.3). A CDX signature is a flattened JWS (RFC 7515) JSON
 * Serialization with an **unencoded, detached** payload (RFC 7797, `b64:false`):
 * the signed payload is `JCS(scope)` — the same canonical bytes the document-ID
 * and manifest-projection machinery already produce — while the readable `scope`
 * object is carried as a sibling member and is NOT part of the JOSE object.
 *
 * This is a JWS profiled toward JAdES (ETSI TS 119 182-1): the signed protected
 * header binds `alg`, `sigT` and exactly one credential path — either an X.509
 * certificate chain (`x5c` + `x5t#S256`) or a keyId (`kid`, a self-certifying
 * `did:key`/`did:jwk` DID; §3.11). It deliberately does NOT claim a JAdES
 * baseline conformance level (B-B/B-T/B-LT/B-LTA): it omits `sigD` (the detached
 * payload is reconstructed as `JCS(scope)` per §3.3, not via a JAdES `sigD`
 * descriptor) and the long-term-validation properties land later.
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

/**
 * keyId (DID) methods recognized by this version's keyId credential path
 * (§3.11). Both are **self-certifying** — the public key is encoded in the
 * identifier itself, so the `kid` (carried in the signed protected header) binds
 * the key without an out-of-band fetch. `did:web` (an out-of-band, resolved key)
 * is a later increment and is intentionally NOT accepted here.
 */
export const SUPPORTED_KID_METHODS: ReadonlySet<string> = new Set(['did:key', 'did:jwk']);

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
 * Validate the SHAPE of a `kid` (keyId) value (§3.11). Structure only: the `kid`
 * must be a non-empty DID of a recognized self-certifying method
 * (`did:key`/`did:jwk`), optionally with a DID-URL fragment selecting one
 * verification method. It does NOT decode the key or evaluate trust — those are
 * verifier obligations (the gate cannot resolve a DID), exactly as the X.509
 * branch does not parse `x5c` as a real certificate.
 */
function validateKid(kid: unknown): void {
  if (typeof kid !== 'string' || kid.length === 0) {
    throw new JwsEnvelopeError('protected header "kid" must be a non-empty DID string');
  }
  // did = "did:" method-name ":" method-specific-id, optionally a "#"-fragment.
  const m = /^(did:[a-z0-9]+):([A-Za-z0-9._%-]+)(#[A-Za-z0-9._%-]+)?$/.exec(kid);
  if (m === null || !SUPPORTED_KID_METHODS.has(m[1])) {
    throw new JwsEnvelopeError(
      `protected header "kid" must be a ${[...SUPPORTED_KID_METHODS].join(' or ')} DID ` +
      `(this version's self-certifying keyId methods); got ${JSON.stringify(kid)}`,
    );
  }
}

/**
 * Validate the SHAPE of a decoded protected header against the JAdES-inspired
 * profile (§3.3/§3.4). This checks structure only — it establishes no trust, does
 * not parse `x5c` as a real certificate, and does not resolve a `kid` (those are
 * the trust core's / verifier's job).
 *
 * A header binds `alg`, `sigT`, and **exactly one** credential path: an X.509
 * certificate chain (`x5c` + `x5t#S256`) XOR a keyId (`kid`). Carrying both, or
 * neither, is rejected.
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
  // Signing time — required on every credential path.
  if (typeof header.sigT !== 'string' || header.sigT.length === 0) {
    throw new JwsEnvelopeError('protected header "sigT" (signing time) must be present');
  }

  // Exactly one credential path: X.509 (x5c + x5t#S256) XOR keyId (kid) — §3.4.
  // Presence of any X.509-only param selects the X.509 path; a stray x5c or
  // x5t#S256 alongside a kid therefore trips the mutual-exclusion guard rather
  // than slipping through.
  const hasX509 = header.x5c !== undefined || header['x5t#S256'] !== undefined;
  const hasKid = header.kid !== undefined;
  if (hasX509 && hasKid) {
    throw new JwsEnvelopeError('protected header carries both an X.509 credential (x5c/x5t#S256) and a keyId (kid); exactly one credential path is allowed');
  }
  if (!hasX509 && !hasKid) {
    throw new JwsEnvelopeError('protected header must carry exactly one credential path: X.509 (x5c + x5t#S256) or keyId (kid)');
  }

  if (hasKid) {
    validateKid(header.kid);
  } else {
    // X.509 path: signing certificate chain (base64 DER, leaf-first) + its JAdES thumbprint.
    if (!Array.isArray(header.x5c) || header.x5c.length === 0 || !header.x5c.every((c) => typeof c === 'string' && c.length > 0)) {
      throw new JwsEnvelopeError('protected header "x5c" must be a non-empty array of base64 DER certificate strings');
    }
    if (typeof header['x5t#S256'] !== 'string' || header['x5t#S256'].length === 0) {
      throw new JwsEnvelopeError('protected header "x5t#S256" (signing-certificate thumbprint) must be present');
    }
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
