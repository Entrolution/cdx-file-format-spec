#!/usr/bin/env npx tsx

/**
 * Unit tests for the document/part mapper (scripts/lib/document-verdict.ts) — specifically
 * the properties the Level-1 fixture corpus CANNOT express.
 *
 * WHY THIS FILE EXISTS. The fixture comparator (conformance-suite.ts
 * `compareFixtureVerdict`) checks that every EXPECTED finding is reported: a SUBSET check,
 * deliberately, because a correct reader MAY report more. That makes "the reader must NOT
 * report X" unassertable there — a spurious extra finding passes every fixture whose
 * document-level disposition it does not raise. Yet several of the subtlest rules in
 * B1b-3b-2 are exactly of that shape:
 *
 *   - an INDETERMINATE asset category (its index absent, unparseable or malformed) must
 *     SUSPEND the document-ID recompute and its own asset references, not report them. The
 *     alternative fans one missing index out into a finding per reference, and manufactures
 *     an id mismatch by recomputing over a partial asset map — the same failure the
 *     `dcResolvable` gate exists to prevent for an unloadable Dublin Core part;
 *   - a DECLARED-but-unloadable bibliography or glossary leaves its namespace indeterminate,
 *     so no citation or glossary mark may be called dangling;
 *   - a dangling asset href must NOT suppress the id-collision finding. `resolveAssetRef`
 *     throws for an unresolvable `assets/`-rooted href, and if the raw-content merge key
 *     called it, that throw would propagate into document-verdict's catch-all and discard
 *     every finding of the reference pass — one bad href switching off an INTEGRITY-ERROR.
 *
 * Mutation testing proved the gap rather than assuming it: removing the `assetsResolvable`
 * gate left all 27 gates green. These tests kill that mutant.
 *
 * Run: `npm run test:document-verdict`.
 */

import assert from 'assert/strict';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { buildZip, type ZipEntryRecipe } from './lib/zip-writer.js';
import { readArchive } from './lib/zip-reader.js';
import { documentVerdict, type ReaderSupport } from './lib/document-verdict.js';
import { deriveContentVocabulary } from './lib/content-classifier.js';
import { canonicalContent, collectDefinedIds, collectStoredTextViolations, MAX_CANONICALIZATION_DEPTH } from './lib/canonicalize.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`    ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}

const VOCAB = deriveContentVocabulary();
const SUPPORT: ReaderSupport = { major: 0, minor: 1, extensions: new Set<string>() };

/** Codes the document mapper reports for an archive assembled from these entries. */
function codesFor(entries: ZipEntryRecipe[]): Set<string> {
  const bytes = buildZip({ entries });
  const archive = readArchive(bytes);
  return new Set(documentVerdict(bytes, archive, SUPPORT, VOCAB).findings.map((f) => f.code));
}

const DC = '{"version":"1.1","terms":{"title":"T","creator":"A. Author"}}';
const FIG1 = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';
const FIG1_HASH = 'sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86';
const INDEX_ONE = `{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"${FIG1_HASH}"}]}`;
const INDEX_ONE_HASH = 'sha256:b437c9030604dd9d987bb6d165de2a651d787e251b665e5b13818921af3aba5d';
const CONTENT_IMAGE = '{"version":"0.1","blocks":[{"type":"image","id":"img1","src":"assets/images/fig1.svg","alt":"Figure 1"}]}';
const CONTENT_IMAGE_HASH = 'sha256:d4f68c68e67a9fff2870e84432e4e7572cc3ff2a8a784522d08298317bf52a4e';
/**
 * The id `CONTENT_IMAGE` + this Dublin Core + `INDEX_ONE` actually canonicalize to. Used
 * where a test needs the recompute to be ATTEMPTED (a real id, not `pending`) while
 * asserting it is suspended — so a suppression failure shows up as a spurious mismatch
 * rather than being masked by the id happening to be wrong anyway.
 */
const REAL_ID = 'sha256:b2c5654bd19fd2d70a36e33fc7d7ec4cb6bebedd406f55c08f11918dfd3840a8';

const manifest = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    cdx: '0.1',
    id: 'pending',
    state: 'draft',
    created: '2025-01-10T08:00:00Z',
    modified: '2025-01-10T08:00:00Z',
    content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
    metadata: { dublinCore: 'metadata/dublin-core.json' },
    ...overrides,
  });

const body = (content = CONTENT_IMAGE): ZipEntryRecipe[] => [
  { name: 'content/document.json', text: content },
  { name: 'metadata/dublin-core.json', text: DC },
];

const imagesCategory = { images: { count: 1, totalSize: 62, index: 'assets/images/index.json', hash: INDEX_ONE_HASH } };

// --- an INDETERMINATE asset category suspends, never accuses -----------------

test('an absent asset index suspends the document-ID recompute', () => {
  // A REAL id plus an unloadable category. Recomputing here would need an asset map the
  // reader does not have, so the id is indeterminate — reporting a mismatch would accuse a
  // document of tampering on the strength of a basis the reader could not assemble.
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ id: REAL_ID, state: 'review', assets: imagesCategory }) },
    ...body(),
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-PART-MISSING-BOUND'), 'the missing index itself is reported');
  assert.ok(!codes.has('CDX-E-DOCUMENT-ID-MISMATCH'), 'the recompute must be SKIPPED, not run over a partial asset map');
});

test('an absent asset index suspends its own asset references', () => {
  // The content references `assets/images/fig1.svg`. With no index the reference is
  // unresolvable-but-indeterminate, not dangling: reporting it would turn ONE missing index
  // into a finding per reference and claim a defect the document may not have.
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ assets: imagesCategory }) },
    ...body(),
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-PART-MISSING-BOUND'));
  assert.ok(!codes.has('CDX-E-ASSET-REFERENCE-DANGLING'), 'a reference into an indeterminate category is not dangling');
});

test('a structurally malformed asset index suspends the same two checks', () => {
  // `buildAssetMap` SKIPS a category whose index carries no `assets` array, without
  // throwing — so this is the arm where an empty map could silently look authoritative.
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ id: REAL_ID, state: 'review', assets: imagesCategory }) },
    ...body(),
    { name: 'assets/images/index.json', text: '{"version":"0.1"}' },
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-ASSET-INDEX-UNUSABLE'));
  assert.ok(!codes.has('CDX-E-DOCUMENT-ID-MISMATCH'), 'an unusable index leaves the id indeterminate');
  assert.ok(!codes.has('CDX-E-ASSET-REFERENCE-DANGLING'), 'and leaves its references indeterminate');
});

test('an absent index is not ALSO reported as an unusable one', () => {
  // `buildAssetMap` throws for a declared category it was given no index text for. Letting
  // that throw through would report one defect twice, the second time under a code that
  // misdescribes it — "present but unusable" for a file that is absent.
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ assets: imagesCategory }) },
    ...body(),
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(!codes.has('CDX-E-ASSET-INDEX-UNUSABLE'), 'the absent-index row already owns this defect');
});

