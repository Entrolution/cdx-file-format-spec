#!/usr/bin/env npx tsx

/**
 * Validates fenced ```json content-block examples in the spec README files
 * against the content-block schema, so the specification's own documented
 * examples cannot silently fail the schema they illustrate.
 *
 * Scope (deliberately conservative to avoid false positives on the ~54% of
 * README blocks that are illustrative fragments):
 *  - Only README.md files under spec/ are scanned.
 *  - A block is validated only when it PARSES as JSON AND its top-level object
 *    carries a `type` that is a recognized content-block type. Everything else
 *    — sub-object fragments, single fields, blocks elided with `...` (which do
 *    not parse), and non-block roots — is skipped.
 *  - A block immediately preceded by an HTML comment containing
 *    `cdx-validate: skip` is skipped (an explicit opt-out for an intentionally
 *    partial example).
 *
 * Each validated block is checked against content.schema.json#/$defs/block,
 * which dispatches core and namespaced extension block types (and applies the
 * open-world escape for unknown namespaced types). A failure fails the build.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getValidator } from './lib/part-schema.js';
import { loadSchema } from './lib/ajv-utils.js';

const rootDir = path.join(__dirname, '..');
const specDir = path.join(rootDir, 'spec');

// Locate the known-block-type list carried by the dispatch's open-world escape
// branch (`{ not: { properties: { type: { enum: [...] } } } }`) inside
// content.schema.json#/$defs/block — the set of types the dispatch recognizes
// without requiring a namespace.
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

// The authoritative content-block type set. Derived from the dispatch's own
// escape enum rather than by re-walking extension schemas, so it stays in
// lockstep with the dispatch and excludes namespaced *marks* (e.g. legal:cite)
// and layer/token sub-types that a heuristic would mis-admit.
function knownBlockTypes(): Set<string> {
  const content = loadSchema('content.schema.json') as { $defs?: { block?: unknown } };
  const enumList = findBlockTypeEnum(content.$defs?.block);
  if (!enumList || enumList.length === 0) {
    throw new Error('could not locate the content-block type enum in content.schema.json#/$defs/block');
  }
  return new Set(enumList);
}

// Recursively find README.md files under spec/.
function findReadmes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findReadmes(full));
    else if (entry.name === 'README.md') out.push(full);
  }
  return out;
}

interface Block {
  json: string;
  line: number; // 1-based line of the opening fence
  skip: boolean;
}

// Extract ```json fenced blocks, tracking the opening-fence line and whether the
// immediately-preceding non-blank line opts the block out via an HTML comment.
function extractJsonBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```json\b/.test(lines[i])) continue;
    const openLine = i + 1;
    // Look back over blank lines for an opt-out marker on the preceding line.
    let p = i - 1;
    while (p >= 0 && lines[p].trim() === '') p--;
    const skip = p >= 0 && /<!--[^>]*cdx-validate:\s*skip[^>]*-->/i.test(lines[p]);
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    blocks.push({ json: body.join('\n'), line: openLine, skip });
  }
  return blocks;
}

interface Failure {
  file: string;
  line: number;
  type: string;
  errors: string;
}

function main(): void {
  console.log('Validating README JSON content-block examples...\n');

  const blockTypes = knownBlockTypes();
  const validate = getValidator('content.schema.json', '#/$defs/block');
  const readmes = findReadmes(specDir);

  let attempted = 0;
  let skipped = 0;
  const failures: Failure[] = [];

  for (const file of readmes) {
    const rel = path.relative(rootDir, file);
    for (const block of extractJsonBlocks(fs.readFileSync(file, 'utf8'))) {
      if (block.skip) {
        skipped++;
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(block.json);
      } catch {
        continue; // illustrative fragment (e.g. elided with `...`); not a complete instance
      }
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof (parsed as Record<string, unknown>).type !== 'string' ||
        !blockTypes.has((parsed as Record<string, unknown>).type as string)
      ) {
        continue; // not a recognized content-block root → fragment, skip
      }
      attempted++;
      if (!validate(parsed)) {
        const errs = (validate.errors ?? [])
          .map((e) => `${e.instancePath || '/'} ${e.message}${e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : ''}`)
          .join('; ');
        failures.push({ file: rel, line: block.line, type: (parsed as Record<string, unknown>).type as string, errors: errs });
      }
    }
  }

  console.log(`Scanned ${readmes.length} README files`);
  console.log(`Validated ${attempted} content-block example(s); ${skipped} opt-out skipped\n`);
  console.log('='.repeat(60));

  if (failures.length > 0) {
    console.log(`\n✗ ${failures.length} README example(s) fail their schema:\n`);
    for (const f of failures) {
      console.log(`  ${f.file}:${f.line}  [${f.type}]`);
      console.log(`    ${f.errors}\n`);
    }
    console.log('='.repeat(60));
    console.log('\nREADME example validation found issues.');
    process.exit(1);
  }

  console.log('\nAll README content-block examples are valid.');
}

main();
