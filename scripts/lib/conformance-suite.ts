/**
 * Conformance-suite comparison engine (Level 0, vector track).
 *
 * This is the authority that turns an adapter's REPORT of what its
 * implementation produced into a PASS/FAIL verdict. The split is deliberate and
 * is the crux of the suite's design:
 *
 *   - The ADAPTER runs the implementation under test and reports raw ACTUAL
 *     values (or a mapped error code). It never decides pass or fail and never
 *     adopts the suite's error vocabulary internally — it maps its native error
 *     to a suite code at the boundary (see conformance/errors.json).
 *   - The SUITE owns every assertion. For each vector kind it knows which
 *     expected fields to compare and how. That knowledge lives in COMPARATORS
 *     below and nowhere else, so a third-party adapter cannot pass by asserting
 *     the wrong thing.
 *
 * Capability scoping (user decision): a vector may declare `requires: [key,…]`
 * naming capabilities from conformance/capabilities.json. If the adapter did not
 * declare a required capability the vector is SKIPPED — reported explicitly and
 * counted on its own, never silently dropped and never counted as a pass.
 *
 * Severity (user decision): a vector defaults to MUST — a failure is fatal. A
 * vector marked `severity: "SHOULD"` is advisory: a failure is reported but is
 * never fatal, so a SHOULD can never sink an otherwise-conformant run.
 *
 * NON-NORMATIVE: nothing here is part of the CDX specification. The comparators
 * encode the published vectors' own expected values; the specification governs
 * where any disagreement arises.
 */

export type Severity = 'MUST' | 'SHOULD';

/** One vector's result as an adapter reports it. */
export interface AdapterResult {
  kind: string;
  name: string;
  /** `value`: the function ran and produced `values`. `error`: it raised (map in `error`). `skip`: the adapter declined. */
  outcome: 'value' | 'error' | 'skip';
  values?: Record<string, unknown>;
  error?: { code?: string | null };
  skip?: { reason?: string };
}

/** An adapter's whole report — the file-based protocol's stdout payload. */
export interface AdapterReport {
  suite: string;
  suiteVersion: string;
  specVersion: string;
  adapter: { name: string; version: string; level: number };
  capabilities: string[];
  results: AdapterResult[];
}

/** A vector as loaded from a vector file, plus the optional scoping members. */
export interface SuiteVector {
  name: string;
  requires?: string[];
  severity?: Severity;
  [field: string]: unknown;
}

/** A vector file reduced to what the engine needs. */
export interface SuiteCaseGroup {
  kind: string;
  /** File-level capability keys every vector in the file needs (the file tests a gated feature). Merged with each vector's own `requires`. */
  requires?: string[];
  vectors: SuiteVector[];
}

export type CaseStatus = 'pass' | 'fail' | 'skip' | 'missing';

export interface CaseVerdict {
  kind: string;
  name: string;
  status: CaseStatus;
  severity: Severity;
  /** True when this case counts against the overall verdict (a MUST that did not pass). */
  fatal: boolean;
  detail?: string;
}

export interface SuiteVerdict {
  cases: CaseVerdict[];
  passed: number;
  /** Fatal outcomes: a MUST that failed or a MUST with no reported result. */
  failed: number;
  /** Non-fatal failures: a SHOULD that failed or is missing. Surfaced, never fatal. */
  advisory: number;
  skipped: number;
  /** "kind/name" the adapter reported that no vector in the suite claims. */
  extraResults: string[];
  ok: boolean;
}

// --- per-kind assertion authority ------------------------------------------

interface Comparison {
  pass: boolean;
  detail?: string;
}

/**
 * A comparator receives a vector and its matching result (already confirmed to
 * exist and to be in scope) and decides pass/fail. It is the ONLY place that
 * knows a kind's expected-field names and comparison rules.
 */
type Comparator = (v: SuiteVector, r: AdapterResult) => Comparison;

