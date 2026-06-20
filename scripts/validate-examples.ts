#!/usr/bin/env npx tsx

/**
 * Validates example documents against their corresponding schemas.
 *
 * Every JSON part file under examples/<doc>/ is discovered and validated
 * against the correct schema via an ordered rule table (first match wins).
 * A part may validate against a $def of a schema rather than its root
 * (e.g. academic/numbering.json -> academic.schema.json#/$defs/numberingConfig),
 * because some schema roots describe the manifest-level config rather than the
 * part-file contents. Any *.json that matches no rule fails the run, so a new
 * part type cannot slip through unvalidated.
 */

import { ValidateFunction } from 'ajv/dist/2020';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createAjv, loadSchema } from './lib/ajv-utils.js';

const examplesDir = path.join(__dirname, '..', 'examples');

// Schema dependencies (schemas that need other schemas loaded first so their
// cross-file $refs resolve at compile time).
const schemaDependencies: Record<string, string[]> = {
  'content.schema.json': ['semantic.schema.json', 'academic.schema.json', 'presentation.schema.json', 'legal.schema.json'],
  'collaboration.schema.json': ['anchor.schema.json'],
  'phantoms.schema.json': ['anchor.schema.json'],
  'security.schema.json': ['anchor.schema.json'],
  'annotations.schema.json': ['anchor.schema.json'],
};

// Validators compiled once, cached per (schema, ref) pair. The ref must be part
// of the key: the same schema can be compiled both at its root and at a $def.
const validators: Record<string, ValidateFunction> = {};

function getValidator(schemaName: string, ref?: string): ValidateFunction {
  const key = ref ? `${schemaName}${ref}` : schemaName;
  if (!validators[key]) {
    const ajv = createAjv();
    for (const dep of schemaDependencies[schemaName] ?? []) {
      ajv.addSchema(loadSchema(dep));
    }
    const schema = loadSchema(schemaName) as { $id: string };
    ajv.addSchema(schema);
    validators[key] = ref ? ajv.compile({ $ref: schema.$id + ref }) : ajv.compile(schema);
  }
  return validators[key];
}

interface Rule {
  test: RegExp;
  schema: string;
  ref?: string;
  // Set when validation is known to be against a root schema that does NOT
  // describe the part-file contents (i.e. currently vacuous). Reported as a
  // warning rather than a clean ✓ so the gap is not mistaken for real coverage.
  note?: string;
}

// Ordered rule table — FIRST match wins, so more-specific paths come first
// (e.g. presentation/layouts/* before the presentation/* catch-all).
// Paths are relative to each examples/<doc>/ directory, using '/' separators.
const rules: Rule[] = [
  { test: /^manifest\.json$/, schema: 'manifest.schema.json' },
  { test: /^content\/document\.json$/, schema: 'content.schema.json' },
  { test: /^metadata\/dublin-core\.json$/, schema: 'dublin-core.schema.json' },
  // academic.schema's root is the manifest-level academic config ({numbering: path});
  // the numbering data file is described by the numberingConfig $def.
  { test: /^academic\/numbering\.json$/, schema: 'academic.schema.json', ref: '#/$defs/numberingConfig' },
  { test: /^collaboration\/(comments|changes)\.json$/, schema: 'collaboration.schema.json' },
  { test: /^assets\/index\.json$/, schema: 'asset-index.schema.json' },
  { test: /^presentation\/layouts\/[^/]+\.json$/, schema: 'precise-layout.schema.json' },
  { test: /^presentation\/[^/]+\.json$/, schema: 'presentation.schema.json' },
  { test: /^provenance\/record\.json$/, schema: 'provenance.schema.json' },
  { test: /^forms\/data\.json$/, schema: 'forms.schema.json' },
  { test: /^phantoms\/clusters\.json$/, schema: 'phantoms.schema.json' },
  { test: /^security\/signatures\.json$/, schema: 'security.schema.json' },
  { test: /^security\/annotations\.json$/, schema: 'annotations.schema.json' },
  // semantic.schema's root describes the manifest-level config, not the file
  // contents, so this validation is currently vacuous. Follow-up: add
  // bibliographyFile / glossaryFile $defs and route here, like academic above.
  { test: /^semantic\/(bibliography|glossary)\.json$/, schema: 'semantic.schema.json', note: 'root-only (file contents unvalidated — follow-up: add file-shape $defs)' },
];

function findJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

let hasErrors = false;
let unmatched = 0;
let validated = 0;

console.log('Validating example documents...\n');

