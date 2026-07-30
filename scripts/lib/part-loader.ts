/**
 * In-memory CDX part loader (the document/part layer, B1b).
 *
 * The container reader (zip-reader.ts) surfaces the archive's central-directory
 * entry set. This module reads a named JSON part OUT of that set — decompressing
 * the entry's bytes in memory (never to disk; the corpus carries zip-slip and
 * symlink entries by design) — and strict-JSON-parses it under the §4.3.2
 * canonical-JSON rules (`parseStrictJson`: duplicate object keys and parser
 * resource-limit exhaustion both throw).
 *
 * It reports the *mechanism* of a load failure (absent / a coded canonicalization
 * defect / an uncoded parse error) as a discriminated result. It deliberately
 * does NOT assign a §5.4 disposition or pick a part-specific defect code: that is
 * document-verdict.ts's job, because the code and disposition depend on WHICH part
 * failed and the document's state (a manifest that will not parse is a different
 * §5.4.2 row than a content part that will not parse). This mirrors the split
 * between zip-reader (detect) and archive-verdict (map) at the container layer.
 */

import { inflateEntry, InflateError, type ArchiveEntry } from './zip-reader.js';
import { parseStrictJson, CanonicalizationError } from './canonicalize.js';

/** Outcome of loading one part by its logical archive path. */
export type PartLoad =
  /** No central-directory entry with this path. */
  | { status: 'absent' }
  /**
   * Parsed cleanly; `value` is the JSON value, `text` the decoded UTF-8 string,
   * and `bytes` the exact decompressed part bytes. `bytes` is what a file-level
   * `content.hash` pins (Document Hashing §5.1) — it is hashed directly, never via
   * `text`, whose UTF-8 re-encoding could differ from the stored bytes.
   */
  | { status: 'ok'; text: string; value: unknown; bytes: Buffer }
  /**
   * Present but unloadable. `code` is the conformance code the canonicalizer
   * attached to a typed CanonicalizationError (e.g. `CDX-E-PART-DUPLICATE-KEYS`)
   * when the defect is a part-agnostic, state-invariant reject; it is `null` for
   * a bare JSON syntax error or a decompression failure, which the mapper codes
   * per-part (a manifest → unparseable-manifest; a hashed part → its own row).
   */
  | { status: 'defect'; code: string | null; detail: string }
  /**
   * Present and intact, but this reader cannot decode it: a compression method the
   * specification PERMITS and this reader has not implemented (§3.2 makes Zstandard
   * RECOMMENDED, not required). Distinct from `defect` because the document is not at
   * fault — §5.4.2 note 6 forbids the missing-part rows from firing for it, and the
   * container layer already reports the entry integrity-indeterminate. A caller that
   * needs the part's CONTENT must treat the result as indeterminate, never as absent.
   */
  | { status: 'unobtainable'; method: number; detail: string };

/**
 * The central-directory entry for an exact logical path, or undefined. Paths are
 * compared byte-for-byte as the reader decoded them (§3.4 normalization already
 * happened in zip-reader when it built the entry set), so this is an exact match.
 */
export function findEntry(entries: readonly ArchiveEntry[], path: string): ArchiveEntry | undefined {
  return entries.find((e) => e.name === path);
}

/** True iff the entry set contains an exact path. */
export function hasEntry(entries: readonly ArchiveEntry[], path: string): boolean {
  return findEntry(entries, path) !== undefined;
}

/**
 * Read + strict-JSON-parse the part at `path`. Decompression uses inflateEntry's
 * default decompression-bomb bound (DEFAULT_BOUNDS), so a hostile part cannot
 * exhaust memory here. Never writes to disk.
 */
export function loadPart(bytes: Buffer, entries: readonly ArchiveEntry[], path: string): PartLoad {
  const entry = findEntry(entries, path);
  if (!entry) return { status: 'absent' };

  let raw: Buffer;
  try {
    raw = inflateEntry(bytes, entry);
  } catch (err) {
    // A part this READER cannot decode, because it uses a compression method the
    // specification permits but this reader has not implemented, is NOT a missing or
    // defective part — it is present and well-formed, and a conformant reader may simply
    // lack the decoder (Container Format §3.2 makes Zstandard RECOMMENDED, not required).
    // §5.4.2 note 6 requires that the missing-part rows MUST NOT fire for it, exactly as
    // note 5 requires for an encrypted part: reporting it missing would blame the DOCUMENT
    // for the reader's capability envelope, and on a frozen document that becomes an
    // INTEGRITY-ERROR accusing an intact archive of tampering.
    if (err instanceof InflateError && err.failure === 'method-unsupported') {
      return { status: 'unobtainable', method: err.method, detail: err.message };
    }
    // Otherwise the bytes exist but cannot be recovered — a bounded-inflate overflow, a
    // forbidden method, or a corrupt stream. The container layer reports each of those on
    // its own terms; the mapper decides the per-part disposition here.
    return { status: 'defect', code: null, detail: err instanceof Error ? err.message : String(err) };
  }
  const text = raw.toString('utf8');

  try {
    const value = parseStrictJson(text);
    return { status: 'ok', text, value, bytes: raw };
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      // Duplicate keys / resource-limit: parseStrictJson attaches the code when it
      // has one (duplicate keys), null otherwise (resource-limit exhaustion).
      return { status: 'defect', code: err.code ?? null, detail: err.message };
    }
    // A bare JSON syntax error (SyntaxError) — an uncoded parse failure.
    return { status: 'defect', code: null, detail: err instanceof Error ? err.message : String(err) };
  }
}