const eq = (actual: unknown, expected: unknown, label: string): Comparison =>
  actual === expected ? { pass: true } : { pass: false, detail: `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };

/**
 * Order-insensitive canonical serialization, for comparing objects whose member
 * order is not significant. Used for the decoded JWK: RFC 7638 sorts the required
 * members before hashing, so a JWK's member order does not affect its thumbprint,
 * and an implementation emitting the spec's canonical order (crv,kty,x,y) must not
 * be failed for ordering.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Either the values bag (outcome `value`) or the Comparison that already rules the case out. */
type Values = { ok: true; v: Record<string, unknown> } | { ok: false; comparison: Comparison };

/** Require outcome `value` and return the values bag; otherwise a failure Comparison. */
function values(r: AdapterResult): Values {
  if (r.outcome !== 'value') {
    return { ok: false, comparison: { pass: false, detail: `expected a computed value, adapter reported outcome "${r.outcome}"${r.error?.code ? ` (error ${r.error.code})` : ''}` } };
  }
  return { ok: true, v: r.values ?? {} };
}

const COMPARATORS: Record<string, Comparator> = {
  'document-id': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    const jcs = eq(a.v.canonicalJcs, v.expectedCanonicalJcs, 'canonicalJcs');
    if (!jcs.pass) return jcs;
    return eq(a.v.id, v.expectedId, 'id');
  },

  'manifest-projection': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    const jcs = eq(a.v.jcs, v.expectedJcs, 'jcs');
    if (!jcs.pass) return jcs;
    return eq(a.v.sha256, v.expectedSha256, 'sha256');
  },

  'manifest-scope': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    const jcs = eq(a.v.jcs, v.expectedJcs, 'jcs');
    if (!jcs.pass) return jcs;
    return eq(a.v.sha256, v.expectedSha256, 'sha256');
  },

  'manifest-projection-errors': (v, r) => {
    if (r.outcome !== 'error') {
      return { pass: false, detail: `expected the projection to raise ${JSON.stringify((v.expect as { code: string }).code)}, adapter reported outcome "${r.outcome}"` };
    }
    return eq(r.error?.code, (v.expect as { code: string }).code, 'error code');
  },

  'jws-header': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    return eq(a.v.protectedHeader, v.expectedProtected, 'protectedHeader');
  },

  'jws-signing-input': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    return eq(a.v.signingInputSha256, v.expectedSha256, 'signingInputSha256');
  },

  'jwk-thumbprint': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    return eq(a.v.thumbprint, v.expectedJkt, 'thumbprint');
  },

  multibase: (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    // The decoded JWK is compared by VALUE, not member order. RFC 7638 sorts the
    // required members before hashing, so member order does not affect the
    // thumbprint; an implementation that emits the spec's canonical order
    // (crv,kty,x,y) is correct and must not fail here. The thumbprint check below
    // carries the cryptographic assertion; this pins the decoded key's values.
    const jwk = eq(stableStringify(a.v.jwk), stableStringify(v.expectedJwk), 'jwk (by value)');
    if (!jwk.pass) return jwk;
    return eq(a.v.thumbprint, v.expectedJkt, 'thumbprint');
  },

  'block-merkle-root': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    return eq(a.v.root, v.root, 'root');
  },

  'block-merkle-inclusion': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    return eq(a.v.included, v.expected, 'included');
  },

  'block-merkle-leaf': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    const jcs = eq(a.v.leafJcs, v.jcs, 'leafJcs');
    if (!jcs.pass) return jcs;
    return eq(a.v.leafHash, v.hash, 'leafHash');
  },

  canonicalize: (v, r) => {
    // A reject vector asserts only that the implementation REJECTS the input
    // (the operation errors). No portable defect code exists for canonicalization
    // failures, so the assertion is rejection, never an identifier — §4.3.2 makes
    // these inputs ones a conformant reader MUST reject.
    if (v.expectReject === true) {
      return r.outcome === 'error'
        ? { pass: true }
        : { pass: false, detail: `expected the input to be rejected, adapter reported outcome "${r.outcome}"` };
    }
    const a = values(r);
    if (!a.ok) return a.comparison;
    const jcs = eq(a.v.canonicalJcs, v.expectedCanonicalJcs, 'canonicalJcs');
    if (!jcs.pass) return jcs;
    return v.expectedId !== undefined ? eq(a.v.id, v.expectedId, 'id') : { pass: true };
  },

  'provenance-timestamp': (v, r) => {
    const a = values(r);
    if (!a.ok) return a.comparison;
    const e = v.expected as { boundToDocument: boolean; merkleVerified?: boolean; leaf?: string; problemsEmpty: boolean };
    const bound = eq(a.v.boundToDocument, e.boundToDocument, 'boundToDocument');
    if (!bound.pass) return bound;
    // merkleVerified and leaf are asserted only where the vector defines them
    // (aggregated timestamps carry them; single tokens do not).
    if (e.merkleVerified !== undefined) {
      const mv = eq(a.v.merkleVerified, e.merkleVerified, 'merkleVerified');
      if (!mv.pass) return mv;
    }
    if (e.leaf !== undefined) {
      const lf = eq(a.v.leaf, e.leaf, 'leaf');
      if (!lf.pass) return lf;
    }
    return eq(a.v.problemsEmpty, e.problemsEmpty, 'problemsEmpty');
  },
};

/** Every vector kind the engine can compare. A vector file of any other kind is a suite error. */
export function comparableKinds(): string[] {
  return Object.keys(COMPARATORS).sort();
}

// --- capability scoping ----------------------------------------------------

/** The capability keys a vector needs: its file's `requires` plus its own. */
export function requiresOf(group: SuiteCaseGroup, v: SuiteVector): string[] {
  return [...(group.requires ?? []), ...(Array.isArray(v.requires) ? v.requires : [])];
}

/** Decide whether a set of required capabilities is satisfied by an adapter's declared ones. */
export function scopeOf(requires: readonly string[], capabilities: ReadonlySet<string>): { inScope: boolean; missing: string[] } {
  const missing = requires.filter((key) => !capabilities.has(key));
  return { inScope: missing.length === 0, missing };
}

/**
 * Lint every vector's required capabilities (file-level + vector-level) against
 * the capability catalog. A key that is not a defined capability would otherwise
 * masquerade as a permanent skip (the adapter can never declare a key that does
 * not exist), so it is a suite authoring error, surfaced here rather than
 * silently swallowed.
 */
export function validateRequiresKeys(groups: SuiteCaseGroup[], catalog: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const g of groups) {
    // File-level keys are linted once per file, not once per vector, so a single
    // bad file-level key does not fan out into one message per vector.
    for (const key of g.requires ?? []) {
      if (!catalog.has(key)) problems.push(`${g.kind} (file-level) requires unknown capability "${key}"`);
    }
    for (const v of g.vectors) {
      for (const key of Array.isArray(v.requires) ? v.requires : []) {
        if (!catalog.has(key)) problems.push(`${g.kind}/${v.name} requires unknown capability "${key}"`);
      }
    }
  }
  return problems;
}

// --- the run ---------------------------------------------------------------

/**
 * Compare an adapter report against the suite's vectors and produce a verdict.
 *
 * Pure: no file IO, no process state. `groups` are the suite's vectors (already
 * loaded and schema-validated); `report` is the adapter's stdout payload
 * (already schema-validated). The overall run is `ok` iff no MUST case failed or
 * went unreported.
 */
export function evaluate(groups: SuiteCaseGroup[], report: AdapterReport): SuiteVerdict {
  const caps = new Set(report.capabilities);
  const cases: CaseVerdict[] = [];
  const key = (kind: string, name: string): string => `${kind}/${name}`;

  const byKey = new Map<string, AdapterResult>();
  for (const r of report.results) byKey.set(key(r.kind, r.name), r);
  const allVectorKeys = new Set<string>();
  for (const g of groups) for (const v of g.vectors) allVectorKeys.add(key(g.kind, v.name));

  for (const g of groups) {
    const comparator = COMPARATORS[g.kind];
    for (const v of g.vectors) {
      const severity: Severity = v.severity === 'SHOULD' ? 'SHOULD' : 'MUST';
      const push = (status: CaseStatus, fatal: boolean, detail?: string): void => {
        cases.push({ kind: g.kind, name: v.name, status, severity, fatal, detail });
      };

      const scope = scopeOf(requiresOf(g, v), caps);
      if (!scope.inScope) {
        // Legitimately out of scope: the adapter did not declare a required
        // capability. A skip is never fatal — but it is never a pass either.
        push('skip', false, `adapter does not declare: ${scope.missing.join(', ')}`);
        continue;
      }

      const r = byKey.get(key(g.kind, v.name));
      // No usable result for an in-scope vector — whether the adapter omitted it
      // or self-skipped it — is a shortfall, fatal for a MUST. `skip` status is
      // reserved for out-of-scope cases so an adapter cannot dodge an in-scope
      // MUST by declining it.
      if (r === undefined) {
        push('missing', severity === 'MUST', 'adapter reported no result for this in-scope vector');
        continue;
      }
      if (r.outcome === 'skip') {
        push('missing', severity === 'MUST', `adapter self-skipped an in-scope vector${r.skip?.reason ? `: ${r.skip.reason}` : ''}`);
        continue;
      }
      if (comparator === undefined) {
        push('fail', severity === 'MUST', `suite has no comparator for kind "${g.kind}"`);
        continue;
      }
      const cmp = comparator(v, r);
      push(cmp.pass ? 'pass' : 'fail', !cmp.pass && severity === 'MUST', cmp.detail);
    }
  }

  // Extra results are those matching NO vector in the suite. A result for a
  // scoped-out vector is NOT extra (it matches a known vector), so a legitimate
  // capability skip does not booby-trap the run.
  const extraResults = [...new Set(report.results.map((r) => key(r.kind, r.name)).filter((k) => !allVectorKeys.has(k)))].sort();

  const passed = cases.filter((c) => c.status === 'pass').length;
  const failed = cases.filter((c) => c.fatal).length;
  const advisory = cases.filter((c) => !c.fatal && (c.status === 'fail' || c.status === 'missing')).length;
  const skipped = cases.filter((c) => c.status === 'skip').length;

  return { cases, passed, failed, advisory, skipped, extraResults, ok: failed === 0 };
}
