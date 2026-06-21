/**
 * Reference canonicalizer for CDX document IDs.
 *
 * Implements the normative canonical-form construction and serialization of
 * spec/core/06-document-hashing.md §4 (with the metadata projection of
 * 08-metadata.md §6 and the asset-path resolution of 05-asset-embedding.md §3).
 * It is a *shared library* (like ./part-schema.ts): the example/KAT checks and
 * any tooling that needs a document ID resolve it through this one module, so
 * they cannot drift from each other.
 *
 * The document ID is an explicit *transform* of the stored parts — the stored
 * files are never modified, and the ID is distinct from the file-level
 * `content.hash` (which pins exact bytes). See §2.1 / §4.1.
 *
 * Design notes (why raw text in, not parsed objects):
 *  - Duplicate object keys MUST be rejected before hashing (§4.3.2 item 3), but
 *    `JSON.parse` is last-wins and a reviver cannot observe duplicates. So this
 *    module parses the raw text itself (see `parseStrictJson`). Callers pass the
 *    raw JSON text of each part.
 *  - RFC 8785 (JCS) serialization — especially number production — is delegated
 *    to the `canonicalize` package; it is never hand-rolled here.
 */

import canonicalize from 'canonicalize';
import * as crypto from 'crypto';

/** Thrown for any input that cannot be canonicalized per §4.3. */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

// ---------------------------------------------------------------------------
// Hash algorithm handling (§3)
// ---------------------------------------------------------------------------

/** Hex-digest length per algorithm (§3.2; mirrors anchor.schema contentHash). */
const HEX_DIGEST_LENGTH: Readonly<Record<string, number>> = {
  sha256: 64,
  sha384: 96,
  sha512: 128,
  'sha3-256': 64,
  'sha3-512': 128,
  blake3: 64,
};

const KNOWN_ALGORITHMS = Object.keys(HEX_DIGEST_LENGTH);

/**
 * Extract the algorithm from an `algorithm:hexdigest` value (e.g. the manifest
 * `id`). Throws on `"pending"`, a missing prefix, or an unknown algorithm — the
 * algorithm is always derived from the value's own prefix, never hardcoded
 * (§3.3).
 */
export function algorithmOf(value: string): string {
  if (typeof value !== 'string') {
    throw new CanonicalizationError(`expected an "algorithm:hexdigest" string, got ${typeof value}`);
  }
  const idx = value.indexOf(':');
  if (idx <= 0) {
    throw new CanonicalizationError(`value "${value}" has no "algorithm:" prefix (a pending or unset id has no algorithm)`);
  }
  const algorithm = value.slice(0, idx);
  if (!KNOWN_ALGORITHMS.includes(algorithm)) {
    throw new CanonicalizationError(`unknown hash algorithm "${algorithm}" in "${value}"`);
  }
  return algorithm;
}

/** True iff `h` is a well-formed `algorithm:hexdigest` of the right length. */
function isValidContentHash(h: unknown): h is string {
  if (typeof h !== 'string') return false;
  const idx = h.indexOf(':');
  if (idx <= 0) return false;
  const algorithm = h.slice(0, idx);
  const digest = h.slice(idx + 1);
  const expected = HEX_DIGEST_LENGTH[algorithm];
  return expected !== undefined && digest.length === expected && /^[0-9a-f]+$/.test(digest);
}

/** Resolve an algorithm to its Node `crypto` hash name, or throw if unusable. */
function nodeHashName(algorithm: string): string {
  if (!KNOWN_ALGORITHMS.includes(algorithm)) {
    throw new CanonicalizationError(`unknown hash algorithm "${algorithm}"`);
  }
  if (algorithm === 'blake3') {
    // Optional algorithm (§3.2) with no Node `crypto` implementation.
    throw new CanonicalizationError('hash algorithm "blake3" is not available in this implementation');
  }
  if (!crypto.getHashes().includes(algorithm)) {
    throw new CanonicalizationError(`hash algorithm "${algorithm}" is not available in this runtime`);
  }
  return algorithm;
}

// ---------------------------------------------------------------------------
// Strict JSON parsing — rejects duplicate object keys (§4.3.2 item 3)
// ---------------------------------------------------------------------------

/**
 * Parse JSON with the standard value semantics of `JSON.parse`, but reject any
 * object containing duplicate keys (anywhere in the tree). `JSON.parse` is used
 * for the values (numbers, strings, structure); a separate structural scan of
 * the raw text detects duplicates that `JSON.parse` would otherwise silently
 * collapse last-wins.
 */
export function parseStrictJson(text: string): unknown {
  const value = JSON.parse(text); // syntax validation + canonical value semantics
  detectDuplicateKeys(text); // structural duplicate-key scan over the (now valid) text
  return value;
}

