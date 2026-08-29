/**
 * The Level-1 container fixture corpus — the reviewed SOURCE OF TRUTH.
 *
 * Each entry defines one case: a deterministic archive `recipe` (materialized by
 * zip-writer.ts) and the expected verdict `expect` (an interval over the
 * disposition lattice, 07 §5.4.1). scripts/build-fixtures.ts writes each case to
 * conformance/fixtures/container/<name>/{case.json, case.cdx}; scripts/check-fixtures.ts
 * re-derives and asserts the committed artifacts match, byte-for-byte. This is
 * the kat -> vectors pattern applied to the document track.
 *
 * ORACLE DISCIPLINE. Every disposition is transcribed from the specification's
 * own §5.4 tables — or the mechanism section a §5.4 row defers to (e.g. §9.2 for
 * the decompression bomb) — each case citing its clause, NEVER read back from the
 * reader.
 * A malformed case's defect is injected BY CONSTRUCTION (the recipe declares it),
 * so its expected REJECT is known a priori; conformance/oracles/archive_oracle.py
 * independently confirms the malformation is actually present in the committed
 * bytes. Positive cases are the counterweight: a "reject-everything" adapter
 * fails them.
 *
 * SCOPE. B1a shipped the container layer (`layer: 'container'`); B1b-1 adds the
 * document/part layer (`layer: 'document'`) — the manifest/part-load spine. Every
 * committed archive uses Store (method 0) so its bytes are byte-stable across
 * zlib/Node versions; Deflate support is exercised in-memory by check-fixtures.ts,
 * not by a committed archive. The frozen/published INTEGRITY-ERROR ceilings (which
 * §5.3 gates on a valid signature) arrive in B3 on B2's trust material.
 */

import type { ZipRecipe, ZipEntryRecipe } from './zip-writer.js';
import type { Disposition } from './disposition.js';

export interface AuthoredInterval {
  atLeast: Disposition;
  atMost: Disposition;
}
export interface AuthoredVerdict {
  documentDisposition: AuthoredInterval;
  findings: Array<{ code: string; atLeast: Disposition; atMost: Disposition }>;
}
export interface AuthoredCase {
  name: string;
  description: string;
  layer: 'container' | 'document';
  requires?: string[];
  clause?: string;
  recipe: ZipRecipe;
  expect: AuthoredVerdict;
}

/** A clean archive: nothing blocks it (max over no finding = IGNORE). */
const CLEAN: AuthoredVerdict = { documentDisposition: { atLeast: 'IGNORE', atMost: 'IGNORE' }, findings: [] };

/** An exact REJECT carried by a single finding. */
const rejectOnly = (code: string): AuthoredVerdict => ({
  documentDisposition: { atLeast: 'REJECT', atMost: 'REJECT' },
  findings: [{ code, atLeast: 'REJECT', atMost: 'REJECT' }],
});

/** An exact WARNING carried by a single finding (readable but flawed). */
const warnOnly = (code: string): AuthoredVerdict => ({
  documentDisposition: { atLeast: 'WARNING', atMost: 'WARNING' },
  findings: [{ code, atLeast: 'WARNING', atMost: 'WARNING' }],
});

/** A minimal well-formed CDX part set (Store; the container reader never parses these). */
const okParts = (): ZipEntryRecipe[] => [
  { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' },
  { name: 'content/document.json', text: '{"version":"0.1","blocks":[]}' },
  { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T"}}' },
];

/** manifest + one deliberately-crafted entry (the injected defect). */
const withManifest = (bad: ZipEntryRecipe): ZipRecipe => ({
  entries: [{ name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' }, bad],
});

// --- Document/part-layer fixture builders (B1b) -----------------------------

// The clean content part and its SHA-256 (metadata.dublinCore is a path-only
// reference, §4.6, so it carries no hash). Reused across the document fixtures;
// the two content-defect fixtures substitute their own bytes.
const CLEAN_CONTENT = '{"version":"0.1","blocks":[]}';
const CLEAN_CONTENT_HASH = 'sha256:5d69e5acc01e8b76df35531f9199eda7f594a972eec7d5718071842062fb39cc';

/**
 * A minimal valid manifest with `overrides` applied over a draft baseline (id
 * `pending`, state `draft`, content -> the clean content part). Object-spread keeps
 * existing keys in position, so the serialization is byte-stable; an override
 * injects the specific defect (a bad `state`, `cdx`, `content` ref, or `extensions`).
 * `id` is `pending` for a draft (§3.2), so no document-ID recompute is triggered.
 */
const manifestJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    cdx: '0.1',
    id: 'pending',
    state: 'draft',
    created: '2025-01-10T08:00:00Z',
    modified: '2025-01-10T08:00:00Z',
    content: { path: 'content/document.json', hash: CLEAN_CONTENT_HASH },
    metadata: { dublinCore: 'metadata/dublin-core.json' },
    ...overrides,
  });

/**
 * A conformant Dublin Core part. 08-metadata §3.3.1/§3.3.2 make BOTH `title` and
 * `creator` required (`title` a non-empty string, `creator` at least one value), as does
 * dublin-core.schema.json — so a DC part carrying only `title` violates the §5.4.2
 * "Missing required metadata at the PART level" row that
 * B1b-3b-1 targets.
 *
 * JSON.stringify, not template interpolation (as manifestJson above): a title bearing a
 * quote or backslash would emit a malformed part, and NOTHING would catch it — the
 * reader treats an unloadable DC as an indeterminate id basis and skips the recompute
 * (document-verdict.ts), and the oracle's _dublin_core_value raises OracleUnsupported,
 * which confirm_clean swallows. A corrupt DC silently buys LESS verification, not a
 * failure.
 *
 * `creator` is SCALAR so the id positive control also covers projectMetadata's
 * scalar-to-one-element-array coercion (06 §4.3.1); primary coverage for that coercion
 * is conformance/vectors/document-id.json, which carries both shapes.
 *
 * (Container-layer fixtures keep their own inline parts — documentVerdict does not run
 * for `layer: 'container'`, so their DC is never read.)
 */
const dublinCoreJson = (dcTitle: string): string =>
  JSON.stringify({ version: '1.1', terms: { title: dcTitle, creator: 'A. Author' } });

/** The standard clean content + Dublin Core entries that follow a manifest entry. */
const cleanBody = (dcTitle = 'Minimal Draft'): ZipEntryRecipe[] => [
  { name: 'content/document.json', text: CLEAN_CONTENT },
  { name: 'metadata/dublin-core.json', text: dublinCoreJson(dcTitle) },
];

/**
 * A body carrying a specific content part (B1b-2 block/mark-classifier cases) plus a
 * clean Dublin Core part. The content `hash` in each case's manifest is the SHA-256 of
 * exactly this `contentText` — a real file hash, which B1b-3a's file-hash pass now
 * verifies against the stored bytes (document-verdict.ts), so a wrong one here makes
 * the fixture emit CDX-E-FILE-HASH-MISMATCH.
 */
const contentBody = (contentText: string, dcTitle: string): ZipEntryRecipe[] => [
  { name: 'content/document.json', text: contentText },
  { name: 'metadata/dublin-core.json', text: dublinCoreJson(dcTitle) },
];

/** A document archive: a manifest entry followed by the given body entries. */
const documentArchive = (manifest: string, body: ZipEntryRecipe[]): ZipRecipe => ({
  entries: [{ name: 'manifest.json', text: manifest }, ...body],
});

// --- B1b-3b-2: asset / presentation / config-slot fixture infrastructure -----
//
// Every hash and every document ID below is REAL — computed from these exact bytes by a
// throwaway script and hard-coded here, so a reader that skips a hash check cannot pass and
// `check:fixtures` can re-derive the archives byte-for-byte.
//
// TWO AUTHORING TRAPS, both a consequence of what enters the document ID (§4.3.1 item 2
// replaces a content asset reference with the referenced asset's DECLARED hash from the
// index, never with the asset's bytes):
//   - a fixture that tampers an asset's BYTES leaves the id basis untouched, so its
//     `manifest.id` must be the CLEAN one — otherwise it also trips
//     CDX-E-DOCUMENT-ID-MISMATCH and stops isolating the asset-hash row;
//   - an index tamper that edits `size`, `type` or `id` likewise leaves the basis untouched,
//     because only the path→hash MAPPING is drawn from an index, never its bytes. Editing an
//     entry's `path` or `hash` DOES change the basis, and only then must the id be recomputed
//     over the tampered index.
// Asset payloads are SVG: real, plausible image bytes that are also valid UTF-8 text, which
// is all `ZipEntryRecipe` carries (binary payloads arrive with the declared-MIME row).

const FIG1 = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';
const FIG1_HASH = 'sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86';
const FIG2 = '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>';
const FIG1_SMALL = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';

/** One asset, no variants — the baseline index. */
const INDEX_ONE =
  '{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86"}]}';
const INDEX_ONE_HASH = 'sha256:b437c9030604dd9d987bb6d165de2a651d787e251b665e5b13818921af3aba5d';
/** The same index with `size` bumped by one — tampered bytes, hash left as declared. */
const INDEX_ONE_TAMPERED =
  '{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":63,"hash":"sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86"}]}';
/** Two DISTINCT assets. */
const INDEX_TWO =
  '{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86"},{"id":"fig2","path":"fig2.svg","type":"image/svg+xml","size":62,"hash":"sha256:b16192e8b20733db17467a22bce6861e4de6bc7c918508b8a18daad6f0d87868"}]}';
const INDEX_TWO_HASH = 'sha256:88064367fb204feebd67b7de4918bdd5df55752265c013591646f2788c798690';
/** Two paths whose entries declare the SAME hash (both copies stored; no `aliasOf`). */
const INDEX_ALIAS =
  '{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86"},{"id":"fig1copy","path":"fig1-copy.svg","type":"image/svg+xml","size":62,"hash":"sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86"}]}';
const INDEX_ALIAS_HASH = 'sha256:a3b6abe7526ebcc7df52a3211da3e76198b6165cc2e4a48633532e5490cabc61';
/** One asset carrying an image variant (05 §4.3). */
const INDEX_VARIANT =
  '{"version":"0.1","assets":[{"id":"fig1","path":"fig1.svg","type":"image/svg+xml","size":62,"hash":"sha256:a5a035f4bdc412baf68e606049b8953e4295f276ce8e014b6e40e72c8e99bb86","variants":[{"path":"fig1-4.svg","width":4,"size":62,"hash":"sha256:5b10d22019dbf0238b178c09957cac2af302655093bbe81a741d207a4e58e53a"}]}]}';
const INDEX_VARIANT_HASH = 'sha256:9928d4ff89ad6f76d18df6928eb625a3a8c7793975e2fe064a0f48916133c632';

const CONTENT_IMAGE = '{"version":"0.1","blocks":[{"type":"image","id":"img1","src":"assets/images/fig1.svg","alt":"Figure 1"}]}';
const CONTENT_IMAGE_HASH = 'sha256:d4f68c68e67a9fff2870e84432e4e7572cc3ff2a8a784522d08298317bf52a4e';
const CONTENT_IMAGE_DANGLING = '{"version":"0.1","blocks":[{"type":"image","id":"img1","src":"assets/images/gone.svg","alt":"Figure 1"}]}';
const CONTENT_IMAGE_DANGLING_HASH = 'sha256:972230484087f85d8dce50276adc15773790c5a1f88c872bb99e8a2263c5cb15';
/** Two adjacent text nodes sharing an `anchor` id, linking to DISTINCT assets. */
const CONTENT_DISTINCT_LINKS =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"anchor","id":"x"},{"type":"link","href":"assets/images/fig1.svg"}]},{"type":"text","value":"b","marks":[{"type":"anchor","id":"x"},{"type":"link","href":"assets/images/fig2.svg"}]}]}]}';
const CONTENT_DISTINCT_LINKS_HASH = 'sha256:39de48508e370e56a4ab50401e915af6cad59cd256ffe64ee1300bd62803e4e9';
/** The same shape, both links naming the SAME bytes under two paths. */
const CONTENT_ALIASED_LINKS =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"anchor","id":"x"},{"type":"link","href":"assets/images/fig1.svg"}]},{"type":"text","value":"b","marks":[{"type":"anchor","id":"x"},{"type":"link","href":"assets/images/fig1-copy.svg"}]}]}]}';
const CONTENT_ALIASED_LINKS_HASH = 'sha256:df02f5f3b985d2d974dbfa23f2356c9ab561177ffa075472b5c29af63bc7ca53';
const CONTENT_PARAGRAPH = '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"x"}]}]}';
const CONTENT_PARAGRAPH_HASH = 'sha256:d2da00ccb856ddd6dffab5b12df723d8899316fdde8185bef09f30f901f61acc';
const CONTENT_SEMANTIC =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"citation","refs":["smith2020"]}]},{"type":"text","value":"b","marks":[{"type":"glossary","ref":"entropy"}]}]}]}';
const CONTENT_SEMANTIC_HASH = 'sha256:0ae5597a1417d01f1a39f9ee2ba93b885058ab9de23bad2329e78ed41ee9f73c';
const CONTENT_SEMANTIC_DANGLING =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"citation","refs":["nosuchkey"]}]},{"type":"text","value":"b","marks":[{"type":"glossary","ref":"nosuchterm"}]}]}]}';
const CONTENT_SEMANTIC_DANGLING_HASH = 'sha256:bc004c0f5f81ed2229b1557e663bd2566a5206a9136d4dfdabbe19a04b79dd17';

// Footnote resolution (Semantic Extension §4.5.2). The OK body exercises BOTH keys in one
// document: the first mark carries an `id` matching a block's (id match takes precedence),
// the second carries only a `number` and matches the block with the equal `number`.
// Every key is LOAD-BEARING, which the first draft of this fixture got wrong: its id-matched
// mark also carried a `number` that resolved uniquely on its own, so deleting the id-precedence
// branch left the fixture green. Here `fn1` and `fn2` deliberately SHARE `number: 1`, so the
// first mark resolves only via id match — without that branch its marker is ambiguous. The
// second mark exercises `number`, the third `symbol`; deleting either arm turns this red. Both
// blocks sharing the marker carry ids, so §4.5.2's "absent `id`s" uniqueness MUST is not
// engaged and the document is genuinely clean.
const CONTENT_FOOTNOTE_OK =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"footnote","number":1,"id":"fn1"}]},{"type":"text","value":"b","marks":[{"type":"footnote","number":2}]},{"type":"text","value":"c","marks":[{"type":"footnote","symbol":"dagger"}]}]},{"type":"semantic:footnote","id":"fn1","number":1,"content":"note"},{"type":"semantic:footnote","id":"fn2","number":1,"content":"note"},{"type":"semantic:footnote","number":2,"content":"note"},{"type":"semantic:footnote","symbol":"dagger","content":"note"}]}';
const CONTENT_FOOTNOTE_OK_HASH = 'sha256:93639de26f8fca596546bd9a0c2ae4983bf34515fddd27f9c9a235e60cc5fef6';
const CONTENT_FOOTNOTE_DANGLING =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"footnote","number":9}]}]},{"type":"semantic:footnote","number":1,"content":"note"}]}';
const CONTENT_FOOTNOTE_DANGLING_HASH = 'sha256:f1ec6502a787a9e5b25a77a7fc4248dd017b2a0c567bfdb79750d3963b3d1fa4';
// Two blocks share `number: 1` and neither carries an `id`, which §4.5.2 forbids ("absent
// `id`s, no two may share a `number` or a `symbol`"). The mark resolves to the first in
// document order and the reader warns.
const CONTENT_FOOTNOTE_AMBIGUOUS =
  '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"footnote","number":1}]}]},{"type":"semantic:footnote","number":1,"content":"note"},{"type":"semantic:footnote","number":1,"content":"note"}]}';
const CONTENT_FOOTNOTE_AMBIGUOUS_HASH = 'sha256:256900baf4da7d822b3624c33f27a87cbb4bf3bcbd44f367a735ba91f649be17';

const BIBLIOGRAPHY = '{"version":"0.1","entries":[{"id":"smith2020","type":"book","title":"A Book"}]}';
const BIBLIOGRAPHY_HASH = 'sha256:2769581d4c19da11daed52e0e62e81e95a791adaba0eb6b6777c23c9211b2136';
const GLOSSARY = '{"version":"0.1","terms":[{"id":"entropy","term":"Entropy","definition":"A measure."}]}';
const GLOSSARY_HASH = 'sha256:5f8f47e6a8e441be2e21e215fb2a10656b0dac93a5c038c189e397b8c418b67d';

const PRESENTATION_OK =
  '{"version":"0.1","type":"paginated","pages":[{"number":1,"elements":[{"blockId":"p1","position":{"x":0,"y":0,"width":100,"height":20}}]}]}';
const PRESENTATION_OK_HASH = 'sha256:810575a84b9b5537290d20adf364cc4f83e41f672e6c65cffa7222141af519b8';
const PRESENTATION_DANGLING =
  '{"version":"0.1","type":"paginated","pages":[{"number":1,"elements":[{"blockId":"gone","position":{"x":0,"y":0,"width":100,"height":20}}]}]}';
const PRESENTATION_DANGLING_HASH = 'sha256:44b9fd7aa780facf15567cb5d124376f41170ed97af780626f6f2e59fea8734b';

/** A `manifest.assets` block for one `images` category (schema: {count, totalSize, index, hash}). */
const imagesCategory = (indexHash: string, count = 1, totalSize = 62): Record<string, unknown> => ({
  images: { count, totalSize, index: 'assets/images/index.json', hash: indexHash },
});

/** An exact IGNORE carried by a single finding (an unrecognized but tolerated element). */
const ignoreOnly = (code: string): AuthoredVerdict => ({
  documentDisposition: { atLeast: 'IGNORE', atMost: 'IGNORE' },
  findings: [{ code, atLeast: 'IGNORE', atMost: 'IGNORE' }],
});

// Overlong UTF-8: "a" + 0xC0 0xAF (an overlong encoding of '/') + "b".
const OVERLONG_NAME_B64 = 'YcCvYg==';

