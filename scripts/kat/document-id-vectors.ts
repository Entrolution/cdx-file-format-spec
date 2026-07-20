/**
 * Known-answer vectors for the canonical content form and document ID
 * (core 06 §4) — a typed loader over `conformance/vectors/document-id.json`.
 *
 * The JSON is the source of truth: the same bytes a third-party implementation
 * runs are the bytes these gates run, so the published suite cannot diverge
 * from what this repository tests itself against. This module contributes the
 * TypeScript types and nothing else; the loader schema-validates on every read.
 *
 * Oracle discipline (recorded in the file's own `oracle` field):
 * `expectedCanonicalJcs` is HAND-AUTHORED and `expectedId` was computed from
 * exactly those bytes by an out-of-band tool, never by this repository's
 * canonicalizer — so a mistyped vector cannot pass by matching a wrong
 * implementation; the hand bytes, the implementation bytes and the external
 * hash would three-way disagree.
 */

import { loadVectors } from '../lib/conformance-vectors.js';

export interface KatVector {
  name: string;
  description: string;
  /** Document-ID hash algorithm (derived from the id prefix in real use). Default sha256. */
  algorithm?: string;
  parts: {
    manifest: string;
    content: string;
    dublinCore: string;
    assetIndexes?: Record<string, string>;
  };
  /** Hand-authored RFC 8785 (JCS) serialization of the canonical {content, metadata}. */
  expectedCanonicalJcs: string;
  /** `algorithm:hexdigest` of the UTF-8 bytes of expectedCanonicalJcs (computed out-of-band). */
  expectedId: string;
}

export const vectors: KatVector[] = loadVectors<KatVector>('document-id');
