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
