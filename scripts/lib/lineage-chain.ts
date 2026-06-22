/**
 * Reference lineage-chain verifier for CDX (core 09 §3.3). It turns the prose
 * "chain verification" sketch into an executable, three-state contract.
 *
 * Lineage is **child-asserted outbound pointers**: a child records `parent: X`
 * (a content hash) and an advisory `ancestors` list. A parent created before its
 * children cannot commit to them, so descent is NOT provable by forward-links;
 * what a verifier CAN do is resolve the chain backwards from the subject and
 * check it for consistency. This function encodes exactly that, and nothing it
 * cannot stand behind:
 *
 *  - The **resolved walk is authoritative.** The chain is built by resolving
 *    `parent` AND `mergedFrom` links (subject → parents → … → roots — a DAG)
 *    through a verifier-supplied resolver (a content-addressed store, never a
 *    document-supplied URL). A fabricated or unresolvable merge parent makes the
 *    chain `incomplete`/`rejected`, never `verified`. The `ancestors` array is an
 *    advisory redundancy hint, authoritative ONLY where a resolved parent
 *    corroborates it.
 *  - **Three states.** `verified` (walked to a root, every link resolved and
 *    consistent), `incomplete` (a link could not be resolved, or the traversal
 *    bound was reached — the chain is not contradicted but cannot be fully
 *    walked; it is NOT "valid", and no claim is made about any ancestor beyond
 *    the break), `rejected` (a proven inconsistency: a cycle, or an `ancestors`
 *    entry that contradicts the resolved parent's committed chain).
 *  - **depth is derived, version is advisory.** `resolvedDepth` is recomputed
 *    from the resolved walk; a document's *claimed* `depth`/`version` are only
 *    cross-checked as warnings (a hard `parent+1` rule would reject legitimate
 *    branching and honest mistakes — core 09 §3.4).
 *  - **Cycle detection + a traversal bound** make the walk safe against a
 *    self-referential chain (DoS) — a cycle is `rejected`, exceeding the bound is
 *    `incomplete` (an honest deep history is not an inconsistency).
 *
 * What it deliberately does NOT provide (disclosed in 09 §2/§3): proof of
 * descent (forged far ancestors that cannot be resolved stay *unverified*, never
 * endorsed), and any authentication of the pointers themselves — that rests on
 * the signed manifest projection (the security extension binds `manifest.lineage`)
 * and on verifier-side resolution, not on this structural check.
 */

export class LineageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineageError';
  }
}

export interface LineageDoc {
  /** The document's own content-hash id. */
  id: string;
  /** Immediate (primary) parent id, or null for a root. */
  parent: string | null;
  /** Additional merge parents (Section 3.4); each is resolved and verified like `parent`. */
  mergedFrom?: string[];
  /** Advisory nearest-first ancestor chain along the primary spine; `ancestors[0]` MUST equal `parent`. */
  ancestors?: string[];
  /** Advisory distance-from-root (cross-checked as a warning, never enforced). */
  depth?: number;
  /** Advisory sequential version (cross-checked as a warning, never enforced). */
  version?: number;
}

export type LineageOutcome = 'verified' | 'incomplete' | 'rejected';

export interface LineageResult {
  outcome: LineageOutcome;
  /** Number of documents resolved on the walk (subject = 1, +1 per ancestor). */
  resolvedDepth: number;
  /** For `incomplete`/`rejected`: a human-readable explanation. */
  reason?: string;
  /** For `incomplete`: the id whose link could not be resolved (chain unverified from here up). */
  brokenAt?: string;
  /** Advisory, non-fatal observations (claimed depth/version mismatches). */
  warnings: string[];
}

/**
 * A verifier MUST support a traversal bound of at least this many links; it MAY
 * configure a larger one. Reaching the bound yields `incomplete`, never
 * `rejected` (a legitimately deep history is not an inconsistency).
 */
export const MIN_TRAVERSAL_BOUND = 64;

/** Resolve a document by id from the verifier's content-addressed store. */
export type LineageResolver = (id: string) => LineageDoc | undefined;

export interface LineageOptions {
  /** Traversal bound; defaults to MIN_TRAVERSAL_BOUND. */
  maxDepth?: number;
}

interface VisitResult {
  outcome: LineageOutcome;
  /** Verified: the longest resolved path to a root; otherwise where the walk stopped. */
  depth: number;
  reason?: string;
  brokenAt?: string;
}

/**
 * Verify a document's lineage chain (core 09 §3.3). Resolves backwards from
 * `subjectId` through `resolve`, following the primary `parent` AND every
 * `mergedFrom` parent (Section 3.4), and returns the three-state outcome.
 * `resolve` returns `undefined` for an id the verifier cannot retrieve
 * (→ `incomplete`). The walk is a DAG: a node re-reached by a different path (a
 * merge diamond) is memoised — not mistaken for a cycle — while a node re-reached
 * on the CURRENT path is a cycle (→ `rejected`).
 */
