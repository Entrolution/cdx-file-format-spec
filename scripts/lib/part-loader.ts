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

import { inflateEntry, type ArchiveEntry } from './zip-reader.js';
import { parseStrictJson, CanonicalizationError } from './canonicalize.js';

/** Outcome of loading one part by its logical archive path. */
export type PartLoad =
  /** No central-directory entry with this path. */
  | { status: 'absent' }
  /** Parsed cleanly; `value` is the JSON value, `text` the raw UTF-8 bytes. */
  | { status: 'ok'; text: string; value: unknown }
  /**
   * Present but unloadable. `code` is the conformance code the canonicalizer
   * attached to a typed CanonicalizationError (e.g. `CDX-E-PART-DUPLICATE-KEYS`)
   * when the defect is a part-agnostic, state-invariant reject; it is `null` for
   * a bare JSON syntax error or a decompression failure, which the mapper codes
   * per-part (a manifest → unparseable-manifest; a hashed part → its own row).
   */
  | { status: 'defect'; code: string | null; detail: string };

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

  let text: string;
  try {
    text = inflateEntry(bytes, entry).toString('utf8');
  } catch (err) {
    // A bounded-inflate overflow or a corrupt Deflate stream. The bytes exist but
    // cannot be recovered; the mapper decides the per-part disposition.
    return { status: 'defect', code: null, detail: err instanceof Error ? err.message : String(err) };
  }

  try {
    const value = parseStrictJson(text);
    return { status: 'ok', text, value };
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
