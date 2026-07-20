#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the signed manifest projection (Security Extension §9.7)
 * and the scoped-signature serialization (§9.5).
 *
 * Part 1 — Projection known-answer vectors: asserts the projector reproduces each
 *   hand-specified canonical JCS and its independently-computed sha256
 *   (scripts/kat/manifest-projection-vectors.ts). The expected bytes and hash are
 *   produced by an out-of-band serializer, so a transform/serializer bug is
 *   caught against an independent oracle, not snapshotted.
 *
 * Part 2 — Scope serialization vectors: pins the existing `JCS(scope)` signing
 *   construction (which previously had no test) before/while `scope.manifest`
 *   extends it.
 *
 * Part 3 — Error vectors: asserts the projector rejects the inputs it must
 *   (pending id, malformed hash, duplicate extension id).
 *
 * Part 4 — Example corpus: enforces the coverage policy — a `frozen`/`published`
 *   document's signatures MUST carry `scope.manifest`, and every stored
 *   `scope.manifest` MUST equal the projection recomputed from the manifest (and
 *   `scope.documentId` MUST equal `manifest.id`).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { jcsOf, CanonicalizationError } from './lib/canonicalize.js';
import { unregisteredCodes } from './lib/error-codes.js';
import { projectManifest, projectManifestToJcs } from './lib/manifest-projection.js';
import { projectionVectors, scopeVectors, errorVectors } from './kat/manifest-projection-vectors.js';
import { getValidator } from './lib/part-schema.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

const sha256Of = (s: string): string => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// The projector's output is signed bytes, but the published manifestProjection
// schema is what a schema-only re-implementer relies on — the two must agree. This
// asserts every projection the code emits validates against the schema, so a field
// the projector produces that the schema forbids (or vice versa) fails here instead
// of shipping as a silent code↔schema divergence.
const validateProjection = getValidator('security.schema.json', '#/$defs/manifestProjection');
const schemaCheck = (label: string, projection: unknown): void => {
  if (!validateProjection(projection)) {
    fail(`${label} — projector output does not validate against the manifestProjection schema: ${JSON.stringify(validateProjection.errors)}`);
  }
};

/** States in which a signature MUST cover the manifest projection (§9.7). */
const COVERAGE_REQUIRED_STATES = new Set(['frozen', 'published']);

