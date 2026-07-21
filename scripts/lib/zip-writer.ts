/**
 * Deterministic, minimal ZIP writer for CDX conformance FIXTURES.
 *
 * NON-NORMATIVE test infrastructure. This is NOT a general-purpose ZIP library
 * and NOT part of any implementation under test. Its sole job is to materialize
 * the byte-exact `.cdx` archive fixtures of the conformance suite's document
 * track (Container Format 01 §3) from a declarative recipe — including
 * deliberately MALFORMED archives that no off-the-shelf writer will emit
 * (local-header/central-directory disagreement, data outside the central
 * directory, duplicate and case-colliding names, symlink entries, unsafe
 * names, declared-ratio decompression bombs).
 *
 * Design constraints:
 *  - **Zero dependencies.** Byte assembly uses Node `Buffer`; the only
 *    compression path (Deflate, method 8) uses the built-in `zlib`. CRC-32 is
 *    hand-rolled. This keeps the repo's `dependencies: {}` invariant.
 *  - **Deterministic.** No timestamps, no host-OS entropy: every DOS date/time
 *    field is a fixed 1980-01-01 constant, entries emit in the given order, and
 *    no extra fields are written unless a recipe asks for them. The same recipe
 *    always produces byte-identical output, which is what lets the `check:fixtures`
 *    gate assert `rebuild(recipe) === committed case.cdx`.
 *  - **Build-time only.** The reference adapter under test reads the COMMITTED
 *    `case.cdx` bytes, never this writer — a writer bug must not be able to mask
 *    a reader bug.
 *
 * The `ZipRecipe` shape here is the on-disk `recipe.json` shape (see
 * conformance/fixtures/fixtures.schema.json); this module is the single
 * interpreter of it.
 */

import * as zlib from 'zlib';
import { crc32 } from './zip-crc.js';

// ---------------------------------------------------------------------------
// Recipe model (mirrors recipe.json)
// ---------------------------------------------------------------------------

/** One archive entry. A well-formed entry contributes one local record and one
 *  matching central-directory record; the optional fields inject malformations. */
export interface ZipEntryRecipe {
  /** Entry name as UTF-8 text. Ignored if `nameBytesBase64` is present. */
  name?: string;
  /** Raw name bytes (base64), for cases a JS string cannot express — e.g. an
   *  overlong or ill-formed UTF-8 name (Container §9.1). Overrides `name`. */
  nameBytesBase64?: string;
  /** Entry content as UTF-8 text (default: empty). */
  text?: string;
  /** Compression method. Default `store`. `deflate` is non-deterministic across
   *  zlib builds — use it only where the assertion is on decompressed content. */
  method?: 'store' | 'deflate';
  /** Mark as a Unix symbolic link: sets version-made-by host = Unix and the
   *  S_IFLNK external-attribute bits (Container §9.3). */
  symlink?: boolean;
  /** Override the declared UNCOMPRESSED size in both headers, leaving the stored
   *  bytes tiny — a declared-ratio decompression bomb (Container §9.2). */
  declaredUncompressedSize?: number;
  /** Store a deliberately wrong CRC-32 in both headers (Container §6.1). */
  wrongCrc?: boolean;
  /** Set the ZIP encryption flag (general-purpose bit 0). The bytes are not
   *  actually encrypted; the flag alone marks the container non-conformant
   *  (Container §3.1). */
  encrypted?: boolean;
  /** Emit this entry's LOCAL record but omit its central-directory record
   *  (data outside the central directory / LFH↔CD disagreement, Container §3.5). */
  omitFromCentral?: boolean;
  /** Emit this entry's CENTRAL record but omit its local record (LFH↔CD
   *  entry-set disagreement, Container §3.5). */
  omitFromLocal?: boolean;
  /** Give the central-directory record a different name from the local record
   *  (LFH↔CD disagreement, Container §3.5). */
  centralName?: string;
}

