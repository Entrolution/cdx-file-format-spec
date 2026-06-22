#!/usr/bin/env npx tsx

/**
 * Enforcing gate for lineage-chain verification (core 09 §3.3) — the
 * chain-validity contract.
 *
 * Part 1 — Chain vectors: `verifyLineageChain` reproduces each hand-derived
 *   three-state outcome (verified / incomplete / rejected) across the root,
 *   linear, cycle, forged-tail, ancestors-mismatch, unresolvable, depth-bound,
 *   and advisory (depth/version warning) cases. Defence-in-depth asserts all
 *   three outcomes are exercised.
 *
 * Part 2 — Corpus grounding: the lineage actually shipped in the example corpus
 *   (manifest and provenance roots) verifies. (Resolving and content-hashing
 *   real ancestors across an archive is a verifier obligation a spec-repo gate
 *   cannot run — core 09 §3.3; the combinator and its contract are what is
 *   pinned here, exactly as for the trust-state machine.)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  verifyLineageChain,
  type LineageDoc,
  type LineageResolver,
} from './lib/lineage-chain.js';
import { lineageVectors } from './kat/lineage-chain-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: chain vectors -------------------------------------------------
console.log('Lineage-chain vectors:');
for (const vec of lineageVectors) {
  const byId = new Map(vec.docs.map((d) => [d.id, d]));
  const resolve: LineageResolver = (id) => byId.get(id);
  const got = verifyLineageChain(vec.subject, resolve, vec.maxDepth !== undefined ? { maxDepth: vec.maxDepth } : {});
  const e = vec.expected;
  const problems: string[] = [];
  if (got.outcome !== e.outcome) problems.push(`outcome ${got.outcome} != ${e.outcome}`);
  if (e.resolvedDepth !== undefined && got.resolvedDepth !== e.resolvedDepth) problems.push(`resolvedDepth ${got.resolvedDepth} != ${e.resolvedDepth}`);
  if (e.reasonIncludes !== undefined && !(got.reason ?? '').includes(e.reasonIncludes)) problems.push(`reason ${JSON.stringify(got.reason)} lacks ${JSON.stringify(e.reasonIncludes)}`);
  if (e.warnings !== undefined && got.warnings.length !== e.warnings) problems.push(`warnings ${got.warnings.length} != ${e.warnings}`);
  if (problems.length > 0) {
    fail(`${vec.name} — ${problems.join('; ')}`);
  } else {
    console.log(`  ✓ ${vec.name} → ${got.outcome}`);
  }
}

// Defence-in-depth: every outcome in the contract must be exercised.
const seen = new Set(lineageVectors.map((v) => v.expected.outcome));
for (const outcome of ['verified', 'incomplete', 'rejected']) {
  if (!seen.has(outcome as never)) fail(`outcome "${outcome}" is never exercised by a vector`);
}

// --- Part 2: corpus grounding ----------------------------------------------
console.log('\nCorpus lineage grounding:');
const ground = (): void => {
  const examplesDir = path.join(__dirname, '..', 'examples');
  let checked = 0;

  // Collect the lineage roots shipped in the corpus: each manifest.lineage and
  // each provenance-record lineage. The corpus documents are standalone roots,
  // so each must verify as a root; a non-root that fails to resolve its parent
  // here would (correctly) report incomplete rather than verified.
  const candidates: { label: string; doc: LineageDoc }[] = [];
  for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const dir = path.join(examplesDir, name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest: any;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }

    if (manifest.lineage && typeof manifest.id === 'string' && manifest.id !== 'pending') {
      const l = manifest.lineage;
      candidates.push({ label: `${name} manifest`, doc: { id: manifest.id, parent: l.parent ?? null, ancestors: l.ancestors, depth: l.depth, version: l.version } });
    }
    const provRel = typeof manifest.provenance === 'string' ? manifest.provenance : undefined;
    if (provRel && fs.existsSync(path.join(dir, provRel))) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, provRel), 'utf8'));
        if (rec.lineage && typeof rec.documentId === 'string') {
          const l = rec.lineage;
          candidates.push({ label: `${name} provenance`, doc: { id: rec.documentId, parent: l.parent ?? null, ancestors: l.ancestors, depth: l.depth, version: l.version } });
        }
      } catch { /* schema validation covers malformed records */ }
    }
  }

  // A shared store keyed by id, so a non-root corpus document (should one ever be
  // added) is walked against the real chain rather than a single-document view.
  const store = new Map<string, LineageDoc>();
  for (const c of candidates) store.set(c.doc.id, c.doc);
  const resolve: LineageResolver = (id) => store.get(id);
  for (const c of candidates) {
    const res = verifyLineageChain(c.doc.id, resolve);
    if (c.doc.parent === null) {
      if (res.outcome !== 'verified') {
        fail(`${c.label} — a root lineage did not verify (got ${res.outcome}: ${res.reason ?? ''})`);
        continue;
      }
      console.log(`  ✓ ${c.label} (root) → verified`);
    } else if (res.outcome === 'rejected') {
      fail(`${c.label} — lineage rejected: ${res.reason}`);
      continue;
    } else {
      console.log(`  ✓ ${c.label} (non-root) → ${res.outcome} (ancestors not resolvable in a spec-repo gate)`);
    }
    checked++;
  }
  if (checked === 0) fail('no corpus lineage found to ground against');
};
try {
  ground();
} catch (err) {
  fail(`corpus grounding threw: ${err instanceof Error ? err.message : String(err)}`);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Lineage check failed.`);
  process.exit(1);
}
console.log(`\nAll ${lineageVectors.length} lineage-chain vectors verified; corpus grounding passed.`);