const exampleDirs = fs.readdirSync(examplesDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

for (const exampleName of exampleDirs) {
  console.log(`${exampleName}/`);
  const examplePath = path.join(examplesDir, exampleName);

  const files = findJsonFiles(examplePath)
    .map(f => path.relative(examplePath, f).split(path.sep).join('/'))
    .sort();

  for (const relPath of files) {
    const rule = rules.find(r => r.test.test(relPath));

    if (!rule) {
      console.log(`  ⚠ ${relPath} — no schema rule matched (unvalidated)`);
      unmatched++;
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(path.join(examplePath, relPath), 'utf8'));
    } catch (err) {
      console.log(`  ✗ ${relPath} — parse error: ${err instanceof Error ? err.message : String(err)}`);
      hasErrors = true;
      continue;
    }

    let validate: ValidateFunction;
    try {
      validate = getValidator(rule.schema, rule.ref);
    } catch (err) {
      console.log(`  ✗ ${relPath} — could not compile ${rule.schema}: ${err instanceof Error ? err.message : String(err)}`);
      hasErrors = true;
      continue;
    }

    if (validate(data)) {
      console.log(`  ${rule.note ? '⚠' : '✓'} ${relPath}${rule.note ? ` — ${rule.note}` : ''}`);
      validated++;
    } else {
      console.log(`  ✗ ${relPath}`);
      for (const e of validate.errors ?? []) {
        console.log(`    - ${e.instancePath || '/'}: ${e.message}`);
      }
      hasErrors = true;
    }
  }

  // Manifest-level checks: every declared file reference resolves on disk, and
  // every declared file hash equals the raw SHA-256 of the referenced file bytes.
  // Per spec §5.1 file hashes are over the DECOMPRESSED bytes; the examples store
  // parts uncompressed, so the on-disk bytes are the decompressed bytes (a part
  // declared with a `compression` codec would need decompressing first). The
  // document id / canonical content hash is a separate field, out of scope here.
  const manifestPath = path.join(examplePath, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const algo: string = manifest.hashAlgorithm ?? 'sha256';

    // Path-only references that must resolve on disk.
    const pathRefs: Array<[string, unknown]> = [
      ['metadata.dublinCore', manifest.metadata?.dublinCore],
      ['provenance', manifest.provenance],
      ['security.signatures', manifest.security?.signatures],
      ['security.encryption', manifest.security?.encryption],
      ['phantoms.clusters', manifest.phantoms?.clusters],
    ];
    for (const [label, rel] of pathRefs) {
      if (typeof rel !== 'string') continue;
      if (!fs.existsSync(path.join(examplePath, rel))) {
        console.log(`  ✗ manifest ${label} -> ${rel} (file missing)`);
        hasErrors = true;
      }
    }

    // Hashed references: the file must resolve AND its hash must match.
    const hashRefs: Array<[string, string, string]> = [];
    if (manifest.content?.path && manifest.content?.hash) {
      hashRefs.push(['content.hash', manifest.content.path, manifest.content.hash]);
    }
    (manifest.presentation ?? []).forEach((pr: { path?: string; hash?: string }, i: number) => {
      if (pr.path && pr.hash) hashRefs.push([`presentation[${i}].hash`, pr.path, pr.hash]);
    });
    for (const [label, rel, declared] of hashRefs) {
      if (!fs.existsSync(path.join(examplePath, rel))) {
        console.log(`  ✗ manifest ${label} -> ${rel} (file missing)`);
        hasErrors = true;
        continue;
      }
      let actual: string;
      try {
        actual = `${algo}:${crypto.createHash(algo).update(fs.readFileSync(path.join(examplePath, rel))).digest('hex')}`;
      } catch (err) {
        console.log(`  ✗ manifest ${label} (${rel}) — cannot hash with '${algo}': ${err instanceof Error ? err.message : String(err)}`);
        hasErrors = true;
        continue;
      }
      if (actual === declared) {
        console.log(`  ✓ manifest ${label} (${rel})`);
      } else {
        console.log(`  ✗ manifest ${label} (${rel}) — hash mismatch`);
        console.log(`      declared ${declared}`);
        console.log(`      actual   ${actual}`);
        hasErrors = true;
      }
    }
  }

  console.log('');
}

console.log(`Validated ${validated} part file(s); ${unmatched} unmatched.`);
if (hasErrors || unmatched > 0) {
  if (hasErrors) console.log('Example validation failed!');
  if (unmatched > 0) {
    console.log(`${unmatched} part file(s) matched no schema rule — add a rule in validate-examples.ts or remove the file.`);
  }
  process.exit(1);
}
console.log('All example parts valid.');
