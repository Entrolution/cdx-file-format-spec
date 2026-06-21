#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the signature-SET integrity rules (Security Extension
 * §3.12) — the 3.3 anti-strip / anti-downgrade core.
 *
 * Part 1 — Combinator vectors: `evaluateRequiredSigners` reproduces each
 *   hand-derived outcome across the strip, downgrade, add/shadow, cross-path and
 *   idempotence cases. Defence-in-depth asserts both outcomes and every
 *   non-`valid` downgrade state are exercised.
 *
 * Part 2 — Malformed entries: the matcher fails closed on every ill-formed
 *   required-signer entry (no kind, two kinds, unknown kind, extra member,
 *   empty/non-string value).
 *
 * Part 3 — Corpus grounding: the real `signaturePolicy` in the signed-document
 *   example is consumable by the combinator — all-required-present-and-valid is
 *   satisfied, and downgrading any required signer to a non-`valid` state makes
 *   the set stripped. (The set rule's identity-match itself is a verifier
 *   obligation a spec-repo gate cannot execute — see §8.5 — exactly as the trust
 *   core's chain/revocation inputs are; this grounds the combinator, not a PKI.)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateRequiredSigners,
  requiredSignerMatcher,
  type RequiredSigner,
  type PresentSignerVerdict,
} from './lib/signature-set.js';
import { signatureSetVectors, malformedRequiredSigners } from './kat/signature-set-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: combinator vectors -------------------------------------------
console.log('Signature-set combinator vectors:');
for (const vec of signatureSetVectors) {
  const got = evaluateRequiredSigners(vec.present, vec.required);
  if (got.satisfied !== vec.expectedSatisfied || got.missing.length !== vec.expectedMissing) {
    fail(`${vec.name} — expected satisfied=${vec.expectedSatisfied} missing=${vec.expectedMissing}, got satisfied=${got.satisfied} missing=${got.missing.length}`);
    continue;
  }
  console.log(`  ✓ ${vec.name} → satisfied=${got.satisfied}, missing=${got.missing.length}`);
}

// Defence-in-depth: both outcomes and every non-valid downgrade state exercised.
if (!signatureSetVectors.some((v) => v.expectedSatisfied)) fail('no vector exercises satisfied=true');
if (!signatureSetVectors.some((v) => !v.expectedSatisfied)) fail('no vector exercises satisfied=false');
for (const state of ['invalid', 'expired', 'revoked', 'untrusted', 'unknown']) {
  if (!signatureSetVectors.some((v) => v.name === `downgrade-required-${state}`)) {
    fail(`no vector exercises a required signer downgraded to "${state}"`);
  }
}

// --- Part 2: malformed entries fail closed --------------------------------
console.log('\nMalformed required-signer entries (must throw):');
for (const m of malformedRequiredSigners) {
  let threw = false;
  try {
    requiredSignerMatcher(m.entry as RequiredSigner);
  } catch {
    threw = true;
  }
  if (!threw) {
    fail(`${m.name} — matcher accepted a malformed entry`);
  } else {
    console.log(`  ✓ ${m.name} → rejected`);
  }
}

// --- Part 3: corpus grounding ---------------------------------------------
console.log('\nCorpus grounding (signed-document signaturePolicy):');
const ground = (): void => {
  const manifestPath = path.join('examples', 'signed-document', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const required: RequiredSigner[] = manifest?.signaturePolicy?.requiredSigners;
  if (!Array.isArray(required) || required.length === 0) {
    fail('signed-document manifest declares no signaturePolicy.requiredSigners to ground against');
    return;
  }

  // Build a present verdict that satisfies each required entry (all valid).
  const matchers = required.map((r) => requiredSignerMatcher(r));
  const allValid: PresentSignerVerdict[] = matchers.map((m) => ({ path: m.path, identity: m.identity, state: 'valid' }));
  const full = evaluateRequiredSigners(allValid, required);
  if (!full.satisfied) {
    fail('all required signers present and valid did not satisfy the set');
  } else {
    console.log(`  ✓ ${required.length} required signer(s) present and valid → satisfied`);
  }

  // Downgrade the first required signer to each non-valid state → stripped.
  for (const state of ['invalid', 'expired', 'revoked', 'untrusted', 'unknown'] as const) {
    const downgraded: PresentSignerVerdict[] = allValid.map((v, i) => (i === 0 ? { ...v, state } : v));
    const res = evaluateRequiredSigners(downgraded, required);
    if (res.satisfied) {
      fail(`downgrading a required signer to "${state}" still satisfied the set`);
      return;
    }
  }
  console.log('  ✓ downgrading any required signer (invalid/expired/revoked/untrusted/unknown) → stripped');

  // Stripping the matching signature entirely → stripped.
  const stripped = evaluateRequiredSigners(allValid.slice(1), required);
  if (stripped.satisfied) {
    fail('stripping a required signer entirely still satisfied the set');
  } else {
    console.log('  ✓ stripping a required signer entirely → stripped');
  }
};
try {
  ground();
} catch (err) {
  fail(`corpus grounding threw: ${err instanceof Error ? err.message : String(err)}`);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Signature-set check failed.`);
  process.exit(1);
}
console.log(`\nAll ${signatureSetVectors.length} combinator vectors + ${malformedRequiredSigners.length} malformed-entry checks verified; corpus grounding passed.`);
