/**
 * Reference implementation of the cdx-bmt-1 block-level Merkle construction
 * (core specification 09 §4.2–4.3, §5.1–5.2).
 *
 * The construction is RFC 6962-style tagged hashing:
 *   - leaf     = H(0x00 || JCS(block))          — 09 §4.2
 *   - internal = H(0x01 || left || right)       — 09 §4.3 (raw digest bytes)
 *   - an odd node is PROMOTED unchanged to the next level, never duplicated
 *
 * The tags and the promotion rule close two classic weaknesses the spec
 * previously disclosed as open: odd-node duplication lets two distinct block
 * sets share one root (the CVE-2012-2459 pattern), and untagged nodes let an
 * internal value be replayed as a leaf. Promotion is unambiguous because of
 * the tags — a promoted node's value can never be reinterpreted at the other
 * role.
 *
 * This fold is DELIBERATELY DISTINCT from the aggregated-timestamp fold in
 * ./provenance-timestamp.ts (09 §6.5): that one is untagged raw concatenation
 * because its proof shape is fixed by external aggregators (OpenTimestamps)
 * and CDX tags cannot be imposed on it. Applying either fold where the other
 * is required must fail — check-block-merkle.ts pins that divergence.
 *
 * Scope note (09 §5.2): the block-level root is advisory in this version — it
 * is not bound by the document ID or the manifest projection — so these proofs
 * are interoperability constructs, not yet a trusted redaction/inclusion
 * oracle. This module pins the bytes of the construction, not a trust claim.
 */

import * as crypto from 'crypto';
import { jcsOf } from './canonicalize.js';

export class BlockMerkleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockMerkleError';
  }
}

/** Wire identifier of this construction (09 §4.3–4.4). */
export const BLOCK_MERKLE_CONSTRUCTION = 'cdx-bmt-1';

/** One-byte domain-separation tags (09 §4.2–4.3). */
const LEAF_TAG = Buffer.from([0x00]);
const INTERNAL_TAG = Buffer.from([0x01]);

/** Upper bound on inclusion-path length, mirroring provenance-timestamp.ts:
 * a path of depth d authenticates up to 2^d leaves, so 256 is astronomically
 * generous while bounding the hashing work an untrusted proof can force. */
const MAX_BLOCK_PATH = 256;

/** Node `crypto` hash names for the supported algorithms. blake3 has no Node
 * binding and is rejected (the same posture as canonicalize.ts). */
const BLOCK_HASHES: Record<string, string> = {
  'sha256': 'sha256',
  'sha384': 'sha384',
  'sha512': 'sha512',
  'sha3-256': 'sha3-256',
  'sha3-512': 'sha3-512',
};

export interface BlockPathElement {
  position: 'left' | 'right';
  hash: string;
}

/** Split an `algorithm:hexdigest` content hash into its algorithm and raw bytes. */
function decodeContentHash(h: string): { algorithm: string; bytes: Buffer } {
  if (typeof h !== 'string') {
    throw new BlockMerkleError('content hash must be a string');
  }
  const colon = h.indexOf(':');
  if (colon <= 0) {
    throw new BlockMerkleError(`malformed content hash "${h}" (expected algorithm:hexdigest)`);
  }
  const algorithm = h.slice(0, colon);
  const hex = h.slice(colon + 1);
  if (!/^[a-f0-9]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new BlockMerkleError(`malformed hex digest in "${h}"`);
  }
  return { algorithm, bytes: Buffer.from(hex, 'hex') };
}

function nodeHashName(algorithm: string): string {
  const node = BLOCK_HASHES[algorithm];
  if (node === undefined) {
    throw new BlockMerkleError(`unsupported hash algorithm "${algorithm}" for block Merkle construction`);
  }
  return node;
}

/** Tagged internal node: H(0x01 || left || right) over raw digest bytes (09 §4.3). */
function internalNode(algorithm: string, left: Buffer, right: Buffer): Buffer {
  return crypto.createHash(nodeHashName(algorithm)).update(Buffer.concat([INTERNAL_TAG, left, right])).digest();
}

/**
 * Tagged leaf hash of a content block: H(0x00 || JCS(block)) (09 §4.2).
 * `block` is the block's parsed JSON value; JCS serialization is delegated to
 * the shared canonicalizer so leaf bytes match the document-ID toolchain.
 */
export function blockLeafHash(block: unknown, algorithm: string = 'sha256'): string {
  const name = nodeHashName(algorithm);
  const jcs = Buffer.from(jcsOf(block), 'utf8');
  const digest = crypto.createHash(name).update(Buffer.concat([LEAF_TAG, jcs])).digest();
  return `${algorithm}:${digest.toString('hex')}`;
}

