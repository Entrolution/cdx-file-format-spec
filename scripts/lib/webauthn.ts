/**
 * Reference helpers for the WebAuthn credential path (Security Extension §6).
 *
 * A WebAuthn assertion cannot sign `JCS(scope)` directly — an authenticator signs
 * `authenticatorData || SHA-256(clientDataJSON)`, and the only place to carry a
 * caller-chosen value is `clientDataJSON.challenge`. CDX therefore binds the
 * document by setting the challenge to `BASE64URL(SHA-256(JCS(scope)))`: the same
 * canonical scope bytes the X.509/keyId paths sign, committed through the
 * challenge. A WebAuthn signature is thus a scoped (manifest-covering) signature.
 *
 * Trust is the self-certifying model of §3.11: the credential's COSE public key
 * (carried as a JWK in `webauthn.publicKey`) is self-asserted and is `untrusted`
 * unless the verifier PINS it (by RFC 7638 thumbprint). This module performs no
 * pinning, DID/registration lookup, or policy evaluation — those are verifier
 * obligations (§6, §8.5). It pins the two things a verifier must get bit-exact:
 * the challenge construction and the stored-bytes signing input.
 *
 * Critical discipline (mirrors the JWS stored-bytes rule): the signed message is
 * `authenticatorData || SHA-256(clientDataJSON)` over the EXACT stored
 * `clientDataJSON` bytes — a verifier MUST hash those bytes and MUST parse (never
 * re-serialize) the JSON to read `type`/`challenge`/`origin`. clientDataJSON is
 * not canonical; re-serializing it would change the hash.
 */

import * as crypto from 'crypto';
import { jcsOf } from './canonicalize.js';

export class WebauthnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebauthnError';
  }
}

/** COSE signature algorithms WebAuthn authenticators emit that this profile accepts. */
export const WEBAUTHN_ALGS: ReadonlySet<string> = new Set(['ES256', 'ES384', 'EdDSA']);

/**
 * The WebAuthn challenge that binds a scope: `BASE64URL(SHA-256(JCS(scope)))`
 * (unpadded). The hash is ALWAYS SHA-256, independent of the assertion's signature
 * algorithm — the challenge hash and the signature hash are separate, and this one
 * is fixed by this spec.
 */
export function webauthnChallenge(scope: unknown): string {
  return crypto.createHash('sha256').update(jcsOf(scope)).digest('base64url');
}

export interface ClientData {
  type: string;
  challenge: string;
  origin?: string;
  crossOrigin?: boolean;
  [k: string]: unknown;
}

/**
 * Parse the stored clientDataJSON bytes into an object. A verifier MUST read
 * `type`/`challenge`/`origin` from this parse — never from a re-serialization —
 * and MUST hash the original bytes (not these) for the signing input.
 */
export function parseClientData(clientDataJSON: Buffer): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(clientDataJSON.toString('utf8'));
  } catch (err) {
    throw new WebauthnError(`clientDataJSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WebauthnError('clientDataJSON is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== 'string' || typeof obj.challenge !== 'string') {
    throw new WebauthnError('clientDataJSON must have string "type" and "challenge"');
  }
  return obj as ClientData;
}

/**
 * The WebAuthn signing input: `authenticatorData || SHA-256(clientDataJSON)`,
 * over the EXACT stored clientDataJSON bytes.
 */
export function webauthnSigningInput(authenticatorData: Buffer, clientDataJSON: Buffer): Buffer {
  const cdHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  return Buffer.concat([authenticatorData, cdHash]);
}

export interface AuthDataFlags {
  up: boolean; // User Present
  uv: boolean; // User Verified
  be: boolean; // Backup Eligible (a syncable/multi-device credential)
  bs: boolean; // Backup State (currently backed up)
  at: boolean; // Attested credential data included
  ed: boolean; // Extension data included
}

export interface AuthData {
  rpIdHash: Buffer;
  flags: AuthDataFlags;
  signCount: number;
}

/** Parse the fixed 37-byte authenticatorData prefix (rpIdHash | flags | signCount). */
export function parseAuthData(authenticatorData: Buffer): AuthData {
  if (authenticatorData.length < 37) {
    throw new WebauthnError(`authenticatorData must be at least 37 bytes, got ${authenticatorData.length}`);
  }
  const f = authenticatorData[32];
  return {
    rpIdHash: authenticatorData.subarray(0, 32),
    flags: {
      up: (f & 0x01) !== 0,
      uv: (f & 0x04) !== 0,
      be: (f & 0x08) !== 0,
      bs: (f & 0x10) !== 0,
      at: (f & 0x40) !== 0,
      ed: (f & 0x80) !== 0,
    },
    signCount: authenticatorData.readUInt32BE(33),
  };
}

/**
 * The COSE algorithm → required public-key type/curve. A WebAuthn signature is
 * only meaningful when its `algorithm` agrees with the key it is checked under
 * (ES256 demands an EC P-256 key, etc.); a mismatch cannot verify.
 */
const ALG_KEY_TYPE: Record<string, { kty: string; crv: string }> = {
  ES256: { kty: 'EC', crv: 'P-256' },
  ES384: { kty: 'EC', crv: 'P-384' },
  EdDSA: { kty: 'OKP', crv: 'Ed25519' },
};

/** Whether a public JWK's type/curve agrees with a COSE signature algorithm (§6.3). */
export function webauthnKeyMatchesAlg(publicKey: crypto.JsonWebKey, algorithm: string): boolean {
  const e = ALG_KEY_TYPE[algorithm];
  return e !== undefined && publicKey?.kty === e.kty && publicKey?.crv === e.crv;
}

/**
 * Verify a WebAuthn assertion signature over `authData || SHA-256(clientDataJSON)`
 * under the credential's public JWK. WebAuthn encodes ECDSA signatures as ASN.1
 * DER (not the raw r||s of JOSE), so ECDSA verification uses `dsaEncoding: 'der'`.
 *
 * TOTAL: returns `false` for any non-verifying condition — an unsupported
 * `algorithm`, an `algorithm` that does not agree with the key's type/curve, a
 * malformed key, or a failed signature — and never throws on (attacker-controlled)
 * assertion input. It checks the cryptographic signature ONLY; it establishes no
 * trust (the key must still be pinned, §6) and does not check the challenge or flags.
 */
export function verifyWebauthnSignature(
  publicKey: crypto.JsonWebKey,
  authenticatorData: Buffer,
  clientDataJSON: Buffer,
  signature: Buffer,
  algorithm: string,
): boolean {
  if (!webauthnKeyMatchesAlg(publicKey, algorithm)) return false;
  const input = webauthnSigningInput(authenticatorData, clientDataJSON);
  try {
    const key = crypto.createPublicKey({ key: publicKey, format: 'jwk' });
    return algorithm === 'EdDSA'
      ? crypto.verify(null, input, key, signature)
      : crypto.verify(algorithm === 'ES384' ? 'sha384' : 'sha256', input, { key, dsaEncoding: 'der' }, signature);
  } catch {
    return false;
  }
}
