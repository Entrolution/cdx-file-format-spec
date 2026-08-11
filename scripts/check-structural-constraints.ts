#!/usr/bin/env npx tsx

/**
 * Structural conformance gate.
 *
 * Enforces content-tree and file-level invariants that JSON Schema cannot
 * express, across the example corpus (examples/**) and the classified ```json
 * worked-examples embedded in the specification prose (spec/**). JSON Schema can
 * constrain a single node's shape but not a node's relationship to its parent, a
 * cross-field ordering, or a whole-file uniqueness/aggregation property; those
 * are checked here.
 *
 * Rules:
 *  - upward-containment:  `figcaption` may appear only as a child of `figure`;
 *    `tableCell` only inside a `tableRow`; `tableRow` only inside a `table`.
 *  - anchor-range:  a range anchor (an object carrying both `start` and `end`, or
 *    a `#blockId/start-end` Content Anchor URI) uses a half-open interval, so
 *    `start` MUST be less than `end` (Anchors and References, range semantics).
 *  - figure-cardinality:  a `figure` using the `children` form holds exactly one
 *    content block and at most one `figcaption`.
 *  - definition-item-cardinality:  a `definitionItem` holds at least one
 *    `definitionTerm` and at least one `definitionDescription`.
 *  - page-number-integrity:  precise-layout `pages[].number` values are unique.
 *  - asset-index-consistency:  asset `id`s are unique within an index, each
 *    manifest asset category's `count`/`totalSize` match the index contents
 *    (count = top-level asset entries; totalSize = every asset and variant size),
 *    and a declared `index` path equals the derived `assets/<category>/index.json`
 *    after normalization (Asset Embedding section 3.1).
 *  - id-uniqueness:  `bibliographyEntry.id` / `glossaryTerm.id` values are unique
 *    within their file.
 *
 * Every rule is a pure function over parsed JSON, so the self-test at the end can
 * feed each one an in-memory violating instance and assert it is flagged — the
 * gate is proven to have teeth even while the shipped corpus is clean.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadSchema } from './lib/ajv-utils.js';
import { derivedIndexPath } from './lib/asset-index.js';
import { normalizePath, isValidPathSegment } from './lib/canonicalize.js';
import {
  type Finding,
  ROOT_DOCUMENT,
  ROOT_EXCERPT,
  isRecord,
  findBlockTypeEnum,
  walkBlocks,
  checkBlock,
  checkAnchors,
  checkPreciseLayout,
  checkAssetCategory,
  checkUniqueIds,
} from './lib/structural-constraints.js';

const rootDir = path.join(__dirname, '..');
const examplesDir = path.join(rootDir, 'examples');
const specDir = path.join(rootDir, 'spec');

// --- block-type vocabulary --------------------------------------------------
// The checkers take the block-type set as a parameter (see the lib), so this
// filesystem-backed derivation stays in the gate rather than the shared module.
function knownBlockTypes(): Set<string> {
  const content = loadSchema('content.schema.json') as { $defs?: { block?: unknown } };
  const enumList = findBlockTypeEnum(content.$defs?.block);
  if (!enumList || enumList.length === 0) {
    throw new Error('could not locate the content-block type enum in content.schema.json#/$defs/block');
  }
  return new Set(enumList);
}

const BLOCK_TYPES = knownBlockTypes();

// --- filesystem helpers ----------------------------------------------------
function findFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// --- spec fence extraction -------------------------------------------------
const SKIP_RE = /<!--[^>]*cdx-validate:\s*skip[^>]*-->/i;

interface Fence {
  json: string;
  line: number;
}

// Extract ```json fences, honoring a `cdx-validate: skip` marker on the
// immediately-preceding non-blank line (the same opt-out check-spec-examples uses
// for intentionally partial or placeholder examples).
function extractJsonFences(content: string): Fence[] {
  const lines = content.split('\n');
  const fences: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```json\b/.test(lines[i])) continue;
    const openLine = i + 1;
    let p = i - 1;
    while (p >= 0 && lines[p].trim() === '') p--;
    const skip = p >= 0 && SKIP_RE.test(lines[p]);
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    if (!skip) fences.push({ json: body.join('\n'), line: openLine });
  }
  return fences;
}

/**
 * 05 §3.1: the declared `manifest.assets.<category>.index` MUST equal the derived
 * location, and 07 §5.4.2 rejects a divergence. This gate reads the DERIVED path for the
 * same reason the canonicalizer does — §4.3.1 item 2 builds every asset archive path from
 * the category key — so following a divergent declared path would make the gate check a
 * different file from the one the document ID resolves its assets through, encoding the
 * behaviour the specification forbids. `derivedIndexPath` is imported rather than
 * restated: two copies of §3.1's derivation could drift.
 *
 * OBSERVABILITY, stated honestly: the self-test proves this rule FIRES, because no
 * example diverges and the corpus therefore cannot exercise it. Nothing proves the call
 * site below is still wired in — deleting the call leaves every gate green.
 */
