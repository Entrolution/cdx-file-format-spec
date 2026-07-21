/**
 * Spec-conformant ZIP reader for the CDX container layer (Container Format 01
 * §3.5, §9.1, §9.2, §9.3).
 *
 * This IS document-level reference logic: an independent implementation must
 * agree with its accept/reject decisions. It is the first archive-layer reader
 * in the repository. Its contract is deliberately narrow:
 *
 *  - It reports **container-level DEFECTS as stable codes** (conformance/errors.json)
 *    together with the archive's entry set. It never invents a disposition — the
 *    disposition mapper resolves each code to IGNORE/WARNING/INTEGRITY-ERROR/REJECT
 *    from errors.json (State Machine §5.4).
 *  - It operates on **bytes in memory only** and never extracts to disk. The
 *    fixture corpus contains zip-slip names, case collisions and symlink entries
 *    by design; materializing them would attack the checkout.
 *
 * Correctness bar — reject what the spec rejects WITHOUT false-rejecting real
 * archives produced by ordinary tools:
 *  - **Central-directory-authoritative** (§3.5): CRC and sizes come from the CD,
 *    never the local file header. The LFH↔CD cross-check is over the NAME SET and
 *    existence only, never header-field byte-equality — because a streaming
 *    producer (general-purpose flag bit 3) legitimately writes zero CRC/sizes in
 *    the LFH, and LFH vs CD carry different extra fields and version bytes.
 *  - Handles a prepended self-extracting stub: offsets are taken relative to the
 *    actual start of the central directory, so a valid stubbed archive parses.
 *  - Reads names from raw bytes as UTF-8 (§3.1 bit 11) and validates
 *    well-formedness there, never through a lenient decoder.
 */

import * as zlib from 'zlib';
import { crc32 } from './zip-crc.js';

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

/** A detected container-level defect. `code` is a conformance/errors.json id;
 *  the disposition mapper turns it into a §5.4 disposition. */
export interface ArchiveFinding {
  code: string;
  detail: string;
}

export interface ArchiveEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ArchiveResult {
  /** Entry set as enumerated by the central directory (the authoritative index). */
  entries: ArchiveEntry[];
  findings: ArchiveFinding[];
}

/** Bounds for the decompression-bomb defence (§9.2). Values are
 *  implementation-defined (§5.3); these are reasonable defaults. A fixture bomb
 *  must exceed ANY plausible conformant bound, not merely these.
 *
 *  The absolute caps sit ABOVE the §5.2 support floor (an implementation MUST
 *  support individual files up to 50 MB), so a legitimate large file is never
 *  rejected. The ratio check is gated on `ratioFloor`: a small file is harmless
 *  at any compression ratio (repetitive JSON legitimately hits 100:1+), so ratio
 *  is only a bomb signal once the DECLARED decompressed size is itself large. */
export interface ReaderBounds {
  maxRatio: number; // decompressed / compressed, only above ratioFloor
  ratioFloor: number; // decompressed bytes below which ratio is ignored
  maxEntrySize: number; // per-entry decompressed bytes
  maxTotalSize: number; // total decompressed bytes
}

export const DEFAULT_BOUNDS: ReaderBounds = {
  maxRatio: 1000,
  ratioFloor: 1 * 1024 * 1024, // 1 MiB
  maxEntrySize: 500 * 1024 * 1024, // 500 MB (§5.1 recommended; > 50 MB floor)
  maxTotalSize: 2 * 1024 * 1024 * 1024, // 2 GB (§5.1 recommended total)
};

// Signatures
const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

const HOST_UNIX = 3;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

const WINDOWS_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// ---------------------------------------------------------------------------
// Container defect codes (must exist in conformance/errors.json)
// ---------------------------------------------------------------------------

export const CODE = {
  UNREADABLE: 'CDX-E-ARCHIVE-UNREADABLE',
  DUPLICATE_ENTRY: 'CDX-E-ARCHIVE-DUPLICATE-ENTRY',
  CASE_COLLISION: 'CDX-E-ARCHIVE-CASE-COLLISION',
  LFH_CD_DISAGREEMENT: 'CDX-E-ARCHIVE-LFH-CD-DISAGREEMENT',
  DATA_OUTSIDE_CD: 'CDX-E-ARCHIVE-DATA-OUTSIDE-CD',
  UNSAFE_NAME: 'CDX-E-ARCHIVE-UNSAFE-NAME',
  SYMLINK: 'CDX-E-ARCHIVE-SYMLINK-ENTRY',
  DECOMPRESSION_BOMB: 'CDX-E-ARCHIVE-DECOMPRESSION-BOMB',
  CRC_MISMATCH: 'CDX-E-ARCHIVE-CRC-MISMATCH',
  FIRST_FILE_NOT_MANIFEST: 'CDX-E-ARCHIVE-FIRST-FILE-NOT-MANIFEST',
  ENCRYPTION_USED: 'CDX-E-ARCHIVE-ENCRYPTION-USED',
  MULTI_VOLUME: 'CDX-E-ARCHIVE-MULTI-VOLUME',
} as const;

