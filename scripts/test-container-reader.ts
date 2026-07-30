#!/usr/bin/env npx tsx

/**
 * Unit tests for the container reader's compression-method handling
 * (scripts/lib/zip-reader.ts).
 *
 * WHY THIS FILE EXISTS. Two of the three outcomes here cannot be asserted through the Level-1
 * fixture corpus:
 *
 *   - `CDX-E-ARCHIVE-ENTRY-INTEGRITY-INDETERMINATE` carries a NULL disposition (it is not a
 *     defect — Container Format §3.2 makes Zstandard RECOMMENDED, not required, so a reader
 *     without it is conformant). The fixture comparator runs `isDisposition(d)`, which fails
 *     for null, so no fixture can assert it. See the sibling rationale in
 *     scripts/test-document-verdict.ts.
 *   - The same finding only arises on a runtime LACKING `zlib.zstdDecompressSync`, which the
 *     reader captures at module load. A test therefore has to run it in a child process with
 *     the API hidden by a preload — there is no in-process seam, and adding one to production
 *     code purely for a test would be worse than spawning.
 *
 * The bug this pins: `inflateEntry` used to treat EVERY non-Store method as raw Deflate, so a
 * Zstandard entry threw a confusing zlib error, both callers swallowed it, and the archive
 * reported CLEAN with its CRC-32 and every hash over those bytes silently unverified.
 *
 * Run: `npm run test:container-reader`.
 */

import assert from 'assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as zlib from 'zlib';
import { buildZip } from './lib/zip-writer.js';
import { readArchive, inflateEntry, canDecompress, InflateError, METHOD_STORE, METHOD_DEFLATE, METHOD_ZSTD } from './lib/zip-reader.js';

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

const MANIFEST = { name: 'manifest.json', text: '{"cdx":"0.1","state":"draft"}' } as const;
const CONTENT = '{"version":"0.1","blocks":[]}';

/** Codes the container reader reports for an archive built from these entries. */
const codesFor = (entries: Parameters<typeof buildZip>[0]['entries']): string[] =>
  readArchive(buildZip({ entries })).findings.map((f) => f.code);

// --- the permitted set is closed --------------------------------------------

test('a method outside §3.2\'s permitted set is REJECTed, never guessed at', () => {
  // §3.2: a reader "MUST NOT infer a method from the data, and in particular MUST NOT treat
  // an unrecognized method as Deflate". Before the fix this archive reported clean.
  for (const method of [1, 12, 14, 99, 65535]) {
    const codes = codesFor([MANIFEST, { name: 'content/document.json', text: CONTENT, methodCodeOverride: method }]);
    assert.ok(codes.includes('CDX-E-ARCHIVE-COMPRESSION-METHOD-FORBIDDEN'), `method ${method} must be reported forbidden, got ${JSON.stringify(codes)}`);
  }
});

test('every permitted method is accepted and its CRC verified', () => {
  // Store and Deflate are always available; Zstandard only where the runtime provides it.
  const methods: Array<'store' | 'deflate' | 'zstd'> = ['store', 'deflate'];
  if (canDecompress(METHOD_ZSTD)) methods.push('zstd');
  for (const method of methods) {
    const codes = codesFor([MANIFEST, { name: 'content/document.json', text: CONTENT, method }]);
    assert.deepEqual(codes, [], `method ${method} must read cleanly, got ${JSON.stringify(codes)}`);
  }
});

// --- undecodable bytes are not silently clean --------------------------------

test('bytes that will not decode under a SUPPORTED method are reported, not swallowed', () => {
  // A Store payload relabelled Deflate: raw-inflate cannot decode it at all. Nothing else in
  // the reader owns this — the local-header/central-directory cross-check compares names and
  // existence only, and the decompression bound reads DECLARED sizes.
  const codes = codesFor([MANIFEST, { name: 'content/document.json', text: 'plain text, not a deflate stream', methodCodeOverride: METHOD_DEFLATE }]);
  assert.ok(codes.includes('CDX-E-ARCHIVE-ENTRY-UNDECODABLE'), `expected undecodable, got ${JSON.stringify(codes)}`);
  assert.ok(!codes.includes('CDX-E-ARCHIVE-CRC-MISMATCH'), 'no checksum could be computed, so a mismatch would misdescribe it');
});

test('bytes that DO decode but checksum wrong remain a CRC mismatch', () => {
  // The counterpart: the two must not collapse into one another.
  const codes = codesFor([MANIFEST, { name: 'content/document.json', text: CONTENT, wrongCrc: true }]);
  assert.ok(codes.includes('CDX-E-ARCHIVE-CRC-MISMATCH'), `expected CRC mismatch, got ${JSON.stringify(codes)}`);
  assert.ok(!codes.includes('CDX-E-ARCHIVE-ENTRY-UNDECODABLE'), 'the bytes decoded fine');
});

