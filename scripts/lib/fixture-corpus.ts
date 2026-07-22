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
    description: 'A well-formed review document with a computed document id. Accepted; the review state is valid and every part loads. (The id/hash recompute lands in a later slice; this fixture already carries the correct id so it stays clean then.)',
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
