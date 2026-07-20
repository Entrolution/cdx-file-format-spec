#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the conformance suite skeleton (Level 0).
 *
 * Part 1 — Engine self-test: drives the comparison engine
 *   (scripts/lib/conformance-suite.ts) through EVERY verdict branch on synthetic
 *   in-memory fixtures — pass, MUST-fail, SHOULD-advisory, capability-skip,
 *   adapter self-skip, missing result, error-kind match/mismatch, extra result,
 *   and the requires-key lint. This is what makes the gate provably able to
 *   FAIL: without it, an all-green integration run cannot distinguish "the
 *   engine verified everything" from "the engine can't detect anything".
 *
 * Part 2 — Suite integrity: the suite's own artifacts are coherent — every
 *   published vector kind has a comparator and vice versa; suite.json,
 *   capabilities.json and report.schema.json are present and internally
 *   consistent; every vector's `requires[]` names a real capability.
 *
 * Part 3 — End-to-end: runs the reference adapter as a SUBPROCESS over the real
 *   suite (the exact file-based protocol a third-party adapter uses — read the
 *   suite, write a report to stdout), validates the report against
 *   report.schema.json, and evaluates it. The reference implementation must PASS
 *   every published vector, with no skips, no advisories, no missing and no
 *   extra results — anything else is a real divergence between the reference
 *   libraries and their own published vectors, surfaced through the very path an
 *   outside implementation will exercise.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createAjv } from './lib/ajv-utils.js';
import { allVectorKinds, loadVectorFile } from './lib/conformance-vectors.js';
import {
  comparableKinds,
  evaluate,
  scopeOf,
  validateRequiresKeys,
  type AdapterReport,
  type AdapterResult,
  type SuiteCaseGroup,
  type SuiteVector,
} from './lib/conformance-suite.js';

const CONFORMANCE_DIR = path.join(__dirname, '..', 'conformance');
const ADAPTER = path.join(__dirname, 'conformance-reference-adapter.ts');

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};
const ok = (msg: string): void => console.log(`  ✓ ${msg}`);

// --- Part 1: engine self-test ----------------------------------------------
console.log('Engine self-test (synthetic fixtures):');

const val = (values: Record<string, unknown>): Pick<AdapterResult, 'outcome' | 'values'> => ({ outcome: 'value', values });
const err = (code: string): Pick<AdapterResult, 'outcome' | 'error'> => ({ outcome: 'error', error: { code } });

