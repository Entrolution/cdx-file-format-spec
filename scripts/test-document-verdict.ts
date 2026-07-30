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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
