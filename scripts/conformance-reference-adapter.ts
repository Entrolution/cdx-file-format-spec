#!/usr/bin/env npx tsx

/**
 * Reference conformance adapter (Level 0 vectors + Level-1 container fixtures) for the CDX conformance suite.
 *
 * This is a worked example of the file-based adapter protocol AND the subject of
 * the `check:conformance` gate. It wraps THIS repository's reference libraries;
 * a third-party adapter wraps its own implementation instead. The shape is the
 * whole contract:
 *
 *   1. Read the suite root (its `suite.json` and `vectors/`), given as argv[2]
 *      or defaulting to ./conformance.
 *   2. For each vector, run the implementation and record what it PRODUCED — a
 *      computed value, or (for the error kind) a native error mapped to a suite
 *      code. The adapter never decides pass or fail.
 *   3. Write one report object to stdout (schema: conformance/report.schema.json).
 *      The suite harness reads it and renders the verdict.
 *
 * A minimal adapter in another language does exactly this: loop the vectors,
 * call your functions, print the actuals. See conformance/ADAPTER.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { canonicalContent, computeDocumentId, jcsOf, MAX_CANONICALIZATION_DEPTH } from './lib/canonicalize.js';
import { projectManifest, projectManifestToJcs } from './lib/manifest-projection.js';
import { encodeProtectedHeader, jwsSigningInput } from './lib/jws-envelope.js';
import { jwkThumbprint, multibaseKeyToJwk } from './lib/keyid-resolution.js';
import { blockLeafHash, blockMerkleRoot, verifyBlockInclusion } from './lib/block-merkle.js';
import { checkTimestampBinding } from './lib/provenance-timestamp.js';
import { selectBreakpoint, selectDefaultPresentation, type Breakpoint } from './lib/presentation-selection.js';
import {
  type Finding,
  ROOT_DOCUMENT,
  ROOT_EXCERPT,
  walkBlocks,
  checkBlock,
  checkAnchors,
  checkPreciseLayout,
  checkAssetCategory,
  checkUniqueIds,
} from './lib/structural-constraints.js';
import { readArchive } from './lib/zip-reader.js';
import { archiveVerdict } from './lib/archive-verdict.js';
import { loadFixtures } from './lib/fixtures.js';
import type { AdapterReport, AdapterResult } from './lib/conformance-suite.js';

const sha256Of = (s: string): string => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** Wrap `leaf` in `depth` nested arrays — the generative expansion of a robustness case. */
function nestDeep(depth: number, leaf: unknown): unknown {
  let v: unknown = leaf;
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

/**
 * Capabilities this implementation genuinely supports across Level 0 and the
 * Level-1 container layer. Only what the reference libraries can actually compute
 * or implement is declared:
 *   - `core` — content canonicalization, document ID, SHA-256 (mandatory).
 *   - `container` — the archive reader (zip-reader.ts): ZIP central-directory
 *     parsing, entry-path uniqueness and name safety, local-header/central
 *     disagreement, and decompression bounds (backs the Level-1 fixtures).
 *   - `ext:security` — the security-extension functions (manifest projection,
 *     JWS protected header / signing input, JWK thumbprint, multibase key).
 *   - `provenance` — cdx-bmt-1 block-Merkle and RFC 3161 timestamp binding.
 *   - the optional hash algorithms the platform can compute.
 * BLAKE3 is deliberately absent: the identifier is recognised but the digest is
 * not available here (canonicalize.ts throws "not available"), so declaring it
 * would be a false claim.
 */
const CAPABILITIES = ['core', 'container', 'ext:security', 'provenance', 'hash:sha-384', 'hash:sha-512', 'hash:sha3-256', 'hash:sha3-512'];
const CAP_SET = new Set(CAPABILITIES);

/** Outcome of running one vector, minus the kind/name the driver fills in. */
type RunOutcome = Pick<AdapterResult, 'outcome' | 'values' | 'error'>;

/** One runner per vector kind: vector input in, produced actuals (or a mapped error) out. */
const RUNNERS: Record<string, (v: Record<string, any>) => RunOutcome> = {
  'document-id': (v) => ({
    outcome: 'value',
    values: {
      canonicalJcs: jcsOf(canonicalContent(v.parts)),
      id: computeDocumentId(v.parts, v.algorithm ?? 'sha256'),
    },
  }),

  'manifest-projection': (v) => {
    const jcs = projectManifestToJcs(v.manifest);
    return { outcome: 'value', values: { jcs, sha256: sha256Of(jcs) } };
  },

  'manifest-scope': (v) => {
    const jcs = jcsOf(v.scope);
    return { outcome: 'value', values: { jcs, sha256: sha256Of(jcs) } };
  },

  'manifest-projection-errors': (v) => {
    // The one kind that expects a raised error. The adapter maps its native
    // error to a suite code at this boundary; the implementation is never asked
    // to adopt the vocabulary internally.
    try {
      projectManifest(v.manifest);
      return { outcome: 'value', values: {} }; // ran without raising — the harness will fail it
    } catch (err) {
      return { outcome: 'error', error: { code: (err as { code?: string }).code ?? null } };
    }
  },

  'jws-header': (v) => ({ outcome: 'value', values: { protectedHeader: encodeProtectedHeader(v.header) } }),

  'jws-signing-input': (v) => ({
    outcome: 'value',
    values: { signingInputSha256: sha256Of(jwsSigningInput(encodeProtectedHeader(v.header), v.scope)) },
  }),

  'jwk-thumbprint': (v) => ({ outcome: 'value', values: { thumbprint: jwkThumbprint(v.jwk) } }),

  multibase: (v) => {
    const jwk = multibaseKeyToJwk(v.multibase);
    return { outcome: 'value', values: { jwk, thumbprint: jwkThumbprint(jwk) } };
  },

  'block-merkle-root': (v) => ({ outcome: 'value', values: { root: blockMerkleRoot(v.leaves) } }),

  'block-merkle-inclusion': (v) => ({ outcome: 'value', values: { included: verifyBlockInclusion(v.leaf, v.path, v.root) } }),

  'block-merkle-leaf': (v) => ({ outcome: 'value', values: { leafJcs: jcsOf(v.block), leafHash: blockLeafHash(v.block, 'sha256') } }),

  canonicalize: (v) => {
    // Transform: the canonical JCS and the document id. On invalid input the
    // library throws, which run() reports as outcome 'error' — exactly what a
    // reject vector asserts, so reject vectors need no special handling here.
    return {
      outcome: 'value',
      values: {
        canonicalJcs: jcsOf(canonicalContent(v.parts)),
        id: computeDocumentId(v.parts, v.algorithm ?? 'sha256'),
      },
    };
  },

  'presentation-selection': (v) => {
    const sel = v.selection as { rule: 'breakpoint' | 'default'; breakpoints?: Breakpoint[]; width?: number; candidates?: Array<Record<string, unknown>> };
    return sel.rule === 'breakpoint'
      ? { outcome: 'value', values: { name: selectBreakpoint(sel.breakpoints ?? [], sel.width ?? 0) } }
      : { outcome: 'value', values: { index: selectDefaultPresentation(sel.candidates ?? []) } };
  },

  'anchor-offset': (v) => {
    const an = v.anchor as { text: string; start: number; end: number };
    // Anchor offsets are CODE POINTS (Unicode scalar values), not UTF-16 code
    // units (Anchors and References §3). `Array.from` splits by code point, so an
    // astral character counts as one; `text.slice(start,end)` (UTF-16) would
    // mis-target — the exact defect this kind catches.
    const selection = Array.from(an.text).slice(an.start, an.end).join('');
    return { outcome: 'value', values: { selection } };
  },

  'structural-constraints': (v) => {
    // Run the named rule's checker over the instance and report whether it
    // FLAGGED — the suite compares that to expect.valid. Block-tree rules use the
    // vector's own `blockTypes` (shipped in the case), so the outcome depends on
    // the vector, not on any schema-derived state.
    const st = v.structural as { rule: string; instance: unknown; index?: unknown; root?: 'document' | 'excerpt'; blockTypes?: string[] };
    const findings: Finding[] = [];
    const where = 'vector';
    switch (st.rule) {
      case 'upward-containment':
      case 'figure-cardinality':
      case 'definition-item-cardinality': {
        const root = st.root === 'document' ? ROOT_DOCUMENT : ROOT_EXCERPT;
        walkBlocks(st.instance, root, where, (b, p, w) => checkBlock(b, p, w, findings), new Set(st.blockTypes ?? []));
        break;
      }
      case 'anchor-range':
        checkAnchors(st.instance, where, findings);
        break;
      case 'page-number-integrity':
        checkPreciseLayout(st.instance, where, findings);
        break;
      case 'asset-index-consistency':
        checkAssetCategory('images', st.instance as Record<string, unknown>, st.index, where, findings);
        break;
      case 'id-uniqueness':
        checkUniqueIds(st.instance, 'id', 'bibliographyEntry', where, findings);
        break;
    }
    return { outcome: 'value', values: { flagged: findings.some((f) => f.rule === st.rule) } };
  },

  'canonicalize-robustness': (v) => {
    // Expand the generative case relative to THIS implementation's own bound, so
    // the depth exercised tracks the reference libraries, not a fixed number.
    const rob = v.robustness as { part: 'content' | 'metadata'; depth: { boundOffset: number }; of: unknown };
    const nested = nestDeep(MAX_CANONICALIZATION_DEPTH + rob.depth.boundOffset, rob.of);
    const parts =
      rob.part === 'metadata'
        ? { manifest: '{}', content: '{"version":"0.1","blocks":[]}', dublinCore: JSON.stringify({ version: '1.1', terms: { title: 'T', creator: nested } }) }
        : { manifest: '{}', content: JSON.stringify(nested), dublinCore: '{"version":"1.1","terms":{"title":"T","creator":"C"}}' };
    // computeDocumentId runs the up-front depth check (assertBoundedDepth) before
    // any recursive walk: one past the bound throws a typed CanonicalizationError
    // (caught by run() → outcome 'error'), never a native stack overflow.
    computeDocumentId(parts, 'sha256');
    return { outcome: 'value', values: {} };
  },

  'provenance-timestamp': (v) => {
    const got = checkTimestampBinding(v.timestamp, v.documentId);
    return {
      outcome: 'value',
      values: {
        boundToDocument: got.boundToDocument,
        merkleVerified: got.merkleVerified,
        leaf: got.leaf,
        problemsEmpty: got.problems.length === 0,
      },
    };
  },
};

function run(kind: string, v: Record<string, any>): RunOutcome {
  const runner = RUNNERS[kind];
  if (runner === undefined) {
    // A kind this adapter does not implement. Declaring it a skip is honest — the
    // harness surfaces it rather than counting a silent pass.
    return { outcome: 'skip' } as RunOutcome;
  }
  try {
    return runner(v);
  } catch (err) {
    // A positive kind that unexpectedly raised. Report the error faithfully; the
    // harness fails it against the expected value, surfacing the real defect.
    return { outcome: 'error', error: { code: (err as { code?: string }).code ?? null } };
  }
}

function main(): void {
  const suiteRoot = process.argv[2] ?? path.join(__dirname, '..', 'conformance');
  const suite = JSON.parse(fs.readFileSync(path.join(suiteRoot, 'suite.json'), 'utf8'));
  const vectorsDir = path.join(suiteRoot, 'vectors');

  const results: AdapterResult[] = [];
  for (const file of fs.readdirSync(vectorsDir).filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(vectorsDir, file), 'utf8'));
    const kind: string = doc.kind;
    const fileRequires: string[] = Array.isArray(doc.requires) ? doc.requires : [];
    for (const v of doc.vectors as Array<Record<string, any>>) {
      // Honour capability scoping: skip a vector needing a capability this
      // adapter did not declare, rather than attempting it and reporting a
      // spurious error. This models a real capability-scoped adapter.
      const required = [...fileRequires, ...(Array.isArray(v.requires) ? v.requires : [])];
      const missing = required.filter((k) => !CAP_SET.has(k));
      if (missing.length > 0) {
        results.push({ kind, name: v.name, outcome: 'skip', skip: { reason: `missing capability: ${missing.join(', ')}` } });
        continue;
      }
      results.push({ kind, name: v.name, ...run(kind, v) });
    }
  }

  // Level 1: document fixtures (container layer). Read each committed case.cdx in
  // memory — NEVER extracted to disk (the corpus carries zip-slip/symlink/case
  // collisions by design) — run the reference reader + disposition mapper, and
  // report the verdict the suite compares against the case's expected interval.
  for (const c of loadFixtures(suiteRoot)) {
    const missing = c.requires.filter((k) => !CAP_SET.has(k));
    if (missing.length > 0) {
      results.push({ kind: c.kind, name: c.name, outcome: 'skip', skip: { reason: `missing capability: ${missing.join(', ')}` } });
      continue;
    }
    try {
      const bytes = fs.readFileSync(path.join(c.dir, 'case.cdx'));
      const verdict = archiveVerdict(readArchive(bytes).findings);
      results.push({ kind: c.kind, name: c.name, outcome: 'value', values: verdict as unknown as Record<string, unknown> });
    } catch (err) {
      results.push({ kind: c.kind, name: c.name, outcome: 'error', error: { code: (err as { code?: string }).code ?? null } });
    }
  }

  const report: AdapterReport = {
    suite: 'cdx-conformance',
    suiteVersion: suite.suiteVersion,
    specVersion: suite.specVersion,
    adapter: { name: 'cdx-reference', version: '0.1.0', level: 1, maxCanonicalizationDepth: MAX_CANONICALIZATION_DEPTH },
    capabilities: CAPABILITIES,
    results,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