test('an unbuildable asset map suspends even a reference with no identifiable category', () => {
  // Two index entries resolve to ONE archive path under different hashes, so `buildAssetMap`
  // rejects the whole map — asset resolution would be order-dependent. Per-CATEGORY
  // suppression cannot cover a reference like `assets/orphan`, which has no category segment
  // at all, so only the whole-map guard suspends it. Without that guard the reader reports a
  // dangling reference on a document whose asset resolution it could not establish.
  const conflicting =
    `{"version":"0.1","assets":[{"id":"a","path":"x.svg","hash":"${FIG1_HASH}"},{"id":"b","path":"x.svg","hash":"sha256:${'0'.repeat(64)}"}]}`;
  const content = '{"version":"0.1","blocks":[{"type":"image","id":"img1","src":"assets/orphan","alt":"F"}]}';
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({ content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` }, assets: imagesCategory }),
    },
    ...body(content),
    { name: 'assets/images/index.json', text: conflicting },
    { name: 'assets/images/x.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-ASSET-INDEX-UNUSABLE'), 'the unbuildable map itself is reported');
  assert.ok(!codes.has('CDX-E-ASSET-REFERENCE-DANGLING'), 'no reference may be called dangling against a map that could not be built');
});

test('an index entry path with a dot segment resolves to the same archive entry as buildAssetMap', () => {
  // `buildAssetMap` NORMALIZES `assets/<category>/<path>` before registering it, so an
  // entry whose `path` is `../fonts/f.svg` is registered at `assets/fonts/f.svg` — and a
  // conformant archive stores it there. A presence or hash check that joined the path
  // WITHOUT normalizing would look for `assets/images/../fonts/f.svg`, which no archive
  // contains: a spurious missing-part finding on a conformant document, and the asset's
  // hash silently never verified. Both failure directions from one omission.
  const crossCategory = `{"version":"0.1","assets":[{"id":"f","path":"../fonts/f.svg","type":"image/svg+xml","size":62,"hash":"${FIG1_HASH}"}]}`;
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: { images: { count: 1, totalSize: 62, index: 'assets/images/index.json', hash: `sha256:${'0'.repeat(64)}` } },
      }),
    },
    ...body('{"version":"0.1","blocks":[{"type":"image","id":"img1","src":"assets/fonts/f.svg","alt":"F"}]}'),
    { name: 'assets/images/index.json', text: crossCategory },
    { name: 'assets/fonts/f.svg', text: FIG1 },
  ]);
  assert.ok(!codes.has('CDX-E-PART-MISSING-BOUND'), 'the asset IS present at its normalized path');
  assert.ok(!codes.has('CDX-E-ASSET-HASH-MISMATCH'), 'and its hash matches, which requires finding the right entry');
  assert.ok(!codes.has('CDX-E-ASSET-REFERENCE-DANGLING'), 'and the content reference resolves against the same normalized key');
});

test('an unrelated file under presentation/ is IGNOREd, not flagged as an undeclared layout', () => {
  // 04 §12's concern is a file a renderer could MISTAKE for authoritative appearance, and
  // §13.3 says what makes it one: a `presentationType`, or a `type` from the closed set. A
  // location-only sweep would collide with §5.4.2's "Unrecognized file or directory in the
  // archive → IGNORE" row and warn about any byte parked under the directory.
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH } }) },
    ...body(),
    { name: 'presentation/notes.json', text: '{"version":"0.1","note":"editorial scratch"}' },
  ]);
  assert.ok(!codes.has('CDX-E-PRESENTATION-UNDECLARED'), 'no discriminator, so not a layout');
});

test('an undeclared file WITH a presentation discriminator is flagged', () => {
  // The counterpart: the sweep must not become so narrow that an injected layout escapes.
  for (const [label, text] of [
    ['precise', '{"version":"0.1","presentationType":"precise","targetFormat":"letter"}'],
    ['reactive', '{"version":"0.1","type":"paginated","pages":[]}'],
  ] as const) {
    const codes = codesFor([
      { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH } }) },
      ...body(),
      { name: 'presentation/layouts/injected.json', text },
    ]);
    assert.ok(codes.has('CDX-E-PRESENTATION-UNDECLARED'), `an undeclared ${label} layout must be surfaced`);
  }
});

test('a declared index path diverging from the derived one is reported, and the index is still read from the derived path', () => {
  // 05 §3.1 states the equality as a MUST and the erratum gave it a §5.4.2 row: REJECT in
  // both columns. §3.1 formerly resolved the conflict itself ("the derived path governs"),
  // which left the document loadable and the defect with no disposition. REJECTING is the
  // verdict, not a relocation of the read: the reader still loads the DERIVED path, proved
  // here by the category resolving cleanly against an index present only there. That
  // matters because a reader that followed the declared path would resolve the category's
  // assets differently — the ambiguity the REJECT exists to remove.
  //
  // The fixture `reject-asset-index-path-divergent` now pins the disposition; this test
  // pins what the fixture's subset comparator cannot — that nothing ELSE is reported.
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: { images: { count: 1, totalSize: 62, index: 'assets/images/catalog.json', hash: INDEX_ONE_HASH } },
      }),
    },
    ...body(),
    { name: 'assets/images/index.json', text: INDEX_ONE },
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-ASSET-INDEX-PATH-DIVERGENT'), 'the divergence is surfaced');
  assert.ok(!codes.has('CDX-E-PART-MISSING-BOUND'), 'the index is read from the derived path, so the category resolved');
  assert.ok(!codes.has('CDX-E-ASSET-REFERENCE-DANGLING'), 'and its references resolve against it');
});

test('a malformed or absent index hash cannot silently disable the category anchor', () => {
  // 05 §8.1 step 3 makes `manifest.assets.<category>.hash` the index's declared hash and §3.1
  // makes that one hash the transitive anchor for the whole category. Skipping the comparison
  // when the DECLARATION is malformed would let a one-character manifest edit turn the anchor
  // off with no finding at all — the opposite of what hash-pinning the index is for.
  for (const [label, category] of [
    ['malformed hash', { count: 1, totalSize: 62, index: 'assets/images/index.json', hash: 'nope' }],
    ['absent hash', { count: 1, totalSize: 62, index: 'assets/images/index.json' }],
  ] as const) {
    const codes = codesFor([
      { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH }, assets: { images: category } }) },
      ...body(),
      { name: 'assets/images/index.json', text: INDEX_ONE },
      { name: 'assets/images/fig1.svg', text: FIG1 },
    ]);
    assert.ok(codes.has('CDX-E-MANIFEST-HASH-MALFORMED'), `${label} must be reported, not skipped`);
  }
  // A category that is not an object at all is the same class, under the reference code.
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH }, assets: { images: 'nope' } }) },
    ...body(),
    { name: 'assets/images/index.json', text: INDEX_ONE },
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-MANIFEST-REFERENCE-MALFORMED'), 'a non-object category is a mistyped required field');
});

test('an aliasOf entry whose bytes are stored once is not reported missing', () => {
  // 05 §10.2: `aliasOf` "marks that an entry's bytes are identical to another entry's — a
  // hint that storage tooling MAY keep the bytes once". A document following that guidance
  // stores one copy, so flagging the alias's own path would report the specification's own
  // worked example as defective — at a row that escalates to INTEGRITY-ERROR in B3.
  const aliased =
    `{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"${FIG1_HASH}"},` +
    `{"id":"fig1alias","path":"fig1-copy.svg","type":"image/svg+xml","size":62,"hash":"${FIG1_HASH}","aliasOf":"fig1"}]}`;
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: { images: { count: 2, totalSize: 124, index: 'assets/images/index.json', hash: `sha256:${'0'.repeat(64)}` } },
      }),
    },
    ...body(),
    { name: 'assets/images/index.json', text: aliased },
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(!codes.has('CDX-E-PART-MISSING-BOUND'), 'the alias may legitimately share one stored copy');
});

test('an index path declared twice with conflicting hashes reports the ambiguity, not a byte mismatch', () => {
  // `buildAssetMap` rejects such an index because the reference would resolve
  // order-dependently, and that ambiguity IS the defect. Comparing the bytes against each
  // declaration in turn would additionally report the loser as a byte-level mismatch — which
  // is guaranteed (at most one of two conflicting declarations can match) and so says nothing
  // about the document beyond what the ambiguity already said.
  const conflicting =
    `{"version":"0.1","assets":[{"id":"a","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"${FIG1_HASH}"},` +
    `{"id":"b","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"sha256:${'0'.repeat(64)}"}]}`;
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH }, assets: imagesCategory }) },
    ...body(),
    { name: 'assets/images/index.json', text: conflicting },
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-ASSET-INDEX-UNUSABLE'), 'the ambiguous index is the defect');
  assert.ok(!codes.has('CDX-E-ASSET-HASH-MISMATCH'), 'the guaranteed byte mismatch adds nothing and is suppressed');
});

test('a PATH-ONLY side file still establishes its namespace', () => {
  // `configValues` holds only the refs the projection binds — exactly `{path, hash}`. A
  // declaration written path-only names a file that is present and perfectly loadable, so
  // reading only `configValues` would leave the namespace indeterminate and silently switch
  // the ENTIRE citation row off. Binding less than it should is a separate defect from
  // whether the namespace can be established.
  const bib = '{"version":"0.1","entries":[{"id":"smith2024","type":"book","title":"A"}]}';
  const content =
    '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":' +
    '[{"type":"text","value":"a","marks":[{"type":"citation","refs":["nosuchkey"]}]}]}]}';
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` },
        semantic: { bibliography: { path: 'semantic/bibliography.json' } },
      }),
    },
    ...body(content),
    { name: 'semantic/bibliography.json', text: bib },
  ]);
  assert.ok(codes.has('CDX-E-CITATION-REFERENCE-DANGLING'), 'the namespace loaded, so the bad ref is genuinely dangling');
});

test('a hash-bound part this reader cannot decode is NOT reported missing', () => {
  // §5.4.2 note 6, mirroring note 5 for encrypted parts: such a part is PRESENT and intact,
  // and the missing-part rows MUST NOT fire for it. Reporting it missing blames the document
  // for the READER's capability envelope — and on a frozen document that escalates to an
  // INTEGRITY-ERROR against an archive that is not damaged. Before the fix the container
  // layer said "integrity-indeterminate, document unaffected" while the document layer said
  // PART-MISSING-BOUND: two contradictory instructions for one archive.
  //
  // Run in a child process with `zlib.zstdDecompressSync` hidden, since the reader captures
  // the decoder at module load and Zstandard is RECOMMENDED, not required (§3.2).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdx-nozstd-doc-'));
  try {
    const preload = path.join(dir, 'hide.cjs');
    fs.writeFileSync(preload, "const z = require('zlib'); delete z.zstdDecompressSync;\n");
    const script = path.join(dir, 'probe.ts');
    fs.writeFileSync(
      script,
      `import { buildZip } from ${JSON.stringify(path.resolve('scripts/lib/zip-writer.ts'))};\n` +
        `import { readArchive } from ${JSON.stringify(path.resolve('scripts/lib/zip-reader.ts'))};\n` +
        `import { documentVerdict } from ${JSON.stringify(path.resolve('scripts/lib/document-verdict.ts'))};\n` +
        `import { deriveContentVocabulary } from ${JSON.stringify(path.resolve('scripts/lib/content-classifier.ts'))};\n` +
        `const m = ${JSON.stringify(JSON.stringify({
          cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z',
          content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` },
          metadata: { dublinCore: 'metadata/dublin-core.json' },
          presentation: [{ type: 'paginated', path: 'presentation/p.json', hash: `sha256:${'0'.repeat(64)}` }],
        }))};\n` +
        `const bytes = buildZip({ entries: [\n` +
        `  { name: 'manifest.json', text: m },\n` +
        `  { name: 'content/document.json', text: ${JSON.stringify(CONTENT_IMAGE)} },\n` +
        `  { name: 'metadata/dublin-core.json', text: ${JSON.stringify(DC)} },\n` +
        `  { name: 'presentation/p.json', text: '{"version":"0.1","type":"paginated","pages":[]}', method: 'zstd' },\n` +
        `] });\n` +
        `const v = documentVerdict(bytes, readArchive(bytes), { major: 0, minor: 1, extensions: new Set() }, deriveContentVocabulary());\n` +
        `console.log(JSON.stringify(v.findings.map(f => f.code)));\n`,
    );
    const out = execFileSync('npx', ['tsx', '--require', preload, script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const codes = JSON.parse(out.trim().split('\n').pop()!) as string[];
    assert.ok(!codes.includes('CDX-E-PART-MISSING-BOUND'), `a present-but-undecodable part must not be reported missing, got ${JSON.stringify(codes)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- a declared-but-unloadable side file suspends its namespace --------------

test('a declared-but-absent bibliography suspends the citation row', () => {
  const content =
    '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"citation","refs":["nosuchkey"]}]}]}]}';
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
        semantic: { bibliography: { path: 'semantic/bibliography.json', hash: `sha256:${'0'.repeat(64)}` } },
      }),
    },
    ...body(content),
  ]);
  assert.ok(codes.has('CDX-E-CONFIG-PART-MISSING'), 'the missing side file itself is reported');
  assert.ok(!codes.has('CDX-E-CITATION-REFERENCE-DANGLING'), 'the namespace is indeterminate, not empty');
});

test('with no external glossary, a glossary ref resolves against in-document semantic:term ids', () => {
  // Semantic Extension §8.3 rule 2: "Otherwise, the in-document `semantic:term` blocks are
  // the source … a `glossary` `ref` (or a `see`) resolves against their `id`s." Treating that
  // namespace as empty reports a dangling reference on EVERY document that defines its terms
  // inline — the ordinary case for a document carrying no external glossary at all.
  const content =
    '{"version":"0.1","blocks":[{"type":"semantic:term","id":"crdt","term":"CRDT","definition":"x"},' +
    '{"type":"paragraph","id":"p1","children":[{"type":"text","value":"see","marks":[{"type":"glossary","ref":"crdt"}]}]}]}';
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` } }) },
    ...body(content),
  ]);
  assert.ok(!codes.has('CDX-E-GLOSSARY-REFERENCE-DANGLING'), 'an inline term definition IS the namespace when no file is declared');
});

