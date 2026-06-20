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
import { getValidator, ruleFor } from './lib/part-schema.js';

const examplesDir = path.join(__dirname, '..', 'examples');

// The part→schema rule table and the validator factory live in ./lib/part-schema
// so generate-template.ts self-validates its output against the same rules.

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
    const rule = ruleFor(relPath);

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
