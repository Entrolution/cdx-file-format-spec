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
 * SCOPE (B1a). Container layer only. Every committed archive uses Store (method 0)
 * so its bytes are byte-stable across zlib/Node versions; Deflate support is
 * exercised in-memory by check-fixtures.ts, not by a committed archive. Part-level
 * dispositions (missing manifest/content, malformed parts) and the frozen/published
 * INTEGRITY-ERROR ceilings arrive in B1b/B3.
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

/** An exact REJECT carried by a single container finding. */
const rejectOnly = (code: string): AuthoredVerdict => ({
  documentDisposition: { atLeast: 'REJECT', atMost: 'REJECT' },
  findings: [{ code, atLeast: 'REJECT', atMost: 'REJECT' }],
});

/** An exact WARNING carried by a single container finding (readable but flawed). */
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