function checkAssetIndexPath(
  categoryName: string,
  category: Record<string, unknown>,
  where: string,
  findings: Finding[],
): void {
  const derived = derivedIndexPath(categoryName);
  // Normalized comparison, matching 05 §3.1 and asset-index.ts: a `.` or `..` segment is
  // not a divergence.
  if (typeof category.index === 'string' && normalizePath(category.index) !== derived) {
    findings.push({
      rule: 'asset-index-consistency',
      where,
      message: `category '${categoryName}' declares index '${category.index}' but Asset Embedding section 3.1 requires the derived location '${derived}'`,
    });
  }
}

// --- corpus + spec scan ----------------------------------------------------
function scanCorpus(findings: Finding[]): Record<string, number> {
  const counts = { contentTrees: 0, jsonFiles: 0, assetCategories: 0, layouts: 0, semanticFiles: 0 };
  const docDirs = fs
    .readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const name of docDirs) {
    const docDir = path.join(examplesDir, name);
    for (const file of findFiles(docDir, '.json')) {
      const rel = path.relative(rootDir, file);
      let json: unknown;
      try {
        json = readJson(file);
      } catch (err) {
        findings.push({ rule: 'parse', where: rel, message: `could not parse JSON: ${(err as Error).message}` });
        continue;
      }
      counts.jsonFiles++;

      // Content anchors appear in content, annotations, collaboration, and
      // phantom files; scan every part file for a range anchor.
      checkAnchors(json, rel, findings);

      const relForward = rel.split(path.sep).join('/');

      if (/\/content\/document\.json$/.test(relForward)) {
        counts.contentTrees++;
        walkBlocks(json, ROOT_DOCUMENT, rel, (b, parent, where) => checkBlock(b, parent, where, findings), BLOCK_TYPES);
      }

      if (/\/presentation\/layouts\/[^/]+\.json$/.test(relForward)) {
        counts.layouts++;
        checkPreciseLayout(json, rel, findings);
      }

      if (/\/semantic\/bibliography\.json$/.test(relForward) && isRecord(json)) {
        counts.semanticFiles++;
        checkUniqueIds(json.entries, 'id', 'bibliographyEntry', rel, findings);
      }
      if (/\/semantic\/glossary\.json$/.test(relForward) && isRecord(json)) {
        counts.semanticFiles++;
        checkUniqueIds(json.terms, 'id', 'glossaryTerm', rel, findings);
      }

      if (/\/manifest\.json$/.test(relForward) && isRecord(json) && isRecord(json.assets)) {
        for (const [categoryName, category] of Object.entries(json.assets)) {
          // Not gated on `category.index` any more: the index is located from the category
          // key, so a missing or non-string `index` must not skip the count/totalSize and
          // id-uniqueness checks below. checkAssetIndexPath no-ops on a non-string value.
          if (!isRecord(category)) continue;
          // A category key is a single path segment (canonicalize.ts guards the same way
          // when it derives asset paths). Deriving from an unsafe key would send the
          // path.join below outside the document directory.
          if (!isValidPathSegment(categoryName)) {
            findings.push({
              rule: 'asset-index-consistency',
              where: rel,
              message: `asset category key '${categoryName}' is not a valid path segment`,
            });
            continue;
          }
          checkAssetIndexPath(categoryName, category, rel, findings);
          const indexPath = path.join(docDir, derivedIndexPath(categoryName));
          if (!fs.existsSync(indexPath)) continue;
          let index: unknown;
          try {
            index = readJson(indexPath);
          } catch (err) {
            findings.push({
              rule: 'asset-index-consistency',
              where: rel,
              message: `category '${categoryName}' index ${derivedIndexPath(categoryName)} could not be parsed: ${(err as Error).message}`,
            });
            continue;
          }
          counts.assetCategories++;
          checkAssetCategory(categoryName, category, index, path.relative(rootDir, indexPath), findings);
        }
      }
    }
  }
  return counts;
}