// 1a. Verdict bucketing: one group whose vectors trigger every verdict branch.
{
  const groups: SuiteCaseGroup[] = [
    {
      kind: 'document-id',
      vectors: [
        { name: 'pass', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
        { name: 'must-fail', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
        { name: 'should-fail', severity: 'SHOULD', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
        { name: 'cap-skip', requires: ['hash:blake3'], expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
        { name: 'must-missing', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
        { name: 'should-missing', severity: 'SHOULD', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
        { name: 'self-skip-must', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' },
      ] as SuiteVector[],
    },
    {
      kind: 'manifest-projection-errors',
      vectors: [
        { name: 'err-pass', expect: { code: 'CDX-E-MANIFEST-HASH-MALFORMED' } },
        { name: 'err-fail', expect: { code: 'CDX-E-MANIFEST-HASH-MALFORMED' } },
      ] as unknown as SuiteVector[],
    },
  ];

  const report: AdapterReport = {
    suite: 'cdx-conformance',
    suiteVersion: '0.1.0',
    specVersion: '0.1',
    adapter: { name: 'synthetic', version: '0', level: 0 },
    capabilities: ['core'], // deliberately WITHOUT hash:blake3, so cap-skip skips
    results: [
      { kind: 'document-id', name: 'pass', ...val({ canonicalJcs: '{}', id: 'sha256:aa' }) },
      { kind: 'document-id', name: 'must-fail', ...val({ canonicalJcs: '{}', id: 'sha256:WRONG' }) },
      { kind: 'document-id', name: 'should-fail', ...val({ canonicalJcs: '{}', id: 'sha256:WRONG' }) },
      // cap-skip: no result (scoped out before lookup regardless)
      // must-missing, should-missing: no result
      { kind: 'document-id', name: 'self-skip-must', outcome: 'skip', skip: { reason: 'demonstration' } },
      { kind: 'manifest-projection-errors', name: 'err-pass', ...err('CDX-E-MANIFEST-HASH-MALFORMED') },
      { kind: 'manifest-projection-errors', name: 'err-fail', ...val({}) },
      { kind: 'document-id', name: 'ghost', ...val({}) }, // extra: no such vector
    ],
  };

  const v = evaluate(groups, report);
  const status = (name: string): string | undefined => v.cases.find((c) => c.name === name)?.status;
  const expectStatus = (name: string, want: string): void => {
    const got = status(name);
    if (got === want) ok(`${name} → ${want}`);
    else fail(`${name} → expected ${want}, got ${got ?? '(no case)'}`);
  };

  expectStatus('pass', 'pass');
  expectStatus('must-fail', 'fail');
  expectStatus('should-fail', 'fail');
  expectStatus('cap-skip', 'skip');
  expectStatus('must-missing', 'missing');
  expectStatus('should-missing', 'missing');
  expectStatus('self-skip-must', 'missing'); // a self-skip of an in-scope MUST is a shortfall, not a skip
  expectStatus('err-pass', 'pass');
  expectStatus('err-fail', 'fail');

  const check = (label: string, got: number, want: number): void =>
    got === want ? ok(`${label} = ${want}`) : fail(`${label} = ${got}, expected ${want}`);
  check('passed', v.passed, 2); // pass, err-pass
  check('failed (fatal)', v.failed, 4); // must-fail, must-missing, self-skip-must, err-fail
  check('advisory (non-fatal)', v.advisory, 2); // should-fail, should-missing
  check('skipped', v.skipped, 1); // cap-skip only (self-skip of a MUST is fatal, not a skip)
  if (v.extraResults.length === 1 && v.extraResults[0] === 'document-id/ghost') ok('extraResults surfaced');
  else fail(`extraResults = ${JSON.stringify(v.extraResults)}, expected ["document-id/ghost"]`);
  if (v.ok === false) ok('overall ok=false (fatal failures present)');
  else fail('overall ok should be false when fatal failures exist');

  // A clean report over the same groups (all in-scope and matching) must be ok=true.
  const clean: AdapterReport = {
    ...report,
    capabilities: ['core', 'hash:blake3'],
    results: groups.flatMap((g) =>
      g.vectors.map((vec) =>
        g.kind === 'manifest-projection-errors'
          ? { kind: g.kind, name: vec.name, ...err('CDX-E-MANIFEST-HASH-MALFORMED') }
          : { kind: g.kind, name: vec.name, ...val({ canonicalJcs: '{}', id: 'sha256:aa' }) },
      ),
    ),
  };
  const cleanV = evaluate(groups, clean);
  if (cleanV.ok && cleanV.failed === 0 && cleanV.skipped === 0 && cleanV.passed === 9) ok('clean report → ok=true, 9 passed, 0 fatal, 0 skip');
  else fail(`clean report verdict wrong: ${JSON.stringify({ ok: cleanV.ok, passed: cleanV.passed, failed: cleanV.failed, skipped: cleanV.skipped })}`);
}

// 1b. Every comparator's FAIL path fires. The end-to-end run only ever feeds a
// correct reference, so without this a toothless or wrong-field comparator for
// 10 of 12 kinds would go undetected. Each row feeds a deliberately-wrong actual
// and asserts the single case FAILS — one perturbation per asserted field.
{
  const NEG: Array<[string, string, SuiteVector, Pick<AdapterResult, 'outcome' | 'values' | 'error'>]> = [
    ['document-id id', 'document-id', { name: 'n', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' }, val({ canonicalJcs: '{}', id: 'sha256:bb' })],
    ['document-id jcs', 'document-id', { name: 'n', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' }, val({ canonicalJcs: '{"x":1}', id: 'sha256:aa' })],
    ['document-id returned-error', 'document-id', { name: 'n', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' }, err('CDX-E-X')],
    ['manifest-projection jcs', 'manifest-projection', { name: 'n', expectedJcs: '{}', expectedSha256: 'sha256:aa' }, val({ jcs: '{"x":1}', sha256: 'sha256:aa' })],
    ['manifest-projection sha', 'manifest-projection', { name: 'n', expectedJcs: '{}', expectedSha256: 'sha256:aa' }, val({ jcs: '{}', sha256: 'sha256:bb' })],
    ['manifest-scope jcs', 'manifest-scope', { name: 'n', expectedJcs: '{}', expectedSha256: 'sha256:aa' }, val({ jcs: '{"x":1}', sha256: 'sha256:aa' })],
    ['manifest-scope sha', 'manifest-scope', { name: 'n', expectedJcs: '{}', expectedSha256: 'sha256:aa' }, val({ jcs: '{}', sha256: 'sha256:bb' })],
    ['mpe wrong-code', 'manifest-projection-errors', { name: 'n', expect: { code: 'CDX-E-A' } } as unknown as SuiteVector, err('CDX-E-B')],
    ['mpe returned-value', 'manifest-projection-errors', { name: 'n', expect: { code: 'CDX-E-A' } } as unknown as SuiteVector, val({})],
    ['jws-header', 'jws-header', { name: 'n', expectedProtected: 'eyAA' }, val({ protectedHeader: 'eyBB' })],
    ['jws-signing-input', 'jws-signing-input', { name: 'n', expectedSha256: 'sha256:aa' }, val({ signingInputSha256: 'sha256:bb' })],
    ['jwk-thumbprint', 'jwk-thumbprint', { name: 'n', expectedJkt: 'aa' }, val({ thumbprint: 'bb' })],
    ['multibase jwk', 'multibase', { name: 'n', expectedJwk: { kty: 'EC', crv: 'P-256' }, expectedJkt: 'aa' }, val({ jwk: { kty: 'OKP', crv: 'P-256' }, thumbprint: 'aa' })],
    ['multibase thumbprint', 'multibase', { name: 'n', expectedJwk: { kty: 'EC' }, expectedJkt: 'aa' }, val({ jwk: { kty: 'EC' }, thumbprint: 'bb' })],
    ['block-merkle-root', 'block-merkle-root', { name: 'n', root: 'sha256:aa' }, val({ root: 'sha256:bb' })],
    ['block-merkle-inclusion', 'block-merkle-inclusion', { name: 'n', expected: true }, val({ included: false })],
    ['block-merkle-leaf jcs', 'block-merkle-leaf', { name: 'n', jcs: '{}', hash: 'sha256:aa' }, val({ leafJcs: '{"x":1}', leafHash: 'sha256:aa' })],
    ['block-merkle-leaf hash', 'block-merkle-leaf', { name: 'n', jcs: '{}', hash: 'sha256:aa' }, val({ leafJcs: '{}', leafHash: 'sha256:bb' })],
    ['provenance boundToDocument', 'provenance-timestamp', { name: 'n', expected: { boundToDocument: true, problemsEmpty: true } } as unknown as SuiteVector, val({ boundToDocument: false, problemsEmpty: true })],
    ['provenance problemsEmpty', 'provenance-timestamp', { name: 'n', expected: { boundToDocument: true, problemsEmpty: true } } as unknown as SuiteVector, val({ boundToDocument: true, problemsEmpty: false })],
    ['provenance merkleVerified', 'provenance-timestamp', { name: 'n', expected: { boundToDocument: true, merkleVerified: true, problemsEmpty: true } } as unknown as SuiteVector, val({ boundToDocument: true, merkleVerified: false, problemsEmpty: true })],
    ['provenance leaf', 'provenance-timestamp', { name: 'n', expected: { boundToDocument: true, leaf: 'sha256:aa', problemsEmpty: true } } as unknown as SuiteVector, val({ boundToDocument: true, leaf: 'sha256:bb', problemsEmpty: true })],
  ];
  const report = (kind: string, result: Pick<AdapterResult, 'outcome' | 'values' | 'error'>): AdapterReport => ({
    suite: 'cdx-conformance', suiteVersion: '0.1.0', specVersion: '0.1',
    adapter: { name: 'synthetic', version: '0', level: 0 }, capabilities: ['core'],
    results: [{ kind, name: 'n', ...result }],
  });
  const kindsCovered = new Set<string>();
  let allFail = true;
  for (const [label, kind, vector, result] of NEG) {
    kindsCovered.add(kind);
    const verdict = evaluate([{ kind, vectors: [vector] }], report(kind, result));
    if (verdict.cases[0]?.status !== 'fail') { fail(`negative fixture "${label}" did not FAIL (got ${verdict.cases[0]?.status})`); allFail = false; }
  }
  if (allFail) ok(`all ${NEG.length} negative fixtures FAILED as required`);
  const uncovered = comparableKinds().filter((k) => !kindsCovered.has(k));
  if (uncovered.length === 0) ok(`every comparable kind (${comparableKinds().length}) has a negative fixture`);
  else fail(`kinds with no negative fixture: ${uncovered.join(', ')}`);

  // multibase JWK compare is by VALUE, not member order: a reordered-but-equal
  // JWK must PASS (the spec's canonical order is crv,kty,x,y, not the emit order).
  const reorder = evaluate(
    [{ kind: 'multibase', vectors: [{ name: 'n', expectedJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }, expectedJkt: 'aa' } as SuiteVector] }],
    report('multibase', val({ jwk: { crv: 'P-256', kty: 'EC', y: 'b', x: 'a' }, thumbprint: 'aa' })),
  );
  if (reorder.cases[0]?.status === 'pass') ok('multibase JWK compared by value (member order ignored)');
  else fail(`multibase reordered JWK should PASS, got ${reorder.cases[0]?.status}: ${reorder.cases[0]?.detail}`);
}

// 1c. Scoping helpers, file-level requires, and the requires-key lint.
{
  const caps = new Set(['core', 'hash:sha-384']);
  if (scopeOf(['hash:sha-384'], caps).inScope) ok('scopeOf: declared requirement in scope');
  else fail('scopeOf: declared requirement should be in scope');
  const s = scopeOf(['hash:blake3'], caps);
  if (!s.inScope && s.missing[0] === 'hash:blake3') ok('scopeOf: undeclared requirement out of scope');
  else fail('scopeOf: undeclared requirement should be out of scope');

  // A file-level requirement scopes every vector in the file.
  const fileGroups: SuiteCaseGroup[] = [{ kind: 'document-id', requires: ['ext:security'], vectors: [{ name: 'n', expectedCanonicalJcs: '{}', expectedId: 'sha256:aa' } as SuiteVector] }];
  const rep = (capsArr: string[]): AdapterReport => ({
    suite: 'cdx-conformance', suiteVersion: '0.1.0', specVersion: '0.1',
    adapter: { name: 's', version: '0', level: 0 }, capabilities: capsArr,
    results: [{ kind: 'document-id', name: 'n', ...val({ canonicalJcs: '{}', id: 'sha256:aa' }) }],
  });
  if (evaluate(fileGroups, rep(['core'])).cases[0]?.status === 'skip') ok('file-level requires scopes out an undeclared adapter');
  else fail('file-level requires should scope out an adapter lacking the capability');
  if (evaluate(fileGroups, rep(['core', 'ext:security'])).cases[0]?.status === 'pass') ok('file-level requires runs for a declaring adapter');
  else fail('file-level requires should run for an adapter that declares the capability');

  const catalog = new Set(['core', 'hash:sha-384', 'ext:security']);
  const lintBad = validateRequiresKeys([{ kind: 'k', requires: ['bogus'], vectors: [{ name: 'v' } as SuiteVector] }], catalog);
  if (lintBad.length === 1) ok('requires-key lint flags an unknown file-level capability');
  else fail(`requires-key lint should flag unknown key, got ${JSON.stringify(lintBad)}`);
  const lintGood = validateRequiresKeys([{ kind: 'k', requires: ['ext:security'], vectors: [{ name: 'v', requires: ['hash:sha-384'] } as SuiteVector] }], catalog);
  if (lintGood.length === 0) ok('requires-key lint accepts known file- and vector-level capabilities');
  else fail(`requires-key lint should accept known keys, got ${JSON.stringify(lintGood)}`);
}

// --- Part 2: suite integrity -----------------------------------------------
console.log('\nSuite integrity:');
const suite = JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, 'suite.json'), 'utf8'));
const capabilitiesDoc = JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, 'capabilities.json'), 'utf8'));
const catalog = new Set<string>(Object.keys(capabilitiesDoc.capabilities ?? {}));

if (!catalog.has('core')) fail('capabilities.json does not define the mandatory `core` capability');
else ok('capabilities.json defines `core`');

// Every published vector kind has a comparator, and every comparator kind is published.
const publishedKinds = allVectorKinds();
const engineKinds = comparableKinds();
const missingComparator = publishedKinds.filter((k) => !engineKinds.includes(k));
const orphanComparator = engineKinds.filter((k) => !publishedKinds.includes(k));
if (missingComparator.length > 0) fail(`vector kinds with no comparator: ${missingComparator.join(', ')}`);
if (orphanComparator.length > 0) fail(`comparators with no published vectors: ${orphanComparator.join(', ')}`);
if (missingComparator.length === 0 && orphanComparator.length === 0) ok(`${publishedKinds.length} kinds each have a comparator`);

// Load every vector file (schema-validated) and lint its requires[] and severities.
const groups: SuiteCaseGroup[] = [];
let totalVectors = 0;
for (const kind of publishedKinds) {
  const file = loadVectorFile<SuiteVector>(kind);
  groups.push({ kind, requires: file.requires, vectors: file.vectors });
  totalVectors += file.vectors.length;
  for (const v of file.vectors) {
    if (v.severity !== undefined && v.severity !== 'MUST' && v.severity !== 'SHOULD') {
      fail(`${kind}/${v.name} has invalid severity ${JSON.stringify(v.severity)}`);
    }
  }
}
const requiresProblems = validateRequiresKeys(groups, catalog);
for (const p of requiresProblems) fail(`requires lint — ${p}`);
if (requiresProblems.length === 0) ok(`${totalVectors} vectors; every requires[] names a real capability`);

// report.schema.json compiles.
let validateReport: ((r: unknown) => boolean) & { errors?: unknown };
try {
  const schema = JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, 'report.schema.json'), 'utf8'));
  validateReport = createAjv().compile(schema) as typeof validateReport;
  ok('report.schema.json compiles');
} catch (err) {
  fail(`report.schema.json does not compile: ${err instanceof Error ? err.message : String(err)}`);
  validateReport = () => true;
}

// --- Part 3: end-to-end reference adapter ----------------------------------
console.log('\nReference adapter (subprocess, file-based protocol):');
let report: AdapterReport;
try {
  const stdout = execFileSync('npx', ['tsx', ADAPTER, CONFORMANCE_DIR], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  report = JSON.parse(stdout);
  ok('reference adapter produced a report');
} catch (err) {
  fail(`reference adapter failed to run: ${err instanceof Error ? err.message : String(err)}`);
  report = { suite: 'cdx-conformance', suiteVersion: '', specVersion: '', adapter: { name: '', version: '', level: 0 }, capabilities: ['core'], results: [] };
}

if (!validateReport(report)) {
  fail(`adapter report does not validate against report.schema.json: ${JSON.stringify(validateReport.errors)}`);
} else {
  ok('report validates against report.schema.json');
}

// Version binding: the report must target the running suite.
if (report.suiteVersion !== suite.suiteVersion) fail(`report suiteVersion ${JSON.stringify(report.suiteVersion)} != suite ${JSON.stringify(suite.suiteVersion)}`);
if (report.specVersion !== suite.specVersion) fail(`report specVersion ${JSON.stringify(report.specVersion)} != suite ${JSON.stringify(suite.specVersion)}`);
if (report.suiteVersion === suite.suiteVersion && report.specVersion === suite.specVersion) ok(`report binds to suite ${suite.suiteVersion} / spec ${suite.specVersion}`);

const verdict = evaluate(groups, report);
console.log(`  reference verdict: ${verdict.passed}/${totalVectors} passed, ${verdict.failed} failed, ${verdict.advisory} advisory, ${verdict.skipped} skipped`);
for (const c of verdict.cases.filter((c) => c.status === 'fail' || c.status === 'missing')) {
  fail(`${c.kind}/${c.name} — ${c.status}${c.detail ? `: ${c.detail}` : ''}`);
}
// The reference implementation must reproduce EVERY published vector: no skips,
// no advisories, no extras, full pass count.
if (verdict.skipped > 0) fail(`reference adapter skipped ${verdict.skipped} vector(s); it must run them all`);
if (verdict.advisory > 0) fail(`reference adapter has ${verdict.advisory} advisory failure(s); it must pass them all`);
if (verdict.extraResults.length > 0) fail(`reference adapter reported ${verdict.extraResults.length} result(s) with no matching vector: ${verdict.extraResults.join(', ')}`);
if (verdict.passed !== totalVectors) fail(`reference adapter passed ${verdict.passed} of ${totalVectors} vectors`);
if (verdict.ok && verdict.passed === totalVectors && verdict.skipped === 0 && verdict.advisory === 0 && verdict.extraResults.length === 0) {
  ok(`reference implementation conforms to all ${totalVectors} published vectors via the adapter protocol`);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Conformance check failed.`);
  process.exit(1);
}
console.log('\nConformance suite skeleton verified.');
