/**
 * Reference helper for CDX provenance-record timestamp bindings (core
 * specification 09 §6). A provenance record (`provenance/record.json`) MAY carry
 * `timestamps[]` anchors, each proving the document hash existed at or before a
 * point in time. For a timestamp to attest THIS document, CDX fixes what it must
 * commit to:
 *
 *     the timestamped leaf hash == record.documentId
 *
 * and, on a frozen/published document, `record.documentId` is itself the
 * signature-authenticated `manifest.id` (09 §6.2). The leaf differs by type:
 *   - rfc3161    — `hash` (the RFC 3161 token's messageImprint commits to it),
 *   - blockchain — `hash` (the on-chain transaction commits to it),
 *   - aggregated — `proof.documentHash` (the Merkle leaf), which MUST also equal
 *                  the top-level `hash`, and is tied to `merkleRoot` by `proof.path`.
 *
 * Gating only the top-level `hash` would be fail-open for the aggregated type:
 * the Merkle path commits to `proof.documentHash`, so an attacker could set
 * `hash == documentId` while `proof.documentHash` is some other hash the calendar
 * actually anchored. This module therefore keys the aggregated binding on
 * `proof.documentHash` and additionally recomputes the Merkle path to the root —
 * the ONE executable cryptographic check in the provenance-timestamp story.
 *
 * What this module does NOT do (verifier obligations a spec-repo gate cannot run,
 * 09 §6.7 / security §8.5): parse an RFC 3161 token or validate its TSA chain,
 * query a blockchain node / light client, check confirmation or finality depth,
 * confirm a transaction contains the hash, or validate the on-chain anchor of an
 * aggregate root. A failed binding here means the structure is wrong; a passing
 * binding is necessary but not sufficient — the cryptographic proof itself is the
 * verifier's to validate, and a verifier MUST report a timestamp it cannot
 * validate as unverified, never as valid.
 */

import * as crypto from 'crypto';

export class ProvenanceTimestampError extends Error {
  /** Stable defect identifier from the conformance vocabulary
   * (`conformance/errors.json`); diagnostics only, never normativity —
   * see CanonicalizationError in ./canonicalize.ts. */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ProvenanceTimestampError';
    this.code = code;
  }
}

/** Upper bound on Merkle inclusion-path length. A path of depth d authenticates a
 * tree of up to 2^d leaves, so 256 is astronomically generous while bounding the
 * per-timestamp hashing work an untrusted proof can force. Mirrors the
 * `proof.path` maxItems in provenance.schema.json; a proof that passes the schema
 * cannot exceed this, and this guard also protects callers that reach the library
 * without schema validation. */
const MAX_MERKLE_PATH = 256;

/** Node `crypto` hash names for the algorithms a Merkle path may use. blake3 has
 * no Node binding and is rejected (the same posture as canonicalize.ts). */
const MERKLE_HASHES: Record<string, string> = {
  'sha256': 'sha256',
  'sha384': 'sha384',
  'sha512': 'sha512',
  'sha3-256': 'sha3-256',
  'sha3-512': 'sha3-512',
};

export interface MerklePathElement {
  position: 'left' | 'right';
  hash: string;
}

/** Split an `algorithm:hexdigest` content hash into its algorithm and raw bytes. */
function decodeContentHash(h: string): { algorithm: string; bytes: Buffer } {
  if (typeof h !== 'string') {
    throw new ProvenanceTimestampError('content hash must be a string');
  }
  const colon = h.indexOf(':');
  if (colon <= 0) {
    throw new ProvenanceTimestampError(`malformed content hash "${h}" (expected algorithm:hexdigest)`);
  }
  const algorithm = h.slice(0, colon);
  const hex = h.slice(colon + 1);
  if (!/^[a-f0-9]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new ProvenanceTimestampError(`malformed hex digest in "${h}"`);
  }
  return { algorithm, bytes: Buffer.from(hex, 'hex') };
}

/** Combine two sibling digests by raw-byte concatenation under `algorithm`.
 * The byte order is the caller's responsibility (left || right). */
function hashConcat(algorithm: string, left: Buffer, right: Buffer): Buffer {
  const node = MERKLE_HASHES[algorithm];
  if (node === undefined) {
    throw new ProvenanceTimestampError(`unsupported hash algorithm "${algorithm}" for Merkle verification`);
  }
  return crypto.createHash(node).update(Buffer.concat([left, right])).digest();
}