/** Index just past the closing quote of the JSON string starting at `start`. */
function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2; // skip the escaped character
      continue;
    }
    if (c === '"') return i + 1;
    i++;
  }
  throw new CanonicalizationError('unterminated string while scanning for duplicate keys');
}

interface ScanFrame {
  kind: 'object' | 'array';
  keys?: Set<string>;
  expectingKey?: boolean;
}

const STRUCTURAL_OR_WS = new Set([' ', '\t', '\n', '\r', ',', '{', '}', '[', ']', ':', '"']);

function detectDuplicateKeys(text: string): void {
  const stack: ScanFrame[] = [];
  const top = (): ScanFrame | undefined => (stack.length ? stack[stack.length - 1] : undefined);
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '{') {
      stack.push({ kind: 'object', keys: new Set(), expectingKey: true });
      i++;
      continue;
    }
    if (c === '[') {
      stack.push({ kind: 'array' });
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      stack.pop();
      i++;
      continue;
    }
    if (c === ',') {
      const t = top();
      if (t && t.kind === 'object') t.expectingKey = true;
      i++;
      continue;
    }
    if (c === ':') {
      const t = top();
      if (t && t.kind === 'object') t.expectingKey = false;
      i++;
      continue;
    }
    if (c === '"') {
      const end = stringEnd(text, i);
      const raw = text.slice(i, end);
      i = end;
      const t = top();
      if (t && t.kind === 'object' && t.expectingKey) {
        const key = JSON.parse(raw) as string; // decode escapes so "a" === "a"
        if (t.keys!.has(key)) {
          throw new CanonicalizationError(`duplicate object key ${JSON.stringify(key)}`);
        }
        t.keys!.add(key);
      }
      continue;
    }
    // number / true / false / null — skip the whole token
    while (i < n && !STRUCTURAL_OR_WS.has(text[i])) i++;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DocumentParts {
  /** Raw JSON text of `manifest.json`. */
  manifest: string;
  /** Raw JSON text of the content part (`manifest.content.path`). */
  content: string;
  /** Raw JSON text of the Dublin Core part (`manifest.metadata.dublinCore`). */
  dublinCore: string;
  /**
   * Raw JSON text of each asset index, keyed by the *category* it registers —
   * i.e. the key under `manifest.assets`. A category present in `manifest.assets`
   * but absent here is an error.
   */
  assetIndexes?: Record<string, string>;
}

export interface CanonicalizeOptions {
  /**
   * Validate the canonical structure for the stored-byte invariants (NFC,
   * well-formed Unicode, safe-integer bounds) and throw on violation. Default
   * true. Validation never *normalizes* — it only rejects (§4.3.2).
   */
  validate?: boolean;
}

/**
 * Build the two-slot canonical content `{ content, metadata }` (§4.2) from the
 * raw document parts. Always returns both slots; `metadata` may be `{}`.
 */
export function canonicalContent(parts: DocumentParts, options: CanonicalizeOptions = {}): unknown {
  const validate = options.validate !== false;

  const manifest = parseStrictJson(parts.manifest);
  const content = parseStrictJson(parts.content);
  const dublinCore = parseStrictJson(parts.dublinCore);

  const assetMap = buildAssetMap(manifest, parts.assetIndexes);
  const metadata = projectMetadata(dublinCore);
  const canonicalizedContent = canon(content, assetMap);

  const result = { content: canonicalizedContent, metadata };
  if (validate) validateStoredByteInvariants(result);
  return result;
}

/**
 * Compute the document ID as `algorithm:hexdigest` (§4.4). `algorithm` is
 * derived by the caller from the value's own prefix — e.g.
 * `computeDocumentId(parts, algorithmOf(manifest.id))`.
 */
export function computeDocumentId(parts: DocumentParts, algorithm: string, options?: CanonicalizeOptions): string {
  const hashName = nodeHashName(algorithm); // fail fast on an unusable algorithm
  const canonical = canonicalContent(parts, options);
  const serialized = jcsOf(canonical);
  const digest = crypto.createHash(hashName).update(serialized, 'utf8').digest('hex');
  return `${algorithm}:${digest}`;
}

// ---------------------------------------------------------------------------
// Metadata projection (§4.3.1 "Metadata projection"; 08 §6)
// ---------------------------------------------------------------------------

/** Term names projected as strings, and as arrays, respectively. */
const STRING_TERMS = ['title', 'description'] as const;
const ARRAY_TERMS = ['creator', 'subject', 'language'] as const;

