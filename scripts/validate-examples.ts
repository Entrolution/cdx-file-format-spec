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
import { CONFIG_SLOTS } from './lib/config-slots.js';

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
      console.log(`  ✓ ${relPath}`);
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
  // document id / canonical content hash is verified separately by the
  // check:document-id gate (scripts/check-document-id.ts).
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
    // Extension config file references ({path, hash}) — bound by the manifest
    // projection, so a declared hash must match the referenced file, the same
    // invariant content/presentation hold.
    for (const slot of Object.keys(CONFIG_SLOTS)) {
      const collectRefs = (v: unknown, label: string): void => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return;
        const o = v as Record<string, unknown>;
        if (typeof o.path === 'string' && typeof o.hash === 'string') {
          hashRefs.push([`${label}.hash`, o.path, o.hash]);
          return;
        }
        for (const k of Object.keys(o)) collectRefs(o[k], `${label}.${k}`);
      };
      collectRefs(manifest[slot], slot);
    }
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

    // Asset-index hashes. Two bindings are checked. (1) The manifest's
    // assets.<category>.hash MUST equal the raw hash of the index file: hash-pinning
    // the index is what lets the signed manifest projection transitively attest the
    // whole category, fonts and image variants included (Security Extension §9.7).
    // (2) Each registered asset's — and each image variant's — declared hash MUST
    // equal the raw hash of its on-disk bytes (archive path = assets/<category>/<entry
    // path>, matching the canonicalizer). A displayed image variant carries its own
    // binding because a renderer shows the variant, not the parent (§4.3).
    for (const [category, cat] of Object.entries<{ index?: string; hash?: string }>(manifest.assets ?? {})) {
      const indexRel = cat?.index;
      if (typeof indexRel !== 'string') continue;
      if (!fs.existsSync(path.join(examplePath, indexRel))) {
        console.log(`  ✗ manifest assets.${category}.index -> ${indexRel} (file missing)`);
        hasErrors = true;
        continue;
      }
      const indexBytes = fs.readFileSync(path.join(examplePath, indexRel));

      // (1) Index hash-pin.
      if (typeof cat.hash === 'string') {
        const indexAlgo = cat.hash.split(':')[0];
        try {
          const actual = `${indexAlgo}:${crypto.createHash(indexAlgo).update(indexBytes).digest('hex')}`;
          if (actual === cat.hash) {
            console.log(`  ✓ manifest assets.${category}.hash (${indexRel})`);
          } else {
            console.log(`  ✗ manifest assets.${category}.hash (${indexRel}) — hash mismatch`);
            console.log(`      declared ${cat.hash}`);
            console.log(`      actual   ${actual}`);
            hasErrors = true;
          }
        } catch (err) {
          console.log(`  ✗ manifest assets.${category}.hash (${indexRel}) — cannot hash with '${indexAlgo}': ${err instanceof Error ? err.message : String(err)}`);
          hasErrors = true;
        }
      }

      // (2) Each asset entry's own file, then each of its image variants.
      let index: { assets?: Array<{ path?: string; hash?: string; variants?: Array<{ path?: string; hash?: string }> }> };
      try {
        index = JSON.parse(indexBytes.toString('utf8'));
      } catch (err) {
        console.log(`  ✗ ${indexRel} — parse error: ${err instanceof Error ? err.message : String(err)}`);
        hasErrors = true;
        continue;
      }
      for (const entry of index.assets ?? []) {
        const files: Array<[string, string | undefined, string | undefined]> = [
          ['asset', entry?.path, entry?.hash],
          ...(entry?.variants ?? []).map((v): [string, string | undefined, string | undefined] => ['asset variant', v?.path, v?.hash]),
        ];
        for (const [kind, entryPath, entryHash] of files) {
          if (typeof entryPath !== 'string' || typeof entryHash !== 'string') continue;
          const assetRel = `assets/${category}/${entryPath}`;
          if (!fs.existsSync(path.join(examplePath, assetRel))) {
            console.log(`  ✗ ${kind} ${assetRel} (file missing)`);
            hasErrors = true;
            continue;
          }
          const assetAlgo = entryHash.split(':')[0];
          let actual: string;
          try {
            actual = `${assetAlgo}:${crypto.createHash(assetAlgo).update(fs.readFileSync(path.join(examplePath, assetRel))).digest('hex')}`;
          } catch (err) {
            console.log(`  ✗ ${kind} ${assetRel} — cannot hash with '${assetAlgo}': ${err instanceof Error ? err.message : String(err)}`);
            hasErrors = true;
            continue;
          }
          if (actual === entryHash) {
            console.log(`  ✓ ${kind} ${assetRel}`);
          } else {
            console.log(`  ✗ ${kind} ${assetRel} — hash mismatch`);
            console.log(`      declared ${entryHash}`);
            console.log(`      actual   ${actual}`);
            hasErrors = true;
          }
        }
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