// --- Part 1: projection known-answer vectors -------------------------------
console.log('Manifest-projection known-answer vectors:');
for (const v of projectionVectors) {
  let jcs: string;
  try {
    jcs = projectManifestToJcs(v.manifest);
  } catch (err) {
    fail(`${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (jcs !== v.expectedJcs) {
    fail(`${v.name} — canonical JCS mismatch`);
    console.log(`      expected ${v.expectedJcs}`);
    console.log(`      actual   ${jcs}`);
    continue;
  }
  if (sha256Of(jcs) !== v.expectedSha256) {
    fail(`${v.name} — sha256 mismatch (expected ${v.expectedSha256}, got ${sha256Of(jcs)})`);
    continue;
  }
  schemaCheck(v.name, JSON.parse(jcs));
  console.log(`  ✓ ${v.name}`);
}

// --- Part 2: scope serialization vectors -----------------------------------
console.log('\nScope serialization vectors:');
for (const v of scopeVectors) {
  let jcs: string;
  try {
    jcs = jcsOf(v.scope);
  } catch (err) {
    fail(`${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (jcs !== v.expectedJcs) {
    fail(`${v.name} — JCS(scope) mismatch`);
    console.log(`      expected ${v.expectedJcs}`);
    console.log(`      actual   ${jcs}`);
    continue;
  }
  if (sha256Of(jcs) !== v.expectedSha256) {
    fail(`${v.name} — sha256 mismatch (expected ${v.expectedSha256}, got ${sha256Of(jcs)})`);
    continue;
  }
  console.log(`  ✓ ${v.name}`);
}

// --- Part 3: error vectors -------------------------------------------------
console.log('\nProjection error vectors:');
for (const v of errorVectors) {
  try {
    projectManifest(v.manifest);
    fail(`${v.name} — expected ${v.expectedCode}, but no error was thrown`);
  } catch (err) {
    // Assert the TYPE, the CODE, and the message. The code is the portable
    // assertion; the message pins the specific throw site, so a vector that
    // starts failing closed at a *different* site than the one its code was
    // assigned to is caught rather than silently passing on the wrong defect.
    if (!(err instanceof CanonicalizationError)) {
      fail(`${v.name} — expected a CanonicalizationError, got ${err instanceof Error ? err.name : typeof err}: ${String(err)}`);
      continue;
    }
    const problems: string[] = [];
    if (err.code !== v.expectedCode) problems.push(`code "${err.code ?? '(none)'}" != "${v.expectedCode}"`);
    if (!err.message.includes(v.expectedError)) problems.push(`message "${err.message}" does not contain "${v.expectedError}"`);
    if (problems.length > 0) {
      fail(`${v.name} — ${problems.join('; ')}`);
    } else {
      console.log(`  ✓ ${v.name} (${err.code})`);
    }
  }
}

// Defence-in-depth: every code a vector expects must be REGISTERED in the
// vocabulary shipped to external implementations — otherwise a typo'd code
// would assert against something no implementation could ever emit.
for (const problem of unregisteredCodes(errorVectors.map((v) => v.expectedCode))) {
  fail(`projection error vectors — ${problem}`);
}

// --- Part 4: example corpus ------------------------------------------------
console.log('\nExample corpus manifest coverage:');
const examplesDir = path.join(__dirname, '..', 'examples');
let covered = 0;
let skipped = 0;
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(examplesDir, name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;

  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  let manifest: any;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    fail(`${name} — manifest parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const sigRel = manifest.security?.signatures;
  if (typeof sigRel !== 'string' || !fs.existsSync(path.join(dir, sigRel))) {
    continue; // no signatures part to check
  }
  if (manifest.id === 'pending') {
    console.log(`  - ${name} (id pending — draft, skipped)`);
    skipped++;
    continue;
  }

  let expectedProjectionJcs: string;
  let sig: any;
  try {
    expectedProjectionJcs = projectManifestToJcs(manifestText);
    sig = JSON.parse(fs.readFileSync(path.join(dir, sigRel), 'utf8'));
  } catch (err) {
    fail(`${name} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  schemaCheck(`${name} recomputed projection`, JSON.parse(expectedProjectionJcs));

  const requireCoverage = COVERAGE_REQUIRED_STATES.has(manifest.state);
  const signatures: any[] = Array.isArray(sig.signatures) ? sig.signatures : [];
  for (const s of signatures) {
    const id = s?.id ?? '(unnamed)';
    const scope = s?.scope;
    const hasManifest = scope != null && scope.manifest !== undefined;

    if (requireCoverage && !hasManifest) {
      fail(`${name} signature "${id}" — document is ${manifest.state} but the signature does not cover the manifest (scope.manifest absent)`);
      continue;
    }
    if (scope != null) {
      if (typeof scope.documentId === 'string' && scope.documentId !== manifest.id) {
        fail(`${name} signature "${id}" — scope.documentId (${scope.documentId}) does not match manifest.id`);
      }
      if (hasManifest) {
        const storedJcs = jcsOf(scope.manifest);
        if (storedJcs !== expectedProjectionJcs) {
          fail(`${name} signature "${id}" — scope.manifest does not match the projection recomputed from the manifest`);
          console.log(`      expected ${expectedProjectionJcs}`);
          console.log(`      stored   ${storedJcs}`);
        }
      }
    }
  }
  console.log(`  ✓ ${name} (${manifest.state}; ${signatures.length} signature(s))`);
  covered++;
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Manifest-projection check failed.`);
  process.exit(1);
}
console.log(`\nAll projection/scope vectors verified; ${covered} signed example(s) checked, ${skipped} pending/skipped.`);