/**
 * Reduce leaf hashes to the cdx-bmt-1 root (09 §4.3): pair adjacent nodes
 * left-to-right under the internal tag; promote a final unpaired node
 * unchanged; repeat to a single root. A single leaf IS the root. All hashes
 * must share one algorithm; an empty tree has no defined root.
 */
export function blockMerkleRoot(leaves: string[]): string {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new BlockMerkleError('cannot compute a Merkle root of zero leaves');
  }
  const first = decodeContentHash(leaves[0]);
  const algorithm = first.algorithm;
  nodeHashName(algorithm); // reject unsupported algorithms up front
  let level: Buffer[] = leaves.map((l) => {
    const d = decodeContentHash(l);
    if (d.algorithm !== algorithm) {
      throw new BlockMerkleError(`tree mixes algorithms ("${algorithm}" vs "${d.algorithm}")`);
    }
    return d.bytes;
  });
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(internalNode(algorithm, level[i], level[i + 1]));
    }
    if (level.length % 2 === 1) {
      next.push(level[level.length - 1]); // promote unchanged (09 §4.3 step 3)
    }
    level = next;
  }
  return `${algorithm}:${level[0].toString('hex')}`;
}

/**
 * Generate the inclusion path for the leaf at `index` (09 §5.1): one sibling
 * per level at which the running node is paired; a promoted level contributes
 * no element, so the path may be shorter than ⌈log2(n)⌉.
 */
export function generateBlockInclusionProof(leaves: string[], index: number): BlockPathElement[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new BlockMerkleError(`leaf index ${index} out of range for ${leaves.length} leaves`);
  }
  blockMerkleRoot(leaves); // validates shape, algorithm agreement, non-emptiness
  const algorithm = decodeContentHash(leaves[0]).algorithm;
  let level: Buffer[] = leaves.map((l) => decodeContentHash(l).bytes);
  let pos = index;
  const path: BlockPathElement[] = [];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(internalNode(algorithm, level[i], level[i + 1]));
    }
    const odd = level.length % 2 === 1;
    if (odd) next.push(level[level.length - 1]);
    if (odd && pos === level.length - 1) {
      pos = next.length - 1; // promoted: no sibling at this level
    } else {
      const sib = pos % 2 === 0 ? pos + 1 : pos - 1;
      path.push({
        position: pos % 2 === 0 ? 'right' : 'left',
        hash: `${algorithm}:${level[sib].toString('hex')}`,
      });
      pos = Math.floor(pos / 2);
    }
    level = next;
  }
  return path;
}

/**
 * Verify a cdx-bmt-1 inclusion proof (09 §5.2): starting from the leaf hash,
 * fold each sibling under the INTERNAL tag — a `left` sibling on the left
 * (H(0x01 || sibling || acc)), a `right` sibling on the right
 * (H(0x01 || acc || sibling)) — and compare the result to `root`. All hashes
 * MUST share one algorithm. Returns true iff the path reproduces root.
 */
export function verifyBlockInclusion(leaf: string, path: BlockPathElement[], root: string): boolean {
  if (!Array.isArray(path)) {
    throw new BlockMerkleError('block Merkle proof path must be an array');
  }
  if (path.length > MAX_BLOCK_PATH) {
    throw new BlockMerkleError(`block Merkle proof path length ${path.length} exceeds maximum ${MAX_BLOCK_PATH}`);
  }
  const { algorithm, bytes } = decodeContentHash(leaf);
  nodeHashName(algorithm);
  let acc = bytes;
  for (const el of path) {
    if (el === null || typeof el !== 'object' || (el.position !== 'left' && el.position !== 'right')) {
      throw new BlockMerkleError('each block Merkle path element needs position "left" or "right" and a hash');
    }
    const sib = decodeContentHash(el.hash);
    if (sib.algorithm !== algorithm) {
      throw new BlockMerkleError(`block Merkle path mixes algorithms ("${algorithm}" vs "${sib.algorithm}")`);
    }
    acc = el.position === 'left'
      ? internalNode(algorithm, sib.bytes, acc)
      : internalNode(algorithm, acc, sib.bytes);
  }
  const r = decodeContentHash(root);
  if (r.algorithm !== algorithm) {
    throw new BlockMerkleError(`root algorithm "${r.algorithm}" differs from leaf algorithm "${algorithm}"`);
  }
  return acc.equals(r.bytes);
}
