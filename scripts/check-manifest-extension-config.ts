#!/usr/bin/env npx tsx

/**
 * Enforcing gate for manifest extension-config slots.
 *
 * The manifest leaves each extension's config slot (`legal`, `academic`,
 * `semantic`, …) an open `{type: object}` BY DESIGN, so the core manifest schema
 * carries no dependency on extension schemas. The cost of that decoupling is that
 * a malformed config — a wrong-typed value, a misspelled key — passes
 * the manifest schema unchecked. This gate closes that gap WITHOUT coupling the
 * core schema to the extensions: it validates every example manifest's MAPPED
 * extension config slot against that extension's config schema, and pins a set of
 * vectors so a malformed config is provably rejected (the teeth) and a well-formed
 * one provably accepted.
 *
 * legal/academic/semantic use their SCHEMA ROOT as the manifest-config shape
 * (e.g. legal's root is `{citationStyle, jurisdiction}`, additionalProperties:false);
 * collaboration uses a dedicated `manifestConfig` $def (its root describes a
 * comments/changes FILE, not the manifest slot). A manifest config slot with no
 * entry below is intentionally unchecked — the manifest is additionalProperties:false,
 * so only the named slots can appear, and each gains validation as its config shape
 * is pinned. The gate grows by adding a slot→schema entry and its vectors.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createAjv, loadSchema } from './lib/ajv-utils.js';

// Manifest config slot -> the schema (and optional $ref) describing that slot's
// shape. legal/academic/semantic use their schema ROOT; collaboration's root is a
// comments/changes FILE, so it uses a dedicated manifestConfig $def.
const CONFIG_SCHEMAS: Record<string, { schema: string; ref?: string }> = {
  legal: { schema: 'legal.schema.json' },
  academic: { schema: 'academic.schema.json' },
  semantic: { schema: 'semantic.schema.json' },
  collaboration: { schema: 'collaboration.schema.json', ref: '#/$defs/manifestConfig' },
};

// One AJV with every schema loaded so any cross-file $ref in a config root resolves.
const schemasDir = path.join(__dirname, '..', 'schemas');
const ajv = createAjv();
for (const f of fs.readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))) {
  ajv.addSchema(loadSchema(f));
}

import type { ValidateFunction } from 'ajv/dist/2020';
const validators: Record<string, ValidateFunction> = {};
for (const [slot, entry] of Object.entries(CONFIG_SCHEMAS)) {
  const id = (loadSchema(entry.schema) as { $id: string }).$id;
  validators[slot] = ajv.compile({ $ref: id + (entry.ref ?? '') });
}

interface ConfigVector {
  slot: string;
  description: string;
  config: unknown;
  valid: boolean;
}

// A well-formed content hash for the file-reference config vectors.
const CFG_HASH = 'sha256:' + 'a'.repeat(64);

// Teeth: a well-formed config MUST validate; a malformed one (a wrong-typed value
// or an unknown key, against the additionalProperties:false config roots) MUST be
// rejected. These are the negative half the corpus cannot give.
const configVectors: ConfigVector[] = [
  { slot: 'legal', description: 'valid citationStyle + jurisdiction', config: { citationStyle: 'bluebook', jurisdiction: 'US' }, valid: true },
  { slot: 'legal', description: 'wrong-type citationStyle rejected', config: { citationStyle: 123 }, valid: false },
  { slot: 'legal', description: 'unknown key rejected', config: { citationStyle: 'bluebook', bogus: 1 }, valid: false },
  { slot: 'legal', description: 'wrong-type jurisdiction rejected', config: { jurisdiction: 123 }, valid: false },
  { slot: 'academic', description: 'valid numbering {path,hash}', config: { numbering: { path: 'academic/numbering.json', hash: CFG_HASH } }, valid: true },
  { slot: 'academic', description: 'bare-string numbering rejected (hash required)', config: { numbering: 'academic/numbering.json' }, valid: false },
  { slot: 'academic', description: 'numbering missing hash rejected', config: { numbering: { path: 'academic/numbering.json' } }, valid: false },
  { slot: 'academic', description: 'unknown key rejected', config: { numbering: { path: 'academic/numbering.json', hash: CFG_HASH }, bogus: 1 }, valid: false },
  { slot: 'semantic', description: 'valid bibliography + glossary {path,hash}', config: { bibliography: { path: 'semantic/bibliography.json', hash: CFG_HASH }, glossary: { path: 'semantic/glossary.json', hash: CFG_HASH } }, valid: true },
  { slot: 'semantic', description: 'bare-string bibliography rejected (hash required)', config: { bibliography: 'semantic/bibliography.json' }, valid: false },
  { slot: 'semantic', description: 'unknown key rejected', config: { bogus: 1 }, valid: false },
  { slot: 'collaboration', description: 'valid comments + changes paths', config: { comments: 'collaboration/comments.json', changes: 'collaboration/changes.json' }, valid: true },
  { slot: 'collaboration', description: 'unknown key rejected', config: { comments: 'collaboration/comments.json', sync: {} }, valid: false },
];

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: example corpus -----------------------------------------------
console.log('Manifest extension configs (example corpus):');
const examplesDir = path.join(__dirname, '..', 'examples');
let checked = 0;
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const manifestPath = path.join(examplesDir, name, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`${name} — manifest parse error: ${(err as Error).message}`);
    continue;
  }
  for (const slot of Object.keys(CONFIG_SCHEMAS)) {
    if (manifest[slot] === undefined) continue;
    checked++;
    const validate = validators[slot];
    if (!validate(manifest[slot])) {
      fail(`${name}: manifest.${slot} invalid — ${JSON.stringify(validate.errors)}`);
    } else {
      console.log(`  ✓ ${name}: manifest.${slot}`);
    }
  }
}

// --- Part 2: vectors (teeth) -----------------------------------------------
console.log('\nConfig vectors (teeth):');
for (const v of configVectors) {
  const validate = validators[v.slot];
  const ok = validate(v.config);
  if (v.valid && !ok) {
    fail(`${v.slot} "${v.description}" — valid config REJECTED: ${JSON.stringify(validate.errors)}`);
  } else if (!v.valid && ok) {
    fail(`${v.slot} "${v.description}" — invalid config ACCEPTED (no teeth)`);
  } else {
    console.log(`  ✓ ${v.slot} "${v.description}"`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} manifest-extension-config check(s) failed`);
  process.exit(1);
}
console.log(`\n✓ manifest-extension-config: ${checked} example config(s) + ${configVectors.length} vectors across ${Object.keys(CONFIG_SCHEMAS).length} extensions, all validated`);
