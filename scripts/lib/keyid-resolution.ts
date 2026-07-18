/**
 * Reference key-resolution helpers for the keyId credential path (Security
 * Extension §3.11) — specifically the parts a verifier must get bit-exactly right
 * when resolving a `did:web` signing key out-of-band.
 *
 * Two operations live here, both pure functions a conformant verifier performs:
 *  - `jwkThumbprint` — the RFC 7638 (with RFC 8037 for OKP) JWK SHA-256
 *    thumbprint. This is the value carried as the signed `jkt` header parameter
 *    and the value a verifier MUST recompute from a resolved key to confirm it is
 *    the signer's intended key. The whole security of the did:web path rests on
 *    this being computed over the **canonical representation** (required members
 *    only, lexicographically ordered, no whitespace), NOT over the bytes a DID
 *    document happens to serve — RFC 7638 §3.1 warns thumbprints are unique only
 *    if the correct representation is used.
 *  - `multibaseKeyToJwk` — converts a DID-document `publicKeyMultibase` (Multikey)
 *    value to a JWK so its thumbprint can be taken. did:web documents publish keys
 *    as either `publicKeyJwk` (used directly) or `publicKeyMultibase` (converted
 *    here); both are supported (§3.11).
 *
 * This module does NOT perform DID resolution itself (no network, no TLS — a
 * spec-repo gate cannot, and §8.5 says so). It pins the canonicalisation and
 * key-decoding a real verifier MUST do, so the conformance KATs can exercise the
 * exact place representation bugs hide.
 */

import * as crypto from 'crypto';
import { jcsOf } from './canonicalize.js';

export class KeyResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyResolutionError';
  }
}

// ---------------------------------------------------------------------------
// base58btc (Bitcoin alphabet) — the multibase 'z' encoding
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP: ReadonlyMap<string, number> = new Map([...BASE58_ALPHABET].map((c, i) => [c, i]));

/** Decode a base58btc string (no multibase prefix) to bytes. */
export function base58btcDecode(s: string): Buffer {
  let num = 0n;
  for (const c of s) {
    const d = BASE58_MAP.get(c);
    if (d === undefined) throw new KeyResolutionError(`invalid base58btc character ${JSON.stringify(c)}`);
    num = num * 58n + BigInt(d);
  }
  // Convert the bignum to bytes, then restore leading zero bytes (encoded as '1').
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  let leadingZeros = 0;
  for (const c of s) {
    if (c === '1') leadingZeros++;
    else break;
  }
  return Buffer.from([...new Array(leadingZeros).fill(0), ...bytes]);
}

// ---------------------------------------------------------------------------
// RFC 7638 / RFC 8037 JWK thumbprint
// ---------------------------------------------------------------------------

/** The required JWK members per key type, in the order RFC 7638/8037 fix. */
const REQUIRED_MEMBERS: Record<string, readonly string[]> = {
  EC: ['crv', 'kty', 'x', 'y'], // RFC 7638 §3.2
  OKP: ['crv', 'kty', 'x'], //     RFC 8037 §2
  RSA: ['e', 'kty', 'n'], //       RFC 7638 §3.2
};

/**
 * The RFC 7638 JWK SHA-256 thumbprint, base64url (no padding) — the `jkt` value.
 * Computed over the canonical JSON of the **required members only**, with members
 * in lexicographic order and no whitespace (RFC 8785/JCS over a flat string object
 * produces exactly this). A verifier MUST recompute this from a resolved key and
 * compare it to the signed `jkt`; it MUST NOT hash the served `publicKeyJwk` bytes
 * verbatim (extra members or non-canonical encoding would yield a different,
 * non-matching digest — RFC 7638 §3.1).
 */
export function jwkThumbprint(jwk: Record<string, unknown>): string {
  const kty = jwk.kty;
  // Object.hasOwn, not `in`: `in` also matches inherited Object.prototype names, so
  // an attacker-served kty of '__proto__'/'constructor' would bypass this guard and
  // reach the loop below with a non-array value, throwing a raw TypeError instead of
  // the module's KeyResolutionError (a did:web-resolution DoS/error-path trap).
  if (typeof kty !== 'string' || !Object.hasOwn(REQUIRED_MEMBERS, kty)) {
    throw new KeyResolutionError(`jwkThumbprint: unsupported or missing "kty" (${JSON.stringify(kty)})`);
  }
  const canonical: Record<string, string> = {};
  for (const member of REQUIRED_MEMBERS[kty]) {
    const v = jwk[member];
    if (typeof v !== 'string' || v.length === 0) {
      throw new KeyResolutionError(`jwkThumbprint: missing/invalid required member "${member}" for kty ${kty}`);
    }
    canonical[member] = v;
  }
  return crypto.createHash('sha256').update(jcsOf(canonical)).digest('base64url');
}

// ---------------------------------------------------------------------------
// publicKeyMultibase (Multikey) → JWK
// ---------------------------------------------------------------------------

// Unsigned-varint multicodec prefixes (the leading bytes of the decoded multibase).
const MULTICODEC_ED25519_PUB = Buffer.from('ed01', 'hex'); // code 0xed
const MULTICODEC_P256_PUB = Buffer.from('8024', 'hex'); //    code 0x1200

/**
 * Convert a `publicKeyMultibase` value (base58btc, 'z' prefix) to a JWK. Supports
 * the algorithms this version requires/recommends: Ed25519 (EdDSA) and P-256
 * (ES256). A P-256 point is published compressed; it is decompressed via the
 * platform EC implementation. Other multicodecs are rejected (the verifier treats
 * such a verification method as non-matching → `unknown`, §3.11).
 */
export function multibaseKeyToJwk(multibase: string): Record<string, string> {
  if (typeof multibase !== 'string' || multibase.length < 2 || multibase[0] !== 'z') {
    throw new KeyResolutionError("multibaseKeyToJwk: expected a base58btc multibase value ('z' prefix)");
  }
  const bytes = base58btcDecode(multibase.slice(1));

  if (bytes.length === 2 + 32 && MULTICODEC_ED25519_PUB.equals(bytes.subarray(0, 2))) {
    return { kty: 'OKP', crv: 'Ed25519', x: bytes.subarray(2).toString('base64url') };
  }

  if (bytes.length === 2 + 33 && MULTICODEC_P256_PUB.equals(bytes.subarray(0, 2))) {
    const compressed = bytes.subarray(2); // 0x02/0x03 || X(32)
    let uncompressed: Buffer;
    try {
      uncompressed = Buffer.from(
        crypto.ECDH.convertKey(compressed, 'prime256v1', undefined, undefined, 'uncompressed') as Buffer,
      );
    } catch (err) {
      throw new KeyResolutionError(`multibaseKeyToJwk: P-256 point decompression failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // uncompressed = 0x04 || X(32) || Y(32)
    return {
      kty: 'EC',
      crv: 'P-256',
      x: uncompressed.subarray(1, 33).toString('base64url'),
      y: uncompressed.subarray(33, 65).toString('base64url'),
    };
  }

  throw new KeyResolutionError(
    `multibaseKeyToJwk: unsupported multicodec prefix 0x${bytes.subarray(0, 2).toString('hex')} (this version supports Ed25519 and P-256)`,
  );
}
