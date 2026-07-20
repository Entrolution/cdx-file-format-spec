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
 *
 * This module is a typed loader over `conformance/vectors/provenance-timestamp.json`,
 * which is the source of truth: the bytes a third-party implementation runs are
 * the bytes these gates run. The loader schema-validates on every read.
 */

import { loadVectors } from '../lib/conformance-vectors.js';

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

export const timestampVectors: TimestampVector[] = loadVectors<TimestampVector>('provenance-timestamp');