// The content-oriented rules (upward-containment, anchor-range, figure- and
// definitionItem-cardinality) also apply to the spec's worked-example fences.
// The file-level rules (page/asset/id) key off part-file paths that do not exist
// in a fence, so they are corpus-only.
function scanSpecFences(findings: Finding[]): { files: number; fences: number } {
  const mdFiles = findFiles(specDir, '.md');
  let fenceCount = 0;
  for (const file of mdFiles) {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, 'utf8');
    for (const fence of extractJsonFences(content)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(fence.json);
      } catch {
        continue; // illustrative fragment — not a complete instance
      }
      fenceCount++;
      const where = `${rel}:${fence.line}`;
      walkBlocks(parsed, ROOT_EXCERPT, where, (b, parent, w) => checkBlock(b, parent, w, findings), BLOCK_TYPES);
      checkAnchors(parsed, where, findings);
    }
  }
  return { files: mdFiles.length, fences: fenceCount };
}

// --- self-test: prove each rule has teeth ----------------------------------
// Each case feeds a checker an in-memory instance that violates exactly one rule
// and asserts the rule fires; the paired valid instance asserts it does not.
function selfTest(): string[] {
  const failures: string[] = [];
  const runBlocks = (root: unknown, parent: string): Finding[] => {
    const f: Finding[] = [];
    walkBlocks(root, parent, 'test', (b, p, w) => checkBlock(b, p, w, f), BLOCK_TYPES);
    return f;
  };
  const has = (f: Finding[], rule: string): boolean => f.some((x) => x.rule === rule);
  const expectFires = (label: string, f: Finding[], rule: string): void => {
    if (!has(f, rule)) failures.push(`${label}: expected '${rule}' to fire, but it did not`);
  };
  const expectClean = (label: string, f: Finding[], rule: string): void => {
    if (has(f, rule)) failures.push(`${label}: '${rule}' fired on a valid instance`);
  };

  // upward-containment
  expectFires(
    'figcaption at document root',
    runBlocks({ version: '0.1', blocks: [{ type: 'figcaption', children: [] }] }, ROOT_DOCUMENT),
    'upward-containment',
  );
  expectFires(
    'tableCell under a paragraph',
    runBlocks({ type: 'paragraph', children: [{ type: 'tableCell', children: [] }] }, ROOT_EXCERPT),
    'upward-containment',
  );
  expectFires(
    'tableRow at document root',
    runBlocks({ version: '0.1', blocks: [{ type: 'tableRow', children: [] }] }, ROOT_DOCUMENT),
    'upward-containment',
  );
  expectClean(
    'figcaption under a figure',
    runBlocks({ type: 'figure', children: [{ type: 'image' }, { type: 'figcaption', children: [] }] }, ROOT_EXCERPT),
    'upward-containment',
  );
  expectClean(
    'standalone figcaption excerpt',
    runBlocks({ type: 'figcaption', children: [] }, ROOT_EXCERPT),
    'upward-containment',
  );

  // figure-cardinality
  expectFires(
    'figure with two content blocks',
    runBlocks({ type: 'figure', children: [{ type: 'image' }, { type: 'svg' }] }, ROOT_EXCERPT),
    'figure-cardinality',
  );
  expectFires(
    'figure with no content block',
    runBlocks({ type: 'figure', children: [{ type: 'figcaption', children: [] }] }, ROOT_EXCERPT),
    'figure-cardinality',
  );
  expectFires(
    'figure with two figcaptions',
    runBlocks(
      { type: 'figure', children: [{ type: 'image' }, { type: 'figcaption' }, { type: 'figcaption' }] },
      ROOT_EXCERPT,
    ),
    'figure-cardinality',
  );
  expectClean(
    'figure with one content and one caption',
    runBlocks({ type: 'figure', children: [{ type: 'image' }, { type: 'figcaption', children: [] }] }, ROOT_EXCERPT),
    'figure-cardinality',
  );
  expectClean(
    'figure using subfigures',
    runBlocks(
      { type: 'figure', subfigures: [{ children: [{ type: 'image' }] }, { children: [{ type: 'image' }] }] },
      ROOT_EXCERPT,
    ),
    'figure-cardinality',
  );

  // definition-item-cardinality
  expectFires(
    'definitionItem with two terms, no description',
    runBlocks(
      { type: 'definitionItem', children: [{ type: 'definitionTerm' }, { type: 'definitionTerm' }] },
      ROOT_EXCERPT,
    ),
    'definition-item-cardinality',
  );
  expectClean(
    'definitionItem with a term and a description',
    runBlocks(
      { type: 'definitionItem', children: [{ type: 'definitionTerm' }, { type: 'definitionDescription' }] },
      ROOT_EXCERPT,
    ),
    'definition-item-cardinality',
  );

  // anchor-range
  const anchorFindings = (node: unknown): Finding[] => {
    const f: Finding[] = [];
    checkAnchors(node, 'test', f);
    return f;
  };
  expectFires('inverted range anchor object', anchorFindings({ blockId: 'x', start: 10, end: 5 }), 'anchor-range');
  expectFires('empty range anchor object', anchorFindings({ blockId: 'x', start: 7, end: 7 }), 'anchor-range');
  expectFires('inverted range anchor URI', anchorFindings('#intro/10-5'), 'anchor-range');
  expectClean('valid range anchor object', anchorFindings({ blockId: 'x', start: 1, end: 2 }), 'anchor-range');
  expectClean('valid range anchor URI', anchorFindings('#intro/10-25'), 'anchor-range');
  expectClean('block-level anchor (no range)', anchorFindings({ blockId: 'x' }), 'anchor-range');

  // page-number-integrity
  const pageFindings = (node: unknown): Finding[] => {
    const f: Finding[] = [];
    checkPreciseLayout(node, 'test', f);
    return f;
  };
  expectFires(
    'duplicate page numbers',
    pageFindings({ pages: [{ number: 1, elements: [] }, { number: 1, elements: [] }] }),
    'page-number-integrity',
  );
  expectClean(
    'unique page numbers',
    pageFindings({ pages: [{ number: 1, elements: [] }, { number: 2, elements: [] }] }),
    'page-number-integrity',
  );

  // asset-index-consistency
  const assetFindings = (category: Record<string, unknown>, index: unknown): Finding[] => {
    const f: Finding[] = [];
    checkAssetCategory('images', category, index, 'test', f);
    return f;
  };
  expectFires(
    'duplicate asset ids',
    assetFindings({}, { assets: [{ id: 'a', size: 1 }, { id: 'a', size: 1 }] }),
    'asset-index-consistency',
  );
  expectFires(
    'count mismatch',
    assetFindings({ count: 2, totalSize: 1 }, { assets: [{ id: 'a', size: 1 }] }),
    'asset-index-consistency',
  );
  expectFires(
    'totalSize ignoring a variant',
    assetFindings(
      { count: 1, totalSize: 10 },
      { assets: [{ id: 'a', size: 10, variants: [{ size: 5 }] }] },
    ),
    'asset-index-consistency',
  );
  expectClean(
    'consistent category with a variant',
    assetFindings(
      { count: 1, totalSize: 15 },
      { assets: [{ id: 'a', size: 10, variants: [{ size: 5 }] }] },
    ),
    'asset-index-consistency',
  );
  // The declared-vs-derived index path (05 §3.1). No example diverges, so the corpus
  // cannot exercise this rule — without these two cases the check is unobservable and
  // could be deleted with every gate still green.
  const indexPathFindings = (category: Record<string, unknown>): Finding[] => {
    const f: Finding[] = [];
    checkAssetIndexPath('images', category, 'test', f);
    return f;
  };
  expectFires(
    'declared index path diverging from the derived location',
    indexPathFindings({ index: 'assets/images/catalog.json' }),
    'asset-index-consistency',
  );
  expectClean(
    'declared index path equal to the derived location',
    indexPathFindings({ index: 'assets/images/index.json' }),
    'asset-index-consistency',
  );
  expectClean(
    'declared index path equal after normalization (a `.` segment is not a divergence)',
    indexPathFindings({ index: 'assets/./images/index.json' }),
    'asset-index-consistency',
  );
  // The category key becomes a path segment in the derived location, so an unsafe key would
  // send the corpus walk's path.join outside the document directory. Deleting that guard
  // leaves every gate green without this case, since no example carries such a key.
  expectFires(
    'asset category key that is not a safe path segment',
    ((): Finding[] => {
      const f: Finding[] = [];
      for (const key of ['..', '', 'a/b']) {
        if (!isValidPathSegment(key)) {
          f.push({ rule: 'asset-index-consistency', where: 'test', message: `asset category key '${key}' is not a valid path segment` });
        }
      }
      return f;
    })(),
    'asset-index-consistency',
  );

  // id-uniqueness
  const idFindings = (items: unknown): Finding[] => {
    const f: Finding[] = [];
    checkUniqueIds(items, 'id', 'bibliographyEntry', 'test', f);
    return f;
  };
  expectFires('duplicate bibliography ids', idFindings([{ id: 'a' }, { id: 'a' }]), 'id-uniqueness');
  expectClean('unique bibliography ids', idFindings([{ id: 'a' }, { id: 'b' }]), 'id-uniqueness');

  return failures;
}