export interface ZipRecipe {
  entries: ZipEntryRecipe[];
  /** Optional archive ZIP comment (Container §4.1). */
  comment?: string;
  /** Truncate the output: `'eocd'` drops the End Of Central Directory record
   *  (archive-unreadable); a number truncates to that many bytes. */
  truncate?: 'eocd' | number;
  /** Prepend N zero bytes as a self-extracting-stub prefix. The recorded offsets
   *  (local-header offsets and the EOCD central-directory offset) are NOT advanced
   *  by the pad — they stay relative to the archive proper — so a reader must
   *  recover the stub delta from the physical EOCD position (a valid archive a
   *  naive reader mis-parses). */
  prependBytes?: number;
  /** Mark the archive multi-volume by setting the EOCD disk fields non-zero
   *  (Container §3.1). */
  multiVolume?: boolean;
  /** Emit a ZIP64 End Of Central Directory record + locator before the classic
   *  EOCD, as some archivers do even for small archives. Exercises a reader's
   *  ZIP64 EOCD path without needing a >4 GB archive. */
  zip64?: boolean;
}

// ---------------------------------------------------------------------------
// Fixed ZIP constants (deterministic — no clock, no host entropy)
// ---------------------------------------------------------------------------

const SIG_LFH = 0x04034b50; // local file header
const SIG_CD = 0x02014b50; // central directory record
const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_EOCD64 = 0x06064b50; // ZIP64 end of central directory record
const SIG_EOCD64_LOCATOR = 0x07064b50; // ZIP64 EOCD locator

const DOS_DATE_1980_01_01 = 0x0021; // day=1, month=1, year=1980
const DOS_TIME_MIDNIGHT = 0x0000;

const GP_FLAG_UTF8 = 0x0800; // bit 11: filename is UTF-8 (Container §3.1)
const GP_FLAG_ENCRYPTED = 0x0001; // bit 0: entry is encrypted (forbidden by §3.1)
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20; // 2.0
const HOST_DOS = 0;
const HOST_UNIX = 3;
const S_IFLNK = 0o120000; // symbolic-link mode bits

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function u16(v: number): Buffer {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(v & 0xffff, 0);
  return b;
}
function u32(v: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}
function u64(v: number): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(BigInt(v), 0);
  return b;
}

function entryBytes(e: ZipEntryRecipe): Buffer {
  return Buffer.from(e.text ?? '', 'utf8');
}

function entryNameBytes(name: string | undefined, nameBytesBase64: string | undefined): Buffer {
  if (nameBytesBase64 !== undefined) return Buffer.from(nameBytesBase64, 'base64');
  return Buffer.from(name ?? '', 'utf8');
}

// ---------------------------------------------------------------------------
// Prepared per-entry record (compression applied once, shared by LFH + CD)
// ---------------------------------------------------------------------------

interface Prepared {
  recipe: ZipEntryRecipe;
  localNameBytes: Buffer;
  centralNameBytes: Buffer;
  stored: Buffer; // bytes actually stored (compressed or raw)
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number; // the DECLARED size written to headers
  versionMadeBy: number;
  externalAttrs: number;
  localOffset: number; // filled during assembly
}

function prepare(e: ZipEntryRecipe): Prepared {
  const raw = entryBytes(e);
  const method = e.method === 'deflate' ? METHOD_DEFLATE : METHOD_STORE;
  const stored = method === METHOD_DEFLATE ? zlib.deflateRawSync(raw) : raw;
  const crc = e.wrongCrc ? (crc32(raw) ^ 0xffffffff) >>> 0 : crc32(raw);

  const host = e.symlink ? HOST_UNIX : HOST_DOS;
  let externalAttrs = 0;
  if (host === HOST_UNIX) {
    const mode = e.symlink ? S_IFLNK | 0o777 : 0o644;
    externalAttrs = (mode << 16) >>> 0;
  }

  return {
    recipe: e,
    localNameBytes: entryNameBytes(e.name, e.nameBytesBase64),
    centralNameBytes:
      e.centralName !== undefined ? Buffer.from(e.centralName, 'utf8') : entryNameBytes(e.name, e.nameBytesBase64),
    stored,
    method,
    flags: GP_FLAG_UTF8 | (e.encrypted ? GP_FLAG_ENCRYPTED : 0),
    crc,
    compressedSize: stored.length,
    uncompressedSize: e.declaredUncompressedSize !== undefined ? e.declaredUncompressedSize : raw.length,
    versionMadeBy: (host << 8) | VERSION_NEEDED,
    externalAttrs,
    localOffset: 0,
  };
}

// ---------------------------------------------------------------------------
// Header emission
// ---------------------------------------------------------------------------

