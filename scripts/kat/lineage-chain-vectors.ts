/**
 * Known-answer vectors for lineage-chain verification (core 09 §3.3),
 * exercising `verifyLineageChain`. Each `expected` outcome is hand-derived from
 * the §3.3 contract — the independent oracle is the written rule, not a snapshot.
 *
 * Coverage: a root and a linear chain (verified); a cycle, a forged tail, an
 * ancestors[0]≠parent, and a root-with-ancestors (rejected); an unresolvable
 * parent, an unresolvable subject, and the traversal bound (incomplete); the
 * advisory cases (claimed depth/version mismatch → verified+warning; a child
 * storing fewer/extra ancestors than its parent committed → not rejected).
 */

import type { LineageDoc, LineageOutcome } from '../lib/lineage-chain.js';

export interface LineageVector {
  name: string;
  description: string;
  /** The verifier's content-addressed store. */
  docs: LineageDoc[];
  subject: string;
  maxDepth?: number;
  expected: {
    outcome: LineageOutcome;
    resolvedDepth?: number;
    /** A substring the `reason` must contain (rejected/incomplete). */
    /** Stable defect code the result must carry — the portable assertion. */
    reasonCode?: string;
    /** Substring of the human-readable reason. Advisory: pins THIS
     * implementation's wording, not portable across implementations. */
    reasonIncludes?: string;
    /** Expected number of advisory warnings. */
    warnings?: number;
  };
}

const ROOT = 'sha256:' + 'r'.repeat(64);
const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);
const D = 'sha256:' + 'd'.repeat(64);
const FAKE = 'sha256:' + 'f'.repeat(64);
const GHOST = 'sha256:' + '9'.repeat(64);

