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

export class TimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimestampError';
  }
}

/**
 * The signature-timestamp message imprint (§3.6): the hex digest of
 * `protected || "." || signature` (the stored base64url members) under
 * `hashAlg` (default sha256, the imprint algorithm carried inside the TSTInfo).
 * A verifier compares this to the token's `messageImprint.hashedMessage`.
 */
export function signatureTimestampImprint(protectedB64: string, signatureB64: string, hashAlg = 'sha256'): string {
  const node = IMPRINT_HASHES[hashAlg];
  if (node === undefined) {
    throw new TimestampError(`unsupported imprint hash algorithm "${hashAlg}"`);
  }
  const message = `${protectedB64}.${signatureB64}`;
  return crypto.createHash(node).update(message, 'utf8').digest('hex');
}