const GP_FLAG_ENCRYPTED = 0x0001; // general-purpose bit 0
const GP_FLAG_DATA_DESCRIPTOR = 0x0008; // general-purpose bit 3 (streaming)
const SIG_DATA_DESCRIPTOR = 0x08074b50;

/** The archive-relative path of the required manifest (Container §4.2). */
const MANIFEST_NAME = 'manifest.json';

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/** Parse and validate an archive. Never throws for a malformed archive: an
 *  unreadable archive is reported as a finding, not an exception. */
export function readArchive(bytes: Buffer, bounds: ReaderBounds = DEFAULT_BOUNDS): ArchiveResult {
  const findings: ArchiveFinding[] = [];
  const add = (code: string, detail: string) => findings.push({ code, detail });

  const eocd = locateEocd(bytes);
  if (!eocd) {
    add(CODE.UNREADABLE, 'no End Of Central Directory record found');
    return { entries: [], findings };
  }

  // Multi-volume archive (§3.1): an EOCD disk field is non-zero.
  if (eocd.diskThis !== 0 || eocd.diskCd !== 0) {
    add(CODE.MULTI_VOLUME, `multi-volume archive (disk fields ${eocd.diskThis}/${eocd.diskCd})`);
  }

  // The central directory ends just before any ZIP64 trailer and the classic
  // EOCD. A self-extracting-stub prefix shifts every physical offset by the same
  // delta; local offsets are corrected by it.
  const actualCdStart = eocd.pos - eocd.trailerBefore - eocd.cdSize;
  const stubDelta = actualCdStart - eocd.cdOffset;

  const central = parseCentralDirectory(bytes, actualCdStart, eocd.cdCount, add);
  if (central === null) {
    // parse error already recorded as UNREADABLE
    return { entries: [], findings };
  }

  // Duplicate / case-collision detection over the CD name set (§3.5).
  detectDuplicates(central, add);

  // Per-entry name safety (§9.1), symlink (§9.3), and ZIP encryption (§3.1).
  for (const c of central) {
    checkNameSafety(c.rawName, add);
    if (isSymlink(c)) add(CODE.SYMLINK, `symlink entry: ${safeLabel(c.rawName)}`);
    if ((c.flags & GP_FLAG_ENCRYPTED) !== 0) add(CODE.ENCRYPTION_USED, `ZIP-encrypted entry: ${safeLabel(c.rawName)}`);
  }

  // Local-header cross-check: every CD entry must have a local header with the
  // same name at its (delta-corrected) offset; and no stray local entry may
  // exist that the CD does not enumerate (data outside the central directory).
  crossCheckLocalHeaders(bytes, central, stubDelta, actualCdStart, add);

  // First archive entry must be manifest.json (§4.2) — a WARNING when not.
  checkFirstFile(bytes, add);

  // Decompression bounds (§9.2) — evaluated from DECLARED sizes, before any
  // inflate, so a declared-ratio bomb is rejected without being expanded. Every
  // flagged entry is recorded so CRC verification never expands it.
  const bombEntries = new Set<number>();
  let total = 0;
  for (let i = 0; i < central.length; i++) {
    const c = central[i];
    if (
      c.uncompressedSize > bounds.ratioFloor &&
      c.compressedSize > 0 &&
      c.uncompressedSize / c.compressedSize > bounds.maxRatio
    ) {
      add(CODE.DECOMPRESSION_BOMB, `declared ratio ${(c.uncompressedSize / c.compressedSize).toFixed(0)}:1 for ${safeLabel(c.rawName)}`);
      bombEntries.add(i);
    }
    if (c.uncompressedSize > bounds.maxEntrySize) {
      add(CODE.DECOMPRESSION_BOMB, `declared size ${c.uncompressedSize} for ${safeLabel(c.rawName)}`);
      bombEntries.add(i);
    }
    total += c.uncompressedSize;
  }
  if (total > bounds.maxTotalSize) add(CODE.DECOMPRESSION_BOMB, `declared total ${total}`);

  const entries: ArchiveEntry[] = central.map((c) => ({
    name: c.name,
    method: c.method,
    crc: c.crc,
    compressedSize: c.compressedSize,
    uncompressedSize: c.uncompressedSize,
    localOffset: c.localOffset + stubDelta, // EFFECTIVE physical offset
  }));

  // CRC-32 verification (§6.1) — over an entry with a present, name-matching
  // local header, skipping any the bomb bound flagged so a declared-huge entry
  // is never expanded. A disagreement (below) already covers a mismatched header.
  for (let i = 0; i < central.length; i++) {
    const c = central[i];
    const e = entries[i];
    if (bombEntries.has(i)) continue; // a flagged bomb is never expanded
    const off = e.localOffset;
    if (off < 0 || off + 30 > bytes.length || bytes.readUInt32LE(off) !== SIG_LFH) continue;
    const nameLen = bytes.readUInt16LE(off + 26);
    if (!bytes.subarray(off + 30, off + 30 + nameLen).equals(c.rawName)) continue;
    try {
      if (crc32(inflateEntry(bytes, e, bounds)) !== c.crc) {
        add(CODE.CRC_MISMATCH, `CRC-32 mismatch for ${safeLabel(c.rawName)}`);
      }
    } catch {
      // A structural problem already surfaced elsewhere; don't double-report.
    }
  }

  return { entries, findings };
}