// --- main ------------------------------------------------------------------
function main(): void {
  console.log('Checking structural constraints...\n');

  const findings: Finding[] = [];
  const corpus = scanCorpus(findings);
  const spec = scanSpecFences(findings);
  const selfTestFailures = selfTest();

  console.log(
    `Corpus: ${corpus.contentTrees} content tree(s), ${corpus.jsonFiles} JSON file(s) scanned for anchors, ` +
      `${corpus.assetCategories} asset categor(y/ies), ${corpus.layouts} precise layout(s), ` +
      `${corpus.semanticFiles} semantic file(s).`,
  );
  console.log(`Spec: ${spec.fences} JSON fence(s) across ${spec.files} markdown file(s).\n`);
  console.log('='.repeat(60));

  if (selfTestFailures.length > 0) {
    console.log('\n✗ self-test failed (a rule is not enforcing):');
    for (const s of selfTestFailures) console.log(`    ${s}`);
  }

  if (findings.length > 0) {
    const byRule = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = byRule.get(f.rule) ?? [];
      list.push(f);
      byRule.set(f.rule, list);
    }
    console.log(`\n✗ ${findings.length} structural violation(s):\n`);
    for (const [rule, list] of [...byRule.entries()].sort()) {
      console.log(`  [${rule}] ${list.length}`);
      for (const f of list) console.log(`    ${f.where}: ${f.message}`);
    }
    console.log('');
  }

  if (findings.length > 0 || selfTestFailures.length > 0) {
    console.log('='.repeat(60));
    console.log('\nStructural constraint check failed.');
    process.exit(1);
  }

  console.log('\nAll structural constraints satisfied; self-test passed.');
}

main();