export const lineageVectors: LineageVector[] = [
  {
    name: 'verified-root',
    description: 'A root document (parent:null) verifies trivially.',
    docs: [{ id: ROOT, parent: null }],
    subject: ROOT,
    expected: { outcome: 'verified', resolvedDepth: 1, warnings: 0 },
  },
  {
    name: 'verified-linear',
    description: 'root ← A ← B, each ancestors chain consistent with its parent.',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [ROOT] },
      { id: B, parent: A, ancestors: [A, ROOT] },
    ],
    subject: B,
    expected: { outcome: 'verified', resolvedDepth: 3, warnings: 0 },
  },
  {
    name: 'verified-no-ancestors-array',
    description: 'An absent ancestors array skips the cross-check; the walk resolves by parent.',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT },
    ],
    subject: A,
    expected: { outcome: 'verified', resolvedDepth: 2, warnings: 0 },
  },
  {
    name: 'verified-child-stores-fewer-ancestors',
    description: 'A child storing fewer ancestors than its parent committed is fine (overlap matches).',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [ROOT] },
      { id: B, parent: A, ancestors: [A] },
    ],
    subject: B,
    expected: { outcome: 'verified', resolvedDepth: 3, warnings: 0 },
  },
  {
    name: 'verified-extra-advisory-ancestor-not-rejected',
    description: 'An ancestors entry BEYOND the parent\'s committed chain is advisory (unverified, not rejected); the walk still reaches root by resolution.',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [ROOT] },
      { id: B, parent: A, ancestors: [A, ROOT, FAKE] },
    ],
    subject: B,
    expected: { outcome: 'verified', resolvedDepth: 3, warnings: 0 },
  },
  {
    name: 'verified-depth-warning',
    description: 'A wrong claimed depth is advisory: verified with a warning, never rejected.',
    docs: [
      { id: ROOT, parent: null, depth: 1 },
      { id: A, parent: ROOT, ancestors: [ROOT], depth: 5 },
    ],
    subject: A,
    expected: { outcome: 'verified', resolvedDepth: 2, warnings: 1 },
  },
  {
    name: 'verified-version-warning',
    description: 'A non-monotonic version is advisory: verified with a warning (branching is legitimate).',
    docs: [
      { id: ROOT, parent: null, version: 1 },
      { id: A, parent: ROOT, ancestors: [ROOT], version: 7 },
    ],
    subject: A,
    expected: { outcome: 'verified', resolvedDepth: 2, warnings: 1 },
  },
  {
    name: 'rejected-cycle',
    description: 'A → B → A is a cycle; a content-addressed chain cannot revisit an id.',
    docs: [
      { id: A, parent: B, ancestors: [B] },
      { id: B, parent: A, ancestors: [A] },
    ],
    subject: A,
    expected: { outcome: 'rejected', reasonCode: 'CDX-E-LINEAGE-CYCLE', reasonIncludes: 'cycle' },
  },
  {
    name: 'rejected-forged-tail',
    description: 'B claims an ancestor that contradicts the resolved parent A\'s committed chain.',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [ROOT] },
      { id: B, parent: A, ancestors: [A, FAKE] },
    ],
    subject: B,
    expected: { outcome: 'rejected', reasonCode: 'CDX-E-LINEAGE-ANCESTORS-CONTRADICT', reasonIncludes: 'contradicts' },
  },
  {
    name: 'rejected-ancestors-first-mismatch',
    description: 'ancestors[0] must equal parent.',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [FAKE] },
    ],
    subject: A,
    expected: { outcome: 'rejected', reasonCode: 'CDX-E-LINEAGE-ANCESTORS-CONTRADICT', reasonIncludes: 'ancestors[0]' },
  },
  {
    name: 'rejected-root-with-ancestors',
    description: 'A root (parent:null) declaring a non-empty ancestors chain is inconsistent.',
    docs: [{ id: ROOT, parent: null, ancestors: [FAKE] }],
    subject: ROOT,
    expected: { outcome: 'rejected', reasonCode: 'CDX-E-LINEAGE-ROOT-WITH-ANCESTORS', reasonIncludes: 'non-empty ancestors' },
  },
  {
    name: 'incomplete-unresolvable-parent',
    description: 'A parent the verifier cannot resolve yields incomplete (NOT valid), with no claim about it.',
    docs: [{ id: A, parent: GHOST, ancestors: [GHOST] }],
    subject: A,
    expected: { outcome: 'incomplete', resolvedDepth: 1, reasonCode: 'CDX-E-LINEAGE-UNRESOLVABLE', reasonIncludes: 'could not be resolved' },
  },
  {
    name: 'incomplete-subject-unresolvable',
    description: 'A subject the verifier cannot resolve yields incomplete at depth 0.',
    docs: [],
    subject: A,
    expected: { outcome: 'incomplete', resolvedDepth: 0, reasonCode: 'CDX-E-LINEAGE-UNRESOLVABLE', reasonIncludes: 'subject' },
  },
  {
    name: 'incomplete-depth-cap',
    description: 'A chain deeper than the traversal bound is incomplete (an honest deep history, not an inconsistency).',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [ROOT] },
      { id: B, parent: A, ancestors: [A, ROOT] },
      { id: C, parent: B, ancestors: [B, A, ROOT] },
    ],
    subject: C,
    maxDepth: 2,
    expected: { outcome: 'incomplete', reasonCode: 'CDX-E-LINEAGE-BOUND-REACHED', reasonIncludes: 'traversal bound' },
  },
  {
    name: 'verified-merge-diamond',
    description: 'D merges B and C (both children of root); the shared root is reached by two paths (a diamond, not a cycle) and the merge verifies.',
    docs: [
      { id: ROOT, parent: null },
      { id: B, parent: ROOT, ancestors: [ROOT] },
      { id: C, parent: ROOT, ancestors: [ROOT] },
      { id: D, parent: B, mergedFrom: [C], ancestors: [B, ROOT] },
    ],
    subject: D,
    expected: { outcome: 'verified', resolvedDepth: 3, warnings: 0 },
  },
  {
    name: 'verified-unequal-depth-merge',
    description:
      'D merges a SHALLOW primary parent C (depth 2) with a DEEP merge parent B (depth 3), so resolvedDepth = max(parents)+1 = 4. A buggy primary-only or min() merge-depth would yield 3 — the equal-depth diamond cannot tell them apart, this can.',
    docs: [
      { id: ROOT, parent: null },
      { id: A, parent: ROOT, ancestors: [ROOT] },
      { id: B, parent: A, ancestors: [A, ROOT] },
      { id: C, parent: ROOT, ancestors: [ROOT] },
      { id: D, parent: C, mergedFrom: [B], ancestors: [C, ROOT] },
    ],
    subject: D,
    expected: { outcome: 'verified', resolvedDepth: 4, warnings: 0 },
  },
  {
    name: 'incomplete-merge-parent-unresolvable',
    description: 'A merge parent the verifier cannot resolve makes the chain incomplete — a fabricated unresolvable mergedFrom never reaches verified.',
    docs: [
      { id: ROOT, parent: null },
      { id: B, parent: ROOT, ancestors: [ROOT] },
      { id: D, parent: B, mergedFrom: [GHOST] },
    ],
    subject: D,
    expected: { outcome: 'incomplete', reasonCode: 'CDX-E-LINEAGE-UNRESOLVABLE', reasonIncludes: 'could not be resolved' },
  },
  {
    name: 'rejected-merge-parent-forged',
    description: 'A merge parent that is itself inconsistent (forged ancestors) is rejected — merge parents are verified, not merely resolved.',
    docs: [
      { id: ROOT, parent: null },
      { id: B, parent: ROOT, ancestors: [ROOT] },
      { id: C, parent: ROOT, ancestors: [FAKE] },
      { id: D, parent: B, mergedFrom: [C] },
    ],
    subject: D,
    expected: { outcome: 'rejected', reasonCode: 'CDX-E-LINEAGE-ANCESTORS-CONTRADICT', reasonIncludes: 'ancestors[0]' },
  },
];