test('a semantic:term see[] entry resolves against the same in-document namespace', () => {
  const content =
    '{"version":"0.1","blocks":[{"type":"semantic:term","id":"crdt","term":"CRDT","definition":"x","see":["gone"]},' +
    '{"type":"semantic:term","id":"ot","term":"OT","definition":"y"}]}';
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` } }) },
    ...body(content),
  ]);
  assert.ok(codes.has('CDX-E-GLOSSARY-REFERENCE-DANGLING'), '"gone" names no term block, so it dangles');
});

test('a DECLARED external bibliography is authoritative — inline entries are not consulted', () => {
  // Semantic Extension §4.4: "When an external bibliography is declared it is the single
  // authoritative source and inline `entries` are not consulted, so the two cannot diverge."
  // Unioning the two would accept a `ref` naming an inline entry the authoritative file
  // omits, reporting a genuinely dangling citation as clean.
  const bib = '{"version":"0.1","entries":[{"id":"smith2024","type":"book","title":"A"}]}';
  const bibHash = `sha256:${createHash('sha256').update(bib, 'utf8').digest('hex')}`;
  const content =
    '{"version":"0.1","blocks":[{"type":"semantic:bibliography","id":"b1","entries":[{"id":"inline2024","type":"book","title":"B"}]},' +
    '{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"citation","refs":["inline2024"]}]}]}]}';
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` },
        semantic: { bibliography: { path: 'semantic/bibliography.json', hash: bibHash } },
      }),
    },
    ...body(content),
    { name: 'semantic/bibliography.json', text: bib },
  ]);
  assert.ok(codes.has('CDX-E-CITATION-REFERENCE-DANGLING'), 'the inline entry does not rescue a ref the authoritative file omits');
});

test('with NO external bibliography declared, inline entries ARE the namespace', () => {
  const content =
    '{"version":"0.1","blocks":[{"type":"semantic:bibliography","id":"b1","entries":[{"id":"inline2024","type":"book","title":"B"}]},' +
    '{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"citation","refs":["inline2024"]}]}]}]}';
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` } }) },
    ...body(content),
  ]);
  assert.ok(!codes.has('CDX-E-CITATION-REFERENCE-DANGLING'), 'the inline entries are authoritative here');
});

test('a PARTIAL asset map must never reach the content walk', () => {
  // The worst outcome this layer can produce. With one category unresolvable, a partial map
  // resolves hrefs into the good category to a real hash while hrefs into the broken one fall
  // back to the placeholder — so two adjacent text nodes sharing an `anchor` id UNDER-merge
  // and the walk reports a duplicate the canonicalizer, holding every index, does not. That
  // is a FALSE CDX-E-ID-COLLISION: an INTEGRITY-ERROR on a conformant document.
  const H = `sha256:${'a'.repeat(64)}`; // the SAME bytes registered in both categories
  const imgIdx = `{"version":"0.1","assets":[{"id":"i","path":"a.svg","type":"image/svg+xml","size":1,"hash":"${H}"}]}`;
  const content =
    '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":' +
    '[{"type":"text","value":"a","marks":[{"type":"anchor","id":"dup"},{"type":"link","href":"assets/images/a.svg"}]},' +
    '{"type":"text","value":"b","marks":[{"type":"anchor","id":"dup"},{"type":"link","href":"assets/fonts/b.woff2"}]}]}]}';
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({
        content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` },
        assets: {
          images: { count: 1, totalSize: 1, index: 'assets/images/index.json', hash: `sha256:${'0'.repeat(64)}` },
          fonts: { count: 1, totalSize: 1, index: 'assets/fonts/index.json', hash: `sha256:${'0'.repeat(64)}` },
        },
      }),
    },
    ...body(content),
    { name: 'assets/images/index.json', text: imgIdx },
    { name: 'assets/images/a.svg', text: FIG1 },
    // No assets/fonts/index.json — the fonts category is unresolvable.
  ]);
  assert.ok(codes.has('CDX-E-PART-MISSING-BOUND'), 'the missing fonts index is reported');
  assert.ok(!codes.has('CDX-E-ID-COLLISION'), 'a partial map must not manufacture a collision');
});