export const FIXTURE_CORPUS: AuthoredCase[] = [
  // --- positives (a reject-everything adapter fails these) -------------------
  {
    name: 'positive-minimal',
    description: 'A well-formed minimal CDX archive (Store) reads cleanly, no container finding.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.3',
    recipe: { entries: okParts(), comment: 'CDX v0.1' },
    expect: CLEAN,
  },
  {
    name: 'positive-unknown-directory',
    description: 'An unrecognized top-level directory is tolerated at the container layer (forward compatibility: unrecognized file/dir -> IGNORE).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 7.2; State Machine section 5.4.2',
    recipe: { entries: [...okParts(), { name: 'x-vendor/notes.bin', text: 'opaque vendor data' }] },
    expect: CLEAN,
  },
  {
    name: 'positive-nested-assets',
    description: 'Nested asset directories and a ZIP comment read cleanly.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 3.3, 4.1',
    recipe: { entries: [...okParts(), { name: 'assets/images/index.json', text: '{"images":[]}' }], comment: 'CDX v0.1' },
    expect: CLEAN,
  },
  {
    name: 'positive-sfx-stub-prefix',
    description: 'A valid archive preceded by a self-extracting-stub prefix (offsets relative to the archive proper) still reads cleanly; a reader that trusts the declared central-directory offset blindly would mis-parse it.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 3.1, 3.5',
    recipe: { entries: okParts(), prependBytes: 64 },
    expect: CLEAN,
  },

  // --- state-invariant REJECTs (Container 3.5 / 9.1 / 9.2 / 9.3; State Machine 5.4.3) ---
  {
    name: 'reject-duplicate-entry',
    description: 'Two central-directory entries resolve to the same path (split-view substitution).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.5; State Machine section 5.4.3',
    recipe: { entries: [...okParts(), { name: 'content/document.json', text: '{"blocks":[{"substituted":true}]}' }] },
    expect: rejectOnly('CDX-E-ARCHIVE-DUPLICATE-ENTRY'),
  },
  {
    name: 'reject-case-collision',
    description: 'Two entries differ only in case, colliding on a case-insensitive filesystem.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.5; State Machine section 5.4.3',
    recipe: { entries: [...okParts(), { name: 'content/Document.json', text: '{"blocks":[{"substituted":true}]}' }] },
    expect: rejectOnly('CDX-E-ARCHIVE-CASE-COLLISION'),
  },
  {
    name: 'reject-lfh-cd-disagreement',
    description: 'An entry whose local-header name differs from its central-directory name.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.5; State Machine section 5.4.3',
    recipe: { entries: [{ name: 'manifest.json', text: '{"cdx":"0.1"}' }, { name: 'content/document.json', centralName: 'content/other.json', text: '{}' }] },
    expect: rejectOnly('CDX-E-ARCHIVE-LFH-CD-DISAGREEMENT'),
  },
  {
    name: 'reject-data-outside-central-directory',
    description: 'A local file header the central directory does not enumerate (stray entry).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.5; State Machine section 5.4.3',
    recipe: { entries: [...okParts(), { name: 'content/ghost.json', text: '{"stray":true}', omitFromCentral: true }] },
    expect: rejectOnly('CDX-E-ARCHIVE-DATA-OUTSIDE-CD'),
  },
  {
    name: 'reject-central-entry-no-local-header',
    description: 'A central-directory entry with no matching local file header (local/central entry-set disagreement).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.5; State Machine section 5.4.3',
    recipe: { entries: [...okParts(), { name: 'content/phantom.json', text: '{"phantom":true}', omitFromLocal: true }] },
    expect: rejectOnly('CDX-E-ARCHIVE-LFH-CD-DISAGREEMENT'),
  },
  {
    name: 'reject-unsafe-parent-traversal',
    description: 'An entry name with a `..` segment (zip-slip).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: withManifest({ name: '../escape.json', text: 'x' }),
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-unsafe-absolute-path',
    description: 'An absolute entry name.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: withManifest({ name: '/etc/cron.d/evil', text: 'x' }),
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-unsafe-backslash',
    description: 'An entry name containing a backslash (a Windows path separator).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 3.4, 9.1; State Machine section 5.4.3',
    recipe: withManifest({ name: '..\\..\\evil', text: 'x' }),
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-unsafe-colon-drive',
    description: 'An entry name containing a colon (Windows drive letter / NTFS alternate data stream).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: withManifest({ name: 'C:evil.json', text: 'x' }),
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-unsafe-device-name',
    description: 'An entry whose segment is a reserved Windows device name.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: withManifest({ name: 'con.json', text: 'x' }),
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-unsafe-trailing-dot',
    description: 'An entry with a trailing-dot segment (Windows folds it onto another entry).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: withManifest({ name: 'evil./payload', text: 'x' }),
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-unsafe-overlong-utf8',
    description: 'An entry name with an overlong UTF-8 encoding (smuggles a byte past a naive comparison).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: { entries: [{ name: 'manifest.json', text: '{"cdx":"0.1"}' }, { nameBytesBase64: OVERLONG_NAME_B64, text: 'x' }] },
    expect: rejectOnly('CDX-E-ARCHIVE-UNSAFE-NAME'),
  },
  {
    name: 'reject-symlink-entry',
    description: 'An entry encoding a Unix symbolic link (a second path-traversal vector).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 9.3; State Machine section 5.4.3',
    recipe: withManifest({ name: 'link', text: '/etc/passwd', symlink: true }),
    expect: rejectOnly('CDX-E-ARCHIVE-SYMLINK-ENTRY'),
  },
  {
    name: 'reject-decompression-bomb',
    description: 'An entry declaring a ~4 GB uncompressed size for a handful of stored bytes (declared-ratio bomb), exceeding any plausible conformant bound.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 5.3, 9.2',
    recipe: withManifest({ name: 'bomb.bin', text: 'tiny', declaredUncompressedSize: 4294967280 }),
    expect: rejectOnly('CDX-E-ARCHIVE-DECOMPRESSION-BOMB'),
  },
  {
    name: 'reject-truncated-no-eocd',
    description: 'An archive with its End Of Central Directory record removed (unreadable).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.1; State Machine section 5.4.2',
    recipe: { entries: okParts(), truncate: 'eocd' },
    expect: rejectOnly('CDX-E-ARCHIVE-UNREADABLE'),
  },
  {
    name: 'reject-crc-mismatch',
    description: 'An entry whose stored ZIP CRC-32 does not match its actual bytes (corrupt container).',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 6.1; State Machine section 5.4.2',
    recipe: withManifest({ name: 'content/document.json', text: '{"version":"0.1","blocks":[]}', wrongCrc: true }),
    expect: rejectOnly('CDX-E-ARCHIVE-CRC-MISMATCH'),
  },
  {
    name: 'reject-encryption-used',
    description: 'An entry marked ZIP-encrypted (general-purpose bit 0); CDX uses the security extension, never container encryption.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.1; State Machine section 5.4.2',
    recipe: withManifest({ name: 'content/document.json', text: '{"version":"0.1"}', encrypted: true }),
    expect: rejectOnly('CDX-E-ARCHIVE-ENCRYPTION-USED'),
  },
  {
    name: 'reject-multi-volume',
    description: 'A multi-volume (split) archive: an End Of Central Directory disk field is non-zero.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.1; State Machine section 5.4.2',
    recipe: { entries: okParts(), multiVolume: true },
    expect: rejectOnly('CDX-E-ARCHIVE-MULTI-VOLUME'),
  },
  {
    name: 'reject-compression-method-forbidden',
    description: 'An entry declaring compression method 99, outside the complete set Container Format §3.2 permits (Store 0, Deflate 8, Zstandard 93). The bytes cannot be obtained, so neither the entry\'s CRC-32 nor any hash over it can be verified — the same class as the ZIP-encryption and multi-volume rows, which are likewise §3.1 violations that cannot be coherently loaded. §3.2 also forbids the failure this pins: a reader MUST NOT infer a method from the data, and in particular MUST NOT treat an unrecognized method as Deflate. A reader that did exactly that reported this archive CLEAN, its CRC silently unverified.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 3.2, 6.1; State Machine section 5.4.2',
    recipe: { entries: [
      { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' },
      { name: 'content/document.json', text: '{"version":"0.1","blocks":[]}', methodCodeOverride: 99 },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T"}}' },
    ] },
    expect: rejectOnly('CDX-E-ARCHIVE-COMPRESSION-METHOD-FORBIDDEN'),
  },
  {
    name: 'reject-entry-undecodable',
    description: 'A Store entry relabelled as Deflate (method 8) in both headers, so its bytes are plain text that raw-inflate cannot decode at all. Distinct from a CRC mismatch, which requires bytes that DID decode and whose checksum then differed — here no checksum can be computed. Nothing else in the reader owns this: the local-header/central-directory cross-check compares names and existence only, and the decompression bound reads DECLARED sizes, so before this row the archive reported clean with its CRC never computed.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 3.2, 6.1; State Machine section 5.4.2',
    recipe: { entries: [
      { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' },
      { name: 'content/document.json', text: 'plain text, definitely not a deflate stream', methodCodeOverride: 8 },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T"}}' },
    ] },
    expect: rejectOnly('CDX-E-ARCHIVE-ENTRY-UNDECODABLE'),
  },
  {
    name: 'reject-entry-truncated-deflate',
    description: 'A real Deflate stream with its last bytes dropped, so it decodes partially and then runs out. Distinct from the relabelled-Store case: those bytes are wrong from the first byte, whereas a truncated stream is where decoders disagree most — Node\'s inflateRawSync throws, while Python\'s decompressobj returns whatever it managed WITHOUT raising. A reader and an independent oracle that drift apart here disagree about whether the entry is undecodable or merely CRC-mismatched, so this fixture pins them together.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format sections 3.2, 6.1; State Machine section 5.4.2',
    recipe: { entries: [
      { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' },
      { name: 'content/document.json', text: '{"version":"0.1","blocks":[]}'.repeat(40), method: 'deflate', truncateStoredBytes: 6 },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T"}}' },
    ] },
    expect: rejectOnly('CDX-E-ARCHIVE-ENTRY-UNDECODABLE'),
  },
  {
    name: 'positive-zstd-entry',
    description: 'An entry compressed with Zstandard (method 93), which Container Format §3.2 permits and RECOMMENDS. A reader implementing it decompresses the entry and verifies its CRC-32 normally — CLEAN. `requires: compression:zstd` scopes the case out of a Deflate-only reader rather than failing it, because §3.2 makes Zstandard RECOMMENDED, not mandatory; such a reader must instead report the entry integrity-indeterminate (§5.4.2 note 6). The positive control for the method dispatch: a reader that still treated every non-Store method as Deflate fails here.',
    layer: 'container',
    requires: ['container', 'compression:zstd'],
    clause: 'Container Format sections 3.2, 6.1',
    recipe: { entries: [
      { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' },
      { name: 'content/document.json', text: '{"version":"0.1","blocks":[]}', method: 'zstd' },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T"}}' },
    ] },
    expect: CLEAN,
  },
  {
    name: 'warn-first-file-not-manifest',
    description: 'A readable archive whose first entry is not manifest.json (only the streaming optimization is lost) -> WARNING, not blocked.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 4.2; State Machine section 5.4.2',
    recipe: {
      entries: [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[]}' },
        { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' },
        { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T"}}' },
      ],
    },
    expect: warnOnly('CDX-E-ARCHIVE-FIRST-FILE-NOT-MANIFEST'),
  },
  {
    name: 'positive-zip64',
    description: 'A well-formed archive that additionally carries a ZIP64 EOCD record + locator (as some archivers always emit); reads cleanly.',
    layer: 'container',
    requires: ['container'],
    clause: 'Container Format section 3.1',
    recipe: { entries: okParts(), zip64: true },
    expect: CLEAN,
  },

  // ===========================================================================
  // Document/part layer (B1b-1, Tier 1): the manifest/part-load spine. A document
  // fixture requires the container capability (to read the archive) AND document
  // (to load the parts out of it). The container is clean here — container defects
  // are the `container` kind's job — except `reject-manifest-absent`, whose
  // first-entry-not-manifest is an inherent, tolerable side effect.
  // ===========================================================================

  // --- positives / non-REJECT (a reject-everything reader fails these) --------
  {
    name: 'positive-draft-minimal',
    description: 'A well-formed minimal draft document: manifest, content and Dublin Core parts all present and strict-JSON-parseable. Nothing blocks it.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 3; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), cleanBody('Minimal Draft')),
    expect: CLEAN,
  },
  {
    name: 'positive-review-minimal',
    description: 'A well-formed review document with a computed document id. Accepted; the review state is valid, every part loads, the file-level content.hash matches the stored bytes, and the recomputed canonical document ID matches manifest.id — the positive control for the B1b-3a file-hash and document-ID checks (a reader that skips either would fail this).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'State Machine section 3.3; Manifest section 4.2',
    recipe: documentArchive(
      manifestJson({ id: 'sha256:34d8f862fc561be2e9ca4fe379103ab525dd83e97191fed53ff05be3a3355793', state: 'review' }),
      cleanBody('Minimal Review'),
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-minor-version-newer',
    description: 'The manifest declares a newer MINOR version (0.2) than the reader implements (0.1): process known fields, ignore unknown additions — WARNING, not blocked.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.1; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ cdx: '0.2' }), cleanBody()),
    expect: warnOnly('CDX-E-VERSION-MINOR-UNSUPPORTED'),
  },
  {
    name: 'ignore-optional-extension-unknown',
    description: 'An optional (required:false) extension names a namespace the reader does not support: its data is skipped and the document degrades gracefully — IGNORE.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.10; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ extensions: [{ id: 'cdx.collaboration', version: '0.1', required: false }] }),
      cleanBody(),
    ),
    expect: ignoreOnly('CDX-E-EXTENSION-OPTIONAL-UNSUPPORTED'),
  },

  // --- state-invariant REJECTs (Document Hashing 4.3.2; State Machine 5.4.3) --
  {
    name: 'reject-duplicate-json-keys',
    description: 'The content part contains an object with duplicate keys, forbidden by the canonical-JSON rules before any hashing (a split-view substitution vector) — REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:468aef983350ce40146c8cf5776075bac3598183983afcee130f910879ed0ebb' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","version":"0.2","blocks":[]}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Dup Key Case') },
      ],
    ),
    expect: rejectOnly('CDX-E-PART-DUPLICATE-KEYS'),
  },
  {
    name: 'reject-manifest-duplicate-keys',
    description: 'The MANIFEST itself contains a duplicate key (two `cdx` members). Detected at strict-JSON load, before any field is interpreted — REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      '{"cdx":"0.1","cdx":"0.2","id":"pending","state":"draft","content":{"path":"content/document.json","hash":"sha256:5d69e5acc01e8b76df35531f9199eda7f594a972eec7d5718071842062fb39cc"},"metadata":{"dublinCore":"metadata/dublin-core.json"}}',
      cleanBody(),
    ),
    expect: rejectOnly('CDX-E-PART-DUPLICATE-KEYS'),
  },
  {
    name: 'reject-non-representable-number',
    description: 'The content part carries an integer of magnitude > 2^53 - 1: the double the canonicalizer would hash differs from the authored value — REJECT in every state, independent of document-ID computation (this is a draft, never canonicalized).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:156e2ef9faf24fc3335e02ff5d1f730c608af852d47e6b064c314ac25ec0db5b' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[],"n":9999999999999999}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Big Number') },
      ],
    ),
    expect: rejectOnly('CDX-E-PART-NUMBER-NON-REPRESENTABLE'),
  },
  {
    name: 'reject-non-representable-float',
    description: 'The content part carries a float-encoded integer beyond the safe range (1e19): like the bare-integer case, the double the canonicalizer hashes differs from the authored value — REJECT in every state. Exercises the float-form of the number rule (distinct from the integer form above).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:8a7ac01a8f44a74aaec47a6af867f7179028254e0caa522b0accf42bea5d56ed' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[],"n":1e19}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Big Float') },
      ],
    ),
    expect: rejectOnly('CDX-E-PART-NUMBER-NON-REPRESENTABLE'),
  },

  {
    name: 'reject-dublincore-duplicate-keys',
    description: 'The Dublin Core metadata part contains a duplicate key. §5.4.3 rejects a duplicate key in ANY part (a split-view substitution vector), not only the manifest or content — REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(manifestJson(), [
      { name: 'content/document.json', text: CLEAN_CONTENT },
      // Spliced from dublinCoreJson so the duplicate `version` key is the ONLY
      // difference from a conformant part — JSON.stringify cannot emit a duplicate key,
      // and re-spelling the part by hand would let it drift into testing something else.
      // A splice that stopped matching yields a part with no duplicate, which fails
      // loudly (mutation-verified): the conformance verdict drops to IGNORE and
      // document_oracle.py cannot confirm CDX-E-PART-DUPLICATE-KEYS.
      { name: 'metadata/dublin-core.json', text: dublinCoreJson('Dup DC').replace('{"version":"1.1",', '{"version":"1.1","version":"9.9",') },
    ]),
    expect: rejectOnly('CDX-E-PART-DUPLICATE-KEYS'),
  },

  // --- manifest REJECTs (absent / unparseable / malformed field) — 5.4.2 -----
  {
    name: 'reject-manifest-absent',
    description: 'The archive contains no manifest.json (only content and Dublin Core). The container additionally reports first-entry-not-manifest, but the blocking defect is the absent manifest — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Container Format section 4.2; State Machine section 5.4.2',
    recipe: { entries: cleanBody() },
    expect: rejectOnly('CDX-E-MANIFEST-ABSENT'),
  },
  {
    name: 'reject-manifest-unparseable',
    description: 'manifest.json is present but is not well-formed JSON (a missing comma), so the manifest cannot be parsed — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 2; State Machine section 5.4.2',
    recipe: documentArchive('{"cdx":"0.1","state":"draft" "content":{"path":"content/document.json"}}', cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-UNPARSEABLE'),
  },
  {
    name: 'reject-manifest-not-object',
    description: 'manifest.json is valid JSON but a top-level array, not a manifest object, so it cannot be parsed as a manifest — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 3.1; State Machine section 5.4.2',
    recipe: documentArchive('[1,2,3]', cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-UNPARSEABLE'),
  },
  {
    name: 'reject-manifest-state-unknown',
    description: 'manifest.state is "archived", outside the draft/review/frozen/published lifecycle enum, so the mutability-and-signature contract cannot be established — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.3; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ state: 'archived' }), cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-STATE-UNKNOWN'),
  },
  {
    name: 'reject-manifest-version-malformed',
    description: 'manifest.cdx is "0", not a "<major>.<minor>" version string — a mistyped required field, REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.1; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ cdx: '0' }), cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-VERSION-MALFORMED'),
  },
  {
    name: 'reject-content-reference-malformed',
    description: 'manifest.content is a bare string rather than a {path, hash} object — a mistyped required field, REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.6; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ content: 'content/document.json' }), cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-REFERENCE-MALFORMED'),
  },
  {
    name: 'reject-content-hash-malformed',
    description: 'manifest.content.hash is "notahash", not a well-formed algorithm:hexdigest value — a mistyped required field, REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.6; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ content: { path: 'content/document.json', hash: 'notahash' } }), cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-HASH-MALFORMED'),
  },
  {
    name: 'reject-content-path-traversal',
    description: 'manifest.content.path is "../secret.json", not a safe archive-relative path — an unsafe path always REJECTs, in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Container Format section 9.1; State Machine section 5.4.3',
    recipe: documentArchive(manifestJson({ content: { path: '../secret.json', hash: CLEAN_CONTENT_HASH } }), cleanBody()),
    expect: rejectOnly('CDX-E-MANIFEST-PATH-TRAVERSAL'),
  },

  // --- version / extension / content-part REJECTs — 5.4.2 --------------------
  {
    name: 'reject-major-version-unsupported',
    description: 'The manifest declares a MAJOR version (1.0) the reader does not implement: the format cannot be safely interpreted — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.1; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ cdx: '1.0' }), cleanBody()),
    expect: rejectOnly('CDX-E-VERSION-MAJOR-UNSUPPORTED'),
  },
  {
    name: 'reject-required-extension-unsupported',
    description: 'A required (required:true) extension names a namespace the reader does not support, so the document cannot be fully interpreted — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.10; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ extensions: [{ id: 'cdx.collaboration', version: '0.1', required: true }] }),
      cleanBody(),
    ),
    expect: rejectOnly('CDX-E-EXTENSION-REQUIRED-UNSUPPORTED'),
  },
  {
    name: 'reject-extension-required-implicit',
    description: 'An unsupported extension omits the `required` field entirely. The reader classifies fail-closed — an entry is optional only when `required` is explicitly false — so a missing `required` is treated as required and REJECTs, guarding against a silent downgrade to IGNORE.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.10; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ extensions: [{ id: 'cdx.collaboration', version: '0.1' }] }),
      cleanBody(),
    ),
    expect: rejectOnly('CDX-E-EXTENSION-REQUIRED-UNSUPPORTED'),
  },
  {
    name: 'reject-content-part-missing',
    description: 'manifest.content.path names content/document.json, but no such archive entry exists (only the manifest and Dublin Core are present) — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.6; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), [{ name: 'metadata/dublin-core.json', text: dublinCoreJson('No Content') }]),
    expect: rejectOnly('CDX-E-CONTENT-PART-MISSING'),
  },
  {
    name: 'reject-content-unparseable',
    description: 'The content part is present but is not well-formed JSON (a missing comma), so the content and document identity cannot be established — REJECT in every state, including a draft that is never canonicalized.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.1',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:db6ef2aaf754c4c6a77a4c92b3e0f4065d7bcf1b48f970a3596f76bdbdc2f1f4' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1" "blocks":[]}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Bad Content') },
      ],
    ),
    expect: rejectOnly('CDX-E-CONTENT-PART-UNPARSEABLE'),
  },

  // ===========================================================================
  // Document/part layer (B1b-2, Tier 2): the content block/mark type classifier.
  // Every block type and text-node mark type is classified against the reader's
  // recognized vocabulary (content-classifier.ts): an unknown BARE type REJECTs, an
  // unknown NAMESPACED type is IGNOREd, and a structurally malformed KNOWN block/mark
  // WARNs (§5.4.2 rows for Content Blocks §5/§5.1, draft/review column). Every case
  // is a draft; the FROZEN/PUBLISHED INTEGRITY-ERROR ceiling for the malformed rows
  // is deferred to B3. Each `content.hash` is the real SHA-256 of the content bytes.
  // ===========================================================================

  // --- positives (a reject-everything reader fails these) --------------------
  {
    name: 'positive-content-blocks',
    description: 'A well-formed content tree: a heading and a paragraph with a bold text run and a valid link mark. Every block and mark type is recognized and well-formed — nothing blocks it.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 4, 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:42a7ff9a41b25577d46396abe648029a1e6e1b5f57290c28cba01e583e7e03ef' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"heading","level":1,"children":[{"type":"text","value":"Title"}]},{"type":"paragraph","children":[{"type":"text","value":"Hello ","marks":["bold"]},{"type":"text","value":"world","marks":[{"type":"link","href":"https://example.com"}]}]}]}', 'Rich Content'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-registered-namespaced-types',
    description: 'A registered namespaced block (academic:theorem) and, in a core paragraph, a registered namespaced mark (legal:cite). Registered namespaced identifiers belong to the known set (Content Blocks §5.1 line 1019), so they are recognized as known, never treated as unknown extensions (which would be IGNORE) — CLEAN. The theorem interior is opaque to the core classifier (deferred), so the exercised legal:cite mark sits in the core paragraph where it is reached.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:c1526e539b86978b95c2ed36b52705f0d1d7d393e04692e1dc5136c2a34bc3eb' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"academic:theorem","children":[{"type":"paragraph","children":[{"type":"text","value":"Pythagoras"}]}]},{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"legal:cite","cite":"Euclid I.47"}]}]}]}', 'Registered Extensions'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-extension-block-opaque-interior',
    description: 'A registered extension block (academic:theorem) whose `children` contain a would-be-bare block type (`paragrph`). The core classifier recognizes the extension type but does NOT interpret its interior — an extension block\'s structure is defined by its own schema (academic:theorem uses `children`, academic:exercise-set uses `exercises[]`, …), which the core classifier cannot know — so full extension-content validation is deferred to B1b-3 and the document is CLEAN at this layer, not REJECT. Pins the extension-interior boundary: a change that started descending into registered extension blocks would false-REJECT this (and mishandle extension content generally).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:813dc95f98f4cdd929ecff37a09c29c7074ec5b7eb932abd823a2ab893531b48' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"academic:theorem","children":[{"type":"paragrph","children":[{"type":"text","value":"x"}]}]}]}', 'Opaque Extension Interior'),
    ),
    expect: CLEAN,
  },

  // --- unknown BARE type => REJECT (state-invariant, §5.4.2) ------------------
  {
    name: 'reject-block-type-unknown-bare',
    description: 'A block type `paragrph` (a misspelled `paragraph`) is unrecognized and not a well-formed namespaced identifier, so it cannot be deferred to an extension fallback — REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:793cdec4cac3ece5bc79bff4167668bc1cb408435a86a8247b782d7762d1e20d' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragrph","children":[{"type":"text","value":"typo"}]}]}', 'Bare Block Type'),
    ),
    expect: rejectOnly('CDX-E-BLOCK-TYPE-UNKNOWN-BARE'),
  },
  {
    name: 'reject-mark-type-unknown-bare',
    description: 'A mark `itlaic` (a misspelled `italic`) is unrecognized and non-namespaced, so it is rejected as malformed rather than silently accepted as an unknown mark — REJECT in every state (Content Blocks §5.1).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:0cc33ea9ddd68c6de9de3135c7ff27ef1dbad293f2e7a2680388cc12c197afbd' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"emphasis","marks":["itlaic"]}]}]}', 'Bare Mark Type'),
    ),
    expect: rejectOnly('CDX-E-MARK-TYPE-UNKNOWN-BARE'),
  },

  // --- unknown NAMESPACED type => IGNORE (state-invariant, §5.4.2) ------------
  {
    name: 'ignore-block-type-unknown-namespaced',
    description: 'An unrecognized but well-formed namespaced block type `myorg:widget` is an extension the reader does not implement: it degrades to a fallback — IGNORE.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:3baaf1797b9cbf93115c2d39c9405f1776e697ae4e05d18cd34036da06281451' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"myorg:widget","config":{"x":1},"children":[{"type":"paragraph","children":[{"type":"text","value":"fallback"}]}]}]}', 'Namespaced Block'),
    ),
    expect: ignoreOnly('CDX-E-BLOCK-TYPE-UNKNOWN-NAMESPACED'),
  },
  {
    name: 'ignore-mark-type-unknown-namespaced',
    description: 'An unrecognized but well-formed namespaced mark `myorg:flag` (bare-string form) is an extension mark the reader does not implement: it degrades to the unmarked text — IGNORE.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:2121c8cb7b2a1f917a8c3004310ac45ff9d604230d6c7ddf5d2e53822fd42a9c' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"flag","marks":["myorg:flag"]}]}]}', 'Namespaced Mark'),
    ),
    expect: ignoreOnly('CDX-E-MARK-TYPE-UNKNOWN-NAMESPACED'),
  },
  {
    name: 'ignore-mark-type-unknown-namespaced-object',
    description: 'The typed-object form of an unknown namespaced mark: `{type:"acme:hl", …}`. §5.1 admits an unknown namespaced mark as either a bare string or a typed object; both degrade to the unmarked text — IGNORE.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:e84c61a3da7d2697d8d12f5fc033054d96a46f0710b412addadaa415eba22be6' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":[{"type":"acme:hl","color":"y"}]}]}]}', 'Namespaced Object Mark'),
    ),
    expect: ignoreOnly('CDX-E-MARK-TYPE-UNKNOWN-NAMESPACED'),
  },

  // --- malformed KNOWN type => WARNING (draft/review; B3 lifts frozen/published) ---
  {
    name: 'warn-block-malformed-known',
    description: 'A known `tableCell` block appears at the document root instead of under a `tableRow` — a structural containment violation JSON Schema cannot express. A malformed block of a known type is a WARNING in draft/review (the frozen/published INTEGRITY-ERROR ceiling is deferred to B3).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:e554f140f7dcf4570d0bb37e4c0a59b12ac001294e2eda2ecaab23f107b1e8ed' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"tableCell","children":[{"type":"paragraph","children":[{"type":"text","value":"orphan cell"}]}]}]}', 'Malformed Block'),
    ),
    expect: warnOnly('CDX-E-BLOCK-MALFORMED'),
  },
  {
    name: 'warn-mark-malformed-known',
    description: 'A known `link` mark object is missing its required `href` field — a structurally malformed mark of a known type. WARNING in draft/review (the frozen/published INTEGRITY-ERROR ceiling is deferred to B3).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:99b8a200152d7a5355705bdc3b3dc9aeed59045a826bd0bd4d799ae2b6e0745f' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"link","marks":[{"type":"link"}]}]}]}', 'Malformed Mark'),
    ),
    expect: warnOnly('CDX-E-MARK-MALFORMED'),
  },

  // --- B1b-2 review hardening: opaque unknown subtrees, container shape, caption,
  //     and coverage for every fail-open-sensitive classifier branch. --------------
  {
    name: 'ignore-block-namespaced-opaque-subtree',
    description: 'An unknown namespaced block whose children contain a would-be bare block. Because an unknown namespaced block is IGNORE (render a fallback), the reader does NOT interpret its interior as CDX content — so the inner bare block is NOT rejected and the document is IGNORE, not REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:cf580e4e85fbec037aa314cf07be6b811a14e483eddb264c5e59565b956348da' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"myorg:widget","children":[{"type":"itlaic"}]}]}', 'Opaque Extension Subtree'),
    ),
    expect: ignoreOnly('CDX-E-BLOCK-TYPE-UNKNOWN-NAMESPACED'),
  },
  {
    name: 'warn-block-nonarray-children',
    description: 'A known `paragraph` whose `children` is an object, not an array — a structural malformation that JSON Schema would reject and that would otherwise hide its contents from the type walk. Flagged as a malformed known block: WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:2e1fb536617d5e520507e11582ec3b8240377673c8767c81ce725844dc219be2' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":{"0":{"type":"text","value":"x"}}}]}', 'Non-array Children'),
    ),
    expect: warnOnly('CDX-E-BLOCK-MALFORMED'),
  },
  {
    name: 'reject-block-type-in-caption',
    description: 'A bare (unknown, non-namespaced) block type placed in a figure `caption` array — a rich-text (textNode) position the walk must also classify. The misspelled type REJECTs, exactly as it does under `children`.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:b74d7560c2fb7592727791964d219e51f004ecc0a8a5ba5be8f6acd2abe50fd0' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"figure","children":[{"type":"image","src":"a.png","alt":"x"}],"caption":[{"type":"evilcaption"}]}]}', 'Bare Type In Caption'),
    ),
    expect: rejectOnly('CDX-E-BLOCK-TYPE-UNKNOWN-BARE'),
  },
  {
    name: 'reject-block-type-unknown-bare-nested',
    description: 'A bare block type nested inside a KNOWN block (a `blockquote`). The walk descends into a recognized block and rejects the misspelled child — REJECT.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:642955b7630466c440cfb803eef7496f730be6f93fcdc7193f01de59170ed354' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"blockquote","children":[{"type":"paragrph","children":[{"type":"text","value":"x"}]}]}]}', 'Nested Bare Block'),
    ),
    expect: rejectOnly('CDX-E-BLOCK-TYPE-UNKNOWN-BARE'),
  },
  {
    name: 'reject-block-type-missing',
    description: 'A block object with no `type` field. With no type to classify and no namespace to defer rendering to, it is an unrecognized bare block — REJECT (fail closed).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:fbb5677d9b644ea1f9b4a557812809455617731c9551757ac1493a775c16b210' } }),
      contentBody('{"version":"0.1","blocks":[{"children":[{"type":"text","value":"x"}]}]}', 'Missing Block Type'),
    ),
    expect: rejectOnly('CDX-E-BLOCK-TYPE-UNKNOWN-BARE'),
  },
  {
    name: 'reject-block-position-non-object',
    description: 'A non-object (null) in a block position. It is neither renderable nor deferrable to an extension — REJECT (fail closed).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:e1205e2ff7e4f3de354313255ba7c2ca246c2d1bf8f1f4957e8f3f9aa7057d6d' } }),
      contentBody('{"version":"0.1","blocks":[null]}', 'Non-object Block Position'),
    ),
    expect: rejectOnly('CDX-E-BLOCK-TYPE-UNKNOWN-BARE'),
  },
  {
    name: 'warn-block-figure-cardinality',
    description: 'A known `figure` with two content children (and no caption) violates figure cardinality (exactly one content block) — a malformed known block, WARNING in draft/review. Exercises the cardinality arm of checkBlock (the containment arm is `warn-block-malformed-known`).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:974e130f7f651fa0bd0b51638b0274ea881ab36f2a3b00bf39d1b8cec3a252b7' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"figure","children":[{"type":"image","src":"a.png","alt":"x"},{"type":"image","src":"b.png","alt":"y"}]}]}', 'Figure Cardinality'),
    ),
    expect: warnOnly('CDX-E-BLOCK-MALFORMED'),
  },
  {
    name: 'warn-block-nonarray-caption',
    description: 'A known `figure` whose `caption` is an object, not the schema-permitted string or textNode array — a malformed container that would also hide its contents from the walk (the `caption` counterpart of `warn-block-nonarray-children`). WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:2d0378ac8c4530e4ef91c228452fdc79d77d5be37f5f09f01857f6053013e96f' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"figure","children":[{"type":"image","src":"a.png","alt":"x"}],"caption":{"0":{"type":"text","value":"cap"}}}]}', 'Non-array Caption'),
    ),
    expect: warnOnly('CDX-E-BLOCK-MALFORMED'),
  },
  {
    name: 'warn-block-subfigure-non-object',
    description: 'A known `figure` whose `subfigures` array contains a non-object element — a malformed figure structure JSON Schema would reject. WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:0d5d6ba72d84d57500b12077365e93c115d2e808cf974de20042855bf79452aa' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"figure","subfigures":[42]}]}', 'Non-object Subfigure'),
    ),
    expect: warnOnly('CDX-E-BLOCK-MALFORMED'),
  },
  {
    name: 'warn-subfigure-nonarray-children',
    description: 'A `subfigure` object whose own `children` is not an array. The container-shape check reaches inside subfigures — the one intermediate container that holds node-bearing arrays — so a wrong-shape subfigure interior is flagged (WARNING) rather than silently hiding its contents from the walk.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:1f7efb40193671d6165728049f33cf4e482fb6a45dbd30852b35abb543b409e0' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"figure","subfigures":[{"children":{"0":{"type":"text","value":"x"}}}]}]}', 'Non-array Subfigure Children'),
    ),
    expect: warnOnly('CDX-E-BLOCK-MALFORMED'),
  },
  {
    name: 'reject-mark-type-unknown-bare-object',
    description: 'An unknown, non-namespaced mark in TYPED-OBJECT form (`{type:"xyz"}`). Symmetric with the bare-string form — the object path must REJECT too, not silently tolerate.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:4c6ba7a0ca09e99ac9b96e650977f7c7d44f029afe0ae42215d3d249f31475b9' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":[{"type":"xyz"}]}]}]}', 'Bare Object Mark'),
    ),
    expect: rejectOnly('CDX-E-MARK-TYPE-UNKNOWN-BARE'),
  },
  {
    name: 'warn-mark-string-as-object',
    description: 'A core string mark (`bold`) carried as an object `{type:"bold"}`. A core mark is valid only as a bare string, so the object form is a structurally malformed known mark — WARNING.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:484382880d4666b2e49af6e3209ae872070e02c2c19baf6eab33049f1d75df8d' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":[{"type":"bold"}]}]}]}', 'String Mark As Object'),
    ),
    expect: warnOnly('CDX-E-MARK-MALFORMED'),
  },
  {
    name: 'warn-mark-structured-as-string',
    description: 'A structured mark (`link`) used as a bare string `"link"`. A structured mark must be an object with its fields, so the bare-string form is a malformed known mark — WARNING.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:9a0844671123e098b30104026e9d81f8dc2933bf879d8e4cb38cbc2b35c82731' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":["link"]}]}]}', 'Structured Mark As String'),
    ),
    expect: warnOnly('CDX-E-MARK-MALFORMED'),
  },
  {
    name: 'warn-mark-anchor-no-id',
    description: 'A known `anchor` mark object missing its required `id` field — a structurally malformed known mark, WARNING. Exercises the `anchor` arm of the mark field check (link is covered by `warn-mark-malformed-known`).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:c607713eeb103305f721b6aac157244adc3919fc604ccb3572ae7db72caa817d' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":[{"type":"anchor"}]}]}]}', 'Anchor Missing Id'),
    ),
    expect: warnOnly('CDX-E-MARK-MALFORMED'),
  },
  {
    name: 'warn-mark-math-incomplete',
    description: 'A known `math` mark object with `format` but no `source` — missing a required field, a malformed known mark, WARNING. Exercises the `math` arm of the mark field check.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 5.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:b892360d7fe7c68d4fecd6a261903212cb4349059dcc14572a8887c05cdc2870' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":[{"type":"math","format":"latex"}]}]}]}', 'Math Missing Source'),
    ),
    expect: warnOnly('CDX-E-MARK-MALFORMED'),
  },

  // ===========================================================================
  // Document/part layer (B1b-3a, Tier 3 part 1): "declared vs computed" — the
  // §5.4.2 "File `hash` or document-ID mismatch" row (draft/review WARNING column).
  // The file-level content.hash is verified against the exact stored content bytes
  // (Document Hashing §5.1), and — for a document carrying a real (non-pending) id —
  // the canonical document ID is recomputed and compared to manifest.id (§4.4/§6.3).
  // The FROZEN/PUBLISHED INTEGRITY-ERROR escalation (state-keyed, §6.3) needs a
  // projection-covering signature (§5.4.2 note 3) and arrives in B3; the asset-index
  // and presentation-file hash rows arrive in B1b-3b. Content is transform-trivial
  // (empty blocks) so the id math is verifiable by the independent oracle.
  // ===========================================================================
  {
    name: 'warn-file-hash-mismatch',
    description: 'A draft whose content part is well-formed but whose declared `content.hash` does not match the stored content bytes (one hex digit flipped) — the file hash pins the exact stored bytes (Document Hashing §5.1), so a mismatch is a WARNING in draft/review. Draft ⇒ id is `pending`, so only the file-hash finding fires. (FROZEN/PUBLISHED escalation to INTEGRITY-ERROR is deferred to B3.)',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 5.1, 6.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:5d69e5acc01e8b76df35531f9199eda7f594a972eec7d5718071842062fb39cd' } }),
      cleanBody('File Hash Mismatch'),
    ),
    expect: warnOnly('CDX-E-FILE-HASH-MISMATCH'),
  },
  {
    name: 'warn-document-id-mismatch-metadata',
    description: 'A review document whose declared `manifest.id` was computed over the title "Minimal Review", but whose Dublin Core title is now "Edited Title" — the metadata projects into the document ID (Document Hashing §4.3.1), so the recomputed id no longer matches the declared one. Models metadata edited after the id was fixed. The `content.hash` is correct, so only the document-ID finding fires — WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.4, 6.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ id: 'sha256:34d8f862fc561be2e9ca4fe379103ab525dd83e97191fed53ff05be3a3355793', state: 'review' }),
      cleanBody('Edited Title'),
    ),
    expect: warnOnly('CDX-E-DOCUMENT-ID-MISMATCH'),
  },
  {
    name: 'warn-document-id-mismatch-content',
    description: 'A review document whose stored content differs from the content its declared `manifest.id` was computed over (content `version` 0.2 vs the 0.1 basis) — the content is part of the canonical hash, so the recomputed id differs. The `content.hash` correctly pins the stored (0.2) bytes, so the file hash is clean and only the document-ID finding fires. Proves the recompute reads the content, not just the metadata. WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.4, 6.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:34d8f862fc561be2e9ca4fe379103ab525dd83e97191fed53ff05be3a3355793',
        state: 'review',
        content: { path: 'content/document.json', hash: 'sha256:30d5a3dc35063023dc212e6cf97d00232f8eb9d2764aaad2946098ce06d09f80' },
      }),
      contentBody('{"version":"0.2","blocks":[]}', 'Minimal Review'),
    ),
    expect: warnOnly('CDX-E-DOCUMENT-ID-MISMATCH'),
  },
  {
    name: 'warn-file-and-id-mismatch',
    description: 'A review document with BOTH a wrong `content.hash` (one hex digit flipped) AND a wrong `manifest.id` (one hex digit flipped) over otherwise-valid content and metadata. Both the file-hash and document-ID checks fire; the document-level disposition is the max over the two WARNINGs (WARNING). Exercises the multi-finding composition path — both findings must be independently confirmed by the oracle.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.4, 5.1, 6.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:34d8f862fc561be2e9ca4fe379103ab525dd83e97191fed53ff05be3a335579c',
        state: 'review',
        content: { path: 'content/document.json', hash: 'sha256:5d69e5acc01e8b76df35531f9199eda7f594a972eec7d5718071842062fb39cd' },
      }),
      cleanBody('Minimal Review'),
    ),
    expect: {
      documentDisposition: { atLeast: 'WARNING', atMost: 'WARNING' },
      findings: [
        { code: 'CDX-E-FILE-HASH-MISMATCH', atLeast: 'WARNING', atMost: 'WARNING' },
        { code: 'CDX-E-DOCUMENT-ID-MISMATCH', atLeast: 'WARNING', atMost: 'WARNING' },
      ],
    },
  },

  // ===========================================================================
  // Document/part layer (B1b-3b-1, Tier 3 part 2): required-metadata presence, the
  // path-only referenced-part row, and reference resolution over the content tree and
  // the out-of-hash annotation layers. Every case is a DRAFT, so `id` is `pending` and
  // no document-ID recompute runs — each fixture isolates exactly one row. The
  // FROZEN/PUBLISHED INTEGRITY-ERROR escalations for the metadata and core-anchor rows
  // are state-keyed and arrive in B3; the rows that are WARNING in every state
  // (path-only part, extension cross-reference, out-of-hash anchor and data part) are
  // already at their final disposition here. Each `content.hash` is the real SHA-256 of
  // the content bytes.
  // ===========================================================================

  // --- required metadata: the Dublin Core part and its terms (§5.4.2) ---------
  {
    name: 'reject-metadata-unreferenced',
    description: 'The manifest declares no `metadata` object at all. `metadata` is a required manifest field and `metadata.dublinCore` is required within it, so the manifest is missing a required field — §5.4.2\'s manifest row, REJECT in every state, exactly as an absent `content` would be. The erratum settled this: §5.4.2\'s metadata row is explicitly PART-level (a Dublin Core part referenced but absent or unparseable, or a missing required term) and does not reach an absent FIELD. The sibling `reject-metadata-reference-malformed` pins the MISTYPED arm and `warn-metadata-part-missing` the referenced-but-absent part, which keeps its WARNING. The content also carries a dangling `#nope` anchor, and the SECOND expected finding is the point: a REJECT must not short-circuit the passes that follow it, and a case expecting one finding could not tell whether they ran.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.11; Metadata sections 3.3.1, 3.3.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        metadata: undefined,
        content: { path: 'content/document.json', hash: 'sha256:ec454fc0d085d72cc6491e44f043199197a9bad16b0ad531d2fd956976e68b57' },
      }),
      [
        {
          name: 'content/document.json',
          text: '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#nope"}]}]}]}',
        },
      ],
    ),
    // An exact pin, not an interval: the row assigns REJECT in both columns, so there is
    // no open reading left to foreclose.
    //
    // THE DANGLING ANCHOR IS LOAD-BEARING, not incidental colour. A REJECT arm that
    // early-returned would report the manifest defect and silently stop — no classifier,
    // no reference resolution, no id recompute — and with only one expected finding the
    // subset comparator could not see the difference. Expecting a SECOND finding from a
    // later pass is what makes the no-early-return rule observable: mutation-tested, and
    // an added `return` turns this case red.
    expect: {
      documentDisposition: { atLeast: 'REJECT', atMost: 'REJECT' },
      findings: [
        { code: 'CDX-E-MANIFEST-FIELD-MISSING', atLeast: 'REJECT', atMost: 'REJECT' },
        { code: 'CDX-E-ANCHOR-DANGLING', atLeast: 'WARNING', atMost: 'WARNING' },
      ],
    },
  },
  {
    name: 'warn-metadata-part-missing',
    description: 'The manifest references `metadata/dublin-core.json`, but the archive carries no such entry. Distinct from `reject-metadata-unreferenced` above, and the distinction is the whole point of the erratum that split them: here the document DECLARES metadata and does not ship it, which is a part-level defect and a WARNING in draft/review, whereas declaring none at all is a malformed manifest and a REJECT. The id basis is also different — INDETERMINATE here (the id was computed over the real terms) rather than empty.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Metadata section 3.3; Container Format section 3.3.1; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), [{ name: 'content/document.json', text: CLEAN_CONTENT }]),
    expect: warnOnly('CDX-E-METADATA-PART-MISSING'),
  },
  {
    name: 'warn-metadata-part-unparseable',
    description: 'The Dublin Core part is present but truncated mid-object, so it is not well-formed JSON. A syntax error, NOT a duplicate key — a duplicate key in any part is the state-invariant REJECT (§5.4.3), a different row. WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Metadata section 3; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), [
      { name: 'content/document.json', text: CLEAN_CONTENT },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"Truncated","creator":"A. Author"' },
    ]),
    expect: warnOnly('CDX-E-METADATA-PART-UNPARSEABLE'),
  },
  {
    name: 'warn-metadata-term-missing',
    description: 'The Dublin Core part parses and carries `title`, but omits `creator` — a term Metadata §3.3.2 requires to have at least one value. The part still loads, so the document ID remains computable and is verified normally; only the metadata is deficient. WARNING in draft/review.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Metadata section 3.3.2; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), [
      { name: 'content/document.json', text: CLEAN_CONTENT },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"No Creator"}}' },
    ]),
    expect: warnOnly('CDX-E-METADATA-TERM-MISSING'),
  },

  // --- a path-only manifest reference whose target is absent (§5.4.2) --------
  {
    name: 'warn-provenance-part-missing',
    description: 'The manifest references a provenance record by path, and the archive does not contain it. A path-only reference carries no hash, so the target is bound by neither the document hash nor the manifest projection — its absence degrades a layer and can never signal tampering, making this a WARNING in EVERY state (not a deferred escalation).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Security Extension section 9.8; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ provenance: 'provenance/record.json' }), cleanBody('Missing Provenance')),
    expect: warnOnly('CDX-E-PART-MISSING-UNBOUND'),
  },
  {
    name: 'warn-phantoms-part-missing',
    description: 'The manifest declares a phantom clusters file by path and the archive omits it — the same state-invariant row as the provenance case, reached through a different manifest shape (a nested `phantoms.clusters` reference rather than a top-level string). Pins that the row is driven by the path-only reference SET, not by one hard-coded field.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Security Extension section 9.8; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ phantoms: { clusters: 'phantoms/clusters.json' } }), cleanBody('Missing Phantoms')),
    expect: warnOnly('CDX-E-PART-MISSING-UNBOUND'),
  },

  // --- reference resolution over hashed content (§5.4.2) ---------------------
  {
    name: 'warn-anchor-dangling',
    description: 'A `link` mark whose `href` is the Content Anchor URI `#nope`, which names no block or anchor id in the document. A core anchor is part of the document\'s addressing layer, so a dangling one is an internal-consistency failure of signed content — WARNING in draft/review, escalating to INTEGRITY-ERROR once frozen (Anchors & References §7.2; deferred to B3).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 2.1, 7.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:ec454fc0d085d72cc6491e44f043199197a9bad16b0ad531d2fd956976e68b57' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#nope"}]}]}]}', 'Dangling Anchor'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-DANGLING'),
  },
  {
    name: 'warn-block-reference-dangling',
    description: 'A `semantic:ref` block whose `target` Content Anchor URI resolves to nothing. Carried under the same §5.4.2 row as a dangling core anchor but under its OWN code, because whether an extension block\'s target field is a core anchor or an extension cross-reference is contested (§5.4.2\'s carve-out names only marks; Anchors & References §11 groups these blocks with the cross-reference mechanisms). Draft/review is WARNING either way; the separate code lets B3 settle the frozen column without re-pointing a published code.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 7.2, 11; Document Hashing section 4.3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:ccefa96dd9bc46e17bf8b963f4b984f3e12116318238a6c8fe4797f92b44ab17' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"semantic:ref","target":"#nope"}]}', 'Dangling Block Reference'),
    ),
    expect: warnOnly('CDX-E-BLOCK-REFERENCE-DANGLING'),
  },
  {
    name: 'warn-cross-reference-dangling',
    description: 'An `academic:equation-ref` mark whose `target` names no equation line. An extension cross-reference is resolved at render time to inject a label or number, so a dangling one degrades rendering only — the signed bytes remain intact and hash-verified — making this WARNING in EVERY state. The contrast with `warn-anchor-dangling` (same namespace, escalating row) is the point of the pair.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 11; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:d84f55d6447fee69cfdb60461972f8cd2e8303fb18ebe3472a64735729cefd0a' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"academic:equation-ref","target":"#nope"}]}]}]}', 'Dangling Cross Reference'),
    ),
    expect: warnOnly('CDX-E-CROSS-REFERENCE-DANGLING'),
  },
  {
    name: 'integrity-error-id-collision',
    description: 'Two paragraph blocks share the id `dup`. The block/anchor/equation-line/subfigure ids form ONE namespace requiring uniqueness, so a collision makes every reference to that id ambiguous — an Error in ALL states (Anchors & References §7.2), which §5.4.2 maps onto INTEGRITY-ERROR. The only INTEGRITY-ERROR this layer can assign before B2/B3, precisely because it does not vary by state. Authored [INTEGRITY-ERROR, REJECT]: INTEGRITY-ERROR is a floor with MAY-escalation to refusal (§5.4.1), so a reader that refuses the document is equally conformant.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 4, 7.2; Document Hashing section 4.3.1; State Machine sections 5.4.1, 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:a16151e8c123fea0a4e8d10c782f33d48a18dd41112bfee4a0e2061d45b7a932' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"dup","children":[]},{"type":"paragraph","id":"dup","children":[]}]}', 'Id Collision'),
    ),
    expect: {
      documentDisposition: { atLeast: 'INTEGRITY-ERROR', atMost: 'REJECT' },
      findings: [{ code: 'CDX-E-ID-COLLISION', atLeast: 'INTEGRITY-ERROR', atMost: 'REJECT' }],
    },
  },

  // --- out-of-hash annotation layers (§5.4.2, state-invariant) ---------------
  {
    name: 'warn-annotation-anchor-dangling',
    description: 'A core annotations file anchors a comment at block `gone`, which the content does not define. The annotation layer is bound by neither the document hash nor the manifest projection, so a dangling anchor cannot signal tampering with signed content — WARNING in every state. Resolved only at the anchor position the schema declares; a generic sweep would false-positive on layers that legitimately carry their own content trees.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 7.2; State Machine sections 5.4.2, 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:d2da00ccb856ddd6dffab5b12df723d8899316fdde8185bef09f30f901f61acc' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"x"}]}]}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Dangling Annotation') },
        { name: 'security/annotations.json', text: '{"version":"0.1","annotations":[{"id":"a1","type":"comment","anchor":{"blockId":"gone"},"author":{"name":"A"},"created":"2025-01-10T08:00:00Z","content":"stale"}]}' },
      ],
    ),
    expect: warnOnly('CDX-E-ANNOTATION-ANCHOR-DANGLING'),
  },
  {
    name: 'warn-extension-data-part-unparseable',
    description: 'A collaboration comments file is present but is not well-formed JSON. Out-of-hash extension data sits in no signature scope, so the extensions overview states directly that a missing or unparseable such part is a WARNING in all states and MUST NOT be reported as an integrity error. Restricted to the conventional out-of-hash locations: an unrecognized file elsewhere in the archive stays IGNORE.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Extensions overview (Integrity Status of Extension Data); State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), [
      { name: 'content/document.json', text: CLEAN_CONTENT },
      { name: 'metadata/dublin-core.json', text: dublinCoreJson('Bad Collaboration Data') },
      { name: 'collaboration/comments.json', text: '{"version":"0.2","comments":[{"id":"c1"' },
    ]),
    expect: warnOnly('CDX-E-EXTENSION-DATA-PART-UNPARSEABLE'),
  },

  // --- positives: the resolver must not fire on a well-formed document -------
  {
    name: 'positive-resolved-references',
    description: 'Every reference resolves: a `link` href to a heading block id, a second `link` href to an `anchor` MARK id, an `academic:equation-ref` to an equation LINE id, and a `semantic:ref` target to the heading. Exercises all three id-namespace members a reference can address (block, anchor mark, equation line) across all three dangling codes — a resolver that collected only block ids, or that skipped any reference field, would emit a spurious WARNING and fail this case. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 4, 2.1; Document Hashing section 4.3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:c6b9a2dc816621aaca93f05c78698f483f591de620c7b3de7dccea1d01d6c0a8' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"heading","id":"intro","level":1,"children":[{"type":"text","value":"Title"}]},{"type":"academic:equation-group","id":"eqg","lines":[{"value":"a=b","id":"eq1"}]},{"type":"paragraph","children":[{"type":"text","value":"see ","marks":[{"type":"link","href":"#intro"}]},{"type":"text","value":"here","marks":[{"type":"anchor","id":"mark1"}]},{"type":"text","value":" and ","marks":[{"type":"academic:equation-ref","target":"#eq1"}]},{"type":"text","value":"back","marks":[{"type":"link","href":"#mark1"}]}]},{"type":"semantic:ref","target":"#intro"}]}', 'Resolved References'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-annotation-anchor-resolved',
    description: 'A core annotations file whose comment anchors at a block the content does define. The positive control for the out-of-hash anchor row: a reader that resolved annotation anchors against the wrong namespace, or failed to resolve them at all in the clean direction, would emit a spurious WARNING here. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 7.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:d2da00ccb856ddd6dffab5b12df723d8899316fdde8185bef09f30f901f61acc' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"x"}]}]}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Resolved Annotation') },
        { name: 'security/annotations.json', text: '{"version":"0.1","annotations":[{"id":"a1","type":"comment","anchor":{"blockId":"p1"},"author":{"name":"A"},"created":"2025-01-10T08:00:00Z","content":"ok"}]}' },
      ],
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-crdt-id-not-in-namespace',
    description: 'A paragraph carrying id `p` AND a `crdt` sync payload that itself contains a block with id `p`. Canonicalization strips `crdt` from every typed node before relabeling (Document Hashing §4.3.1 item 1 / §4.1a), so the payload\'s id is not in the shared namespace and there is NO collision — the document canonicalizes and its id computes. Pins that the resolver applies the canonicalizer\'s own erasures when walking RAW stored content: a resolver that walked raw content naively would report CDX-E-ID-COLLISION here, the harshest disposition this layer assigns, on a document every other check accepts. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.1a, 4.3.1; Anchors and References section 4; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:0c4510c6e8fcf757b95f33e5ae1854d54a26a7f0b182c366bdf30630d3e04dee' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p","crdt":{"blocks":[{"type":"paragraph","id":"p"}]},"children":[]}]}', 'Crdt Id Not In Namespace'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-adjacent-text-merge-no-collision',
    description: 'Two ADJACENT text nodes carrying the byte-identical `anchor` mark `x`. Canonicalization merges adjacent merge-eligible text nodes with equal mark sets (Document Hashing §4.3.1 item 4) BEFORE checking id uniqueness, so the absorbed node\'s mark — and its id — cease to exist and there is exactly one `x`. The document canonicalizes and its id computes, so a resolver that walked raw content without reproducing the merge would report CDX-E-ID-COLLISION (INTEGRITY-ERROR, state-invariant, the harshest disposition this layer assigns) on a document every other check accepts. The `warn`-side controls are the separated and differing-marks cases, which do NOT merge and are genuine collisions. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1; Anchors and References sections 4, 7.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:42f6b4821a1370b11d5fd77c5d268ac1e9ec34d0bd33800e56fe226e40aa6b58' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a","marks":[{"type":"anchor","id":"x"}]},{"type":"text","value":"b","marks":[{"type":"anchor","id":"x"}]}]}]}', 'Adjacent Text Merge'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-crdt-in-mark-survives',
    description: 'A `crdt` payload carried ON a text node\'s `anchor` mark, holding a block with id `ghost`, and a `semantic:ref` targeting `#ghost`. Canonicalization strips `crdt` only where it RECURSES, and it deliberately does not recurse into a text node\'s `marks` (they are final after normalization) — so this payload SURVIVES, its id is relabelled, and the reference resolves. The mirror image of `positive-crdt-id-not-in-namespace`: there the payload sits on a block and is stripped. A resolver that erased derived fields everywhere would make the raw namespace a strict SUBSET of the canonical one and report a spurious dangling reference here. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.1a, 4.3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:fb892ccdd88d6e8af876b86b7230b19b30fc9764f3f98ba3376a7384026a4c4d' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p","children":[{"type":"text","value":"v","marks":[{"type":"anchor","id":"a","crdt":{"type":"paragraph","id":"ghost"}}]}]},{"type":"semantic:ref","id":"r","target":"#ghost"}]}', 'Crdt In Mark Survives'),
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-metadata-term-malformed',
    description: 'The Dublin Core part carries a well-formed `title` and `creator` but a `subject` of the wrong type (a number). The metadata projection REJECTS a malformed term rather than dropping it (Document Hashing §4.3.1), so the metadata cannot be projected and the document-ID basis is indeterminate — reported as an unusable metadata part. Without this arm one malformed ADVISORY term would silently disable the document-ID check while the document still loaded clean: an integrity check switched off by a field that does not even enter the required set.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1; Metadata section 3.3; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson(), [
      { name: 'content/document.json', text: CLEAN_CONTENT },
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"Malformed Term","creator":"A. Author","subject":42}}' },
    ]),
    expect: warnOnly('CDX-E-METADATA-PART-UNPARSEABLE'),
  },
  {
    name: 'reject-metadata-reference-malformed',
    description: 'The manifest declares `metadata.dublinCore` as an OBJECT rather than a path string. `metadata` and its `dublinCore` member are both required manifest fields, so a mistyped one is §5.4.2\'s "manifest ... missing or MISTYPING a required field" — REJECT, not the missing-metadata WARNING. The distinction matters: without it, replacing the path with an object downgrades a REJECT to a WARNING and silently switches the document-ID recompute onto an empty-metadata basis.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.11; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ metadata: { dublinCore: { path: 'metadata/dublin-core.json' } } }), cleanBody('Mistyped Reference')),
    expect: rejectOnly('CDX-E-MANIFEST-REFERENCE-MALFORMED'),
  },
  {
    name: 'reject-declared-part-duplicate-keys',
    description: 'A manifest-declared out-of-hash side file (`metadata.jsonld`) at a path that does NOT end in `.json`, containing a duplicate key. §5.4.3 rejects a duplicate key in ANY part in EVERY state — the split-view substitution vector — and nothing obliges a part to be named `.json` (the relative-path form permits any name). A duplicate-key sweep keyed only on the extension would let this part load clean, so the sweep covers every manifest-declared part path as well.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(manifestJson({ metadata: { dublinCore: 'metadata/dublin-core.json', jsonld: 'metadata/doc.jsonld' } }), [
      ...cleanBody('Declared Part Duplicate Keys'),
      { name: 'metadata/doc.jsonld', text: '{"@context":"a","@context":"b"}' },
    ]),
    expect: rejectOnly('CDX-E-PART-DUPLICATE-KEYS'),
  },
  {
    name: 'warn-custom-metadata-part-missing',
    description: 'The manifest declares a custom metadata reference (`metadata.custom.notes`) whose target the archive omits. `metadata.custom` is an open map of path-only references, so its values bind nothing exactly as `provenance` and `metadata.jsonld` do — a sweep enumerating only the NAMED path-only fields would let a whole reference family escape both the missing-part row and the duplicate-key sweep. WARNING in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Manifest section 4.11; Security Extension section 9.8; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ metadata: { dublinCore: 'metadata/dublin-core.json', custom: { notes: 'metadata/notes.json' } } }),
      cleanBody('Missing Custom Metadata'),
    ),
    expect: warnOnly('CDX-E-PART-MISSING-UNBOUND'),
  },
  {
    name: 'positive-non-annotation-part-not-anchor-resolved',
    description: 'A provenance record — a path-only referenced part, but NOT an annotation layer — that happens to carry a top-level `changes` array whose entries look anchor-shaped. Only the layers whose schemas DECLARE a ContentAnchor position anchor into content, so this must not be read as one: resolving anchors in every path-only part would report a dangling anchor for a `changes` array that means something else entirely. The part is well-formed, so the unparseable row stays silent too. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 7.2; State Machine sections 5.4.2, 5.4.3',
    recipe: documentArchive(manifestJson({ provenance: 'provenance/record.json' }), [
      ...cleanBody('Non Annotation Part'),
      { name: 'provenance/record.json', text: '{"version":"0.1","changes":[{"anchor":{"blockId":"not-a-content-id"}}]}' },
    ]),
    expect: CLEAN,
  },
  {
    name: 'warn-provenance-part-unparseable',
    description: 'The manifest declares a provenance record by path and the archive ships it corrupt. The same out-of-hash row as a bad collaboration file, reached through a manifest-declared path rather than a conventional directory: a path-only reference binds nothing, so a corrupt target is a WARNING in every state. Pins the symmetry — covering only a MISSING path-only part while staying silent on a CORRUPT one would report the milder defect and ignore the worse.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Extensions overview (Integrity Status of Extension Data); Security Extension section 9.8; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ provenance: 'provenance/record.json' }), [
      ...cleanBody('Corrupt Provenance'),
      { name: 'provenance/record.json', text: '{"version":"0.1","events":[' },
    ]),
    expect: warnOnly('CDX-E-EXTENSION-DATA-PART-UNPARSEABLE'),
  },

  // ===========================================================================
  // Document/part layer (B1b-3b-2, Tier 3 part 3): the hash-BOUND material
  // outside the content part — asset categories, presentation layers, and the
  // extension config-slot side files, plus the reference rows that resolve
  // against them (§5.4.2). Every FROZEN/PUBLISHED escalation is B3.
  // ===========================================================================

  // --- assets: the positives -------------------------------------------------
  {
    name: 'positive-asset-resolved',
    description: 'A review document with one registered image asset: the index sits at the DERIVED path `assets/images/index.json` and matches the manifest\'s declared index hash, the asset\'s stored bytes match its hash in the index, the content `image` block resolves against it, and the declared `manifest.id` is the id recomputed WITH the asset index in the basis (Document Hashing §4.3.1 item 2 replaces the reference with the asset\'s hash). The positive control for the whole asset chain, and specifically for the `assetIndexes` wiring: before B1b-3b-2 the recompute passed no index, so `buildAssetMap` threw and every asset-bearing document silently skipped its id check — a reader with that gap computes a different id here and fails. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding sections 3.1, 3.2, 8.1; Document Hashing section 4.3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:17e034cf9f7b30d0cdc00f3638fac6fe503c98ec0fd985bb2475fcfffb36ac3e',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Asset Document'),
        { name: 'assets/images/index.json', text: INDEX_ONE },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-asset-variant-resolved',
    description: 'An asset carrying an image variant, both present and both matching their own hashes in the index (Asset Embedding §8.1 verifies the index file, the top-level asset AND each variant). The positive control for the variant arm: a reader that verified only the parent asset would still pass a swapped variant, which is what §4.3 warns about — the variant, not the parent, is what a viewer actually sees. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding sections 4.3, 8.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:7dad350905c46c6a780e43e6fe47d2e0473144d55dea618d5f3ac492f7a1f718',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_VARIANT_HASH, 1, 124),
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Variant Document'),
        { name: 'assets/images/index.json', text: INDEX_VARIANT },
        { name: 'assets/images/fig1.svg', text: FIG1 },
        { name: 'assets/images/fig1-4.svg', text: FIG1_SMALL },
      ],
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-aliased-assets-merge',
    description: 'Two adjacent text nodes carry the SAME `anchor` id and link to two different asset PATHS whose index entries declare the same hash. (Both copies are stored here; Asset Embedding §10.2\'s `aliasOf` deduplication hint is a separate case.) `normalizeMarks` resolves each href to the asset hash BEFORE `mergeAdjacentText` compares mark sets, so the resolved marks are equal, the nodes merge, and the shared anchor id is ONE id — not a collision. A reader whose raw content walk resolved hrefs to anything other than the asset hash (leaving the paths distinct) would report a spurious CDX-E-ID-COLLISION, an INTEGRITY-ERROR on a document the canonicalizer accepts. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1 items 2-4; Asset Embedding section 10.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:ab82e1d5fa6448db1a098085603391f86c15d5e1e52245d2e264aca7756751e2',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_ALIASED_LINKS_HASH },
        assets: imagesCategory(INDEX_ALIAS_HASH, 2, 124),
      }),
      [
        ...contentBody(CONTENT_ALIASED_LINKS, 'Aliased Assets'),
        { name: 'assets/images/index.json', text: INDEX_ALIAS },
        { name: 'assets/images/fig1.svg', text: FIG1 },
        { name: 'assets/images/fig1-copy.svg', text: FIG1 },
      ],
    ),
    expect: CLEAN,
  },

  // --- assets: the defect rows -----------------------------------------------
  {
    name: 'integrity-error-id-collision-distinct-assets',
    description: 'Two adjacent text nodes carry the SAME `anchor` id and link to two DIFFERENT assets. Their hrefs resolve to different hashes, so the mark sets differ, the nodes do NOT merge, and both `anchor` marks survive into the shared identifier namespace — a duplicate id, an Error in every state (Anchors and References §7.2). The exact counterpart of positive-aliased-assets-merge, and the case a reader that cannot resolve asset references MISSES: keying every packaged-asset href alike over-merges the two nodes and hides this collision entirely. Authored as an interval because INTEGRITY-ERROR is a floor with MAY-escalation (§5.4.1).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 7.2; Document Hashing section 4.3.1 items 2-5; State Machine sections 5.4.1, 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_DISTINCT_LINKS_HASH },
        assets: imagesCategory(INDEX_TWO_HASH, 2, 124),
      }),
      [
        ...contentBody(CONTENT_DISTINCT_LINKS, 'Distinct Asset Links'),
        { name: 'assets/images/index.json', text: INDEX_TWO },
        { name: 'assets/images/fig1.svg', text: FIG1 },
        { name: 'assets/images/fig2.svg', text: FIG2 },
      ],
    ),
    expect: {
      documentDisposition: { atLeast: 'INTEGRITY-ERROR', atMost: 'REJECT' },
      findings: [{ code: 'CDX-E-ID-COLLISION', atLeast: 'INTEGRITY-ERROR', atMost: 'REJECT' }],
    },
  },
  {
    name: 'warn-asset-index-missing',
    description: 'The manifest declares an `images` asset category but the archive ships no `assets/images/index.json`. The index is bound by the manifest projection (Security Extension §9.7), so its absence is the hash-BOUND missing-part row — WARNING in draft/review. The content still references an asset, and the reader must NOT also report that reference dangling: with the index unloadable the category is INDETERMINATE, and fanning one missing index out into a finding per reference would claim defects the document may not have.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding section 3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [...contentBody(CONTENT_IMAGE, 'Asset Index Missing'), { name: 'assets/images/fig1.svg', text: FIG1 }],
    ),
    expect: warnOnly('CDX-E-PART-MISSING-BOUND'),
  },
  {
    name: 'reject-asset-index-path-divergent',
    description: 'The manifest declares `assets.images.index` as `assets/images/catalog.json` while the index actually sits at the derived location `assets/images/index.json`. 05 §3.1 states the equality as a MUST, and the erratum gave it a §5.4.2 row: REJECT in both columns. Before the erratum §3.1 resolved the disagreement itself ("the derived path governs"), which left the document loadable, gave the defect no disposition, and so left this case UNTESTABLE as a fixture — a null-disposition code cannot be asserted through the comparator at all, so `test-document-verdict.ts` carried its only coverage. What the REJECT closes is a split between identity and attestation: the manifest projection binds the DECLARED path\'s hash (Security Extension §9.7) while the document ID is computed from the DERIVED path\'s bytes (§4.3.1 item 2 builds every asset path from the category key), so a signature would attest one file while identity depended on another. The index and the asset it lists are both present and intact — nothing here is missing or corrupt; the divergence alone is the defect.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding section 3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: { images: { count: 1, totalSize: 62, index: 'assets/images/catalog.json', hash: INDEX_ONE_HASH } },
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Divergent Asset Index'),
        { name: 'assets/images/index.json', text: INDEX_ONE },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: {
      documentDisposition: { atLeast: 'REJECT', atMost: 'REJECT' },
      findings: [{ code: 'CDX-E-ASSET-INDEX-PATH-DIVERGENT', atLeast: 'REJECT', atMost: 'REJECT' }],
    },
  },
  {
    name: 'warn-asset-index-unusable',
    description: 'The index file is present and parses, but carries no `assets` array. `buildAssetMap` SKIPS such a category without throwing, so a reader relying on the canonicalizer to surface the problem gets an empty asset map that nothing notices — the quiet failure this row exists to make loud. The category is indeterminate, so the content\'s asset reference is again not reported dangling. Authored as an INTERVAL because §5.4.2 assigns no row to a hash-bound part that is present but unusable: WARNING is the floor this suite reads from the missing-part row, and pinning it as a CEILING would fail a reader that treats an unusable integrity anchor more severely — a ceiling the specification never set.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding section 3.1; Document Hashing section 4.3.1 item 2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        // The REAL hash of the malformed index below, so the fixture isolates the
        // unusable-index row instead of also tripping the index-hash row.
        assets: imagesCategory('sha256:cf107005b0df40f356d1f8643fa611bf27dd3a388f6950830880049a86b76295'),
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Asset Index Unusable'),
        { name: 'assets/images/index.json', text: '{"version":"0.1"}' },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: {
      documentDisposition: { atLeast: 'WARNING', atMost: 'REJECT' },
      findings: [{ code: 'CDX-E-ASSET-INDEX-UNUSABLE', atLeast: 'WARNING', atMost: 'REJECT' }],
    },
  },
  {
    name: 'warn-asset-index-hash-mismatch',
    description: 'The index file\'s stored bytes (one `size` field edited) do not match the hash the manifest declares for the category. Asset Embedding §8.1 step 3 makes `manifest.assets.<category>.hash` the index\'s declared hash, and §3.1 makes that one hash the transitive anchor for the whole category. The `manifest.id` here is recomputed over the TAMPERED index text — the bytes that actually enter the id basis — so the fixture isolates the index-hash row instead of also tripping the document-ID row.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding sections 3.1, 8.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:dce9f0d97e1b1b514c435bab0c9d581cb6bccf20aa30e9877837d7e8d7ad34eb',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Index Hash Mismatch'),
        { name: 'assets/images/index.json', text: INDEX_ONE_TAMPERED },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: warnOnly('CDX-E-ASSET-INDEX-HASH-MISMATCH'),
  },
  {
    name: 'warn-asset-hash-mismatch',
    description: 'The asset\'s stored bytes differ from the `hash` the index declares for it (Asset Embedding §8.1 steps 1-4). The index itself is intact and its own hash matches, so only the per-asset row fires — proving the reader verifies each asset, not merely the index that anchors them. The declared `manifest.id` is the CLEAN one: §4.3.1 item 2 resolves the content reference to the index\'s DECLARED hash, never to the asset\'s bytes, so tampering the bytes leaves the id basis untouched.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding section 8.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:98b87bc5b6cc0dd070e8d2e29df66ec791a30243bf904f24ea72a7c4a579cf71',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Asset Bytes Tampered'),
        { name: 'assets/images/index.json', text: INDEX_ONE },
        { name: 'assets/images/fig1.svg', text: FIG2 },
      ],
    ),
    expect: warnOnly('CDX-E-ASSET-HASH-MISMATCH'),
  },
  {
    name: 'warn-asset-document-id-mismatch',
    description: 'A review document that DECLARES an asset category and carries a `manifest.id` one hex digit away from the id its parts canonicalize to. The recompute must run and report the mismatch — and it can only run if the category\'s index is supplied to it: `buildAssetMap` throws "no asset index supplied for category" for any declared category it is handed no index text for, whatever the content contains. This is the fixture that pins the `assetIndexes` wiring, which before B1b-3b-2 was omitted entirely, making every asset-bearing document silently skip its id check inside the recompute\'s catch. A clean asset-bearing positive cannot catch that regression, because a skipped id check also looks clean. The content is deliberately INERT (empty blocks), so the asset index affects only whether the recompute RUNS, never what it computes — which both isolates the wiring and keeps the fixture confirmable by the independent oracle. Asset resolution\'s effect on the id VALUE is pinned separately, by the hand-authored asset vectors in conformance/vectors/document-id.json.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.3.1, 4.4, 6.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        // The real id for this basis is …752a; the final digit is changed to `b`.
        id: 'sha256:465c67c5dac8783c81a472f651d3f442fa9d3155269fdace496375916f76752b',
        state: 'review',
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [
        ...cleanBody('Asset Wiring'),
        { name: 'assets/images/index.json', text: INDEX_ONE },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: warnOnly('CDX-E-DOCUMENT-ID-MISMATCH'),
  },
  {
    name: 'warn-asset-listed-but-absent',
    description: 'The index lists an asset the archive does not ship (Asset Embedding §11.1 item 1). This is the missing hash-bound-part row, NOT a dangling reference: the reference still RESOLVES, because §4.3.1 item 2 binds the index\'s declared hash into the document ID rather than the asset\'s bytes — so the id is unaffected and only the bytes are missing. A reader that reported this as a dangling asset reference would misattribute an integrity failure of the archive to the content tree.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding sections 3.2, 11.1; Document Hashing section 4.3.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [...contentBody(CONTENT_IMAGE, 'Asset Bytes Absent'), { name: 'assets/images/index.json', text: INDEX_ONE }],
    ),
    expect: warnOnly('CDX-E-PART-MISSING-BOUND'),
  },
  {
    name: 'warn-asset-variant-missing',
    description: 'An image variant listed in the index is absent from the archive. Asset Embedding §4.3 requires the reader to fall back to the full-resolution image — "Missing variants SHOULD produce a warning but MUST NOT prevent the image from being displayed" — so this is deliberately NOT the escalating missing-hash-bound-part row a missing top-level asset earns: the document still renders exactly the content it asserts.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Asset Embedding section 4.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_HASH },
        assets: imagesCategory(INDEX_VARIANT_HASH, 1, 124),
      }),
      [
        ...contentBody(CONTENT_IMAGE, 'Variant Absent'),
        { name: 'assets/images/index.json', text: INDEX_VARIANT },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: warnOnly('CDX-E-ASSET-VARIANT-MISSING'),
  },
  {
    name: 'warn-asset-reference-dangling',
    description: 'The content\'s `image` block names `assets/images/gone.svg`, which the (loadable, intact) index does not register. §5.4.2 defines this row as "a canonicalization error once the ID is computed": Document Hashing §4.3.1 item 2 REPLACES the reference with the asset\'s hash, so an unresolvable one makes the document identity uncomputable. Draft (`id: pending`), so no id recompute competes with the finding.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1 item 2; Asset Embedding section 3.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_IMAGE_DANGLING_HASH },
        assets: imagesCategory(INDEX_ONE_HASH),
      }),
      [
        ...contentBody(CONTENT_IMAGE_DANGLING, 'Dangling Asset Reference'),
        { name: 'assets/images/index.json', text: INDEX_ONE },
        { name: 'assets/images/fig1.svg', text: FIG1 },
      ],
    ),
    expect: warnOnly('CDX-E-ASSET-REFERENCE-DANGLING'),
  },

  // --- presentation layers ---------------------------------------------------
  {
    name: 'positive-presentation-resolved',
    description: 'A review document declaring one `paginated` presentation layer whose stored bytes match its declared hash and whose single `pageElement` targets a block the content defines. The positive control for the presentation rows: a reader that mis-hashed the layer, or resolved `blockId` against the wrong namespace, would emit a spurious finding here. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Presentation Layers sections 12, 13.4; Document Hashing section 6.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:cab6b00ff455db74d01a1ded0fac20fae3450f8f9faa3c50522a8d05faa3fc39',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH },
        presentation: [{ type: 'paginated', path: 'presentation/paginated.json', hash: PRESENTATION_OK_HASH }],
      }),
      [...contentBody(CONTENT_PARAGRAPH, 'Presentation Document'), { name: 'presentation/paginated.json', text: PRESENTATION_OK }],
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-presentation-part-missing',
    description: 'A declared `manifest.presentation[]` layer whose file the archive omits. §5.4.2 names a declared presentation layer as the example of a part bound by the document hash or manifest projection, so its absence is the hash-BOUND row — WARNING in draft/review, and distinct from the path-only row a missing provenance record earns.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Presentation Layers section 12; Security Extension section 9.7; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH },
        presentation: [{ type: 'paginated', path: 'presentation/paginated.json', hash: PRESENTATION_OK_HASH }],
      }),
      contentBody(CONTENT_PARAGRAPH, 'Presentation Missing'),
    ),
    expect: warnOnly('CDX-E-PART-MISSING-BOUND'),
  },
  {
    name: 'warn-presentation-hash-mismatch',
    description: 'A declared presentation layer whose stored bytes do not match the `hash` the manifest declares for it. The file-hash row, under its own code rather than CDX-E-FILE-HASH-MISMATCH — that code\'s published summary is specifically `manifest.content.hash` over the content part\'s bytes, and conformance/errors.json is append-only, so its meaning cannot be widened after publication. The shipped layer\'s own `blockId` resolves cleanly, so the state-VARYING file-hash row is isolated from the state-INVARIANT reference row.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 6.3; Presentation Layers section 12; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH },
        // Declares the hash of a DIFFERENT presentation file than the one shipped below.
        presentation: [{ type: 'paginated', path: 'presentation/paginated.json', hash: PRESENTATION_DANGLING_HASH }],
      }),
      [...contentBody(CONTENT_PARAGRAPH, 'Presentation Hash Mismatch'), { name: 'presentation/paginated.json', text: PRESENTATION_OK }],
    ),
    expect: warnOnly('CDX-E-PRESENTATION-HASH-MISMATCH'),
  },
  {
    name: 'warn-presentation-reference-dangling',
    description: 'A declared presentation layer, correctly hashed, whose `pageElement` targets a `blockId` the content does not define. Presentation Layers §13.4: the reader omits that rule and renders the affected content with default styling. WARNING in EVERY state — presentation sits outside the document-hash boundary (Document Hashing §4.1a), so a stale reference degrades rendering and never impugns integrity. The file hash is correct here precisely so the state-INVARIANT reference row is isolated from the state-VARYING file-hash row.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Presentation Layers section 13.4; Document Hashing section 4.1a; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH },
        presentation: [{ type: 'paginated', path: 'presentation/paginated.json', hash: PRESENTATION_DANGLING_HASH }],
      }),
      [...contentBody(CONTENT_PARAGRAPH, 'Dangling Presentation'), { name: 'presentation/paginated.json', text: PRESENTATION_DANGLING }],
    ),
    expect: warnOnly('CDX-E-PRESENTATION-REFERENCE-DANGLING'),
  },
  {
    name: 'warn-presentation-undeclared',
    description: 'A precise-layout file sits in `presentation/layouts/` but no `manifest.presentation[]` entry declares it, so no hash binds it and no manifest-covering signature can attest it. §5.4.2\'s preamble expressly refuses to treat such a file as a benign out-of-hash annotation — "an injected layout is an attempt to alter signed content" — and Presentation Layers §12 directs that its presence be surfaced as an integrity concern. The finding reports the file\'s presence; the normative requirement it backs is that a renderer MUST NOT present it as the document\'s appearance. Pinned EXACTLY at WARNING, and the erratum is why: the preamble formerly removed this file from the out-of-hash row without supplying a replacement, so WARNING was only a floor and a ceiling would have failed a reader that escalated. §5.4.2 now carries a dedicated row assigning WARNING in draft/review, and §5.4.1 makes escalating a WARNING non-conformant ("The document remains valid and a warning never blocks loading"), so the exact pin is now the correct assertion and an interval would be too loose. The frozen/published INTEGRITY-ERROR the same row assigns is exercised in B3.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Presentation Layers sections 12, 12.1; State Machine section 5.4.2',
    recipe: documentArchive(manifestJson({ content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH } }), [
      ...contentBody(CONTENT_PARAGRAPH, 'Undeclared Layout'),
      { name: 'presentation/layouts/letter.json', text: '{"version":"0.1","presentationType":"precise","targetFormat":"letter"}' },
    ]),
    expect: warnOnly('CDX-E-PRESENTATION-UNDECLARED'),
  },

  // --- extension config-slot side files, and the namespaces they carry -------
  {
    name: 'positive-semantic-references-resolved',
    description: 'A review document declaring `semantic.bibliography` and `semantic.glossary` as `{path, hash}` config references, both present and correctly hashed, whose content carries a `citation` mark resolving to a bibliography entry id and a `glossary` mark resolving to a term id. The positive control for the two namespaces §5.4.2\'s extension-cross-reference row names alongside the academic marks — and for keeping them SEPARATE from the content-anchor namespace, which is why §4.3.1 item 5 leaves both as authored. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1 item 5; Security Extension section 9.7; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        id: 'sha256:708d2e14b2f96dbf780d73a4e5f00b33fc09e9bef2dd5e9341fc6d8215af62e2',
        state: 'review',
        content: { path: 'content/document.json', hash: CONTENT_SEMANTIC_HASH },
        semantic: {
          bibliography: { path: 'semantic/bibliography.json', hash: BIBLIOGRAPHY_HASH },
          glossary: { path: 'semantic/glossary.json', hash: GLOSSARY_HASH },
        },
      }),
      [
        ...contentBody(CONTENT_SEMANTIC, 'Semantic Document'),
        { name: 'semantic/bibliography.json', text: BIBLIOGRAPHY },
        { name: 'semantic/glossary.json', text: GLOSSARY },
      ],
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-citation-and-glossary-dangling',
    description: 'Both side files load cleanly, but the content\'s `citation` mark names no bibliography entry and its `glossary` mark names no term. Two findings, two codes — neither reusing CDX-E-CROSS-REFERENCE-DANGLING, whose published summary enumerates the three `academic:*-ref` marks specifically. WARNING in every state: §5.4.2\'s preamble explains that such a mark is resolved at RENDER time to inject a label or definition, so a dangling one degrades rendering while the signed bytes stay intact and hash-verified.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1 item 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_SEMANTIC_DANGLING_HASH },
        semantic: {
          bibliography: { path: 'semantic/bibliography.json', hash: BIBLIOGRAPHY_HASH },
          glossary: { path: 'semantic/glossary.json', hash: GLOSSARY_HASH },
        },
      }),
      [
        ...contentBody(CONTENT_SEMANTIC_DANGLING, 'Dangling Cross References'),
        { name: 'semantic/bibliography.json', text: BIBLIOGRAPHY },
        { name: 'semantic/glossary.json', text: GLOSSARY },
      ],
    ),
    expect: {
      documentDisposition: { atLeast: 'WARNING', atMost: 'WARNING' },
      findings: [
        { code: 'CDX-E-CITATION-REFERENCE-DANGLING', atLeast: 'WARNING', atMost: 'WARNING' },
        { code: 'CDX-E-GLOSSARY-REFERENCE-DANGLING', atLeast: 'WARNING', atMost: 'WARNING' },
      ],
    },
  },
  {
    name: 'positive-footnote-resolved',
    description: 'All three of §4.5.2\'s resolution keys in one document, each load-bearing. The first `footnote` mark resolves by ID MATCH — and only by it, because `fn1` and `fn2` deliberately share `number: 1`, so without id precedence that mark\'s marker is ambiguous. The second resolves by `number`, the third by `symbol` (§4.5.1a), so deleting either marker arm turns this fixture red. Both blocks sharing a marker carry `id`s, so §4.5.2\'s "absent `id`s" uniqueness MUST is not engaged and the document is genuinely clean. The positive control for the footnote arm of §5.4.2\'s extension-cross-reference row, and for the erratum that made it work: until §4.3.1 item 5 stopped relabelling a `semantic:footnote` block id, the mark kept `fn1` while the block became `b0`, so id match could never hold on the canonical form. No side file is involved — §4.5.2 gives footnotes none, so the namespace is purely in-document. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Semantic Extension section 4.5.2; Document Hashing section 4.3.1 item 5; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: CONTENT_FOOTNOTE_OK_HASH } }),
      contentBody(CONTENT_FOOTNOTE_OK, 'Footnotes Resolved'),
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-footnote-reference-dangling',
    description: 'A `footnote` mark carrying `number: 9` where the document\'s only `semantic:footnote` block is numbered 1, so the mark resolves to no block by either key. §4.5.2 states the disposition for this case in its own words — "a footnote mark that resolves to no block is likewise a WARNING, never an integrity failure" — matching §5.4.2\'s extension-cross-reference row, which already names the footnote mark. A separate code from the citation and glossary arms so the three namespaces stay independently reportable.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Semantic Extension section 4.5.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: CONTENT_FOOTNOTE_DANGLING_HASH } }),
      contentBody(CONTENT_FOOTNOTE_DANGLING, 'Dangling Footnote'),
    ),
    expect: warnOnly('CDX-E-FOOTNOTE-REFERENCE-DANGLING'),
  },
  {
    name: 'warn-footnote-reference-ambiguous',
    description: 'Two `semantic:footnote` blocks share `number: 1` and neither carries an `id`, which §4.5.2 forbids ("and — absent `id`s — no two may share a `number` or a `symbol`"), and a mark carries that marker. Distinct from the dangling case and given its own code: the mark DOES resolve — §4.5.2 sends the reader to the first block in document order — so the defect is the violated uniqueness MUST, not a missing target. That the FIRST block is the one chosen cannot be asserted here, the comparator being a subset check over reported findings; it is pinned in scripts/test-document-verdict.ts.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Semantic Extension section 4.5.2, section 11',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: CONTENT_FOOTNOTE_AMBIGUOUS_HASH } }),
      contentBody(CONTENT_FOOTNOTE_AMBIGUOUS, 'Ambiguous Footnote'),
    ),
    expect: warnOnly('CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS'),
  },
  {
    name: 'warn-config-part-missing',
    description: 'The `semantic.bibliography` config reference names a file the archive omits, while the glossary it also declares is present and intact. WHICH §5.4.2 row governs was previously open — the out-of-hash row gave "a PATH-ONLY semantic/academic side file (bibliography, glossary, numbering)" as an example, contradicting its own qualifier, since semantic.schema.json declares the reference as `{path, hash}` with `additionalProperties: false` and the manifest projection binds every such pair (Security Extension §9.7). The erratum removed those examples: the hash-bound row governs, which is WARNING in draft/review and INTEGRITY-ERROR when frozen (B3). The draft/review disposition never depended on the answer, so this case is now pinned exactly. The content carries BOTH a citation and a glossary mark, which is the point: the citation namespace is INDETERMINATE (declared but unloadable) so no citation may be reported dangling, while the glossary namespace loaded and resolves — a reader that treated an unloadable side file as an EMPTY namespace would report a spurious cross-reference finding here.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'State Machine section 5.4.2; Security Extension section 9.7',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_SEMANTIC_HASH },
        semantic: {
          bibliography: { path: 'semantic/bibliography.json', hash: BIBLIOGRAPHY_HASH },
          glossary: { path: 'semantic/glossary.json', hash: GLOSSARY_HASH },
        },
      }),
      [...contentBody(CONTENT_SEMANTIC, 'Bibliography Missing'), { name: 'semantic/glossary.json', text: GLOSSARY }],
    ),
    expect: warnOnly('CDX-E-CONFIG-PART-MISSING'),
  },
  {
    name: 'warn-config-file-hash-mismatch',
    description: 'The `semantic.bibliography` file is present but its stored bytes do not match the declared hash. Unlike the MISSING case above, this row is not contested: the reference declares a hash, so comparing it against the stored bytes is the file-hash row on either reading of where the missing-file case belongs. The glossary file is intact, so the glossary namespace stays clean and only the bibliography finding fires.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 6.3; Security Extension section 9.7; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({
        content: { path: 'content/document.json', hash: CONTENT_SEMANTIC_HASH },
        semantic: {
          bibliography: { path: 'semantic/bibliography.json', hash: BIBLIOGRAPHY_HASH },
          glossary: { path: 'semantic/glossary.json', hash: GLOSSARY_HASH },
        },
      }),
      [
        ...contentBody(CONTENT_SEMANTIC, 'Bibliography Hash Mismatch'),
        { name: 'semantic/bibliography.json', text: '{"version":"0.1","entries":[{"id":"smith2020","type":"book","title":"Another Book"}]}' },
        { name: 'semantic/glossary.json', text: GLOSSARY },
      ],
    ),
    expect: warnOnly('CDX-E-CONFIG-FILE-HASH-MISMATCH'),
  },

  // === B1b-3c-1a: content ROOT ENVELOPE (03 §2.2; §5.4.2's dedicated row) ============
  //
  // The envelope is checked independently of the block/mark type walk, because a
  // non-array `blocks` is exactly what silences that walk: `classifyContent` descends
  // only when `blocks` IS an array, so one bracket turns a document §5.4.2 rejects into
  // one that reports nothing — with the id still computable and a signature over it
  // still verifying. REJECT in every state.
  {
    name: 'reject-content-root-not-object',
    description: 'The content part parses as JSON but its root is an array, not an object. Content Blocks section 2.2 requires an object carrying `version` and `blocks`; a document whose content root is not an object has no content tree at all, so it cannot be coherently loaded.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 2.2, 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' } }),
      contentBody('[]', 'Root Not Object'),
    ),
    expect: rejectOnly('CDX-E-CONTENT-ROOT-MALFORMED'),
  },
  {
    name: 'reject-content-root-scalar',
    description: 'The content part parses as JSON but its root is a NUMBER. RFC 8259 permits a scalar at the top level, so this parses cleanly and is not the unparseable row — it simply is not a content document. Distinct from the array case above and not redundant with it: a reader that reached for a member of the root without first establishing it is an object would fault here, where an array root would silently answer "absent" to every member lookup.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 2.2, 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049' } }),
      contentBody('42', 'Root Scalar'),
    ),
    expect: rejectOnly('CDX-E-CONTENT-ROOT-MALFORMED'),
  },
  {
    name: 'reject-content-root-blocks-missing',
    description: 'The content root is an object carrying `version` but no `blocks`. Content Blocks section 2.2 makes `blocks` Required, and absent is not the same as empty: Document Hashing section 4.3.1 item 6 preserves absence rather than materializing a default, so this document and one carrying `blocks: []` render identically but canonicalize to different bytes — one rendered document with two identities.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 2.2, 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:cf107005b0df40f356d1f8643fa611bf27dd3a388f6950830880049a86b76295' } }),
      contentBody('{"version":"0.1"}', 'Blocks Missing'),
    ),
    expect: rejectOnly('CDX-E-CONTENT-ROOT-MALFORMED'),
  },
  {
    name: 'reject-content-root-blocks-not-array',
    description: 'The content root carries `blocks` as an OBJECT rather than an array. This is the arm that matters most: every content-level row in the section 5.4.2 table is reached by walking `blocks`, so a non-array withdraws all of them at once. The document id stays computable and a signature over it still verifies, so nothing else catches it. (The wrapped block is well-formed — this case pins that the ENVELOPE is reported, not that a nested defect is withdrawn; the withdrawal property is an absence claim the subset comparator cannot express, and is pinned in test-document-verdict.ts.)',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 2.2, 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:186f7fcb08a6bc540e61b792f7bd931ebb436714c60078c9d1dbddc19b0d41b1' } }),
      contentBody('{"version":"0.1","blocks":{"0":{"type":"paragraph"}}}', 'Blocks Not Array'),
    ),
    expect: rejectOnly('CDX-E-CONTENT-ROOT-MALFORMED'),
  },
  {
    name: 'reject-content-root-version-missing',
    description: 'The content root carries a well-formed `blocks` array but no `version`. Because `blocks` IS an array here, the block/mark type walk still runs and still reports the bare `paragrph` inside it — pinning that the envelope check reports its own defect WITHOUT switching the classifier off. `version` is hashed inside the content slot (Document Hashing section 4.2), so its absence is a missing input to the document ID, not an unread field.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 2.2, 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:ba5400b7fa859f2f505dd26235e4fa546ce5641894825f64858fde9014f703fc' } }),
      contentBody('{"blocks":[{"type":"paragrph","children":[{"type":"text","value":"x"}]}]}', 'Version Missing'),
    ),
    expect: {
      documentDisposition: { atLeast: 'REJECT', atMost: 'REJECT' },
      findings: [
        { code: 'CDX-E-CONTENT-ROOT-MALFORMED', atLeast: 'REJECT', atMost: 'REJECT' },
        { code: 'CDX-E-BLOCK-TYPE-UNKNOWN-BARE', atLeast: 'REJECT', atMost: 'REJECT' },
      ],
    },
  },
  {
    name: 'reject-content-root-version-mistyped',
    description: 'The content root carries `version` as a number rather than a string. Mistyping a Required field is the same defect class as omitting it — the manifest row of section 5.4.2 already reads "missing or mistyping a required field" — and the mistyped value changes the canonical bytes exactly as a missing one does.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks sections 2.2, 7.1; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:77442477abb9dbb687de844d6e241a3fb41ec241d0bf04d4f9604e7f4e1f23dc' } }),
      contentBody('{"version":1,"blocks":[]}', 'Version Mistyped'),
    ),
    expect: rejectOnly('CDX-E-CONTENT-ROOT-MALFORMED'),
  },
  {
    name: 'positive-content-root-open',
    description: 'A conformant content root carrying an UNRECOGNIZED extra member alongside `version` and `blocks`. The root is deliberately open — content.schema.json declares no root `additionalProperties: false` — so an extra member is not a defect, and a root-envelope check that closed the root would false-REJECT this. The published corpus already depends on the root being open: the two non-representable-number fixtures carry an extra root key of their own.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Content Blocks section 2.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:4ddbd1bdb988196bd0c4e727f627aa54ad85edbbdacb144a7543fc6a39a087aa' } }),
      contentBody('{"version":"0.1","blocks":[],"x-vendor":{}}', 'Open Root'),
    ),
    expect: CLEAN,
  },

  // === B1b-3c-1a: stored-byte TEXT invariants (06 §4.3.2 item 2; §5.4.3) =============
  //
  // Every non-ASCII character below is written as a literal `\uXXXX` ESCAPE in the JSON
  // text, never as a raw character. Two reasons, both load-bearing:
  //   - a lone surrogate has no UTF-8 encoding at all, so a raw one in this TS source
  //     would be written to the archive as U+FFFD and the fixture would test nothing;
  //   - a decomposed sequence written raw is one editor-normalization away from silently
  //     becoming NFC, which would leave the fixture passing for the wrong reason.
  // The escapes also keep the stored bytes ASCII, so the hashes below are stable.
  {
    name: 'reject-content-text-non-nfc',
    description: 'A text node value in Normalization Form D (`e` followed by U+0301 COMBINING ACUTE) rather than NFC. Document Hashing section 4.3.2 makes NFC a property of the stored bytes and forbids normalizing at hash time, so a reader has no repair available: normalizing would change the very bytes the document is identified by. REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:5e7ae1607b5a6f4662f0725354dc91a369d6ab735321408c217b1eb15aaee355' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"cafe\\u0301"}]}]}', 'Non-NFC Text'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-key-non-nfc',
    description: 'A non-NFC OBJECT KEY (an `attributes` member) while every string VALUE in the document is conformant. Document Hashing section 4.3.2 binds "all object keys and string values", so a reader that scanned only values would pass this — the key enters the canonical JCS serialization exactly as a value does.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:69ba96e2835a83f4ebc1477798ef0c86eea72d153574783e0b423f007fe61497' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"cafe\\u0301":"x"},"children":[{"type":"text","value":"ok"}]}]}', 'Non-NFC Key'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-split-combining-sequence',
    description: 'A combining sequence split across a text-node boundary: one node ends `cafe`, the next is U+0301 alone. EACH node value is individually in NFC — a per-string check passes this document — but their concatenation is not, which is the arm Document Hashing section 4.3.2 states explicitly ("This applies to the concatenated text content of each block, not merely to individual text-node values"). The two nodes carry different marks so canonicalization does not merge them, leaving the split observable in the stored bytes.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:6790b6550ee4d396e289587dac692cd7e47ed6a0bcd76de31a69708c77fb7aca' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"cafe"},{"type":"text","value":"\\u0301","marks":["bold"]}]}]}', 'Split Combining Sequence'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-split-combining-sequence-mid-array',
    description: 'The same split combining sequence, but the run of text nodes is FOLLOWED by a non-text sibling in the same array rather than ending it. Not redundant with the case above: a scan that flushed its pending run only at the end of an array would miss this one, and a scan that flushed only mid-array would miss that one. Together they pin both boundaries of the run. The content is SCHEMA-VALID and must not be "corrected" to nest the text nodes: the run sits in the ROOT `blocks` array, and `content.schema.json` admits a text node there — `blocks.items` resolves to the block definition, which counts `text` among its known types and dispatches it to the text-node definition — so a run followed by a non-text sibling is reachable without leaving the schema. It is a `children` array that forbids the shape (Content Blocks section 7.2 rule 1: a paragraph\'s children MUST be text nodes), which is why the boundary is pinned at the root rather than inside a block. One consequence is worth knowing when comparing implementations: the two nodes carry no marks, so canonicalization MERGES them and a check driven from the canonical form reports the per-string arm ("string is not in NFC"), while a scan of the stored bytes reports the concatenation arm. Both are `CDX-E-PART-STRING-NOT-NFC` and the suite pins the code, not the message.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:f29ea5a425826d7cec8f6be22c03f0bea14d3e51b06f65d6c69364936314141b' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"text","value":"cafe"},{"type":"text","value":"\\u0301"},{"type":"paragraph","children":[{"type":"text","value":"ok"}]}]}', 'Split Combining Mid-Array'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-text-unpaired-surrogate',
    description: 'A text node value carrying a lone high surrogate (U+D800) with no low surrogate following, so the string is not well-formed Unicode and has no UTF-8 encoding at all. RFC 8259 parsers disagree on such an escape exactly as they disagree on a duplicate key — preserve it, substitute U+FFFD, or refuse — so two conformant readers derive different document IDs from this one archive. REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:e6572daa78e8b3c9dcf154f51bf3442ef0e6b2bfbfd2b1a509807dc9b162ea1f' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"\\ud800"}]}]}', 'Unpaired Surrogate'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-ILL-FORMED'),
  },
  {
    name: 'reject-content-text-ill-formed-and-non-nfc',
    description: 'A text value carrying BOTH defects at once: decomposed text (`e` + U+0301) followed by a lone high surrogate. Both are REJECT, so the document disposition is the same either way — what this pins is WHICH arm is reported. A reader testing NFC first would report only the non-NFC arm and never mention that the string has no UTF-8 encoding at all, which is the arm under which two conformant readers disagree on the bytes. Note a string whose ONLY defect is a lone surrogate does not distinguish the two orders, because normalization leaves a lone surrogate unchanged.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:27305dca59492495800cd6668e82c7c41f824bdd224c3feb10ee14befc464916' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"cafe\\u0301\\ud800"}]}]}', 'Ill-Formed And Non-NFC'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-ILL-FORMED'),
  },
  {
    name: 'positive-content-derived-field-non-nfc',
    description: 'A non-NFC string inside a `crdt` field — one of the three fields the canonical transform DELETES (Document Hashing section 4.3.1 item 1). CLEAN, and deliberately so: section 5.4.2\'s rows and both string codes bind a HASHED key or value, and a field canonicalization deletes is not hashed. The split-view harm that justifies the REJECT cannot reach it either — two readers cannot derive different canonical bytes from a field both delete. This is the control for the scan\'s SCOPE: a reader scanning the whole stored part rather than its hashed material REJECTs this conformant document in every state, and `crdt` carries opaque third-party CRDT state holding arbitrary user text, so that is a live false-reject on real collaborative documents.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.3.1, 4.3.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:04fef6e2e299a3367194cbc2b64ac7b7ca6f30d8dc68fcf8e3b7d8385ce50164' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","crdt":{"note":"cafe\\u0301"},"children":[{"type":"text","value":"ok"}]}]}', 'Non-NFC Derived Field'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-content-attributes-text-shaped',
    description: 'Two objects SHAPED like text nodes inside a block\'s `attributes.semantic`, whose values are each in NFC but whose concatenation is not (`cafe` + U+0301). CLEAN. This is the corpus control for the POSITION scope of both rules that read runs of text nodes — section 4.3.1 item 4\'s merge and section 4.3.2 item 2\'s concatenated-NFC check. Neither is a property of an element\'s SHAPE: `attributes.semantic` is a JSON-LD annotation with `additionalProperties: true` (semantic.schema.json), so an author may put a member named `children` there holding whatever the vocabulary calls for, and an implementation keyed on shape merges these two and then REJECTS the merged string. That is a live false-reject on a conformant document. Authored through `semantic` of necessity, not preference: `blockAttributes` is `additionalProperties: false`, so an array of text-shaped objects can sit NOWHERE ELSE beneath `attributes` — a case authored under any other member name is itself non-conformant and pins nothing. The run is nested one level below `semantic` so the barrier must survive an array-to-item hop, not only an object one. Note what stays in force underneath: the PER-STRING checks still run here, pinned by the two cases below; only the RUN rule is withheld.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.3.1, 4.3.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:d5e6370be0a680ea053267c9ee592a0f01048297b51c7dd354be3dc56878b7db' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"semantic":{"@type":"Question","children":[{"@type":"Answer","children":[{"type":"text","value":"cafe"},{"type":"text","value":"\\u0301"}]}]}},"children":[{"type":"text","value":"ok"}]}]}', 'Attributes Text Shaped'),
    ),
    expect: CLEAN,
  },
  {
    name: 'reject-content-attributes-value-non-nfc',
    description: 'A non-NFC string VALUE inside `attributes.semantic`. REJECT — and this is the boundary of the case above, not a contradiction of it. `attributes` is HASHED material: unlike `crdt`, the canonical transform does not delete it, so section 4.3.2\'s per-string rule binds every string it carries and two readers that normalize differently derive different canonical bytes. What the position scope withholds under `attributes` is only the CONCATENATION rule, which needs a run of adjacent text nodes to mean anything. Without this case the scope can be widened into a wholesale exemption for everything beneath `attributes` — an implementation that skips the subtree rather than withholding one rule passes the case above and every other published case; only a non-NFC KEY was otherwise covered.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:e2128736a984ce22317efbe0d345529c40a5fd49796123c61abde3fbff137841' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"semantic":{"@type":"Question","name":"cafe\\u0301"}},"children":[{"type":"text","value":"ok"}]}]}', 'Attributes Value Non-NFC'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-attributes-value-ill-formed',
    description: 'A string value inside `attributes.semantic` carrying a lone high surrogate (U+D800), so it is not well-formed Unicode and has no UTF-8 encoding at all. REJECT. The second arm of the boundary the case above opens: the two per-string codes are reported independently, so exempting `attributes` from one and not the other is a distinguishable state, and a fixture for the NFC arm alone leaves the ill-formed arm free to be dropped silently.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:f448654e157e24a0324f940e15395725318109ab4a71dfc12df2f02e75aa8550' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","attributes":{"semantic":{"@type":"Question","name":"caf\\ud800"}},"children":[{"type":"text","value":"ok"}]}]}', 'Attributes Value Ill-Formed'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-ILL-FORMED'),
  },
  {
    name: 'reject-content-caption-split-combining-sequence',
    description: 'A combining sequence split across the two text nodes of a FIGURE CAPTION, which carry differing marks and so cannot merge. REJECT. The block-content positions are not only `children`: a figure\'s rich `caption` array holds text nodes (content.schema.json) and both rules reach it. This is the positive control the `attributes` cases need: a scope narrowed too far reads exactly like a scope drawn correctly. Strict `children` is the specific wrong answer it rules out — that scope drops this array AND the root `blocks` array reject-content-split-combining-sequence-mid-array uses. The corpus is what carries the `caption` pin to an implementation whose own unit tests cover only its `children` path.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:16e9f3d6b5c03a5f63aa17fd0850a124b4f0d88d8b5afd384ca135bafcf27764' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"figure","subfigures":[{"label":"a","children":[{"type":"paragraph","children":[{"type":"text","value":"Panel a"}]}]}],"caption":[{"type":"text","value":"cafe","marks":["bold"]},{"type":"text","value":"\\u0301","marks":["italic"]}]}]}', 'Caption Split Combining Sequence'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-hints-split-combining-sequence',
    description: 'A combining sequence split across two differently-marked text nodes of an `academic:exercise` `hints` array. REJECT. `hints` declares its `items` as `$defs/block`, and a `block` DISPATCHES `type:"text"` to `$defs/textNode` in its first `allOf` branch — so a text node is admissible here and both rules reach it. The `$ref` is what makes this worth a case: reading it as "blocks only, never text nodes" is a natural and WRONG inference, and it is the inference that leaves this position unenforced. The same reading would exempt the root `blocks` array, which reject-content-split-combining-sequence-mid-array already shows is enforced.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:03539fdae7f15113cf8893689132897afb694845efa2a6aaba41308e8f118f28' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"academic:exercise","children":[{"type":"paragraph","children":[{"type":"text","value":"Q"}]}],"hints":[{"type":"text","value":"cafe","marks":["bold"]},{"type":"text","value":"\\u0301","marks":["italic"]}]}]}', 'Hints Split Combining Sequence'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'reject-content-preamble-split-combining-sequence',
    description: 'The same defect in an `academic:exercise-set` `preamble`, the sixth and last block-content position. Not redundant with the `hints` case: the two keys are declared on DIFFERENT blocks, so an implementation deriving its positions per-block can admit one and miss the other. Between them the corpus now exercises five of the six positions with a real document — the sixth, `content`, is a `presentation:footnote` mark\'s content, where the run rule fires but the merge does not, so it is deliberately left to the canonicalize vectors rather than pinned here.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:2b41d80b32a43bc580d7487e9938de4bf77fb7e8aaa12a79cd1f8ffed0f75ea1' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"academic:exercise-set","preamble":[{"type":"text","value":"cafe","marks":["bold"]},{"type":"text","value":"\\u0301","marks":["italic"]}],"exercises":[{"type":"academic:exercise","children":[{"type":"paragraph","children":[{"type":"text","value":"Q"}]}]}]}]}', 'Preamble Split Combining Sequence'),
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },
  {
    name: 'positive-content-astral-text',
    description: 'A text node carrying an astral character (U+1F600, stored as the well-formed surrogate PAIR U+D83D U+DE00) in NFC. A reader that flagged any surrogate code unit rather than an UNPAIRED one would false-REJECT this — every non-BMP character in every conformant document is a surrogate pair.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:9fa673a55e622b9f75269a3cf10a0fe3d9c3ac86ef7250d7e7fd23b9d978738f' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"a\\ud83d\\ude00b"}]}]}', 'Astral Text'),
    ),
    expect: CLEAN,
  },
  {
    name: 'reject-metadata-term-non-nfc-array-element',
    description: 'A non-NFC string (`cafe` followed by U+0301 COMBINING ACUTE) carried as an ELEMENT of the array-valued `creator` term, while every string-valued term is conformant. Document Hashing section 4.3.2 binds the whole hashed basis, and section 4.3.1 keeps exactly five Dublin Core terms in it — projecting `creator`, `subject` and `language` as ARRAYS (a scalar value is coerced to a one-element array). It is the AUTHORED value that may be either a string or an array of strings, per dublin-core.schema.json, and this part authors the array form. So a reader that scanned only the terms authored as bare strings admits a non-NFC byte into the document identity through three of the five. The part is otherwise conformant — `title` is present and `creator` holds a non-empty member — so it projects cleanly and this is the section 4.3.2 scan arm rather than the malformed-metadata or missing-term rows. It carries the corpus\'s only array-shaped projected term, so it is the only fixture in which that shape reaches the scan. REJECT in every state.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing sections 4.3.1, 4.3.2; State Machine section 5.4.3',
    recipe: documentArchive(
      manifestJson(),
      [
        { name: 'content/document.json', text: CLEAN_CONTENT },
        // Written as a raw JSON literal rather than through `dublinCoreJson`, for the reason
        // the content fixtures above give: the `\u0301` escape keeps the STORED bytes ASCII, so
        // the decomposed sequence cannot be silently normalized away by an editor and leave the
        // fixture passing for the wrong reason.
        { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"T","creator":["A. Author","cafe\\u0301"]}}' },
      ],
    ),
    expect: rejectOnly('CDX-E-PART-STRING-NOT-NFC'),
  },

  // === B1b-3c-1a: anchor POSITION validity (03a §2.2, §3, §7.3) ======================
  //
  // Only the arms carrying a CONCRETE disposition are fixtures. The structural arm
  // (CDX-E-ANCHOR-POSITION-INVALID) has `disposition: null` — §5.4.2 assigns it no row —
  // and the fixture comparator cannot express a null-disposition finding at all: it
  // requires every expected finding to carry a disposition interval. No fixture in the
  // published corpus asserts any of the ten null-disposition codes, for that reason.
  // Those arms are pinned in scripts/test-document-verdict.ts instead.
  {
    name: 'warn-anchor-position-out-of-range',
    description: 'A `link` mark href `#p1/20-25` whose target block holds 13 code points of text, so the range runs off the end of the text it addresses. Anchors and References section 7.3 makes a position exceeding the target text a defect, and section 7.2 tabulates it at the same severities as a dangling anchor. The reference RESOLVES — this is not the dangling row — so a reader that checked only target existence reports nothing here.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.2, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:fa5bd8826995c7fdb8a04c652b9e2d9a6920fbf1ce9e3906b3da580ccc936921' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"Hello, world!"}]},{"type":"paragraph","id":"p2","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#p1/20-25"}]}]}]}', 'Anchor Out Of Range'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'warn-anchor-position-out-of-range-astral',
    description: 'The same defect where the unit of measurement is the whole question: the target block holds `a`, U+1F600, `b` — THREE code points but FOUR UTF-16 code units — and the anchor addresses `#p1/0-4`. Anchors and References section 3 fixes the unit as the Unicode scalar value, so this range exceeds the text; an implementation measuring `String.length` computes 4, finds the range in bounds, and reports nothing. That is the defect the anchor-offset vectors exist to catch, here at the document layer.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.2, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:2f2f2d8c1f9a2bd8207c502e3e7e5f01db820e1686cef0c4c86dc5d234531578' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a\\ud83d\\ude00b"}]},{"type":"paragraph","id":"p2","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#p1/0-4"}]}]}]}', 'Anchor Astral Out Of Range'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'positive-anchor-position-in-bounds',
    description: 'A `link` mark href `#p1/7-12` selecting `world` from a 13-code-point block. The positive control for the range check: a reader with an off-by-one bound, or one that reported every positional anchor, would emit a spurious finding here. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:276e4859cf3ba068a0c53abe2f6c9ccb5c4960d76034a720f2b7fb089213b446' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"Hello, world!"}]},{"type":"paragraph","id":"p2","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#p1/7-12"}]}]}]}', 'Anchor In Bounds'),
    ),
    expect: CLEAN,
  },
  {
    name: 'positive-anchor-position-at-text-end',
    description: 'A range ending EXACTLY at the target block\'s text length (`#p1/0-3` over three code points), which selects through the final character. Anchors and References section 7.3 says a position MUST NOT EXCEED the length, so equality is valid — a reader using `>=` rather than `>` reports a spurious finding here. It shares its target block with the astral out-of-range case above, so the two together pin both the unit and the boundary. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.3',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:5e5e9ffb229921762466a88f651f95b21ab87989911b3046e03c7ae27cd7ecc1' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"a\\ud83d\\ude00b"}]},{"type":"paragraph","id":"p2","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#p1/0-3"}]}]}]}', 'Anchor At Text End'),
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-anchor-position-out-of-range-code-block',
    description: 'A `link` href `#code1/0-99` into a `codeBlock` holding 12 code points. Anchors & References section 3 names `codeBlock` among the text-bearing blocks outright, so a position addresses its text exactly as it would a paragraph\'s and an out-of-bounds one is the tabulated WARNING. The case exists because a `codeBlock` reaches its text node through an `allOf` that NARROWS it (section 4: exactly one marks-free text node) rather than through a direct schema reference — an implementation deriving the text-bearing set from direct references alone drops it, reports a conformant in-bounds anchor into source code as targeting a non-text-bearing block, and downgrades this case to the structural code, whose disposition is null. Anchoring a range of code is the ordinary reason to anchor at all, so that is a live false positive.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.2, 7.3; Content Blocks section 4; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:b9f5f0661602ec76f59afaa787c9b7b151d15bab4cf9c0ef192ad3646182f685' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"codeBlock","id":"code1","children":[{"type":"text","value":"const x = 1;"}]},{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#code1/0-99"}]}]}]}', 'Code Block Anchor Out Of Range'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'warn-anchor-position-out-of-range-unsafe-integer',
    description: 'A range `#p1/9007199254740992-9007199254740993` whose two bounds are DISTINCT integers that round to the same IEEE-754 double. Schema-valid: `contentAnchorUri`\'s pattern admits an unbounded `[0-9]+`, and Document Hashing section 4.3.2\'s 2^53 limit governs hashed NUMBERS, not digits inside a string. A reader deciding `start < end` after converting to a double finds them equal, takes the STRUCTURAL arm, and reports a null-disposition finding — silently downgrading a WARNING that Anchors & References section 7.2 tabulates. The bound must be compared before conversion; the Python oracle uses arbitrary-precision integers and reaches the correct answer either way, so this is a live two-implementation disagreement rather than a shared blind spot.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 2.1, 3, 7.2, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:f8195049a7df3e358680581e56690f96df23dac77b7a62b151be9132eec621ca' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"short"}]},{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#p1/9007199254740992-9007199254740993"}]}]}]}', 'Anchor Position Unsafe Integer'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'warn-anchor-position-multi-text-node-target',
    description: 'The only target in the corpus whose text spans MORE THAN ONE text node: `p1` holds `abc` and `def`, so Anchors & References section 3\'s concatenation gives six code points and the range `#p1/0-7` runs off the end. Section 3 defines a block\'s text content as the concatenation of its text-node children, with nothing inserted between them — an implementation joining on a separator computes seven, finds the range in bounds, and reports nothing. Every other positional fixture has a single-text-node target, where concatenation is unobservable, so this case is what makes the model testable at all.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.2, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:80f9cc25ef359e5fbfc86771a24196b7d898342393843b2e69b427991e09ac63' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"abc"},{"type":"text","value":"def"}]},{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#p1/0-7"}]}]}]}', 'Anchor Multi Text Node Target'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'warn-block-reference-position-out-of-range',
    description: 'A `semantic:ref` block whose `target` `#p1/20-25` resolves to a block holding 13 code points, so the range runs off the end of the text it addresses. The same defect as `warn-anchor-position-out-of-range` in a DIFFERENT §5.4.2 row, and therefore under a different code: an out-of-range position is disposed of by the row of the FIELD carrying it, exactly as a dangling target in that field is (`warn-block-reference-dangling`). A reader emitting one out-of-range code across every reference field passes the core-anchor case and fails here — which matters because the rows diverge in the frozen column, contested for these fields on the reasoning CDX-E-BLOCK-REFERENCE-DANGLING records.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.2, 7.3, 11; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:9ba8fa85b8abb2d3e63ba8bcdf4e3314cd0d456051f9c40c1533f459c879445c' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"Hello, world!"}]},{"type":"semantic:ref","target":"#p1/20-25"}]}', 'Block Reference Out Of Range'),
    ),
    expect: warnOnly('CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'warn-cross-reference-position-out-of-range',
    description: 'An `academic:theorem-ref` mark whose `target` `#p1/20-25` resolves to a block holding 13 code points. WARNING in EVERY state under §5.4.2\'s extension-cross-reference row, where the two cases above escalate when frozen — so a reader reusing the core-anchor row\'s code here would hold a stale offset in a render-time reference to a HARSHER frozen disposition than a missing target in the same mark, which is the inversion the three-code split exists to prevent. The mark targets a PARAGRAPH deliberately, and that is the only shape in which this code can fire: a position addresses the concatenated text of a text-bearing block (§3), so a `*-ref` naming a theorem or equation block instead carries the structural CDX-E-ANCHOR-POSITION-INVALID, whose disposition is null. Anchors & References §7.2 tabulates this condition as escalating regardless of the field, against §5.4.2\'s row — a conflict recorded, not settled (design-decisions OQ-011).',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.3, 11; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:664d9cbcb48ba2ea8136a6c8a31d7e33851dc3b2f92ab966411f4b6c4a9e977f' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"Hello, world!"}]},{"type":"paragraph","children":[{"type":"text","value":"see","marks":[{"type":"academic:theorem-ref","target":"#p1/20-25"}]}]}]}', 'Cross Reference Out Of Range'),
    ),
    expect: warnOnly('CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE'),
  },
  {
    name: 'warn-annotation-anchor-position-non-ascii-digits',
    description: 'An out-of-hash annotation anchoring by the URI form with an ARABIC-INDIC digit — `#p1/0-٥` — against a five-code-point block. The Content Anchor URI grammar (Anchors & References section 2.1) and `contentAnchorUri`\'s pattern both admit `[0-9]` only, so this is not a range at all but a structurally invalid position; either way the out-of-hash row reports one code. The case exists to pin the GRAMMAR rather than the disposition, and specifically to hold the independent oracle to it: a Python implementation writing `\\d` matches every Unicode decimal digit and `int()` accepts them, so it parses this as the in-bounds range 0-5 and reports NOTHING — silently agreeing with a reader that has stopped checking. The same shape catches an oracle whose `$` matches before a trailing newline.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 2.1, 2.2, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:3e33d6d0dae9648aaf1598d3bef37281c04197096743f973ce2194d54e5c6111' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"short"}]}]}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Annotation Anchor Non ASCII Digits') },
        { name: 'security/annotations.json', text: '{"version":"0.1","annotations":[{"id":"a1","type":"comment","anchor":"#p1/0-\\u0665","author":{"name":"A"},"created":"2025-01-10T08:00:00Z","content":"ok"}]}' },
      ],
    ),
    expect: warnOnly('CDX-E-ANNOTATION-ANCHOR-POSITION-INVALID'),
  },
  {
    name: 'positive-annotation-anchor-position-integral-float',
    description: 'A CLEAN out-of-hash annotation whose `offset` is written `1.0` in the stored bytes. JSON Schema `integer` accepts an integral float and `contentAnchor` declares these fields that way, so this is a conformant anchor at offset 1 into a five-code-point block. The control for an over-strict integrality test: an implementation rejecting any non-`int` runtime type reports a defect here on a conformant document. It is invisible to an obvious probe, since a JSON serializer writes `1.0` back out as `1` — only hand-written bytes reach the case, which is why it needs a fixture rather than a generated one. CLEAN.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 2.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:3e33d6d0dae9648aaf1598d3bef37281c04197096743f973ce2194d54e5c6111' } }),
      [
        { name: 'content/document.json', text: '{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","children":[{"type":"text","value":"short"}]}]}' },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Annotation Anchor Integral Float') },
        { name: 'security/annotations.json', text: '{"version":"0.1","annotations":[{"id":"a1","type":"comment","anchor":{"blockId":"p1","offset":1.0},"author":{"name":"A"},"created":"2025-01-10T08:00:00Z","content":"ok"}]}' },
      ],
    ),
    expect: CLEAN,
  },
  {
    name: 'warn-annotation-anchor-position-malformed',
    description: 'A comment anchor carrying `offset` ALONGSIDE `start`/`end`. Anchors & References section 2.2 states the combination rule directly — an anchor has no position fields, `offset` only, or both `start` and `end` — and this names two incompatible positions at once, so a reader cannot tell which the author meant. Schema-valid: the three fields are each declared and the rule is prose, so nothing but a dedicated check catches it. The STRUCTURAL sibling of `warn-annotation-anchor-position-out-of-range`, which exercises the same code by the bounds arm; out of hash both arms share one code, since both take the same §5.4.2 row in both columns.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References section 2.2; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH } }),
      [
        { name: 'content/document.json', text: CONTENT_PARAGRAPH },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Annotation Anchor Malformed Position') },
        { name: 'security/annotations.json', text: '{"version":"0.1","annotations":[{"id":"a1","type":"comment","anchor":{"blockId":"p1","offset":0,"start":0,"end":1},"author":{"name":"A"},"created":"2025-01-10T08:00:00Z","content":"ok"}]}' },
      ],
    ),
    expect: warnOnly('CDX-E-ANNOTATION-ANCHOR-POSITION-INVALID'),
  },
  {
    name: 'warn-annotation-anchor-position-out-of-range',
    description: 'A core annotations file whose comment anchors at a block that EXISTS — so the dangling row does not fire — with a range running past the end of that block\'s text. WARNING in every state: the annotation layer is bound by neither the document hash nor the manifest projection, so its defect cannot signal tampering. Unlike hashed content, the out-of-hash arm carries ONE code for both the structural and the out-of-bounds cases, because both take the same section 5.4.2 row in both columns.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Anchors and References sections 3, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: CONTENT_PARAGRAPH_HASH } }),
      [
        { name: 'content/document.json', text: CONTENT_PARAGRAPH },
        { name: 'metadata/dublin-core.json', text: dublinCoreJson('Annotation Anchor Out Of Range') },
        { name: 'security/annotations.json', text: '{"version":"0.1","annotations":[{"id":"a1","type":"comment","anchor":{"blockId":"p1","start":20,"end":25},"author":{"name":"A"},"created":"2025-01-10T08:00:00Z","content":"ok"}]}' },
      ],
    ),
    expect: warnOnly('CDX-E-ANNOTATION-ANCHOR-POSITION-INVALID'),
  },
  {
    name: 'warn-anchor-position-masked-by-derived-field',
    description: 'A `link` mark href `#target/0-25` whose target block holds 5 code points, so the range runs off the end — while an EARLIER block carries, inside a `crdt` payload, a decoy spelling the same `target` id with 30 code points of text. Document Hashing section 4.3.1 item 1 deletes `crdt`, so the decoy is not in the document and not in the shared identifier namespace: the anchor addresses the real block and is out of range. A reader whose anchor-target map comes from a walk that does not reproduce the canonical transforms lets the decoy claim the id first and reports NOTHING. Nothing else fires here — the id resolves, so this is not the dangling row, and only one occurrence is in the namespace, so it is not a collision — which is why the finding cannot be reached by accident.',
    layer: 'document',
    requires: ['container', 'document'],
    clause: 'Document Hashing section 4.3.1 item 1; Anchors and References sections 3, 7.2, 7.3; State Machine section 5.4.2',
    recipe: documentArchive(
      manifestJson({ content: { path: 'content/document.json', hash: 'sha256:f22dbd912af5a1c0fd9f44eb8747718c3d2380d04c271b23967ae184dfe3e58f' } }),
      contentBody('{"version":"0.1","blocks":[{"type":"paragraph","id":"p1","crdt":{"shadow":{"type":"paragraph","id":"target","children":[{"type":"text","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}},"children":[{"type":"text","value":"see","marks":[{"type":"link","href":"#target/0-25"}]}]},{"type":"paragraph","id":"target","children":[{"type":"text","value":"short"}]}]}', 'Anchor Position Masked By Derived Field'),
    ),
    expect: warnOnly('CDX-E-ANCHOR-POSITION-OUT-OF-RANGE'),
  },
];

/** The committed case.json object for a case (key order is the on-disk order). */
export function caseDescriptor(c: AuthoredCase): Record<string, unknown> {
  const obj: Record<string, unknown> = { description: c.description, layer: c.layer };
  if (c.requires) obj.requires = c.requires;
  if (c.clause) obj.clause = c.clause;
  obj.recipe = c.recipe;
  obj.expect = c.expect;
  return obj;
}

/** Byte-canonical case.json text — the single serializer for build AND check. */
export function caseJson(c: AuthoredCase): string {
  return JSON.stringify(caseDescriptor(c), null, 2) + '\n';
}