function projectMetadata(dublinCore: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const terms = isPlainObject(dublinCore) ? dublinCore.terms : undefined;
  if (!isPlainObject(terms)) return out;

  for (const term of STRING_TERMS) {
    const v = terms[term];
    if (typeof v === 'string' && v !== '') out[term] = v; // omit absent / ""
  }
  for (const term of ARRAY_TERMS) {
    const v = terms[term];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      if (v === '') continue; // wholly empty
      out[term] = [v]; // coerce scalar to a one-element array
    } else if (Array.isArray(v)) {
      if (v.length === 0) continue; // wholly empty
      out[term] = v.slice(); // preserve elements verbatim, in authored order
    }
    // any other shape is left out (schema constrains these to string|string[])
  }
  return out;
}

// ---------------------------------------------------------------------------
// Asset resolution (§4.3.1 "Resolve asset references"; 05 §3)
// ---------------------------------------------------------------------------

/**
 * Map each registered asset's archive path to its content hash. The archive
 * path is the category directory — `assets/` + the key under `manifest.assets`
 * — joined with the asset's index `path` (§4.3.1 item 2). Per-category index
 * model (05 §3.1): `manifest.assets[<category>].index` points at that
 * category's index file, supplied here as `parts.assetIndexes[<category>]`.
 */
function buildAssetMap(manifest: unknown, assetIndexes?: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  const assets = isPlainObject(manifest) ? manifest.assets : undefined;
  if (!isPlainObject(assets)) return map; // no registered assets

  for (const category of Object.keys(assets)) {
    if (!isValidPathSegment(category)) {
      throw new CanonicalizationError(`manifest.assets category "${category}" is not a valid path segment`);
    }
    const raw = assetIndexes?.[category];
    if (raw === undefined) {
      throw new CanonicalizationError(`no asset index supplied for category "${category}" declared in manifest.assets`);
    }
    const index = parseStrictJson(raw);
    const entries = isPlainObject(index) ? index.assets : undefined;
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;
      const p = entry.path;
      const h = entry.hash;
      // Register any entry carrying both its own path and hash — including an
      // `aliasOf` entry that does so. Entries without a path or hash (e.g. a
      // pure alias) cannot be referenced by path, so they are skipped.
      if (typeof p !== 'string' || typeof h !== 'string') continue;
      if (!isValidContentHash(h)) {
        throw new CanonicalizationError(`asset "${String(entry.id ?? p)}" in category "${category}" has a malformed hash "${h}"`);
      }
      const archivePath = normalizePath(`assets/${category}/${p}`);
      const existing = map.get(archivePath);
      if (existing !== undefined && existing !== h) {
        // Two entries resolve to one archive path with different hashes — the
        // reference would resolve ambiguously (order-dependent), so reject.
        throw new CanonicalizationError(`asset archive path "${archivePath}" is registered with conflicting hashes`);
      }
      map.set(archivePath, h);
    }
  }
  return map;
}

/**
 * Resolve one content asset reference to its content hash, or return it
 * verbatim when it is not a packaged-asset path (§4.3.1 item 2). `external` is
 * the carve-out flag carried (out of schema, per 05 §9.2) on image/svg/
 * signature nodes; link marks have no such flag and pass `false`.
 */
function resolveAssetRef(ref: string, assetMap: Map<string, string>, external: boolean): string {
  if (external) return ref; // explicitly external
  if (ref.startsWith('#')) return ref; // internal Content Anchor reference
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) return ref; // carries a URL scheme

  const normalized = normalizePath(ref);
  const hit = assetMap.get(normalized);
  if (hit !== undefined) return hit;

  if (ref.startsWith('assets/') || normalized.startsWith('assets/')) {
    const detail = assetMap.size === 0 ? ' (no assets are registered in the manifest)' : '';
    throw new CanonicalizationError(`asset reference "${ref}" resolves to no registered asset${detail}`);
  }
  return ref; // not a packaged-asset path
}

// ---------------------------------------------------------------------------
// Content transform (§4.3.1 "Content transforms")
// ---------------------------------------------------------------------------

function canon(value: unknown, assetMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((v) => canon(v, assetMap));
    return mergeAdjacentText(mapped); // §4.3.1 item 4
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const obj: Record<string, unknown> = { ...value };
  const type = obj.type;

  if (typeof type === 'string') {
    // Strip transient collaboration sync state from any block or text node (§4.1a).
    delete obj.crdt;

    switch (type) {
      case 'measurement':
        delete obj.display; // derived human-readable rendering (§4.3.1 item 1)
        break;
      case 'codeBlock':
        delete obj.tokens; // regenerable syntax highlighting (§4.3.1 item 1)
        break;
      case 'image':
      case 'svg':
        if (typeof obj.src === 'string') {
          obj.src = resolveAssetRef(obj.src, assetMap, obj.external === true);
        }
        break;
      case 'signature':
        if (typeof obj.image === 'string') {
          obj.image = resolveAssetRef(obj.image, assetMap, obj.external === true);
        }
        break;
      case 'text':
        if (Array.isArray(obj.marks)) {
          const normalized = normalizeMarks(obj.marks, assetMap); // §4.3.1 item 3
          if (normalized.length === 0) delete obj.marks; // omit empty (absent ≡ [])
          else obj.marks = normalized;
        }
        break;
    }
  }

  // Recurse into the remaining properties. A text node's `marks` is already
  // final (resolved + sorted + deduped); re-canonicalizing it would be
  // redundant, so skip it.
  for (const key of Object.keys(obj)) {
    if (type === 'text' && key === 'marks') continue;
    obj[key] = canon(obj[key], assetMap);
  }
  return obj;
}