/** The physically-first archive entry must be manifest.json (Container §4.2). */
function checkFirstFile(bytes: Buffer, add: (code: string, detail: string) => void): void {
  const off = firstLocalHeader(bytes);
  if (off < 0 || off + 30 > bytes.length) return;
  const nameLen = bytes.readUInt16LE(off + 26);
  const name = bytes.subarray(off + 30, off + 30 + nameLen);
  if (name.toString('utf8') !== MANIFEST_NAME) {
    add(CODE.FIRST_FILE_NOT_MANIFEST, `first entry is ${safeLabel(name)}, not ${JSON.stringify(MANIFEST_NAME)}`);
  }
}

// ---------------------------------------------------------------------------
// EOCD location (with ZIP64 awareness)
// ---------------------------------------------------------------------------

interface Eocd {
  pos: number; // byte offset of the classic EOCD signature
  cdOffset: number; // declared central-directory offset
  cdSize: number;
  cdCount: number;
  diskThis: number; // EOCD "number of this disk"
  diskCd: number; // EOCD "disk where the central directory starts"
  trailerBefore: number; // bytes between the CD end and the classic EOCD (ZIP64 records)
}

function locateEocd(bytes: Buffer): Eocd | null {
  // Scan backward for the EOCD signature; the trailing comment is up to 65535
  // bytes, so search that window plus the 22-byte record.
  const minPos = Math.max(0, bytes.length - (0xffff + 22));
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (bytes.readUInt32LE(i) === SIG_EOCD) {
      const commentLen = bytes.readUInt16LE(i + 20);
      if (i + 22 + commentLen === bytes.length) {
        let cdOffset = bytes.readUInt32LE(i + 16);
        let cdSize = bytes.readUInt32LE(i + 12);
        let cdCount = bytes.readUInt16LE(i + 10);
        const diskThis = bytes.readUInt16LE(i + 4);
        const diskCd = bytes.readUInt16LE(i + 6);
        // A ZIP64 EOCD record + locator, if present, sits physically between the
        // central directory and this classic EOCD; some archivers emit it even
        // for small archives. Its counts override the (possibly 0xFFFF-marked)
        // classic ones, and its size is part of the trailer before the EOCD.
        const z64 = locateZip64(bytes, i);
        let trailerBefore = 0;
        if (z64) {
          cdOffset = z64.cdOffset;
          cdSize = z64.cdSize;
          cdCount = z64.cdCount;
          trailerBefore = z64.trailerBefore;
        }
        return { pos: i, cdOffset, cdSize, cdCount, diskThis, diskCd, trailerBefore };
      }
    }
  }
  return null;
}

