/**
 * Known-answer vectors for the cdx-bmt-1 block-level Merkle construction
 * (core 09 §4.2–4.3, §5.1–5.2) — a typed loader over
 * `conformance/vectors/block-merkle-*.json`.
 *
 * The JSON is the source of truth; this module contributes types and the
 * named constants the gate reads directly. The loader schema-validates on
 * every read.
 *
 * Oracle discipline (recorded in each file's `oracle` field): every expected
 * value was computed by an INDEPENDENT Python oracle (hashlib over tagged
 * concatenation — leaf = H(0x00 ‖ JCS(block)), internal = H(0x01 ‖ left ‖
 * right), odd node promoted unchanged), not by the library under test, so a
 * folding bug is caught rather than snapshotted.
 *
 * The vectors pin four things: the tagged construction across tree sizes
 * (including single-leaf identity and the §4.3 promotion rule); inclusion-proof
 * verification including position sensitivity and the promoted-level
 * no-sibling shape; the REJECTION of the legacy untagged duplicate-odd root
 * (the CVE-2012-2459 pattern the tags close); and the §5.2/§6.5 decoupling —
 * an untagged fold value must NOT verify as a cdx-bmt-1 root.
 */

import { loadVectors } from '../lib/conformance-vectors.js';

export interface RootVector {
  name: string;
  description: string;
  leaves: string[];
  root: string;
}

export interface InclusionVector {
  name: string;
  description: string;
  leaf: string;
  path: Array<{ position: 'left' | 'right'; hash: string }>;
  root: string;
  expected: boolean;
}

export interface LeafVector {
  name: string;
  description: string;
  block: unknown;
  jcs: string;
  hash: string;
}

export const rootVectors: RootVector[] = loadVectors<RootVector>('block-merkle-root');
export const inclusionVectors: InclusionVector[] = loadVectors<InclusionVector>('block-merkle-inclusion');

const leafVectors = loadVectors<LeafVector>('block-merkle-leaf');
const leafVector = leafVectors[0];

/** A simple content block, its JCS form, and its tagged leaf hash. */
export const LEAF_BLOCK = leafVector.block;
export const LEAF_BLOCK_JCS = leafVector.jcs;
export const LEAF_BLOCK_HASH = leafVector.hash;

/** Fixed-pattern leaves the trees are built from. */
export const LEAF_A = 'sha256:' + '11'.repeat(32);
export const LEAF_C = 'sha256:' + '33'.repeat(32);

/** The two-leaf root, reused as an inclusion-path sibling. */
export const ROOT_TWO = rootVectors.find((v) => v.leaves.length === 2)!.root;
/** The three-leaf root (one promotion). */
export const ROOT_THREE = rootVectors.find((v) => v.leaves.length === 3)!.root;

/**
 * The untagged fold of C's inclusion path in the three-leaf tree — what the
 * §6.5 aggregated fold produces from the SAME proof inputs. Asserted to differ
 * from ROOT_THREE, which is the §5.2/§6.5 decoupling.
 */
export const UNTAGGED_FOLD_C = inclusionVectors.find((v) => v.name === 'untagged-fold-value-must-not-verify-as-a-cdx-bmt-1-root')!.root;