test('an entry that inflates past the bound is a BOMB, not corruption', () => {
  // The §9.2 pre-pass screens DECLARED sizes, and those are attacker-controlled — so an
  // entry understating its uncompressed size walks past it and only the actual output limit
  // catches it. Filing that as "corrupt or truncated" would describe an attack as an
  // accident, under a code whose note explicitly distinguishes itself from the bomb row.
  const bytes = buildZip({ entries: [MANIFEST, { name: 'content/document.json', text: 'A'.repeat(8_000_000), method: 'deflate', declaredUncompressedSize: 40 }] });
  const codes = readArchive(bytes, { maxRatio: 1e9, ratioFloor: 1e9, maxEntrySize: 1_000_000, maxTotalSize: 1e9 }).findings.map((f) => f.code);
  assert.ok(codes.includes('CDX-E-ARCHIVE-DECOMPRESSION-BOMB'), `expected the bomb row, got ${JSON.stringify(codes)}`);
  assert.ok(!codes.includes('CDX-E-ARCHIVE-ENTRY-UNDECODABLE'), 'a bomb is not corruption');
});

// --- the typed error contract ------------------------------------------------

test('inflateEntry always throws a TYPED error, for every method and every bad offset', () => {
  // The earlier version of this test asserted only `method: 99`, so it passed while the
  // permitted methods still let a bare RangeError escape from the header read — the untyped
  // escape every caller's `instanceof InflateError` guard drops silently. Sweep the methods.
  const check = (method: number, localOffset: number, expected: string) => {
    const entry = { name: 'x', method, crc: 0, compressedSize: 0, uncompressedSize: 0, localOffset };
    assert.throws(
      () => inflateEntry(Buffer.alloc(64), entry),
      (err: unknown) => err instanceof InflateError && err.failure === expected,
      `method ${method} at offset ${localOffset} must throw a typed ${expected}`,
    );
  };
  for (const method of [METHOD_STORE, METHOD_DEFLATE, METHOD_ZSTD]) {
    check(method, 1 << 30, 'corrupt'); // past the end of the buffer
    check(method, -1, 'corrupt'); // NEGATIVE offsets previously threw nothing and returned short bytes
  }
  // A forbidden method is classified without touching the archive at all, so a bad offset
  // must not mask it.
  check(99, 1 << 30, 'method-forbidden');
});

test('canDecompress agrees with what inflateEntry actually does', () => {
  assert.equal(canDecompress(METHOD_STORE), true);
  assert.equal(canDecompress(METHOD_DEFLATE), true);
  assert.equal(canDecompress(99), false, 'a forbidden method is never decompressible');
  // For zstd the two must not disagree: if canDecompress says yes, a real zstd entry reads.
  if (canDecompress(METHOD_ZSTD)) {
    assert.deepEqual(codesFor([MANIFEST, { name: 'content/document.json', text: CONTENT, method: 'zstd' }]), []);
  }
});

// --- the indeterminate path, in a child process without zstd -----------------

test('a Deflate-only reader reports a Zstandard entry INDETERMINATE, not clean and not failed', () => {
  // §5.4.2 note 6: such a reader is conformant and the document is not defective, but the
  // entry MUST NOT be reported as verified and MUST NOT be silently treated as clean. This is
  // the arm no fixture can assert, because the code carries a null disposition.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdx-nozstd-'));
  try {
    const preload = path.join(dir, 'hide-zstd.cjs');
    fs.writeFileSync(preload, "const z = require('zlib'); delete z.zstdDecompressSync;\n");

    // Build the archive HERE (where zstd may exist) and hand the bytes to the child, so the
    // child only has to READ them.
    const zstdAvailable = typeof (zlib as { zstdCompressSync?: unknown }).zstdCompressSync === 'function';
    const entry = zstdAvailable
      ? { name: 'content/document.json', text: CONTENT, method: 'zstd' as const }
      : { name: 'content/document.json', text: CONTENT, methodCodeOverride: METHOD_ZSTD };
    const archive = path.join(dir, 'case.cdx');
    fs.writeFileSync(archive, buildZip({ entries: [MANIFEST, entry] }));

    const script = path.join(dir, 'probe.ts');
    fs.writeFileSync(
      script,
      `import * as fs from 'fs';\n` +
        `import { readArchive, canDecompress, METHOD_ZSTD } from ${JSON.stringify(path.resolve('scripts/lib/zip-reader.ts'))};\n` +
        `const r = readArchive(fs.readFileSync(${JSON.stringify(archive)}));\n` +
        `console.log(JSON.stringify({ zstd: canDecompress(METHOD_ZSTD), codes: r.findings.map(f => f.code) }));\n`,
    );

    const out = execFileSync('npx', ['tsx', '--require', preload, script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const result = JSON.parse(out.trim().split('\n').pop()!) as { zstd: boolean; codes: string[] };

    assert.equal(result.zstd, false, 'the child must genuinely lack zstd, or this test proves nothing');
    assert.ok(result.codes.includes('CDX-E-ARCHIVE-ENTRY-INTEGRITY-INDETERMINATE'), `expected indeterminate, got ${JSON.stringify(result.codes)}`);
    assert.ok(!result.codes.includes('CDX-E-ARCHIVE-COMPRESSION-METHOD-FORBIDDEN'), 'Zstandard IS permitted; only unimplemented here');
    assert.ok(!result.codes.includes('CDX-E-ARCHIVE-CRC-MISMATCH'), 'no CRC could be computed, so a mismatch would be a false accusation');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