/** Locate a v1 ZIP64 EOCD (56-byte record) + 20-byte locator immediately before
 *  the classic EOCD, reading the record PHYSICALLY — not via the locator's
 *  declared offset, which a self-extracting-stub prefix would shift.
 *
 *  Scope (B1a, store-only corpus): only the 56-byte v1 record is recognised. A
 *  v2/extensible record (size field > 44), or a genuinely > 4 GB producer that
 *  stores sizes/offsets in per-entry ZIP64 extended-info extra fields behind
 *  0xFFFFFFFF sentinels, is out of scope here and would fall through to the
 *  classic EOCD; revisit when large archives are tested. */
function locateZip64(
  bytes: Buffer,
  eocdPos: number,
): { cdOffset: number; cdSize: number; cdCount: number; trailerBefore: number } | null {
  const locPos = eocdPos - 20;
  if (locPos < 0 || bytes.readUInt32LE(locPos) !== SIG_EOCD64_LOCATOR) return null;
  const z64Pos = locPos - 56; // v1 ZIP64 EOCD record is 56 bytes
  if (z64Pos < 0 || bytes.readUInt32LE(z64Pos) !== SIG_EOCD64) return null;
  return {
    cdCount: Number(bytes.readBigUInt64LE(z64Pos + 32)),
    cdSize: Number(bytes.readBigUInt64LE(z64Pos + 40)),
    cdOffset: Number(bytes.readBigUInt64LE(z64Pos + 48)),
    trailerBefore: 20 + 56,
  };
}

// ---------------------------------------------------------------------------
// Central directory
// ---------------------------------------------------------------------------

interface CdEntry {
  rawName: Buffer;
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  versionMadeBy: number;
  externalAttrs: number;
}

function parseCentralDirectory(
  bytes: Buffer,
  start: number,
  count: number,
  add: (code: string, detail: string) => void,
): CdEntry[] | null {
  const out: CdEntry[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== SIG_CD) {
      add(CODE.UNREADABLE, `central-directory record ${i} malformed at offset ${p}`);
      return null;
    }
    const versionMadeBy = bytes.readUInt16LE(p + 4);
    const flags = bytes.readUInt16LE(p + 8);
    const method = bytes.readUInt16LE(p + 10);
    const crc = bytes.readUInt32LE(p + 16);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const uncompressedSize = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const externalAttrs = bytes.readUInt32LE(p + 38);
    const localOffset = bytes.readUInt32LE(p + 42);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    out.push({
      rawName,
      name: rawName.toString('utf8'),
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      versionMadeBy,
      externalAttrs,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Defect detectors
// ---------------------------------------------------------------------------

function detectDuplicates(central: CdEntry[], add: (code: string, detail: string) => void): void {
  const exact = new Map<string, number>();
  const folded = new Map<string, string>(); // lowercased -> first original
  for (const c of central) {
    const n = c.name;
    exact.set(n, (exact.get(n) ?? 0) + 1);
    const lower = n.toLowerCase();
    if (folded.has(lower) && folded.get(lower) !== n) {
      add(CODE.CASE_COLLISION, `case-only collision: ${safeLabel(c.rawName)} vs ${folded.get(lower)}`);
    } else if (!folded.has(lower)) {
      folded.set(lower, n);
    }
  }
  for (const [n, count] of exact) {
    if (count > 1) add(CODE.DUPLICATE_ENTRY, `duplicate entry path: ${n} (${count}x)`);
  }
}

function checkNameSafety(rawName: Buffer, add: (code: string, detail: string) => void): void {
  // Well-formed, shortest-form UTF-8: an overlong encoding can smuggle a `..`
  // past a byte comparison (§9.1). Compare a strict decode/re-encode round-trip.
  const decoded = rawName.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(rawName)) {
    add(CODE.UNSAFE_NAME, `ill-formed or overlong UTF-8 name: ${safeLabel(rawName)}`);
    return;
  }
  const name = decoded;
  const label = safeLabel(rawName);

  if (name.includes('\\')) add(CODE.UNSAFE_NAME, `backslash in name: ${label}`);
  if (name.startsWith('/')) add(CODE.UNSAFE_NAME, `absolute path: ${label}`);
  if (name.includes(':')) add(CODE.UNSAFE_NAME, `colon (drive/ADS) in name: ${label}`);

  const segments = name.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      add(CODE.UNSAFE_NAME, `parent-directory segment: ${label}`);
      continue; // "." / ".." are their own defect; don't also flag as trailing-dot
    }
    if (seg === '.') continue;
    if (seg.length > 0 && (seg.endsWith('.') || seg.endsWith(' '))) {
      add(CODE.UNSAFE_NAME, `trailing dot/space segment (Windows fold): ${label}`);
    }
    const base = seg.split('.')[0].toLowerCase();
    if (WINDOWS_DEVICE_NAMES.has(base)) add(CODE.UNSAFE_NAME, `reserved device name: ${label}`);
  }
}

