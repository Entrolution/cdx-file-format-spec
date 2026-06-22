/**
 * Known-answer vectors for provenance-record timestamp bindings (core 09 §6),
 * exercising `checkTimestampBinding` / `verifyMerkleInclusion`.
 *
 * Every Merkle `merkleRoot` below was computed by an INDEPENDENT Python oracle
 * (hashlib over raw-digest-byte concatenation, left/right per 09 §6.5), not by
 * the library under test — so a folding bug in the library is caught, not
 * snapshotted. The leaf and siblings are fixed byte patterns:
 *   LEAF = sha256:11..11, S1 = sha256:22..22, S2 = sha256:33..33.
 *
 * The vectors pin three things: (1) the per-type leaf binding (rfc3161/blockchain
 * key on `hash`, aggregated on `proof.documentHash`); (2) the fail-open guard —
 * an aggregated entry whose top-level `hash` equals the documentId while
 * `proof.documentHash` does NOT must NOT be accepted (a gate keying only on
 * `hash` would wrongly pass it); (3) the Merkle recomputation, including
 * position (left/right) sensitivity and a wrong root.
 */

const LEAF = 'sha256:' + '11'.repeat(32);
const S1 = 'sha256:' + '22'.repeat(32);
const S2 = 'sha256:' + '33'.repeat(32);

// Independent-oracle roots (see header):
const ROOT_SINGLE = 'sha256:5189c77d29fe5d546a045ec46986852785fea5c13ac7da9c115ff5fb6edf817c'; // [right S1] over LEAF
const ROOT_DOUBLE = 'sha256:277b6f43115f5bfd44a875c69575ec332ca5cae7eb76566270a122038611e48f'; // [right S1, left S2] over LEAF
const ROOT_TRIPLE = 'sha256:ccc3f7fe01a5288154e5edfa8e6942b8022c51533954453f1aabb6eb8723efd4'; // [left S2, right S1, right S2] over LEAF
const ROOT_DECOY = 'sha256:c8e5ff41fdd4ca636d8fa244e9600532589f5023c7c17c3e02f7e0fa743e7fe1'; // [right S2] over S1 (a valid proof for the WRONG leaf)
const WRONG_ROOT = 'sha256:' + 'ff'.repeat(32);

// Illustrative placeholders (never validated by the gate — see 09 §6.7).
const TOKEN = 'MIIEjDAVBgkqhkiG9w0BCQUxCDAGBgQBMjM0';
const BLOCK_HASH = '0000000000000000000209b4f1e8a2c9d3b7e6f5a4c3d2e1f0a9b8c7d6e5f4a3';
const TX_ID = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';

export interface TimestampVector {
  name: string;
  documentId: string;
  timestamp: unknown;
  expected: {
    boundToDocument: boolean;
    /** aggregated only; omitted for rfc3161/blockchain */
    merkleVerified?: boolean;
    leaf?: string;
    /** whether `problems` should be empty (a clean structural binding) */
    problemsEmpty: boolean;
  };
}

