/**
 * Reference helper for the CDX signature-timestamp binding (Security Extension
 * §3.6). A signature MAY carry an RFC 3161 TimeStampToken (`timestamp.token`)
 * that establishes the signature existed at or before the TSA's genTime T. For
 * the token to be a non-repudiation proof it must be bound to THIS signature, so
 * CDX fixes what the token's `messageImprint` covers:
 *
 *     messageImprint.hashedMessage == H( protected || "." || signature )
 *
 * over the EXACT stored base64url `protected` and `signature` members joined by a
 * single ".", under the imprint's own hash algorithm. Binding both members (not
 * just the signature value) commits the signed protected header — and thus the
 * credential identity (`x5c`/`kid`) and `sigT` — so a genuine token cannot be
 * re-pointed at a record whose header the TSA never saw. A verifier MUST
 * recompute the imprint over the record the token is a sibling of and MUST NOT
 * accept a token whose imprint matches a different record ("this record" rule).
 *
 * Like the rest of the trust model this module performs no PKI: parsing the RFC
 * 3161 token, validating the TSA chain to the verifier's TSA trust store, and
 * extracting genTime are verifier obligations a spec-repo gate cannot execute
 * (§8.5). What it pins, executably and bit-exactly, is the one thing two
 * implementations must agree on: the bytes the imprint covers.
 */

import * as crypto from 'crypto';

/** Hash algorithms an RFC 3161 messageImprint may use in this profile. */
const IMPRINT_HASHES: Record<string, string> = {
  'sha256': 'sha256',
  'sha384': 'sha384',
  'sha512': 'sha512',
};

/** JOSE base64url alphabet (RFC 7515) — no '.', so it cannot collide with the imprint delimiter. */
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export class TimestampError extends Error {
  /** Stable defect identifier from the conformance vocabulary
   * (`conformance/errors.json`); diagnostics only, never normativity —
   * see CanonicalizationError in ./canonicalize.ts. */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TimestampError';
    this.code = code;
  }
}

/**
 * The signature-timestamp message imprint (§3.6): the hex digest of
 * `protected || "." || signature` (the stored base64url members) under
 * `hashAlg` (default sha256, the imprint algorithm carried inside the TSTInfo).
 * A verifier compares this to the token's `messageImprint.hashedMessage`.
 */
export function signatureTimestampImprint(protectedB64: string, signatureB64: string, hashAlg = 'sha256'): string {
  // Object.hasOwn, not `IMPRINT_HASHES[hashAlg] === undefined`: a hashAlg of
  // '__proto__'/'constructor' resolves to an inherited value (truthy), bypassing the
  // undefined check and reaching crypto.createHash with a non-string → a raw
  // TypeError instead of the module's TimestampError.
  if (!Object.hasOwn(IMPRINT_HASHES, hashAlg)) {
    throw new TimestampError(`unsupported imprint hash algorithm "${hashAlg}"`);
  }
  const node = IMPRINT_HASHES[hashAlg];
  // The '.' join is injective ONLY if the members are delimiter-free. JOSE base64url
  // contains no '.', so enforce it: otherwise imprint('AAA','BBB.CCC') would equal
  // imprint('AAA.BBB','CCC'), letting one token bind two different (protected,
  // signature) pairs and defeating the "this record" binding (B4-M8-SEC-03).
  if (!BASE64URL.test(protectedB64) || !BASE64URL.test(signatureB64)) {
    throw new TimestampError('protected and signature members must be base64url (the imprint delimiter "." must not appear in a member)');
  }
  const message = `${protectedB64}.${signatureB64}`;
  return crypto.createHash(node).update(message, 'utf8').digest('hex');
}
