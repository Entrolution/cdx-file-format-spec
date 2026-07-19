/**
 * Known-answer vectors for the cdx-bmt-1 block-level Merkle construction
 * (core 09 §4.2–4.3, §5.1–5.2), exercising blockLeafHash / blockMerkleRoot /
 * verifyBlockInclusion.
 *
 * Every expected value below was computed by an INDEPENDENT Python oracle
 * (hashlib over tagged concatenation: leaf = H(0x00 || JCS(block)),
 * internal = H(0x01 || left || right), odd node promoted unchanged), not by
 * the library under test — so a folding bug is caught, not snapshotted. The
 * leaves are fixed byte patterns:
 *   A = sha256:11..11, B = 22..22, C = 33..33, D = 44..44, E = 55..55.
 *
 * The vectors pin four things: (1) the tagged construction across tree sizes,
 * including single-leaf (root == leaf) and the §4.3 promotion rule (3- and
 * 5-leaf trees); (2) inclusion-proof verification, including position
 * sensitivity and the promoted-level no-sibling shape; (3) the REJECTION of
 * the legacy construction — the untagged duplicate-odd root of [A,B,C] must
 * NOT verify under cdx-bmt-1 (the CVE-2012-2459 pattern the tags close); and
 * (4) the §5.2/§6.5 decoupling — the tagged fold and the untagged aggregated
 * fold must disagree on identical inputs (check-block-merkle.ts asserts this
 * against verifyMerkleInclusion directly).
 */

export const LEAF_A = 'sha256:' + '11'.repeat(32);
export const LEAF_B = 'sha256:' + '22'.repeat(32);
export const LEAF_C = 'sha256:' + '33'.repeat(32);
export const LEAF_D = 'sha256:' + '44'.repeat(32);
export const LEAF_E = 'sha256:' + '55'.repeat(32);

// Independent-oracle roots (see header):
export const ROOT_ONE = LEAF_A; // single leaf: root == leaf (09 §4.3)
export const ROOT_TWO = 'sha256:1d8f52d3ec81ac02cd97cb3281523be47af850c0f0295af866f04bc245f46bbf'; // H01(A,B)
export const ROOT_THREE = 'sha256:adc505e99f1e9887777a6aa5d140106fcc012a2e4430875f3c2e135124145842'; // H01(H01(A,B), C) — C promoted once
export const ROOT_FIVE = 'sha256:715e85a12f31b7e9488faaeb0e87a1788100f5cc0a39bcad343010685e7abe53'; // H01(H01(H01(A,B),H01(C,D)), E) — E promoted twice

/** Untagged duplicate-odd root of [A,B,C] — the LEGACY construction this
 * version replaced: H(H(A||B) || H(C||C)). MUST NOT verify under cdx-bmt-1. */
export const LEGACY_ROOT_THREE = 'sha256:e046522f24b39f1a9a2cf96bebcd386df477f282d7ac9b61d0ca59d8fe8f81b6';

/** Untagged fold of C's inclusion path in the 3-leaf tree, H(H01(A,B) || C) —
 * what the §6.5 aggregated fold produces from the SAME proof inputs. MUST
 * differ from ROOT_THREE (the §5.2/§6.5 decoupling). */
export const UNTAGGED_FOLD_C = 'sha256:c74cd6c5c9b7163a5ffaa0ac8b8e452878496f1493709ced5d8690e248d316ef';

/** Leaf-hash vector: a simple content block, its JCS form, and the tagged
 * leaf hash H(0x00 || JCS(block)) — all oracle-computed. */
export const LEAF_BLOCK = { type: 'paragraph', id: 'p-1', children: [{ type: 'text', value: 'Hello' }] };
export const LEAF_BLOCK_JCS = '{"children":[{"type":"text","value":"Hello"}],"id":"p-1","type":"paragraph"}';
export const LEAF_BLOCK_HASH = 'sha256:9d0c48691cece62ce6a930b73f353e4e6f34618a372fd1c656bafaf2bdbb728f';

export interface RootVector {
  name: string;
  leaves: string[];
  root: string;
}

export const rootVectors: RootVector[] = [
  { name: 'single-leaf (root == leaf)', leaves: [LEAF_A], root: ROOT_ONE },
  { name: 'two-leaf', leaves: [LEAF_A, LEAF_B], root: ROOT_TWO },
  { name: 'three-leaf (one promotion)', leaves: [LEAF_A, LEAF_B, LEAF_C], root: ROOT_THREE },
  { name: 'five-leaf (double promotion)', leaves: [LEAF_A, LEAF_B, LEAF_C, LEAF_D, LEAF_E], root: ROOT_FIVE },
];

export interface InclusionVector {
  name: string;
  leaf: string;
  path: Array<{ position: 'left' | 'right'; hash: string }>;
  root: string;
  expected: boolean;
}

export const inclusionVectors: InclusionVector[] = [
  {
    name: 'A in two-leaf tree',
    leaf: LEAF_A,
    path: [{ position: 'right', hash: LEAF_B }],
    root: ROOT_TWO,
    expected: true,
  },
  {
    name: 'C in three-leaf tree (promoted: single-element path)',
    leaf: LEAF_C,
    path: [{ position: 'left', hash: ROOT_TWO }],
    root: ROOT_THREE,
    expected: true,
  },
  {
    name: 'A in three-leaf tree',
    leaf: LEAF_A,
    path: [{ position: 'right', hash: LEAF_B }, { position: 'right', hash: LEAF_C }],
    root: ROOT_THREE,
    expected: true,
  },
  {
    name: 'E in five-leaf tree (double promotion: single-element path)',
    leaf: LEAF_E,
    // E's only pairing is at the top level; its sibling is H01(H01(A,B), H01(C,D)) (oracle-computed).
    path: [{ position: 'left', hash: 'sha256:891e2a21dcae25f3928073284134da49b89e7b081d640419c403abad9d6c1de4' }],
    root: ROOT_FIVE,
    expected: true,
  },
  {
    name: 'position flip must fail',
    leaf: LEAF_A,
    path: [{ position: 'left', hash: LEAF_B }],
    root: ROOT_TWO,
    expected: false,
  },
  {
    name: 'legacy duplicate-odd root must NOT verify (CVE-2012-2459 pattern)',
    leaf: LEAF_C,
    path: [{ position: 'left', hash: ROOT_TWO }],
    root: LEGACY_ROOT_THREE,
    expected: false,
  },
  {
    name: 'untagged-fold value must NOT verify as a cdx-bmt-1 root',
    leaf: LEAF_C,
    path: [{ position: 'left', hash: ROOT_TWO }],
    root: UNTAGGED_FOLD_C,
    expected: false,
  },
];