test('an UNDECLARED bibliography leaves the namespace empty, so a citation does dangle', () => {
  // The counterpart of the test above, and the reason indeterminate and empty must stay
  // distinct: a document that declares no bibliography at all genuinely resolves its
  // citations to nothing, and suppressing there would hide a real defect.
  const content =
    '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"citation","refs":["nosuchkey"]}]}]}]}';
  const codes = codesFor([
    {
      name: 'manifest.json',
      text: manifest({ content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` } }),
    },
    ...body(content),
  ]);
  assert.ok(codes.has('CDX-E-CITATION-REFERENCE-DANGLING'));
});

// --- a dangling asset href must not switch off the collision check -----------

test('a dangling asset href does not suppress the id-collision finding', () => {
  // Two adjacent text nodes share the anchor id `x` and link to two DIFFERENT unregistered
  // assets. If the raw-content merge key resolved hrefs with `resolveAssetRef`, its throw
  // would propagate into document-verdict's CanonicalizationError catch and discard the
  // whole reference pass — so one dangling href would switch off an INTEGRITY-ERROR. The
  // non-throwing lookup keeps both findings alive.
  // One href RESOLVES and the other does not, deliberately: two unresolvable hrefs would both
  // key to the same placeholder, the nodes would merge, and there would be no collision left
  // to assert — the test would pass with the collision check deleted outright. With one
  // resolvable href the keys differ, the nodes stay apart, and both `anchor` ids survive.
  const content =
    '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":' +
    '[{"type":"text","value":"a","marks":[{"type":"anchor","id":"x"},{"type":"link","href":"assets/images/fig1.svg"}]},' +
    '{"type":"text","value":"b","marks":[{"type":"anchor","id":"x"},{"type":"link","href":"assets/images/gone.svg"}]}]}]}';
  const codes = codesFor([
    { name: 'manifest.json', text: manifest({ content: { path: 'content/document.json', hash: `sha256:${'0'.repeat(64)}` }, assets: imagesCategory }) },
    ...body(content),
    { name: 'assets/images/index.json', text: INDEX_ONE },
    { name: 'assets/images/fig1.svg', text: FIG1 },
  ]);
  assert.ok(codes.has('CDX-E-ASSET-REFERENCE-DANGLING'), 'the dangling href is reported');
  assert.ok(codes.has('CDX-E-ID-COLLISION'), 'and the collision survives alongside it');
});


// --- footnote resolution: the properties a SUBSET check cannot express -------
//
// Semantic Extension §4.5.2 is mostly a rule about what a reader MUST NOT conclude, and the
// fixture comparator asserts only that expected findings are present. Everything below is a
// must-NOT-report property, which is why it lives here.
//
// NOT tested here, deliberately: §4.5.2's "resolves to the first block in document order".
// That is a RENDERER selection, and this layer performs no selection — it reports the
// ambiguity and stops. Asserting it at this layer would be asserting something the code
// does not claim to do.

const fnMark = (mark: Record<string, unknown>, blocks: Record<string, unknown>[]): string =>
  JSON.stringify({
    version: '0.1',
    blocks: [
      { type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'a', marks: [{ type: 'footnote', ...mark }] }] },
      ...blocks.map((b) => ({ type: 'semantic:footnote', content: 'note', ...b })),
    ],
  });

const footnoteCodes = (content: string): Set<string> =>
  codesFor([{ name: 'manifest.json', text: manifest({}) }, ...body(content)]);

test('footnote: an id match suppresses an otherwise-ambiguous marker (id match takes precedence)', () => {
  // Two blocks share `number: 1`, so the MARKER is ambiguous — but the mark carries an `id`
  // that identifies one block exactly, and §4.5.2 gives id match precedence. Reporting the
  // ambiguity here would warn about a reference the specification resolves unambiguously,
  // and would do it on the very shape §4.5.2 tells authors to use to disambiguate.
  const codes = footnoteCodes(fnMark({ number: 1, id: 'fn1' }, [{ id: 'fn1', number: 1 }, { number: 1 }]));
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'an id match must not report the marker ambiguity');
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'an id match must not report dangling');
});

test('footnote: an ambiguous marker reports AMBIGUOUS and not DANGLING', () => {
  // The mark does resolve — to more than one block. Reporting it as dangling would say the
  // target is absent, which is the opposite of the defect.
  const codes = footnoteCodes(fnMark({ number: 1 }, [{ number: 1 }, { number: 1 }]));
  assert.ok(codes.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'the ambiguity is reported');
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'an ambiguous marker is not a dangling one');
});

test('footnote: a dangling marker reports DANGLING and not AMBIGUOUS', () => {
  const codes = footnoteCodes(fnMark({ number: 9 }, [{ number: 1 }]));
  assert.ok(codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'the dangling mark is reported');
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'nothing matched, so nothing is ambiguous');
});

test('footnote: duplicate markers with NO mark referencing them report nothing', () => {
  // §4.5.2's uniqueness MUST is violated, but its reader rule is scoped to "a reader that
  // finds a MARKER RESOLVING to more than one block". With no mark, no marker resolves, and
  // §5.4.2 assigns the bare uniqueness violation no row — so reporting one would be inventing
  // a disposition. Recorded in the code's `note` rather than guessed at.
  const content = JSON.stringify({
    version: '0.1',
    blocks: [
      { type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'a' }] },
      { type: 'semantic:footnote', number: 1, content: 'x' },
      { type: 'semantic:footnote', number: 1, content: 'y' },
    ],
  });
  const codes = footnoteCodes(content);
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'no mark, no ambiguity finding');
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'no mark, no dangling finding');
});

test('footnote: a mark whose id matches nothing falls back to its marker', () => {
  // The recorded reading (see CDX-E-FOOTNOTE-REFERENCE-DANGLING's note): the mark carries an
  // `id` no block claims, but its `number` identifies one block exactly. This implementation
  // resolves it; the strict reading of "by a single key" would report it dangling. Pinned so
  // the choice cannot drift silently — not because the specification settles it.
  const codes = footnoteCodes(fnMark({ number: 1, id: 'nosuch' }, [{ number: 1 }]));
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'the marker resolves, so nothing is reported');
});

test('footnote: a mark with NO resolution key is not reported as dangling', () => {
  // §4.5.1 requires either `number` or `symbol`, so a mark with neither (and no `id`) is a
  // structurally malformed mark — §5.4.2's malformed row, WARNING in draft/review and
  // INTEGRITY-ERROR when frozen. Reporting it as a dangling cross-reference would file it
  // under a row whose WARNING holds in every state, pre-empting an escalation
  // CDX-E-MARK-MALFORMED's note says is only deferred. Nothing reports it today; that is the
  // deferral, not this arm's business.
  const codes = footnoteCodes(fnMark({}, [{ number: 1 }]));
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'a keyless mark is malformed, not dangling');
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'));
});

test('footnote: a `semantic:footnote` INSIDE a marks array is not a resolution target', () => {
  // The collector's `!ctx.inMarks` guard. A block type appearing at a mark position is an
  // unknown namespaced MARK (IGNORE), not a footnote block — counting it would let a mark
  // resolve against something that is not a target. Mutation-verified: without the guard this
  // document reports nothing.
  const content = JSON.stringify({
    version: '0.1',
    blocks: [
      {
        type: 'paragraph',
        id: 'p1',
        children: [
          { type: 'text', value: 'a', marks: [{ type: 'footnote', number: 1 }, { type: 'semantic:footnote', number: 1 }] },
        ],
      },
    ],
  });
  assert.ok(footnoteCodes(content).has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'the mark has no real block to resolve to');
});

test('footnote: a `footnote`-typed object OUTSIDE a marks array is not a mark', () => {
  // The resolver's `ctx.inMarks` guard on the mark walk. A `{type:"footnote"}` object sitting
  // in a block position is not a footnote MARK, so it must not be resolved — otherwise a
  // document with no footnote marks at all reports one dangling.
  const content = JSON.stringify({
    version: '0.1',
    blocks: [
      { type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'a' }] },
      { type: 'footnote', number: 9 },
    ],
  });
  const codes = footnoteCodes(content);
  assert.ok(!codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'a block-position object is not a mark');
});

test('footnote: the `symbol` marker resolves, is ambiguous, and dangles on its own terms', () => {
  // §4.5.1a's six symbols are a second, independent marker: "a `symbol` mark to the block
  // with the equal `symbol`". Every other case here uses `number`, and with no symbol case
  // the whole branch could be deleted with all 31 gates green — mutation-verified, which is
  // how this test came to exist.
  const resolved = footnoteCodes(fnMark({ symbol: 'dagger' }, [{ symbol: 'dagger' }]));
  assert.ok(!resolved.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'a matching symbol resolves');
  assert.ok(!resolved.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'and is unambiguous');

  const dangling = footnoteCodes(fnMark({ symbol: 'dagger' }, [{ symbol: 'asterisk' }]));
  assert.ok(dangling.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'), 'a symbol matching no block dangles');

  const ambiguous = footnoteCodes(fnMark({ symbol: 'dagger' }, [{ symbol: 'dagger' }, { symbol: 'dagger' }]));
  assert.ok(ambiguous.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'a repeated symbol is ambiguous');

  // §4.5.1a permits a stored symbol to repeat past the sixth note (the doubling is a display
  // convention, and the stored value "remains one of the six enumerated names"), which is
  // exactly why §4.5.2 tells an author who repeats a marker to disambiguate with an `id`.
  const disambiguated = footnoteCodes(fnMark({ symbol: 'dagger', id: 'fn7' }, [{ symbol: 'dagger' }, { id: 'fn7', symbol: 'dagger' }]));
  assert.ok(!disambiguated.has('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'), 'an id disambiguates a legitimately reused symbol');
});

test('footnote: the raw walk erases what canon erases — a crdt-nested block is not a target', () => {
  // The resolver walks RAW stored content, so it must reproduce every `canon` transform that
  // changes which nodes exist (canonicalize.ts `CollectOptions.rawInput`). §4.3.1 item 1
  // strips `crdt`, so a `semantic:footnote` inside one does not exist canonically. A walk
  // that saw it would resolve this mark against a block the canonicalizer deleted — a MISSED
  // dangling reference, invisible to any test that only checks reported findings.
  //
  // Asserted DIFFERENTIALLY against the canonicalizer rather than by mutation: a wrong model
  // of the transforms passes its own mutants, because both sides would share the error.
  const content = JSON.stringify({
    version: '0.1',
    blocks: [
      {
        type: 'paragraph',
        id: 'p1',
        crdt: { ghost: { type: 'semantic:footnote', number: 7, content: 'ghost' } },
        children: [{ type: 'text', value: 'a', marks: [{ type: 'footnote', number: 7 }] }],
      },
    ],
  });
  const canon = canonicalContent({ manifest: '{}', content, dublinCore: '{}' }) as { content: unknown };
  assert.ok(
    !JSON.stringify(canon.content).includes('semantic:footnote'),
    'precondition: canon strips the crdt payload, so no footnote block survives',
  );
  const codes = footnoteCodes(content);
  assert.ok(
    codes.has('CDX-E-FOOTNOTE-REFERENCE-DANGLING'),
    'the mark must be dangling: its only candidate block exists solely in stripped crdt state',
  );
});


// --- B1b-3c-1a: anchor POSITION validity ------------------------------------
//
// These live here rather than in the fixture corpus because the comparator cannot
// express them. CDX-E-ANCHOR-POSITION-INVALID carries `disposition: null` (§5.4.2
// assigns it no row), and `compareFixtureVerdict` requires every expected finding to
// carry a disposition interval — no fixture in the published corpus asserts any of the
// null-disposition codes. The must-NOT-report properties below are unassertable there
// for the separate reason that the findings check is a SUBSET check.

/** A one-block-plus-reference document whose content is `blocks`. */
function anchorDoc(blocks: unknown[]): ZipEntryRecipe[] {
  const content = JSON.stringify({ version: '0.1', blocks });
  const hash = 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  return [
    { name: 'manifest.json', text: JSON.stringify({ cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z', content: { path: 'content/document.json', hash }, metadata: { dublinCore: 'metadata/dublin-core.json' } }) },
    { name: 'content/document.json', text: content },
    { name: 'metadata/dublin-core.json', text: DC },
  ];
}

const para = (id: string | undefined, text: string, marks?: unknown[]): unknown => ({
  type: 'paragraph',
  ...(id ? { id } : {}),
  children: [{ type: 'text', value: text, ...(marks ? { marks } : {}) }],
});
const linkPara = (href: string): unknown => para(undefined, 'see', [{ type: 'link', href }]);

test('an inverted range reports POSITION-INVALID', () => {
  const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), linkPara('#p1/10-5')]));
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'start not less than end is a structural defect');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'an inverted range is invalid, not out of range');
});

test('a URI suffix that is neither an offset nor a range reports POSITION-INVALID', () => {
  const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), linkPara('#p1/x')]));
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'the URI grammar admits only #id, #id/n and #id/n-m');
});

test('a position on a named-anchor target reports POSITION-INVALID', () => {
  // 03a §2.2: a named anchor already denotes a position, so it MUST NOT carry one.
  const anchored = { type: 'paragraph', children: [{ type: 'text', value: 'key', marks: [{ type: 'anchor', id: 'a1' }] }] };
  const codes = codesFor(anchorDoc([anchored, linkPara('#a1/0-2')]));
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'a position on an anchor mark is invalid');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'an anchor mark has no text, so nothing is OUT of range');
});

test('a position on a non-text-bearing block reports POSITION-INVALID, not out-of-range', () => {
  // 03a §3: a character-offset anchor MUST target a text-bearing block. A container has
  // no text content of its own, so this is a different defect from exceeding a length —
  // and offset 0, which no length bound would reject, is still invalid.
  const list = { type: 'list', id: 'l1', ordered: false, children: [{ type: 'listItem', children: [para(undefined, 'x')] }] };
  const codes = codesFor(anchorDoc([list, linkPara('#l1/0')]));
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'a container block has no text content to address');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'a container must not be reported as a zero-length text block');
});

test('a dangling target with a malformed position reports BOTH, and not out-of-range', () => {
  const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), linkPara('#gone/10-5')]));
  assert.ok(codes.has('CDX-E-ANCHOR-DANGLING'), 'the target resolves to nothing');
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'the position is malformed whether or not the target exists');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'with no target there is no length to exceed');
});

test('a dangling target with a well-formed position reports only the dangle', () => {
  const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), linkPara('#gone/0-2')]));
  assert.ok(codes.has('CDX-E-ANCHOR-DANGLING'), 'the target resolves to nothing');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'a well-formed position on an absent target is not itself a defect');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'nothing to bound-check against');
});

test('a block-level anchor with no position is never a position defect', () => {
  const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), linkPara('#p1')]));
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'no position, no position defect');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'no position, no position defect');
});

test('an empty text-bearing block is length 0, not "no text content"', () => {
  // A paragraph with `children: []` is text-bearing and legitimately empty, so offset 0
  // is in bounds while offset 1 exceeds it. A model that treated it as non-text-bearing
  // would report the first as invalid.
  const empty = { type: 'paragraph', id: 'e1', children: [] };
  const ok = codesFor(anchorDoc([empty, linkPara('#e1/0')]));
  assert.ok(!ok.has('CDX-E-ANCHOR-POSITION-INVALID') && !ok.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'offset 0 into an empty block is in bounds');
  const over = codesFor(anchorDoc([empty, linkPara('#e1/1')]));
  assert.ok(over.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'offset 1 exceeds a zero-length block');
});

// --- B1b-3c-1a: exact range bounds, and §3's concatenation model -------------

test('a range whose bounds exceed 2^53 is ordered exactly, not by double', () => {
  // Two DISTINCT integers that round to the same double. Deciding `start < end` after
  // conversion finds them equal and takes the structural arm, reporting a null-disposition
  // finding in place of the WARNING §7.2 tabulates. Pinned here as well as by the fixture
  // because only a unit test can assert the INVALID code is absent.
  const codes = codesFor(anchorDoc([para('p1', 'short'), linkPara('#p1/9007199254740992-9007199254740993')]));
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'the range is well-ordered and exceeds a 5-code-point block');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'start IS less than end; a double comparison is what makes them look equal');
});

test('a genuinely inverted range above 2^53 is still INVALID', () => {
  // The mirror case, so the fix cannot be "never report inverted above 2^53".
  const codes = codesFor(anchorDoc([para('p1', 'short'), linkPara('#p1/9007199254740993-9007199254740992')]));
  assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'start greater than end is inverted at any magnitude');
});

test('leading zeros compare by magnitude, not by digit count', () => {
  // `[0-9]+` admits `007`, so a length-first comparison of the raw digit strings calls this
  // inverted and reports a conformant anchor. `Number()` got this case right, and the
  // exact-comparison fix must not regress it.
  const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), linkPara('#p1/007-10')]));
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-INVALID'), '007 is 7, which is less than 10');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), '7 to 10 is inside a 13-code-point block');
});

test('an in-bounds anchor into a codeBlock is clean', () => {
  // The positive control the corpus fixture cannot express: it pins that the out-of-bounds
  // case WARNs, and a subset check cannot also assert that the in-bounds case reports
  // nothing. Both halves are needed — an implementation that dropped `codeBlock` from the
  // text-bearing set failed them in opposite directions, reporting a defect here and the
  // WRONG code there.
  const code = { type: 'codeBlock', id: 'code1', children: [{ type: 'text', value: 'const x = 1;' }] };
  const codes = codesFor(anchorDoc([code, linkPara('#code1/0-5')]));
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'a codeBlock is text-bearing (§3), so it has text to address');
  assert.ok(!codes.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), '0-5 is inside 12 code points');
});

test("a block's text content is its text nodes concatenated with nothing between them", () => {
  // §3. The corpus fixture pins the out-of-range side; this pins the exact length from both
  // directions, which is what rules out every separator AND any off-by-one: `abc` + `def` is
  // six code points, so 0-6 is in bounds and 0-7 is not. With a single-text-node target —
  // every other positional case — the concatenation model is unobservable.
  const target = { type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'abc' }, { type: 'text', value: 'def' }] };
  const atEnd = codesFor(anchorDoc([target, linkPara('#p1/0-6')]));
  assert.ok(!atEnd.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'six code points, so a range ending at 6 is in bounds');
  const over = codesFor(anchorDoc([target, linkPara('#p1/0-7')]));
  assert.ok(over.has('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'), 'a separator between the nodes would make this fit');
});

// --- B1b-3c-1a: which §5.4.2 row an out-of-range position takes --------------
//
// An out-of-range position is disposed of by the row of the FIELD carrying it, so the
// arm has three codes — and the three rows disagree about the frozen/published column,
// which an append-only vocabulary cannot separate after publication. Every reference
// field is asserted, not a sample: the defect this guards against is one field routed
// to the wrong row, which is invisible in any test that checks only the fields it
// happens to name. Two fixtures cover the `link` and `semantic:ref` cases end to end;
// these cover all eight, including `academic:theorem` `uses[]`, the only `many` path.
//
// Each case asserts the OTHER two codes are absent as well. A reader emitting all three
// would satisfy a presence-only assertion while publishing three dispositions for one
// defect — and the fixture comparator, a subset check, cannot catch that either.

const OUT_OF_RANGE_ROWS: { label: string; node: unknown; code: string }[] = [
  { label: 'link href', node: linkPara('#p1/20-25'), code: 'CDX-E-ANCHOR-POSITION-OUT-OF-RANGE' },
  { label: 'academic:theorem-ref target', node: para(undefined, 'see', [{ type: 'academic:theorem-ref', target: '#p1/20-25' }]), code: 'CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE' },
  { label: 'academic:equation-ref target', node: para(undefined, 'see', [{ type: 'academic:equation-ref', target: '#p1/20-25' }]), code: 'CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE' },
  { label: 'academic:algorithm-ref target', node: para(undefined, 'see', [{ type: 'academic:algorithm-ref', target: '#p1/20-25' }]), code: 'CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE' },
  { label: 'academic:proof of', node: { type: 'academic:proof', of: '#p1/20-25' }, code: 'CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE' },
  { label: 'academic:theorem uses[]', node: { type: 'academic:theorem', uses: ['#p1/20-25'] }, code: 'CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE' },
  { label: 'semantic:ref target', node: { type: 'semantic:ref', target: '#p1/20-25' }, code: 'CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE' },
  { label: 'presentation:reference target', node: { type: 'presentation:reference', target: '#p1/20-25' }, code: 'CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE' },
];

const ALL_OUT_OF_RANGE_CODES = [
  'CDX-E-ANCHOR-POSITION-OUT-OF-RANGE',
  'CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE',
  'CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE',
];

for (const row of OUT_OF_RANGE_ROWS) {
  test(`an out-of-range position on ${row.label} takes its own §5.4.2 row`, () => {
    const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), row.node]));
    assert.ok(codes.has(row.code), `${row.label} should report ${row.code}`);
    for (const other of ALL_OUT_OF_RANGE_CODES) {
      if (other === row.code) continue;
      assert.ok(!codes.has(other), `${row.label} must not also report ${other} — one defect, one row`);
    }
  });
}

test('the STRUCTURAL position arm does not split by row', () => {
  // CDX-E-ANCHOR-POSITION-INVALID's disposition is null in every row, so there is no
  // frozen-column divergence to keep separable and nothing for a split to record. This
  // pins the asymmetry with the out-of-range arm above: a future reader "completing" the
  // split would publish three codes for one absence of a rule.
  for (const field of [
    { type: 'semantic:ref', target: '#p1/10-5' },
    para(undefined, 'see', [{ type: 'academic:theorem-ref', target: '#p1/10-5' }]),
  ]) {
    const codes = codesFor(anchorDoc([para('p1', 'Hello, world!'), field]));
    assert.ok(codes.has('CDX-E-ANCHOR-POSITION-INVALID'), 'every row shares the structural code');
    for (const other of ALL_OUT_OF_RANGE_CODES) {
      assert.ok(!codes.has(other), `an inverted range is invalid, not out of range (${other})`);
    }
  }
});

// --- B1b-3c-1a: stored-byte text scope --------------------------------------

test('a non-NFC NON-projected Dublin Core term is not reported', () => {
  // §4.3.1 projects only title/description/creator/subject/language, so `rights` never
  // enters the document ID. Reporting it would reject a document over bytes the identity
  // does not depend on.
  const dc = JSON.stringify({ version: '1.1', terms: { title: 'T', creator: 'A. Author', rights: 'cafe\u0301' } });
  const content = '{"version":"0.1","blocks":[]}';
  const hash = 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  const codes = codesFor([
    { name: 'manifest.json', text: JSON.stringify({ cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z', content: { path: 'content/document.json', hash }, metadata: { dublinCore: 'metadata/dublin-core.json' } }) },
    { name: 'content/document.json', text: content },
    { name: 'metadata/dublin-core.json', text: dc },
  ]);
  assert.ok(!codes.has('CDX-E-PART-STRING-NOT-NFC'), 'a non-projected term is not part of the hashed basis');
});

test('a non-NFC PROJECTED Dublin Core term IS reported', () => {
  const dc = JSON.stringify({ version: '1.1', terms: { title: 'cafe\u0301', creator: 'A. Author' } });
  const content = '{"version":"0.1","blocks":[]}';
  const hash = 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  const codes = codesFor([
    { name: 'manifest.json', text: JSON.stringify({ cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z', content: { path: 'content/document.json', hash }, metadata: { dublinCore: 'metadata/dublin-core.json' } }) },
    { name: 'content/document.json', text: content },
    { name: 'metadata/dublin-core.json', text: dc },
  ]);
  assert.ok(codes.has('CDX-E-PART-STRING-NOT-NFC'), '`title` projects into the document ID');
});

for (const term of ['creator', 'subject', 'language'] as const) {
  test(`a non-NFC element of the ARRAY-valued projected Dublin Core term \`${term}\` IS reported`, () => {
    // §4.3.1 keeps exactly five terms and projects `creator`, `subject` and `language` as
    // ARRAYS — "a scalar value is coerced to a one-element array". It is the AUTHORED value
    // that may be a string or an array of strings (dublin-core.schema.json makes each a
    // `oneOf`); after projection all three are arrays. So a violation inside an ELEMENT is
    // inside the hashed basis exactly as a bare string is.
    //
    // All three are asserted, not just one: narrowing the scan loop to
    // PROJECTED_STRING_TERMS + 'creator' was measured to leave the entire corpus green —
    // 366/366, both oracles, every verdict test — so pinning one term leaves the other two
    // unscanned in BOTH implementations, which is the shared-misreading case this suite exists
    // to catch.
    const terms: Record<string, unknown> = { title: 'T', creator: 'A. Author' };
    terms[term] = term === 'creator' ? ['A. Author', 'cafe\u0301'] : ['ok', 'cafe\u0301'];
    const dc = JSON.stringify({ version: '1.1', terms });
    const content = '{"version":"0.1","blocks":[]}';
    const hash = 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
    const codes = codesFor([
      { name: 'manifest.json', text: JSON.stringify({ cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z', content: { path: 'content/document.json', hash }, metadata: { dublinCore: 'metadata/dublin-core.json' } }) },
      { name: 'content/document.json', text: content },
      { name: 'metadata/dublin-core.json', text: dc },
    ]);
    assert.ok(codes.has('CDX-E-PART-STRING-NOT-NFC'), 'an array ELEMENT is hashed basis exactly as a bare string is');
    assert.ok(!codes.has('CDX-E-METADATA-PART-UNPARSEABLE'), 'a string array is projectable, so this is the scan arm, not the malformed one');
  });
}

// The three absence/presence properties the fixture comparator cannot express: it is a
// SUBSET check, so "this document reports NOTHING" is unassertable there. Each pairs the
// scan against `canonicalContent`, because the scan's scope claim is a claim ABOUT canon —
// asserting only the scan would pass under a wrong model of what canon deletes.

test('a split run inside a `crdt` on a BLOCK is silent, and canon accepts it', () => {
  // §4.3.1 item 1 deletes `crdt`, so the run is not hashed and the split-view harm cannot
  // reach it. Both directions asserted: a scan that reported it would REJECT a document the
  // canonicalizer accepts, which is a false reject in every state on real collaborative
  // content.
  const doc = '{"version":"0.1","blocks":[{"type":"paragraph","crdt":{"kids":[{"type":"text","value":"cafe"},{"type":"text","value":"\\u0301"}]},"children":[{"type":"text","value":"ok"}]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(doc)), null, 'a deleted field is not hashed material');
  assert.doesNotThrow(() => canonicalContent({ manifest: '{}', content: doc, dublinCore: '{}' }), 'and canon deletes it before validating');
});

test("a non-NFC STRING inside a `crdt` under a TEXT NODE's `marks` IS reported", () => {
  // The carve-out, and the case that kills a gate keyed on the field NAME alone: canon does
  // not recurse into a text node's `marks`, so this `crdt` SURVIVES, is hashed, and canon
  // throws. Suppressing it by name would go silent on a document canon rejects — the
  // completeness property broken in the direction that matters.
  //
  // Pinned with a single non-NFC STRING rather than a split RUN. A run here would prove
  // nothing about derived-field suppression once §4.3.2 item 2 is scoped to block content
  // (BLOCK_CONTENT_KEYS): a `crdt` payload's own member is not a block's text content, so
  // the run rule is withheld there for a reason that has nothing to do with `crdt`. The
  // per-string arm isolates the property this test is actually for.
  const doc = '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"v","marks":[{"type":"anchor","id":"a","crdt":{"s":"cafe\\u0301"}}]}]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(doc))?.code, 'CDX-E-PART-STRING-NOT-NFC', 'a derived field under a text node\'s marks is still hashed');
  assert.throws(() => canonicalContent({ manifest: '{}', content: doc, dublinCore: '{}' }), 'and canon throws on it');
});

test('an id under `attributes` reaches the raw walk and canon alike', () => {
  // Agreement, not correctness: whether such an id belongs in the namespace at all is open.
  // What must not happen is the two disagreeing — a duplicate canon rejects while the walk
  // that feeds the verdict reports nothing.
  const doc = '{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"semantic":{"@type":"Q","children":[{"@type":"A","children":[{"type":"text","value":"a","marks":[{"type":"anchor","id":"dup"}]},{"type":"text","value":"a","marks":[{"type":"anchor","id":"dup"}]}]}]}},"children":[{"type":"text","value":"ok"}]}]}';
  assert.deepEqual(collectDefinedIds(JSON.parse(doc), { rawInput: true }).duplicates, ['dup']);
  assert.throws(() => canonicalContent({ manifest: '{}', content: doc, dublinCore: '{}' }), /duplicate id/);

  // Without this the assertion above passes on a walk that reports every id twice.
  const once = '{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"semantic":{"@type":"Q","children":[{"@type":"A","children":[{"type":"text","value":"a","marks":[{"type":"anchor","id":"solo"}]}]}]}},"children":[{"type":"text","value":"ok"}]}]}';
  assert.deepEqual(collectDefinedIds(JSON.parse(once), { rawInput: true }).duplicates, []);
  assert.doesNotThrow(() => canonicalContent({ manifest: '{}', content: once, dublinCore: '{}' }));
});

test('the run rule is withheld OUTSIDE block content, scan and canon agreeing', () => {
  // §4.3.1 item 4 and §4.3.2 item 2 are properties of POSITION, not of element shape
  // (BLOCK_CONTENT_KEYS). These are the positions where an array may hold objects shaped
  // like text nodes without being block content, and where keying on shape made
  // canonicalization REJECT a conformant document.
  //
  // Both directions asserted on every case. Asserting only the scan would pass under a wrong
  // model of what canon merges — and a scan that goes silent where canon still throws is not
  // a smaller defect but an INVERTED one, a document canonicalization rejects loading clean.
  const pair = '{"type":"text","value":"cafe"},{"type":"text","value":"\\u0301"}';
  const silent: [string, string][] = [
    ['attributes.semantic', `{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"semantic":{"h":[${pair}]}},"children":[{"type":"text","value":"ok"}]}]}`],
    ['an extension block\'s own data array', `{"version":"0.1","blocks":[{"type":"forms:field","history":[${pair}]}]}`],
  ];
  for (const [label, doc] of silent) {
    assert.equal(collectStoredTextViolations(JSON.parse(doc)), null, `${label}: not a block\'s text content, so no run`);
    assert.doesNotThrow(() => canonicalContent({ manifest: '{}', content: doc, dublinCore: '{}' }), `${label}: and canon accepts it`);
  }

  // THE CONTROLS. Without them "withhold the run rule" is satisfied by withholding it
  // everywhere, which is the mutant that matters — it would silence every real split run.
  // The ROOT array is here because a strict `children` key was measured to lose it, and a
  // published fixture depends on it.
  const reported: [string, string][] = [
    ['the root blocks array', `{"version":"0.1","blocks":[${pair},{"type":"paragraph","children":[{"type":"text","value":"ok"}]}]}`],
    ['a paragraph\'s children', `{"version":"0.1","blocks":[{"type":"paragraph","children":[${pair}]}]}`],
    ['a figure caption rich array', `{"version":"0.1","blocks":[{"type":"figure","caption":[${pair}],"children":[]}]}`],
  ];
  for (const [label, doc] of reported) {
    assert.equal(collectStoredTextViolations(JSON.parse(doc))?.code, 'CDX-E-PART-STRING-NOT-NFC', `${label}: a split run IS still reported`);
    assert.throws(() => canonicalContent({ manifest: '{}', content: doc, dublinCore: '{}' }), `${label}: and canon still rejects it`);
  }
});

test('only the RUN rule is withheld — strings inside `attributes` are still checked', () => {
  // The scoping must not be mistakable for exempting `attributes` wholesale. Every string in
  // there is still hashed material and still individually bound by §4.3.2 item 2.
  const nfc = '{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"style":"cafe\\u0301"},"children":[{"type":"text","value":"ok"}]}]}';
  const ill = '{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"style":"\\ud83d"},"children":[{"type":"text","value":"ok"}]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(nfc))?.code, 'CDX-E-PART-STRING-NOT-NFC', 'a non-NFC attribute value still rejects');
  assert.equal(collectStoredTextViolations(JSON.parse(ill))?.code, 'CDX-E-PART-STRING-ILL-FORMED', 'an ill-formed attribute value still rejects');
  assert.throws(() => canonicalContent({ manifest: '{}', content: nfc, dublinCore: '{}' }), 'and canon agrees on the NFC one');
  assert.throws(() => canonicalContent({ manifest: '{}', content: ill, dublinCore: '{}' }), 'and on the ill-formed one');
});

test('a split run in a `figure` `caption` rich array IS reported', () => {
  // A rich array that is not a block's `children`, so it pins that the run rule follows
  // hashed text rather than one field name. Canon reaches the same verdict by a DIFFERENT
  // arm — it merges the two adjacent text nodes (equal marks) and the per-STRING check fires
  // on the merged value — so the two implementations agree on the reject without agreeing on
  // the route, which is why the scan cannot be derived from canon's message.
  const doc = '{"version":"0.1","blocks":[{"type":"figure","caption":[{"type":"text","value":"cafe"},{"type":"text","value":"\\u0301"}],"children":[]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(doc))?.code, 'CDX-E-PART-STRING-NOT-NFC', 'a caption is hashed text');
  assert.throws(() => canonicalContent({ manifest: '{}', content: doc, dublinCore: '{}' }), 'and canon throws, via its merge arm');
});

test('a non-text element BREAKS the run, so the strings either side are never concatenated', () => {
  // The NEGATIVE control for the mid-array flush. `reject-content-split-combining-sequence-mid-array`
  // pins that a run IS flushed and reported at a non-text element, but nothing pinned that the
  // flush actually SEPARATES: deleting the `run = ''` reset leaves that fixture green, because
  // the longer merged run still violates NFC. Only a document whose runs are individually clean
  // can tell the two apart.
  //
  // The PAIR is the control. Both documents carry the same four text-node values in the same
  // order and differ only by a paragraph between the second and third. Each run is NFC-stable
  // alone ('ae', and U+0301 followed by 'c'); only the concatenation across the boundary is not.
  // So a scan that fails to reset reports `separated`, and one that resets too eagerly stops
  // reporting `adjacent` — the second assertion is what stops "never concatenate" passing.
  //
  // Both sit in a `blockquote`, whose `children` take `#/$defs/block` and so admit a text node
  // beside a paragraph. Verified with the repo's own validator against a negative control (a
  // paragraph's children holding a paragraph is INVALID, Content Blocks §7.2 rule 1). The
  // shape is deliberately NOT at the root: the root array would work too, but its admissibility
  // for a bare text node is settled only by the schema, and a control does not need to rest on
  // that. `blockquote`, `listItem`, `tableCell`, `admonition` and `definitionDescription` all
  // admit it.
  const separated = '{"version":"0.1","blocks":[{"type":"blockquote","children":[{"type":"text","value":"a"},{"type":"text","value":"e"},{"type":"paragraph","children":[{"type":"text","value":"x"}]},{"type":"text","value":"\\u0301"},{"type":"text","value":"c"}]}]}';
  const adjacent = '{"version":"0.1","blocks":[{"type":"blockquote","children":[{"type":"text","value":"a"},{"type":"text","value":"e"},{"type":"text","value":"\\u0301"},{"type":"text","value":"c"}]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(separated)), null, 'the non-text element ends the run');
  assert.equal(collectStoredTextViolations(JSON.parse(adjacent))?.code, 'CDX-E-PART-STRING-NOT-NFC', 'and the same values adjacent DO violate');
  // Canon agrees in both directions, by its merge arm: with no marks to differ, the adjacent
  // nodes merge into one value and the per-STRING check fires on it, while the separated pair
  // merges into two individually clean values.
  assert.doesNotThrow(() => canonicalContent({ manifest: '{}', content: separated, dublinCore: '{}' }), 'canon accepts the separated runs');
  assert.throws(() => canonicalContent({ manifest: '{}', content: adjacent, dublinCore: '{}' }), 'and throws on the adjacent ones');
});

test('the derived text-bearing set contains every block §3 names, and no container', () => {
  // TWO ONE-SIDED ASSERTIONS, NOT AN EQUALITY, and the difference is the point. §3 defines a
  // text-bearing block as "a block whose `children` are text nodes" and then illustrates it —
  // "(SUCH AS `paragraph`, `heading`, `figcaption`, `definitionTerm`, and `codeBlock`)". The
  // children test is the definition; the list is examples. So the specification supports only
  // a superset relation, and an equality assertion would FAIL ON A CORRECT WIDENING — whereupon
  // the cheapest way to green is to narrow the derivation back, re-creating the very defect
  // this exists to catch. An earlier version of this test did assert equality, and it did so
  // having just been written to catch `codeBlock` going missing.
  //
  // The lower bound catches a derivation that drops a type: `codeBlock` reaches `textNode`
  // through an `allOf` that narrows it (§4: exactly one marks-free text node), so a derivation
  // following only direct references dropped it, reported a conformant anchor into source code
  // as targeting a non-text-bearing block, and downgraded an out-of-bounds one to the
  // null-disposition code.
  //
  // The upper bound catches the opposite error, which is what a widening fix risks: §3 is
  // explicit that "a container block whose children are other blocks (`list`, `listItem`,
  // `blockquote`, `table`, and the like) has no text content of its own", so a derivation that
  // swept one in would accept a character offset against a block that has no text.
  //
  // Neither bound is redundant with the throw-on-empty guard, which a partial refactor passes
  // with a non-empty WRONG set. MEASURED: dropping `figcaption` leaves the WHOLE corpus green —
  // every conformance check and every oracle confirmation — because no fixture anchors into one
  // and a wrong set only produces CDX-E-ANCHOR-POSITION-INVALID, whose null disposition is
  // invisible in both comparator dimensions (the findings check is a subset, and nulls are
  // filtered from the disposition MAX). Only this assertion fails.
  const derived = deriveContentVocabulary().textBearingTypes;
  for (const named of ['paragraph', 'heading', 'figcaption', 'definitionTerm', 'codeBlock']) {
    assert.ok(derived.has(named), `§3 names \`${named}\` text-bearing, so the derivation must include it`);
  }
  for (const container of ['blockquote', 'list', 'listItem', 'table', 'tableCell', 'admonition', 'definitionDescription']) {
    assert.ok(!derived.has(container), `§3: a container block has no text content of its own, so \`${container}\` must not be derived`);
  }
});

// --- B1b-3c-1a: the out-of-hash position arm (§2.2's combination rule) -------
//
// `contentAnchorPosition` is reachable only through an annotation layer — the object form is
// the one that can express `offset` alongside `start`/`end`, a half range, and a negative or
// fractional bound, none of which the URI grammar admits.
//
// Four of the five structural guards are killed by deleting them (verified). The HALF-RANGE
// guard is not, and that is a property of the code rather than a gap here: a half range falls
// through to the numeric guard, which reports the same code because the absent half is not a
// number. It survives as a diagnostic, and `contentAnchorPosition` says so at the line itself.

/** A document whose content is one 1-code-point block `p1`, plus an annotation anchored at it. */
function annotationDoc(anchor: unknown): ZipEntryRecipe[] {
  const content = '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"x"}]}]}';
  const hash = 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  const annotation = { id: 'a1', type: 'comment', anchor, author: { name: 'A' }, created: '2025-01-10T08:00:00Z', content: 'ok' };
  return [
    { name: 'manifest.json', text: JSON.stringify({ cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z', content: { path: 'content/document.json', hash }, metadata: { dublinCore: 'metadata/dublin-core.json' } }) },
    { name: 'content/document.json', text: content },
    { name: 'metadata/dublin-core.json', text: DC },
    { name: 'security/annotations.json', text: JSON.stringify({ version: '0.1', annotations: [annotation] }) },
  ];
}

const POSITION_DEFECTIVE = 'CDX-E-ANNOTATION-ANCHOR-POSITION-INVALID';

for (const c of [
  { label: '`offset` alongside `start`/`end`', anchor: { blockId: 'p1', offset: 0, start: 0, end: 1 } },
  { label: 'a half range (`start` without `end`)', anchor: { blockId: 'p1', start: 0 } },
  { label: 'a half range (`end` without `start`)', anchor: { blockId: 'p1', end: 1 } },
  { label: 'a negative `offset`', anchor: { blockId: 'p1', offset: -1 } },
  { label: 'a fractional `offset`', anchor: { blockId: 'p1', offset: 0.5 } },
  { label: 'a fractional range bound', anchor: { blockId: 'p1', start: 0, end: 1.5 } },
  { label: 'a negative range bound', anchor: { blockId: 'p1', start: -1, end: 1 } },
]) {
  test(`an annotation anchor with ${c.label} is reported`, () => {
    const codes = codesFor(annotationDoc(c.anchor));
    assert.ok(codes.has(POSITION_DEFECTIVE), `${c.label} violates §2.2's combination rule`);
    assert.ok(!codes.has('CDX-E-ANNOTATION-ANCHOR-DANGLING'), 'the target block exists; only the position is at fault');
  });
}

test('a present-but-null position field is a defect, not an absent one', () => {
  // Pins `!== undefined` rather than a loose null check: reading `{offset: null}` as "no
  // position" makes a malformed anchor silently block-level, which is the wrong direction —
  // a reader would place the annotation on the whole block rather than report it.
  const codes = codesFor(annotationDoc({ blockId: 'p1', offset: null }));
  assert.ok(codes.has(POSITION_DEFECTIVE), 'a null offset is present and not an integer');
});

test('an annotation anchor with no position at all is clean', () => {
  // The positive control for all of the above: block-level anchoring is the declared common
  // case, and a reader reporting every annotation would fail here.
  const codes = codesFor(annotationDoc({ blockId: 'p1' }));
  assert.ok(!codes.has(POSITION_DEFECTIVE), 'no position fields is the block-level form §2.2 permits');
  assert.ok(!codes.has('CDX-E-ANNOTATION-ANCHOR-DANGLING'), 'and the target resolves');
});

test('an annotation anchor in URI form has its position checked too', () => {
  // The object form is what the schemas declare, so the string form is the arm most likely to
  // rot unnoticed. A layer writing `#p1/20-25` has the same stale anchor as one writing
  // `{blockId, start, end}`, and `p1` holds one code point.
  const codes = codesFor(annotationDoc('#p1/20-25'));
  assert.ok(codes.has(POSITION_DEFECTIVE), 'the URI spelling points past the end of the same block');
});

test('an annotation anchor in URI form with no position is clean', () => {
  const codes = codesFor(annotationDoc('#p1'));
  assert.ok(!codes.has(POSITION_DEFECTIVE), 'no position, no position defect');
  assert.ok(!codes.has('CDX-E-ANNOTATION-ANCHOR-DANGLING'), 'and the target resolves');
});

test('the stored-text scan agrees with the canonicalizer it shares a predicate with', () => {
  // Differential, not a restatement: the scan walks the RAW part while canonicalization
  // validates the transformed one, so they agree only because the predicate is shared and
  // the raw scope is a superset. A conformant document must satisfy both.
  const clean = '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"a\\ud83d\\ude00b"}]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(clean)), null, 'the scan accepts it');
  assert.doesNotThrow(
    () => canonicalContent({ manifest: '{}', content: clean, dublinCore: '{}' }),
    'and so does the canonicalizer',
  );
  const dirty = '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"cafe\\u0301"}]}]}';
  assert.equal(collectStoredTextViolations(JSON.parse(dirty))?.code, 'CDX-E-PART-STRING-NOT-NFC', 'the scan rejects it');
  assert.throws(
    () => canonicalContent({ manifest: '{}', content: dirty, dublinCore: '{}' }),
    'and so does the canonicalizer',
  );
});


// ---------------------------------------------------------------------------
// The canonicalization depth bound silences the reference-resolution pass (OQ-007)
// ---------------------------------------------------------------------------
//
// `assertBoundedDepth` runs at the TOP of `resolveContentReferences`, and this file's
// subject wraps that call, `resolveAssetReferences` and `resolveSemanticReferences` in ONE
// `try` whose `catch` swallows `CanonicalizationError`. Content nested past the bound
// therefore silences every code those three passes emit, plus the two passes gated on
// `contentIds` and the id recompute — seventeen codes, headed by CDX-E-ID-COLLISION and
// CDX-E-DOCUMENT-ID-MISMATCH. OQ-007 records what a reader should do about it.
//
// THE SILENCE IS NOT BLANKET, and saying so is most of the work here. The
// pre-canonicalization scans run BEFORE the guarded block and survive any depth, so
// "a deep document loads clean" holds only of one carrying nothing they catch.
//
// EVERY TEST BELOW CARRIES A LIVE WITNESS: a second defect that still fires above the
// bound. Without one, "reports nothing" is equally satisfied by a reader that never
// managed to read the part at all — the assertion cannot tell a silence from a failure to
// load, which is the difference the tests exist to establish. The witness is a non-NFC
// string, scanned by `collectStoredTextViolations`: an iterative walk with no depth guard
// at any nesting. An unknown block type does NOT work as a witness — `classifyContent`
// carries its own bound (counting block LEVELS, not containers), so it goes silent around
// 256 blockquotes and a test resting on it would pin a claim false one bound further out.
//
// PINNED AGAINST THE BOUND, NOT A BLOCK COUNT. `MAX_CANONICALIZATION_DEPTH` counts
// CONTAINERS — every object and every array — and a blockquote contributes two, itself and
// its `children`. So the block count at which a document goes silent is a function of the
// constant AND of everything else in the tree. The boundary is therefore SEARCHED for
// rather than written down: a hard-coded 126 would be a fact about today's constant and
// today's document shape, true of neither if either moved. Assertions use set EQUALITY, not
// membership, so one comparison catches all three directions at once — the gated code gone,
// the witness still present, and nothing swapped in.

/** Container depth of a parsed value, counting objects and arrays as assertBoundedDepth does. */
function containerDepth(v: unknown): number {
  if (v === null || typeof v !== 'object') return 0;
  const kids = Object.values(v as Record<string, unknown>).map(containerDepth);
  return 1 + (kids.length > 0 ? Math.max(...kids) : 0);
}

/** `n` nested blockquotes wrapping `inner`. Each contributes TWO containers. */
function nestBlockquotes(n: number, inner: unknown[]): unknown[] {
  let nodes = inner;
  for (let i = 0; i < n; i++) nodes = [{ type: 'blockquote', children: nodes }];
  return nodes;
}

/**
 * The largest `n` for which `build(n)` still canonicalizes, and the first that does not.
 * Throws rather than returning a degenerate pair, so a shape that never crosses the bound
 * fails loudly instead of vacuously satisfying every assertion below.
 */
function depthBoundary(build: (n: number) => unknown): { under: number; over: number } {
  for (let n = 1; n <= 400; n++) {
    if (containerDepth(build(n)) > MAX_CANONICALIZATION_DEPTH) {
      if (n === 1) throw new Error('shape exceeds the bound with a single wrapper: no boundary to pin');
      return { under: n - 1, over: n };
    }
  }
  throw new Error('shape never reaches the canonicalization depth bound within 400 wrappers');
}

/**
 * The live witness: non-NFC text, reported by a pre-canonicalization scan at any depth.
 * Written as an ESCAPE, never a raw combining character — a literal here is one editor
 * normalization away from being NFC, at which point the witness stops firing and every
 * test below fails for a reason that has nothing to do with what it pins.
 */
const NFD_WITNESS = 'cafe\u0301';
const WITNESS_CODE = 'CDX-E-PART-STRING-NOT-NFC';
const sorted = (s: Set<string>): string[] => [...s].sort();

test('a hashed anchor position goes silent past the depth bound, and only it does', () => {
  const build = (n: number): unknown => ({
    version: '0.1',
    blocks: [...nestBlockquotes(n, [para('p1', NFD_WITNESS)]), linkPara('#p1/20-25')],
  });
  const { under, over } = depthBoundary(build);
  const blocks = (n: number) => (build(n) as { blocks: unknown[] }).blocks;

  // THE FLOOR. Without it, "silent above the bound" is satisfied by a check that never
  // fires at all — which is exactly how the arms this file guards came to be unmutatable.
  assert.deepEqual(
    sorted(codesFor(anchorDoc(blocks(under)))),
    ['CDX-E-ANCHOR-POSITION-OUT-OF-RANGE', WITNESS_CODE].sort(),
    'below the bound both the anchor defect and the witness are reported',
  );

  // The claim. The witness surviving is what makes this a silence rather than a reader
  // that gave up on the part: the position code is gone, the witness is not.
  assert.deepEqual(
    sorted(codesFor(anchorDoc(blocks(over)))),
    [WITNESS_CODE],
    'one container deeper the anchor defect is gone and nothing replaces it',
  );

  // ON THE BOUND EXACTLY. A blockquote contributes two containers, so the chain above
  // steps in twos and straddles the bound without ever landing on it: `under` is 255 and
  // `over` is 257. That leaves the guard's comparison untested on the one value that
  // distinguishes `>` from `>=`, and TIGHTENING it by one was measured to pass every gate
  // in the repository. An empty `marks` array on the innermost text node adds a single
  // container, shifting the parity so a document sits at exactly MAX_CANONICALIZATION_DEPTH
  // — which the specification admits, the bound being a maximum and not a limit exceeded.
  const onBound = (n: number): unknown => ({
    version: '0.1',
    blocks: [
      ...nestBlockquotes(n, [{ type: 'paragraph', id: 'p1', children: [{ type: 'text', value: NFD_WITNESS, marks: [] }] }]),
      linkPara('#p1/20-25'),
    ],
  });
  const exact = depthBoundary(onBound).under;
  assert.equal(
    containerDepth(onBound(exact)),
    MAX_CANONICALIZATION_DEPTH,
    'the padded shape lands on the bound itself, not one short of it',
  );
  assert.deepEqual(
    sorted(codesFor(anchorDoc((onBound(exact) as { blocks: unknown[] }).blocks))),
    ['CDX-E-ANCHOR-POSITION-OUT-OF-RANGE', WITNESS_CODE].sort(),
    'a document AT the bound is still fully checked',
  );
});

test('an OUT-OF-HASH annotation position goes silent on deep content too', () => {
  // The stronger instance. The annotation layer is not deep and its author does not
  // control the content part, so what silences the check is the depth of a document
  // somebody else wrote.
  const build = (n: number): unknown => ({
    version: '0.1',
    blocks: nestBlockquotes(n, [para('p1', NFD_WITNESS)]),
  });
  const { under, over } = depthBoundary(build);

  const deepAnnotationDoc = (n: number): ZipEntryRecipe[] => {
    const content = JSON.stringify(build(n));
    const hash = 'sha256:' + createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
    const annotation = { id: 'a1', type: 'comment', anchor: { blockId: 'p1', start: 20, end: 25 }, author: { name: 'A' }, created: '2025-01-10T08:00:00Z', content: 'ok' };
    return [
      { name: 'manifest.json', text: JSON.stringify({ cdx: '0.1', id: 'pending', state: 'draft', created: '2025-01-10T08:00:00Z', modified: '2025-01-10T08:00:00Z', content: { path: 'content/document.json', hash }, metadata: { dublinCore: 'metadata/dublin-core.json' } }) },
      { name: 'content/document.json', text: content },
      { name: 'metadata/dublin-core.json', text: DC },
      { name: 'security/annotations.json', text: JSON.stringify({ version: '0.1', annotations: [annotation] }) },
    ];
  };

  assert.deepEqual(
    sorted(codesFor(deepAnnotationDoc(under))),
    [POSITION_DEFECTIVE, WITNESS_CODE].sort(),
    'below the bound the stale annotation anchor and the witness are both reported',
  );
  assert.deepEqual(
    sorted(codesFor(deepAnnotationDoc(over))),
    [WITNESS_CODE],
    'past the bound the annotation defect is gone and the witness remains',
  );
});

test('an id COLLISION goes silent past the bound, taking a REJECT with it', () => {
  // The sharpest instance in the vocabulary, and the reason this is worth its own case
  // rather than another code folded into the one above. CDX-E-ID-COLLISION is an Error in
  // every state, and `documentVerdict` deliberately orders the reference pass BEFORE the
  // id recompute so a duplicate id surfaces as its own finding rather than being swallowed
  // by the recompute's catch. Past the bound that ordering buys nothing: the collision is
  // never reported, so the document loses the REJECT and its id verification together, and
  // reads as carrying only a stray Unicode defect.
  const build = (n: number): unknown => ({
    version: '0.1',
    blocks: nestBlockquotes(n, [para('dup', NFD_WITNESS), para('dup', 'b')]),
  });
  const { under, over } = depthBoundary(build);
  const blocks = (n: number) => (build(n) as { blocks: unknown[] }).blocks;

  assert.deepEqual(
    sorted(codesFor(anchorDoc(blocks(under)))),
    ['CDX-E-ID-COLLISION', WITNESS_CODE].sort(),
    'below the bound the collision is reported',
  );
  assert.deepEqual(
    sorted(codesFor(anchorDoc(blocks(over)))),
    [WITNESS_CODE],
    'past the bound the collision is gone while the witness proves the part was still read',
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