/**
 * Recompute an aggregated timestamp's Merkle inclusion proof (09 §6.5):
 * UNTAGGED raw-digest-byte concatenation — fold each sibling into the
 * accumulator — a `left` sibling on the left (`H(sibling || acc)`), a `right`
 * sibling on the right (`H(acc || sibling)`) — and compare the result to `root`.
 * All hashes MUST share one algorithm. Returns true iff the path reproduces root.
 *
 * This is deliberately NOT the tagged cdx-bmt-1 block-tree fold of 09 §5.2
 * (./block-merkle.ts): an aggregated proof's shape is fixed by the external
 * aggregator (e.g. OpenTimestamps), so CDX domain tags cannot be imposed on it.
 * check-block-merkle.ts pins the divergence in both directions.
 */
export function verifyMerkleInclusion(leaf: string, path: MerklePathElement[], root: string): boolean {
  if (!Array.isArray(path)) {
    throw new ProvenanceTimestampError('Merkle proof path must be an array');
  }
  if (path.length > MAX_MERKLE_PATH) {
    throw new ProvenanceTimestampError(`Merkle proof path length ${path.length} exceeds maximum ${MAX_MERKLE_PATH}`);
  }
  const { algorithm, bytes } = decodeContentHash(leaf);
  let acc = bytes;
  for (const el of path) {
    if (el === null || typeof el !== 'object' || (el.position !== 'left' && el.position !== 'right')) {
      throw new ProvenanceTimestampError('each Merkle path element needs position "left" or "right" and a hash');
    }
    const sib = decodeContentHash(el.hash);
    if (sib.algorithm !== algorithm) {
      throw new ProvenanceTimestampError(`Merkle path mixes algorithms ("${algorithm}" vs "${sib.algorithm}")`);
    }
    acc = el.position === 'left' ? hashConcat(algorithm, sib.bytes, acc) : hashConcat(algorithm, acc, sib.bytes);
  }
  const r = decodeContentHash(root);
  if (r.algorithm !== algorithm) {
    throw new ProvenanceTimestampError(`merkleRoot algorithm "${r.algorithm}" differs from leaf algorithm "${algorithm}"`);
  }
  return acc.equals(r.bytes);
}

export interface TimestampBinding {
  /** The discriminated timestamp type, or undefined for an unknown shape. */
  type: string | undefined;
  /** The hash this timestamp commits to (rfc3161/blockchain: `hash`; aggregated:
   * `proof.documentHash`), or undefined when it cannot be located. */
  leaf: string | undefined;
  /** Whether the leaf equals the record's documentId. */
  boundToDocument: boolean;
  /** Aggregated only: whether `proof.path` reproduces `merkleRoot`. */
  merkleVerified?: boolean;
  /** Human-readable problems; empty iff the structural binding holds. */
  problems: string[];
}

/**
 * Check a single provenance timestamp's binding to `documentId` (09 §6.2). This
 * is the executable, gateable core: the per-type leaf MUST equal `documentId`,
 * and for the aggregated type the leaf is `proof.documentHash` (keyed there, not
 * on the top-level `hash`, which MUST additionally equal it), with `proof.path`
 * recomputed to `merkleRoot`. It does NOT validate the cryptographic proof itself
 * (token / chain / anchor) — see the module header.
 */
export function checkTimestampBinding(timestamp: any, documentId: string): TimestampBinding {
  const problems: string[] = [];
  if (timestamp === null || typeof timestamp !== 'object') {
    return { type: undefined, leaf: undefined, boundToDocument: false, problems: ['timestamp is not an object'] };
  }
  const type = timestamp.type;
  let leaf: string | undefined;
  let merkleVerified: boolean | undefined;

  if (type === 'rfc3161' || type === 'blockchain') {
    leaf = timestamp.hash;
  } else if (type === 'aggregated') {
    leaf = timestamp.proof?.documentHash;
    if (timestamp.hash !== leaf) {
      problems.push(`aggregated: hash (${timestamp.hash}) must equal proof.documentHash (${leaf})`);
    }
    try {
      merkleVerified = verifyMerkleInclusion(timestamp.proof?.documentHash, timestamp.proof?.path, timestamp.merkleRoot);
      if (!merkleVerified) {
        problems.push('aggregated: Merkle path does not reproduce merkleRoot');
      }
    } catch (err) {
      merkleVerified = false;
      problems.push(`aggregated: Merkle verification error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    return { type, leaf: undefined, boundToDocument: false, problems: [`unknown timestamp type "${type}"`] };
  }

  const boundToDocument = typeof leaf === 'string' && leaf === documentId;
  if (!boundToDocument) {
    problems.push(`timestamped leaf hash (${leaf}) does not equal documentId (${documentId})`);
  }
  return { type, leaf, boundToDocument, merkleVerified, problems };
}
