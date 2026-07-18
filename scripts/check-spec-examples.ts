#!/usr/bin/env npx tsx

/**
 * Validates the fenced ```json worked examples embedded in the specification
 * prose against the schemas they illustrate, so the spec's own examples cannot
 * silently drift from the schemas — implementers read these as ground truth.
 *
 * Every ```json fence under spec/ is classified into exactly one of:
 *
 *  1. A content-block root — its top-level `type` is in the content-block
 *     dispatch enum — validated against content.schema.json#/$defs/block.
 *  2. A complete document root, recognized by carrying ALL of a root schema's
 *     required top-level keys: a manifest, a Dublin Core file, or a signatures
 *     file. Validated against that schema. A partial excerpt necessarily lacks a
 *     required key, so it is not matched — and therefore not falsely failed.
 *  3. A fence explicitly annotated `<!-- cdx-schema: <file>[#/pointer] -->` on
 *     the line preceding the fence — validated against the named schema. This is
 *     the opt-in path for a complete instance whose root has no unambiguous
 *     required-key signature (e.g. a ContentAnchor, a semantic file).
 *
 * Everything else — illustrative fragments, single fields, `...`-elided blocks
 * that do not parse — is skipped. A fence preceded by `<!-- cdx-validate: skip -->`
 * is always skipped: an explicit opt-out for an intentionally partial example or
 * one that uses placeholder values (e.g. `sha256:abc123...`) purely for
 * illustration.
 *
 * Tiers 1 and 2 are the coverage-forcing paths: a complete content block or a
 * complete manifest/Dublin-Core/signatures example cannot be added to the spec
 * without being validated (or explicitly skip-marked). Tier 3 is opt-in.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ValidateFunction } from 'ajv/dist/2020';
import { getValidator } from './lib/part-schema.js';
import { loadSchema } from './lib/ajv-utils.js';

const rootDir = path.join(__dirname, '..');
const specDir = path.join(rootDir, 'spec');

// --- content-block type set (tier 1) ---------------------------------------
// Derived from the dispatch's own open-world escape enum
// (content.schema.json#/$defs/block → `{ not: { properties: { type: { enum } } } }`)
// so it stays in lockstep with the dispatch and excludes namespaced marks and
// layer/token sub-types a heuristic would mis-admit.
function findBlockTypeEnum(node: unknown): string[] | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findBlockTypeEnum(item);
      if (r) return r;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const not = obj.not as Record<string, unknown> | undefined;
  const typeDef = (not?.properties as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined;
  if (Array.isArray(typeDef?.enum)) {
    return (typeDef!.enum as unknown[]).filter((v): v is string => typeof v === 'string');
  }
  for (const value of Object.values(obj)) {
    const r = findBlockTypeEnum(value);
    if (r) return r;
  }
  return null;
}

function knownBlockTypes(): Set<string> {
  const content = loadSchema('content.schema.json') as { $defs?: { block?: unknown } };
  const enumList = findBlockTypeEnum(content.$defs?.block);
  if (!enumList || enumList.length === 0) {
    throw new Error('could not locate the content-block type enum in content.schema.json#/$defs/block');
  }
  return new Set(enumList);
}

// --- document-root discriminators (tier 2) ---------------------------------
// A parsed top-level object is a "complete document root" iff it carries every
// key in `requiredKeys`. Required keys are the schema's own `required` list, so a
// fragment (which by definition omits at least one) is never matched. `guard`
// disambiguates roots whose key set overlaps another (a Dublin Core file and a
// semantic namespace file both carry {version, terms}; only the former lacks a
// top-level `namespace`).
interface DocRoot {
  name: string;
  requiredKeys: string[];
  schema: string;
  ref?: string;
  guard?: (o: Record<string, unknown>) => boolean;
}

// Read a schema's (or a $def's) own `required` list, so every discriminator's
// key signature tracks the schema it dispatches to rather than a hand-copied set.
function requiredKeysOf(schema: string, ref?: string): string[] {
  const root = loadSchema(schema) as Record<string, unknown>;
  const node = ref
    ? ref.replace(/^#\//, '').split('/').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], root)
    : root;
  const required = (node as { required?: unknown } | undefined)?.required;
  return Array.isArray(required) ? (required.filter((k): k is string => typeof k === 'string')) : [];
}

function documentRoots(): DocRoot[] {
  return [
    { name: 'manifest', requiredKeys: requiredKeysOf('manifest.schema.json'), schema: 'manifest.schema.json' },
    {
      name: 'dublin-core',
      requiredKeys: requiredKeysOf('dublin-core.schema.json'),
      schema: 'dublin-core.schema.json',
      // A Dublin Core file and a semantic namespace file both carry {version, terms};
      // only the former lacks a top-level `namespace`.
      guard: (o) => !('namespace' in o) && typeof o.terms === 'object' && o.terms !== null && !Array.isArray(o.terms),
    },
    {
      name: 'signatures-file',
      requiredKeys: requiredKeysOf('security.schema.json', '#/$defs/signaturesFile'),
      schema: 'security.schema.json',
      ref: '#/$defs/signaturesFile',
    },
    // A precise-layout root carries a 7-key required signature
    // (version + presentationType + targetFormat + pageSize + contentHash +
    // generatedAt + pages) that no other document root, content block, or the
    // presentation root shares, so it needs no guard. A complete precise-layout
    // example embedded in the spec is therefore validated rather than skipped as an
    // "unrecognized root". (The presentation.schema.json root — {version, type,
    // defaults, styles} — is deliberately NOT added: two complete presentation
    // fences in spec/core/04-presentation-layers.md do not currently satisfy that
    // schema, so a discriminator would fail the gate on prose the tooling layer must
    // not edit; enabling it needs a spec-side fix or skip-marker first.)
    {
      name: 'precise-layout',
      requiredKeys: requiredKeysOf('precise-layout.schema.json'),
      schema: 'precise-layout.schema.json',
    },
  ];
}

// --- fence extraction ------------------------------------------------------
interface Block {
  json: string;
  line: number; // 1-based line of the opening fence
  skip: boolean;
  schemaAnnotation?: { schema: string; ref?: string };
}

const SKIP_RE = /<!--[^>]*cdx-validate:\s*skip[^>]*-->/i;
const SCHEMA_RE = /<!--[^>]*cdx-schema:\s*([A-Za-z0-9_.-]+\.schema\.json)(#\/[^\s>]*)?[^>]*-->/i;

// Extract ```json fenced blocks, tracking the opening-fence line and any control
// marker (`cdx-validate: skip` or `cdx-schema: …`) on the immediately-preceding
// non-blank line.
function extractJsonBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```json\b/.test(lines[i])) continue;
    const openLine = i + 1;
    let p = i - 1;
    while (p >= 0 && lines[p].trim() === '') p--;
    const marker = p >= 0 ? lines[p] : '';
    const skip = SKIP_RE.test(marker);
    const schemaMatch = SCHEMA_RE.exec(marker);
    const schemaAnnotation = schemaMatch
      ? { schema: schemaMatch[1], ref: schemaMatch[2] }
      : undefined;
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    blocks.push({ json: body.join('\n'), line: openLine, skip, schemaAnnotation });
  }
  return blocks;
}

// A control marker is only honored on the line immediately preceding a ```json
// fence (blank lines between are fine). A marker separated from its fence by a
// prose line is silently ineffective — the fence falls through to auto-classi-
// fication (a lost `cdx-schema:` leaves an example unvalidated; a lost `skip`
// force-validates an intentionally-partial one). Flag such a stray marker loudly.
function orphanedMarkerLines(content: string): number[] {
  const lines = content.split('\n');
  const orphans: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SKIP_RE.test(lines[i]) && !SCHEMA_RE.test(lines[i])) continue;
    let n = i + 1;
    while (n < lines.length && lines[n].trim() === '') n++;
    if (n >= lines.length || !/^\s*```json\b/.test(lines[n])) orphans.push(i + 1);
  }
  return orphans;
}

function findMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}

interface Failure {
  file: string;
  line: number;
  classifiedAs: string;
  errors: string;
}

function formatErrors(v: ValidateFunction): string {
  return (v.errors ?? [])
    .map((e) => `${e.instancePath || '/'} ${e.message}${e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : ''}`)
    .join('; ');
}

function main(): void {
  console.log('Validating spec JSON worked examples...\n');

  const blockTypes = knownBlockTypes();
  const roots = documentRoots();
  const files = findMarkdown(specDir);

  let attempted = 0;
  let skipped = 0;
  const perClass: Record<string, number> = {};
  const failures: Failure[] = [];

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, 'utf8');
    for (const orphan of orphanedMarkerLines(content)) {
      failures.push({ file: rel, line: orphan, classifiedAs: 'misplaced-marker', errors: 'a cdx-schema/cdx-validate control marker is not immediately above a ```json fence, so it will be silently ignored — move it to the line directly before the fence' });
    }
    for (const block of extractJsonBlocks(content)) {
      if (block.skip) {
        skipped++;
        continue;
      }

      // Tier 3: explicit annotation — always validated (parse failure is an error
      // because the fence is declared a complete instance).
      if (block.schemaAnnotation) {
        const { schema, ref } = block.schemaAnnotation;
        let parsed: unknown;
        try {
          parsed = JSON.parse(block.json);
        } catch (err) {
          failures.push({ file: rel, line: block.line, classifiedAs: `annotated:${schema}${ref ?? ''}`, errors: `does not parse as JSON: ${(err as Error).message}` });
          continue;
        }
        let validate: ValidateFunction;
        try {
          validate = getValidator(schema, ref);
        } catch (err) {
          failures.push({ file: rel, line: block.line, classifiedAs: `annotated:${schema}${ref ?? ''}`, errors: `unknown schema/ref: ${(err as Error).message}` });
          continue;
        }
        attempted++;
        perClass[`annotated:${schema}${ref ?? ''}`] = (perClass[`annotated:${schema}${ref ?? ''}`] ?? 0) + 1;
        if (!validate(parsed)) {
          failures.push({ file: rel, line: block.line, classifiedAs: `annotated:${schema}${ref ?? ''}`, errors: formatErrors(validate) });
        }
        continue;
      }

      // Fragments that don't parse are illustrative — skip.
      let parsed: unknown;
      try {
        parsed = JSON.parse(block.json);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;

      // Tier 1: content-block root.
      if (typeof obj.type === 'string' && blockTypes.has(obj.type)) {
        const blockType = obj.type;
        attempted++;
        perClass['block'] = (perClass['block'] ?? 0) + 1;
        const validate = getValidator('content.schema.json', '#/$defs/block');
        if (!validate(obj)) {
          failures.push({ file: rel, line: block.line, classifiedAs: `block:${blockType}`, errors: formatErrors(validate) });
        }
        continue;
      }

      // Tier 2: complete document root by required-key signature.
      const root = roots.find((r) => r.requiredKeys.length > 0 && r.requiredKeys.every((k) => k in obj) && (!r.guard || r.guard(obj)));
      if (root) {
        attempted++;
        perClass[root.name] = (perClass[root.name] ?? 0) + 1;
        const validate = getValidator(root.schema, root.ref);
        if (!validate(obj)) {
          failures.push({ file: rel, line: block.line, classifiedAs: root.name, errors: formatErrors(validate) });
        }
        continue;
      }

      // Unrecognized root shape → illustrative fragment, skip.
    }
  }

  // --- self-test: the validation path must have teeth ----------------------
  // The validators must REJECT structurally-incomplete instances — a gate that
  // accepts anything is worthless. These assert rejection only, so they do not go
  // stale when a schema tightens its required set; the opposite failure (a rule
  // that wrongly rejects a valid instance) is already caught by validate-examples
  // and by the real spec examples this gate classifies.
  const selfTestFailures: string[] = [];
  const manifestValidate = getValidator('manifest.schema.json');
  if (manifestValidate({})) selfTestFailures.push('empty object ACCEPTED as a manifest (validation has no teeth)');
  if (manifestValidate({ cdx: '0.1', id: 'pending', state: 'draft' })) {
    selfTestFailures.push('manifest missing required content/metadata ACCEPTED (validation has no teeth)');
  }
  const sigValidate = getValidator('security.schema.json', '#/$defs/signaturesFile');
  if (sigValidate({ version: '0.1', documentId: 'sha256:' + 'a'.repeat(64), signatures: [] })) {
    selfTestFailures.push('signatures file with empty signature set ACCEPTED (minItems has no teeth)');
  }
  const preciseLayoutValidate = getValidator('precise-layout.schema.json');
  if (preciseLayoutValidate({ version: '1.0', presentationType: 'precise', targetFormat: 'pdf' })) {
    selfTestFailures.push('precise-layout missing required pageSize/contentHash/generatedAt/pages ACCEPTED (validation has no teeth)');
  }

  // Tier-3 annotation path: the `cdx-schema:` marker must parse, resolve to a
  // validator, and reject a bad instance — proving the opt-in path works end to end
  // even while no spec fence currently carries an annotation.
  const sampleMarker = '<!-- cdx-schema: anchor.schema.json#/$defs/contentAnchor -->';
  const parsedMarker = SCHEMA_RE.exec(sampleMarker);
  if (!parsedMarker || parsedMarker[1] !== 'anchor.schema.json' || parsedMarker[2] !== '#/$defs/contentAnchor') {
    selfTestFailures.push('cdx-schema marker did not parse to {anchor.schema.json, #/$defs/contentAnchor}');
  } else {
    const anchorValidate = getValidator(parsedMarker[1], parsedMarker[2]);
    if (anchorValidate({ blockId: 'intro', start: 10, end: 25, contentHash: 'sha256:abc123...' })) {
      selfTestFailures.push('ContentAnchor with a non-conforming contentHash ACCEPTED via annotation path (no teeth)');
    }
  }

  // --- report --------------------------------------------------------------
  console.log(`Scanned ${files.length} spec markdown file(s)`);
  const classSummary = Object.entries(perClass).sort().map(([k, n]) => `${k}=${n}`).join(', ');
  console.log(`Validated ${attempted} example(s) [${classSummary || 'none'}]; ${skipped} skip-marked\n`);
  console.log('='.repeat(60));

  if (selfTestFailures.length > 0) {
    console.log('\n✗ self-test failed (the validation path is not enforcing):');
    for (const s of selfTestFailures) console.log(`    ${s}`);
  }

  if (failures.length > 0) {
    console.log(`\n✗ ${failures.length} spec example(s) fail their schema:\n`);
    for (const f of failures) {
      console.log(`  ${f.file}:${f.line}  [${f.classifiedAs}]`);
      console.log(`    ${f.errors}\n`);
    }
  }

  if (failures.length > 0 || selfTestFailures.length > 0) {
    console.log('='.repeat(60));
    console.log('\nSpec example validation found issues.');
    process.exit(1);
  }

  console.log('\nAll classified spec examples are valid; self-test passed.');
}

main();
