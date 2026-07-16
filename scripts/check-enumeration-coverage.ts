#!/usr/bin/env npx tsx

/**
 * Meta-gate over the hand-maintained enumeration lists the other gates iterate.
 *
 * Several gates walk a manually-curated list and are only as complete as that
 * list: the schema-closure list (which schemas are teeth-tested for closure), the
 * schema-compile list (which schemas validate-schemas compiles), the manifest
 * config-slot set (which slots are shape-checked and hash-verified), and the CI
 * step list (which gates actually run in the workflow). Each drifts silently when
 * a schema/slot/gate is added but its list entry is forgotten, because CI stays
 * green. This gate enumerates the underlying directory / schema / package scripts
 * and asserts each list covers it, so an omission fails the build instead of
 * quietly narrowing coverage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CLOSED_SCHEMAS } from './kat/schema-closure-vectors.js';
import { standaloneSchemas, dependentSchemas } from './lib/schema-registry.js';
import { CONFIG_SLOTS } from './lib/config-slots.js';
import { loadSchema } from './lib/ajv-utils.js';

const rootDir = path.join(__dirname, '..');
const schemasDir = path.join(rootDir, 'schemas');

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};
const pass = (msg: string): void => console.log(`  ✓ ${msg}`);

const allSchemaFiles = fs
  .readdirSync(schemasDir)
  .filter((f) => f.endsWith('.schema.json'))
  .sort();

// Does a schema declare a closed object anywhere (additionalProperties:false or
// unevaluatedProperties:false)?
function declaresClosure(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(declaresClosure);
  if (node === null || typeof node !== 'object') return false;
  const obj = node as Record<string, unknown>;
  if (obj.additionalProperties === false || obj.unevaluatedProperties === false) return true;
  return Object.values(obj).some(declaresClosure);
}

// --- 1. schema-closure list covers every closed schema ---------------------
console.log('Closure-list coverage:');
{
  const before = failures;
  const closedInDir = allSchemaFiles.filter((f) => declaresClosure(loadSchema(f)));
  const enrolled = new Set(CLOSED_SCHEMAS);
  for (const f of closedInDir) {
    if (!enrolled.has(f)) fail(`${f} declares a closed object but is not in CLOSED_SCHEMAS (its closure has no teeth-test)`);
  }
  for (const f of CLOSED_SCHEMAS) {
    if (!allSchemaFiles.includes(f)) fail(`CLOSED_SCHEMAS lists ${f}, which is not a schema file`);
    else if (!declaresClosure(loadSchema(f))) fail(`CLOSED_SCHEMAS lists ${f}, but it declares no closed object`);
  }
  if (failures === before) pass(`${closedInDir.length} closed schema(s) all enrolled in CLOSED_SCHEMAS`);
}

// --- 2. schema-compile list covers the directory ---------------------------
console.log('\nSchema-compile-list coverage:');
{
  const compiled = new Set<string>([...standaloneSchemas, ...dependentSchemas.map((d) => d.schema)]);
  const before = failures;
  for (const f of allSchemaFiles) {
    if (!compiled.has(f)) fail(`${f} is never compiled by validate-schemas (not in standalone/dependent lists)`);
  }
  for (const f of compiled) {
    if (!allSchemaFiles.includes(f)) fail(`schema-compile list references ${f}, which is not a schema file`);
  }
  if (failures === before) pass(`${compiled.size} schema(s) compiled, covering all ${allSchemaFiles.length} in schemas/`);
}

// --- 3. config-slot set equals the manifest's bare open object slots --------
console.log('\nConfig-slot coverage:');
{
  const manifest = loadSchema('manifest.schema.json') as { properties?: Record<string, Record<string, unknown>> };
  // A manifest top-level property is a config slot iff it is a bare open object:
  // `{type: object}` with no properties, no closure, no $ref, no composition.
  const bareObjectSlots = Object.entries(manifest.properties ?? {})
    .filter(([, v]) => v.type === 'object' && !v.properties && !v.$ref && v.additionalProperties !== false && !v.oneOf && !v.anyOf && !v.allOf)
    .map(([k]) => k)
    .sort();
  const declaredSlots = Object.keys(CONFIG_SLOTS).sort();
  const before = failures;
  for (const slot of bareObjectSlots) {
    if (!declaredSlots.includes(slot)) fail(`manifest slot "${slot}" is a bare {type:object} config slot but is absent from CONFIG_SLOTS (unchecked config, unverified file hashes)`);
  }
  for (const slot of declaredSlots) {
    if (!bareObjectSlots.includes(slot)) fail(`CONFIG_SLOTS declares "${slot}", which is not a bare {type:object} manifest slot`);
  }
  if (failures === before) pass(`config slots {${declaredSlots.join(', ')}} match the manifest's bare object slots`);
}

// --- 4. every gate npm script runs in the CI workflow ----------------------
console.log('\nCI-step coverage:');
{
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const workflow = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'validate-schemas.yml'), 'utf8');
  // Which scripts must run in CI: the `check:*` gate convention plus the two
  // non-`check` gates. validate:schemas/validate:examples run transitively under
  // `npm test` (asserted separately); any other script (a future lint/format/clean)
  // is not a CI gate and is not required here.
  const nonCheckGates = new Set(['test:canonicalize', 'generate:template']);
  const isGate = (name: string): boolean => name.startsWith('check:') || nonCheckGates.has(name);
  // Match the whole script name so a name that is a prefix of another (a future
  // `check:sign` vs the existing `check:signature-set`) is not spuriously satisfied
  // by the longer one's step.
  const runsInCi = (name: string): boolean =>
    new RegExp(`npm run ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w:-])`).test(workflow);
  const before = failures;
  for (const name of Object.keys(pkg.scripts ?? {})) {
    if (!isGate(name)) continue;
    if (!runsInCi(name)) fail(`gate script "${name}" has no CI step (no \`npm run ${name}\` in the workflow)`);
  }
  if (!/\bnpm test\b/.test(workflow)) fail('the workflow never runs `npm test` (validate:schemas/validate:examples are unrun)');
  if (failures === before) pass('every gate script is invoked by the workflow');
}

console.log('');
if (failures > 0) {
  console.log(`${failures} enumeration-coverage check(s) failed`);
  process.exit(1);
}
console.log('✓ enumeration-coverage: all hand-maintained lists cover their directory/slots/steps');