/**
 * Normalize a text node's `marks` (§4.3.1 item 3): resolve any link-mark href
 * to an asset hash, then sort by JCS serialization (UTF-16 code-unit order, so
 * bare string marks sort before structured object marks) and deduplicate by
 * identical JCS serialization.
 */
function normalizeMarks(marks: unknown[], assetMap: Map<string, string>): unknown[] {
  const resolved = marks.map((m) => {
    if (isPlainObject(m) && m.type === 'link' && typeof m.href === 'string') {
      return { ...m, href: resolveAssetRef(m.href, assetMap, false) };
    }
    return m;
  });

  const keyed = resolved.map((m) => ({ mark: m, jcs: jcsOf(m) }));
  keyed.sort((a, b) => (a.jcs < b.jcs ? -1 : a.jcs > b.jcs ? 1 : 0));

  const out: unknown[] = [];
  let lastJcs: string | undefined;
  for (const { mark, jcs } of keyed) {
    if (jcs === lastJcs) continue; // dedup identical serializations
    out.push(mark);
    lastJcs = jcs;
  }
  return out;
}

/**
 * Merge adjacent sibling text nodes with identical canonical mark-sets (§4.3.1
 * item 4). Only a "plain" text node — keys ⊆ {type, value, marks} after the
 * step-1 stripping — is merge-eligible; one carrying an `id`, `attributes`, or
 * any other field is preserved unchanged and acts as a boundary. A non-text
 * node also breaks the run.
 */
function mergeAdjacentText(arr: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const node of arr) {
    const prev = out.length ? out[out.length - 1] : undefined;
    if (isMergeableTextNode(node) && isMergeableTextNode(prev) && marksEqual(prev, node)) {
      prev.value = (prev.value ?? '') + (node.value ?? '');
    } else {
      out.push(node);
    }
  }
  return out;
}

interface PlainTextNode {
  type: 'text';
  value?: string;
  marks?: unknown[];
  [k: string]: unknown;
}

function isMergeableTextNode(n: unknown): n is PlainTextNode {
  if (!isPlainObject(n) || n.type !== 'text' || typeof n.value !== 'string') return false;
  for (const key of Object.keys(n)) {
    if (key !== 'type' && key !== 'value' && key !== 'marks') return false;
  }
  return true;
}

function marksEqual(a: PlainTextNode, b: PlainTextNode): boolean {
  // Absent marks ≡ []; both are already normalized when present.
  return jcsOf(a.marks ?? []) === jcsOf(b.marks ?? []);
}

// ---------------------------------------------------------------------------
// Stored-byte invariant validation (§4.3.2) — validate, never normalize
// ---------------------------------------------------------------------------

function validateStoredByteInvariants(value: unknown): void {
  if (typeof value === 'string') {
    checkString(value);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError(`non-finite number ${value} cannot be canonicalized`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new CanonicalizationError(`integer ${value} exceeds the safe-integer range (magnitude > 2^53-1)`);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) validateStoredByteInvariants(v);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      checkString(key);
      validateStoredByteInvariants(value[key]);
    }
  }
}

function checkString(s: string): void {
  if (!isWellFormedUnicode(s)) {
    throw new CanonicalizationError(`string contains an unpaired surrogate (not well-formed Unicode): ${JSON.stringify(s)}`);
  }
  if (s.normalize('NFC') !== s) {
    throw new CanonicalizationError(`string is not in Normalization Form C (NFC): ${JSON.stringify(s)}`);
  }
}

function isWellFormedUnicode(s: string): boolean {
  // Prefer the native check (Node 20+); fall back to a manual surrogate scan.
  const native = (s as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof native === 'function') return native.call(s);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false; // high surrogate not followed by low
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false; // lone low surrogate
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidPathSegment(seg: string): boolean {
  return seg.length > 0 && seg !== '.' && seg !== '..' && !seg.includes('/');
}

/** Resolve `.`/`..`/empty segments (case-sensitive); join with '/'. */
function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/** JCS-serialize a value, throwing rather than returning `undefined`. */
function jcsOf(value: unknown): string {
  const s = canonicalize(value);
  if (typeof s !== 'string') {
    throw new CanonicalizationError(`value could not be JCS-serialized: ${JSON.stringify(value)}`);
  }
  return s;
}