export function verifyLineageChain(subjectId: string, resolve: LineageResolver, options: LineageOptions = {}): LineageResult {
  const maxDepth = options.maxDepth ?? MIN_TRAVERSAL_BOUND;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new LineageError('maxDepth must be a positive integer');
  }
  const warnings: string[] = [];
  const memo = new Map<string, number>(); // id -> subtree depth, VERIFIED subtrees only

  // `path` is the current ancestor path (cycle detection); `d` is the 1-based
  // depth of `id` from the subject.
  function visit(id: string, path: Set<string>, d: number): VisitResult {
    if (path.has(id)) {
      // A content-addressed chain cannot revisit an id on one path — a document
      // cannot be its own ancestor — so this is a proven inconsistency.
      return { outcome: 'rejected', depth: d - 1, reason: `cycle detected at ${id}` };
    }
    const cached = memo.get(id);
    if (cached !== undefined) return { outcome: 'verified', depth: cached };

    const doc = resolve(id);
    if (doc === undefined) {
      const what = d === 1 ? 'subject' : 'ancestor';
      return { outcome: 'incomplete', depth: d - 1, reason: `${what} ${id} could not be resolved`, brokenAt: id };
    }

    const parents: string[] = [];
    if (doc.parent !== null && doc.parent !== undefined) parents.push(doc.parent);
    if (Array.isArray(doc.mergedFrom)) parents.push(...doc.mergedFrom);

    if (parents.length === 0) {
      // Root. (The root test precedes the bound test, so a root sitting exactly
      // at the bound still verifies; a non-root at the bound is incomplete.)
      if (Array.isArray(doc.ancestors) && doc.ancestors.length > 0) {
        return { outcome: 'rejected', depth: d, reason: `root ${id} declares a non-empty ancestors chain` };
      }
      if (typeof doc.depth === 'number' && doc.depth !== 1) {
        warnings.push(`root ${id} claims depth ${doc.depth}, expected 1`);
      }
      memo.set(id, 1);
      return { outcome: 'verified', depth: 1 };
    }

    if (d >= maxDepth) {
      return { outcome: 'incomplete', depth: d, reason: `traversal bound (${maxDepth}) reached`, brokenAt: parents[0] };
    }

    // Cross-check the advisory ancestors array against the resolved PRIMARY
    // parent's committed chain, where they overlap (Section 3.2). A mismatch
    // within that range is a forged tail → rejected. Entries beyond it are
    // advisory and are verified only if the walk resolves them.
    if (doc.parent !== null && doc.parent !== undefined && Array.isArray(doc.ancestors)) {
      const parent = resolve(doc.parent);
      if (parent !== undefined) {
        if (doc.ancestors.length === 0 || doc.ancestors[0] !== doc.parent) {
          return { outcome: 'rejected', depth: d, reason: `ancestors[0] does not equal parent at ${id}` };
        }
        const expected = [doc.parent, ...(Array.isArray(parent.ancestors) ? parent.ancestors : [])];
        const overlap = Math.min(doc.ancestors.length, expected.length);
        for (let i = 0; i < overlap; i++) {
          if (doc.ancestors[i] !== expected[i]) {
            return { outcome: 'rejected', depth: d, reason: `ancestors chain at index ${i} of ${id} contradicts the resolved parent's committed chain` };
          }
        }
      }
    }

    // Verify every parent (primary + merge). A rejection anywhere wins; failing
    // that, any incomplete; otherwise verified with depth = max(parents)+1.
    const nextPath = new Set(path);
    nextPath.add(id);
    let firstIncomplete: VisitResult | undefined;
    let maxParentDepth = 0;
    for (const p of parents) {
      const r = visit(p, nextPath, d + 1);
      if (r.outcome === 'rejected') return r;
      if (r.outcome === 'incomplete') {
        if (firstIncomplete === undefined) firstIncomplete = r;
        continue;
      }
      if (r.depth > maxParentDepth) maxParentDepth = r.depth;
    }
    if (firstIncomplete !== undefined) return firstIncomplete;

    // Advisory monotonicity (warnings only — never fatal; §3.4 branching). depth
    // is checked against the recomputed max(parents)+1; version against the
    // primary parent only (a merge has no single predecessor).
    if (typeof doc.depth === 'number' && doc.depth !== maxParentDepth + 1) {
      warnings.push(`claimed depth ${doc.depth} != max(parents.depth)+1 (${maxParentDepth + 1}) at ${id}`);
    }
    if (doc.parent !== null && doc.parent !== undefined && typeof doc.version === 'number') {
      const primary = resolve(doc.parent);
      if (primary !== undefined && typeof primary.version === 'number' && doc.version !== primary.version + 1) {
        warnings.push(`claimed version ${doc.version} != parent.version+1 at ${id}`);
      }
    }

    memo.set(id, maxParentDepth + 1);
    return { outcome: 'verified', depth: maxParentDepth + 1 };
  }

  const r = visit(subjectId, new Set(), 1);
  return { outcome: r.outcome, resolvedDepth: r.depth, reason: r.reason, brokenAt: r.brokenAt, warnings };
}
