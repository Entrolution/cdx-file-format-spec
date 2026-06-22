#!/usr/bin/env npx tsx

/**
 * Enforcing gate for schema closure (Phase 4) — proves that objects declared
 * "closed" actually REJECT unknown properties. This is the negative half of
 * coverage that validate-examples cannot give: validate-examples only confirms
 * that valid instances pass, never that malformed instances fail.
 *
 * Part 1 — Closure vectors: for each closed object, a minimal instance MUST
 *   validate (guards against an over-tight closure) and a near-identical instance
 *   carrying one unknown key MUST be rejected (proves the closure has teeth).
 *   An intentionally-open bag (e.g. asset.metadata) is pinned the other way: its
 *   valid instance carries an arbitrary key that MUST still be accepted.
 *
 * Part 2 — Coverage: every schema in CLOSED_SCHEMAS must own at least one vector,
 *   so a future increment cannot close a schema without adding a closure vector.
 *
 * The gate grows per increment: each closure increment appends its objects to
 * scripts/kat/schema-closure-vectors.ts and its schema to CLOSED_SCHEMAS.
 */

import { getValidator } from './lib/part-schema.js';
import { closureVectors, CLOSED_SCHEMAS } from './kat/schema-closure-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: closure vectors -----------------------------------------------
console.log('Schema-closure vectors:');
const covered = new Set<string>();
for (const v of closureVectors) {
  const label = `${v.schema}${v.ref ?? ''} (${v.description})`;
  covered.add(v.schema);
  let validate;
  try {
    validate = getValidator(v.schema, v.ref);
  } catch (err) {
    fail(`${label} — failed to compile: ${(err as Error).message}`);
    continue;
  }
  if (!validate(v.validInstance)) {
    fail(`${label} — valid instance REJECTED: ${JSON.stringify(validate.errors)}`);
  } else if (validate(v.invalidInstance)) {
    fail(`${label} — invalid instance ACCEPTED (closure has no teeth)`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// --- Part 2: every closed schema must own a vector -------------------------
for (const s of CLOSED_SCHEMAS) {
  if (!covered.has(s)) fail(`closed schema ${s} has no closure vector`);
}

if (failures > 0) {
  console.log(`\n${failures} schema-closure check(s) failed`);
  process.exit(1);
}
console.log(`\n✓ schema-closure: ${closureVectors.length} vectors across ${CLOSED_SCHEMAS.length} schemas, all closures have teeth`);
