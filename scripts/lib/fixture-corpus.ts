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

/** The standard clean content + Dublin Core entries that follow a manifest entry. */
const cleanBody = (dcTitle = 'Minimal Draft'): ZipEntryRecipe[] => [
  { name: 'content/document.json', text: CLEAN_CONTENT },
  { name: 'metadata/dublin-core.json', text: `{"version":"1.1","terms":{"title":"${dcTitle}"}}` },
];

/**
 * A body carrying a specific content part (B1b-2 block/mark-classifier cases) plus a
 * clean Dublin Core part. The content `hash` in each case's manifest is the SHA-256
 * of exactly this `contentText` (a real file hash — the mapper does not yet verify
 * it, but computing it keeps the fixtures correct for the B1b-3 recompute).
 */
const contentBody = (contentText: string, dcTitle: string): ZipEntryRecipe[] => [
  { name: 'content/document.json', text: contentText },
  { name: 'metadata/dublin-core.json', text: `{"version":"1.1","terms":{"title":"${dcTitle}"}}` },
];

/** A document archive: a manifest entry followed by the given body entries. */
const documentArchive = (manifest: string, body: ZipEntryRecipe[]): ZipRecipe => ({
  entries: [{ name: 'manifest.json', text: manifest }, ...body],
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
      manifestJson({ id: 'sha256:b580ac3b69152f9b2898b03170a58d531b6726a4f6e5ba752c77ab0ad2df0675', state: 'review' }),
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
        { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"Dup Key Case"}}' },
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
        { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"Big Number"}}' },
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
        { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"Big Float"}}' },
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
      { name: 'metadata/dublin-core.json', text: '{"version":"1.1","version":"9.9","terms":{"title":"Dup DC"}}' },
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
    recipe: documentArchive(manifestJson(), [{ name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"No Content"}}' }]),
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
        { name: 'metadata/dublin-core.json', text: '{"version":"1.1","terms":{"title":"Bad Content"}}' },
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
      manifestJson({ id: 'sha256:b580ac3b69152f9b2898b03170a58d531b6726a4f6e5ba752c77ab0ad2df0675', state: 'review' }),
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
        id: 'sha256:b580ac3b69152f9b2898b03170a58d531b6726a4f6e5ba752c77ab0ad2df0675',
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
        id: 'sha256:b580ac3b69152f9b2898b03170a58d531b6726a4f6e5ba752c77ab0ad2df067c',
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
