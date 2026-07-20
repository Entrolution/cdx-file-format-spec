/**
 * Known-answer test vectors for the detached-JWS signature envelope
 * (Security Extension §3.3).
 *
 * `headerVectors` pin the reference protected-header encoding (header object →
 * base64url). `signingInputVectors` pin the full signing-input construction —
 * `BASE64URL(protected) || '.' || JCS(scope)` (RFC 7797 detached, b64:false) —
 * against an independent SHA-256 oracle (Python base64/json/hashlib, not this
 * repo's code), so a construction or encoding bug is caught, not snapshotted.
 *
 * These vectors exercise the ENVELOPE only: no certificate is parsed, no DID is
 * resolved, and no signature is verified — the `x5c`/`x5t#S256`/`kid` values are
 * clearly-fake placeholders, and trust semantics are out of scope here (the trust
 * core and keyId resolution are separate increments). The vectors cover both
 * credential paths: X.509 (`x5c`+`x5t#S256`) and keyId (`kid`, §3.11).
 *
 * Typed loader over `conformance/vectors/jws-*.json`, `jwk-thumbprint.json` and
 * `multibase.json`, which are the source of truth; the loader schema-validates
 * on every read.
 */

const DOC_ID = 'sha256:e7ad94ba3634250646b41d62bc40cfc0c6aba0de995c2193fd2ebae77eed35c7';
const DOC_CONTENT = 'sha256:f28bbc78915107cc2973f10da7c5c0943414a03b274cdf6193f7b34d433ef026';

/** Clearly-fake, non-verifying cert material for envelope-shape vectors. */
const X5C_PLACEHOLDER = 'MIIBixUNVERIFIEDplaceholderDERcertificateBASE64FORILLUSTRATIONxw==';
const X5T_PLACEHOLDER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Clearly-fake, non-resolving self-certifying keyId (did:key) for envelope-shape vectors. */
const KID_PLACEHOLDER = 'did:key:z6MkUNVERIFIEDplaceholderEd25519keyForIllustration';

/** A did:web keyId + a real RFC 7638 thumbprint (the RFC 8037 Ed25519 key) for did:web shape vectors. */
const KID_WEB = 'did:web:example.com:alice';
const JKT_SAMPLE = 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k';

export interface HeaderVector {
  name: string;
  description: string;
  header: Record<string, unknown>;
  /** base64url of the RFC 8785 (JCS) serialization of `header`. */
  expectedProtected: string;
}

export interface SigningInputVector {
  name: string;
  description: string;
  /** The protected header is derived from this object via the reference encoder. */
  header: Record<string, unknown>;
  /** The readable scope sibling whose JCS is the detached payload. */
  scope: unknown;
  /** sha256 of the UTF-8 signing input (computed out-of-band). */
  expectedSha256: string;
}

import { loadVectors } from '../lib/conformance-vectors.js';

export interface ThumbprintVector {
  name: string;
  description: string;
  jwk: Record<string, string>;
  /** base64url RFC 7638 SHA-256 thumbprint (the `jkt`). */
  expectedJkt: string;
}

export interface MultibaseVector {
  name: string;
  description: string;
  /** A DID-document publicKeyMultibase value (base58btc, 'z' prefix). */
  multibase: string;
  expectedJwk: Record<string, string>;
  /** The thumbprint of the converted key — confirms convert→thumbprint round-trips. */
  expectedJkt: string;
}

export const headerVectors: HeaderVector[] = loadVectors<HeaderVector>('jws-header');
export const signingInputVectors: SigningInputVector[] = loadVectors<SigningInputVector>('jws-signing-input');
export const thumbprintVectors: ThumbprintVector[] = loadVectors<ThumbprintVector>('jwk-thumbprint');
export const multibaseVectors: MultibaseVector[] = loadVectors<MultibaseVector>('multibase');