function isSymlink(c: CdEntry): boolean {
  const host = c.versionMadeBy >> 8;
  if (host !== HOST_UNIX) return false;
  const mode = (c.externalAttrs >>> 16) & 0xffff;
  return (mode & S_IFMT) === S_IFLNK;
}

function crossCheckLocalHeaders(
  bytes: Buffer,
  central: CdEntry[],
  stubDelta: number,
  cdStart: number,
  add: (code: string, detail: string) => void,
): void {
  // Every CD entry must resolve to a local header with a matching name.
  for (const c of central) {
    const off = c.localOffset + stubDelta;
    if (off < 0 || off + 30 > bytes.length || bytes.readUInt32LE(off) !== SIG_LFH) {
      add(CODE.LFH_CD_DISAGREEMENT, `no local header for ${safeLabel(c.rawName)} at ${off}`);
      continue;
    }
    const nameLen = bytes.readUInt16LE(off + 26);
    const lfhName = bytes.subarray(off + 30, off + 30 + nameLen);
    if (!lfhName.equals(c.rawName)) {
      add(
        CODE.LFH_CD_DISAGREEMENT,
        `local name ${safeLabel(lfhName)} != central name ${safeLabel(c.rawName)}`,
      );
    }
  }

  // Data outside the central directory: walk the pre-CD region and confirm every
  // local header is enumerated by the CD. A header at an offset no CD entry
  // points to is a stray entry (split-view substitution). The walk advances by
  // the CENTRAL directory's authoritative compressed size, NOT the local header's
  // — a streaming producer (general-purpose bit 3) writes size 0 in the LFH and
  // defers the real size to a trailing data descriptor, so trusting the LFH size
  // would land inside the entry data and miss a following stray header.
  const cdByOffset = new Map<number, CdEntry>();
  for (const c of central) cdByOffset.set(c.localOffset + stubDelta, c);
  let p = firstLocalHeader(bytes);
  let steps = 0;
  while (p >= 0 && p + 30 <= cdStart && steps++ <= central.length) {
    if (bytes.readUInt32LE(p) !== SIG_LFH) break;
    const c = cdByOffset.get(p);
    if (c === undefined) {
      add(CODE.DATA_OUTSIDE_CD, `stray local header at ${p} not in central directory`);
      break; // one stray is enough to reject; its size is not trustworthy anyway
    }
    const nameLen = bytes.readUInt16LE(p + 26);
    const extraLen = bytes.readUInt16LE(p + 28);
    let next = p + 30 + nameLen + extraLen + c.compressedSize;
    if ((c.flags & GP_FLAG_DATA_DESCRIPTOR) !== 0 && next + 4 <= bytes.length) {
      // Optional data-descriptor signature (0x08074b50) then crc + two sizes.
      next += bytes.readUInt32LE(next) === SIG_DATA_DESCRIPTOR ? 16 : 12;
    }
    p = next;
  }
}

function firstLocalHeader(bytes: Buffer): number {
  // Honour a prepended stub: find the first local-header signature.
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) === SIG_LFH) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A printable, injection-safe label for a raw (possibly malformed) name. */
function safeLabel(rawName: Buffer): string {
  return JSON.stringify(rawName.toString('utf8'));
}

/** Decompress an entry's bytes, honouring the bound (used by callers that need
 *  content, e.g. to verify a CRC on a positive fixture). Not called during the
 *  reject path — bombs are caught by declared-size bounds before inflate. */
export function inflateEntry(bytes: Buffer, entry: ArchiveEntry, bounds: ReaderBounds = DEFAULT_BOUNDS): Buffer {
  const dataStart = entry.localOffset + 30 + bytes.readUInt16LE(entry.localOffset + 26) + bytes.readUInt16LE(entry.localOffset + 28);
  const stored = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(stored);
  const out = zlib.inflateRawSync(stored, { maxOutputLength: bounds.maxEntrySize });
  return out;
}

/** Recompute and compare an entry's CRC (Container §6.1). */
export function crcMatches(bytes: Buffer, entry: ArchiveEntry, bounds?: ReaderBounds): boolean {
  const data = inflateEntry(bytes, entry, bounds);
  return crc32(data) === entry.crc;
}