function localHeader(p: Prepared): Buffer {
  return Buffer.concat([
    u32(SIG_LFH),
    u16(VERSION_NEEDED),
    u16(p.flags),
    u16(p.method),
    u16(DOS_TIME_MIDNIGHT),
    u16(DOS_DATE_1980_01_01),
    u32(p.crc),
    u32(p.compressedSize),
    u32(p.uncompressedSize),
    u16(p.localNameBytes.length),
    u16(0), // extra field length
    p.localNameBytes,
    p.stored,
  ]);
}

function centralHeader(p: Prepared): Buffer {
  return Buffer.concat([
    u32(SIG_CD),
    u16(p.versionMadeBy),
    u16(VERSION_NEEDED),
    u16(p.flags),
    u16(p.method),
    u16(DOS_TIME_MIDNIGHT),
    u16(DOS_DATE_1980_01_01),
    u32(p.crc),
    u32(p.compressedSize),
    u32(p.uncompressedSize),
    u16(p.centralNameBytes.length),
    u16(0), // extra field length
    u16(0), // comment length
    u16(0), // disk number start
    u16(0), // internal attributes
    u32(p.externalAttrs),
    u32(p.localOffset),
    p.centralNameBytes,
  ]);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Build a `.cdx` archive from a recipe, returning the exact bytes. */
export function buildZip(recipe: ZipRecipe): Buffer {
  const prepared = recipe.entries.map(prepare);

  const chunks: Buffer[] = [];
  let offset = 0;

  if (recipe.prependBytes && recipe.prependBytes > 0) {
    // Self-extracting-stub prefix: physically shifts the archive but `offset` is
    // NOT advanced, so every recorded offset stays relative to the archive proper
    // and the reader must recover the delta (stubDelta > 0). Do not merge this
    // into the LFH loop's offset accounting.
    chunks.push(Buffer.alloc(recipe.prependBytes, 0));
  }

  // Local file headers + data, in order (skip entries marked local-omitted).
  for (const p of prepared) {
    if (p.recipe.omitFromLocal) continue;
    p.localOffset = offset;
    const lfh = localHeader(p);
    chunks.push(lfh);
    offset += lfh.length;
  }

  // Central directory (skip entries marked central-omitted).
  const cdOffset = offset;
  let cdSize = 0;
  let cdCount = 0;
  for (const p of prepared) {
    if (p.recipe.omitFromCentral) continue;
    const cd = centralHeader(p);
    chunks.push(cd);
    cdSize += cd.length;
    cdCount++;
  }

  // Optional ZIP64 EOCD record + locator, sitting physically between the CD and
  // the classic EOCD (a v1 56-byte record, as ordinary archivers emit).
  const zip64Parts: Buffer[] = [];
  if (recipe.zip64) {
    const z64Offset = cdOffset + cdSize; // physical: immediately after the CD
    const eocd64 = Buffer.concat([
      u32(SIG_EOCD64),
      u64(44), // size of the remainder of this record (56 - 12)
      u16(VERSION_NEEDED),
      u16(VERSION_NEEDED),
      u32(0), // this disk
      u32(0), // disk with start of central directory
      u64(cdCount),
      u64(cdCount),
      u64(cdSize),
      u64(cdOffset),
    ]);
    const locator = Buffer.concat([
      u32(SIG_EOCD64_LOCATOR),
      u32(0), // disk with the ZIP64 EOCD
      u64(z64Offset),
      u32(1), // total number of disks
    ]);
    zip64Parts.push(eocd64, locator);
  }

  // End of central directory.
  const disk = recipe.multiVolume ? 1 : 0;
  const commentBytes = recipe.comment !== undefined ? Buffer.from(recipe.comment, 'utf8') : Buffer.alloc(0);
  const eocd = Buffer.concat([
    u32(SIG_EOCD),
    u16(disk), // this disk number
    u16(disk), // disk with start of central directory
    u16(cdCount), // central-directory records on this disk
    u16(cdCount), // total central-directory records
    u32(cdSize),
    u32(cdOffset),
    u16(commentBytes.length),
    commentBytes,
  ]);

  let out = Buffer.concat([...chunks, ...zip64Parts, eocd]);

  if (recipe.truncate === 'eocd') {
    out = out.subarray(0, out.length - eocd.length);
  } else if (typeof recipe.truncate === 'number') {
    out = out.subarray(0, Math.max(0, recipe.truncate));
  }

  return out;
}
