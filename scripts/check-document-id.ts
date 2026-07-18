#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the document-ID canonicalizer (Document Hashing §4).
 *
 * Part 1 — Known-answer vectors: asserts the canonicalizer reproduces each
 *   hand-authored canonical JCS and its independently-hashed id
 *   (scripts/kat/document-id-vectors.ts). These are the *independent* oracle:
 *   the expected bytes are written by hand and the expected id is `shasum` of
 *   those bytes, so a transform or serializer bug is caught, not snapshotted.
 *
 * Part 2 — Example corpus: recomputes every example's document id from its
 *   parts and asserts it equals the frozen `manifest.id`, and that any
 *   `signatures.json` `documentId` binds to it. This closes the document-id
 *   verification that validate-examples.ts intentionally leaves out of scope.
 */

import * as fs from 'fs';
import * as path from 'path';
import canonicalize from 'canonicalize';
import { canonicalContent, computeDocumentId, algorithmOf, type DocumentParts } from './lib/canonicalize.js';
import { vectors } from './kat/document-id-vectors.js';

let failures = 0;
let verified = 0;
let skipped = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: known-answer vectors -----------------------------------------
console.log('Known-answer vectors:');
for (const v of vectors) {
  const algorithm = v.algorithm ?? 'sha256';
  let jcs: string | undefined;
  let id: string | undefined;
  try {
    jcs = canonicalize(canonicalContent(v.parts));
    id = computeDocumentId(v.parts, algorithm);
  } catch (err) {
    fail(`${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (jcs !== v.expectedCanonicalJcs) {
    fail(`${v.name} — canonical JCS mismatch`);
    console.log(`      expected ${v.expectedCanonicalJcs}`);
    console.log(`      actual   ${jcs}`);
    continue;
  }
  if (id !== v.expectedId) {
    fail(`${v.name} — id mismatch (expected ${v.expectedId}, got ${id})`);
    continue;
  }
  console.log(`  ✓ ${v.name}`);
}

// Asset purity is a defining property: identical content with a renamed asset
// (same bytes) MUST yield the same id.
const orig = vectors.find((v) => v.name === 'asset-purity-original');
const renamed = vectors.find((v) => v.name === 'asset-purity-renamed');
if (orig && renamed && orig.expectedId !== renamed.expectedId) {
  fail('asset purity — renamed-asset id differs from original');
}

// Block-id purity is a defining property: two documents differing ONLY in their
// author-chosen block/anchor labels MUST yield the same id.
const labelsA = vectors.find((v) => v.name === 'alpha-rename-labels-a');
const labelsB = vectors.find((v) => v.name === 'alpha-rename-labels-b');
if (labelsA && labelsB && labelsA.expectedId !== labelsB.expectedId) {
  fail('block-id purity — relabeled-document id differs from original');
}

// --- Part 2: example corpus -----------------------------------------------
console.log('\nExample corpus document ids:');
const examplesDir = path.join(__dirname, '..', 'examples');
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(examplesDir, name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`${name} — manifest parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (manifest.id === 'pending') {
    console.log(`  - ${name} (id pending — draft, skipped)`);
    skipped++;
    continue;
  }

  // §3.3: `hashAlgorithm`, when present, MUST equal the id's algorithm prefix.
  // The id is computed with algorithmOf(manifest.id) below, so a manifest whose
  // advertised hashAlgorithm disagreed with its id prefix would recompute cleanly
  // yet mislead any verifier that keys the digest algorithm off hashAlgorithm.
  if (manifest.hashAlgorithm !== undefined) {
    let idAlgorithm: string;
    try {
      idAlgorithm = algorithmOf(manifest.id);
    } catch (err) {
      fail(`${name} — cannot derive id algorithm: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (manifest.hashAlgorithm !== idAlgorithm) {
      fail(`${name} — manifest.hashAlgorithm (${JSON.stringify(manifest.hashAlgorithm)}) does not equal the id prefix (${idAlgorithm})`);
      continue;
    }
  }

  const read = (rel: string): string => fs.readFileSync(path.join(dir, rel), 'utf8');
  let id: string;
  try {
    const assetIndexes: Record<string, string> = {};
    for (const [category, cat] of Object.entries<{ index: string }>(manifest.assets ?? {})) {
      assetIndexes[category] = read(cat.index);
    }
    const parts: DocumentParts = {
      manifest: read('manifest.json'),
      content: read(manifest.content.path),
      dublinCore: read(manifest.metadata.dublinCore),
      assetIndexes: Object.keys(assetIndexes).length ? assetIndexes : undefined,
    };
    id = computeDocumentId(parts, algorithmOf(manifest.id));
  } catch (err) {
    fail(`${name} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  if (id !== manifest.id) {
    fail(`${name} — document id mismatch`);
    console.log(`      manifest ${manifest.id}`);
    console.log(`      computed ${id}`);
    continue;
  }
  console.log(`  ✓ ${name}`);
  verified++;

  // A signatures part's documentId must bind to the document id it signs.
  const sigRel = manifest.security?.signatures;
  if (typeof sigRel === 'string' && fs.existsSync(path.join(dir, sigRel))) {
    try {
      const sig = JSON.parse(read(sigRel));
      if (typeof sig.documentId === 'string' && sig.documentId !== manifest.id) {
        fail(`${name} — signatures.documentId (${sig.documentId}) does not match manifest.id`);
      }
    } catch (err) {
      fail(`${name} — signatures.json parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Document-ID check failed.`);
  process.exit(1);
}
console.log(`\nAll known-answer vectors verified; ${verified} example document id(s) verified, ${skipped} pending/skipped.`);