export const timestampVectors: TimestampVector[] = [
  // --- rfc3161: keyed on `hash` -------------------------------------------------
  {
    name: 'rfc3161-bound',
    documentId: LEAF,
    timestamp: { type: 'rfc3161', time: '2025-01-15T10:00:00Z', hash: LEAF, token: TOKEN, authority: 'https://timestamp.digicert.com' },
    expected: { boundToDocument: true, leaf: LEAF, problemsEmpty: true },
  },
  {
    name: 'rfc3161-mismatch',
    documentId: LEAF,
    timestamp: { type: 'rfc3161', time: '2025-01-15T10:00:00Z', hash: S1, token: TOKEN },
    expected: { boundToDocument: false, leaf: S1, problemsEmpty: false },
  },

  // --- blockchain: keyed on `hash` ---------------------------------------------
  {
    name: 'blockchain-bound',
    documentId: LEAF,
    timestamp: { type: 'blockchain', time: '2025-01-15T10:05:00Z', hash: LEAF, chain: 'bitcoin', blockHeight: 880000, blockHash: BLOCK_HASH, txId: TX_ID },
    expected: { boundToDocument: true, leaf: LEAF, problemsEmpty: true },
  },
  {
    name: 'blockchain-mismatch',
    documentId: LEAF,
    timestamp: { type: 'blockchain', time: '2025-01-15T10:05:00Z', hash: S1, chain: 'ethereum', blockHeight: 19000000, blockHash: BLOCK_HASH, txId: TX_ID },
    expected: { boundToDocument: false, leaf: S1, problemsEmpty: false },
  },

  // --- aggregated: keyed on proof.documentHash + Merkle recomputation ----------
  {
    name: 'aggregated-single-verified',
    documentId: LEAF,
    timestamp: {
      type: 'aggregated', time: '2025-01-15T10:10:00Z', hash: LEAF,
      proof: { documentHash: LEAF, path: [{ position: 'right', hash: S1 }] },
      merkleRoot: ROOT_SINGLE,
      anchor: { chain: 'bitcoin', blockHeight: 880000, txId: TX_ID },
    },
    expected: { boundToDocument: true, merkleVerified: true, leaf: LEAF, problemsEmpty: true },
  },
  {
    name: 'aggregated-double-verified',
    documentId: LEAF,
    timestamp: {
      type: 'aggregated', time: '2025-01-15T10:10:00Z', hash: LEAF,
      proof: { documentHash: LEAF, path: [{ position: 'right', hash: S1 }, { position: 'left', hash: S2 }] },
      merkleRoot: ROOT_DOUBLE,
      anchor: { chain: 'bitcoin', blockHeight: 880000, txId: TX_ID },
    },
    expected: { boundToDocument: true, merkleVerified: true, leaf: LEAF, problemsEmpty: true },
  },
  {
    name: 'aggregated-triple-verified',
    documentId: LEAF,
    timestamp: {
      type: 'aggregated', time: '2025-01-15T10:10:00Z', hash: LEAF,
      proof: { documentHash: LEAF, path: [{ position: 'left', hash: S2 }, { position: 'right', hash: S1 }, { position: 'right', hash: S2 }] },
      merkleRoot: ROOT_TRIPLE,
      anchor: { chain: 'ethereum', blockHeight: 19000000, txId: TX_ID },
    },
    expected: { boundToDocument: true, merkleVerified: true, leaf: LEAF, problemsEmpty: true },
  },
  {
    // THE FAIL-OPEN GUARD: top-level `hash` == documentId (a naive gate keying on
    // `hash` passes), but the Merkle leaf proof.documentHash != documentId, and
    // the proof validly anchors that OTHER leaf. Keying on proof.documentHash
    // catches it: not bound to this document.
    name: 'aggregated-hash-decoy-rejected',
    documentId: LEAF,
    timestamp: {
      type: 'aggregated', time: '2025-01-15T10:10:00Z', hash: LEAF,
      proof: { documentHash: S1, path: [{ position: 'right', hash: S2 }] },
      merkleRoot: ROOT_DECOY,
      anchor: { chain: 'bitcoin', blockHeight: 880000, txId: TX_ID },
    },
    expected: { boundToDocument: false, merkleVerified: true, leaf: S1, problemsEmpty: false },
  },
  {
    name: 'aggregated-wrong-root',
    documentId: LEAF,
    timestamp: {
      type: 'aggregated', time: '2025-01-15T10:10:00Z', hash: LEAF,
      proof: { documentHash: LEAF, path: [{ position: 'right', hash: S1 }] },
      merkleRoot: WRONG_ROOT,
      anchor: { chain: 'bitcoin', blockHeight: 880000, txId: TX_ID },
    },
    expected: { boundToDocument: true, merkleVerified: false, leaf: LEAF, problemsEmpty: false },
  },
  {
    // Position sensitivity: ROOT_SINGLE is H(LEAF || S1) ([right S1]); flipping the
    // sibling to the left computes H(S1 || LEAF) and must NOT reproduce the root.
    name: 'aggregated-swapped-position',
    documentId: LEAF,
    timestamp: {
      type: 'aggregated', time: '2025-01-15T10:10:00Z', hash: LEAF,
      proof: { documentHash: LEAF, path: [{ position: 'left', hash: S1 }] },
      merkleRoot: ROOT_SINGLE,
      anchor: { chain: 'bitcoin', blockHeight: 880000, txId: TX_ID },
    },
    expected: { boundToDocument: true, merkleVerified: false, leaf: LEAF, problemsEmpty: false },
  },

  // --- unknown type -------------------------------------------------------------
  {
    name: 'unknown-type-rejected',
    documentId: LEAF,
    timestamp: { type: 'otherchain', time: '2025-01-15T10:10:00Z', hash: LEAF },
    expected: { boundToDocument: false, problemsEmpty: false },
  },
];
