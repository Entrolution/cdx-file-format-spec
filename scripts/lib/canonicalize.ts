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

/**
 * Thrown for any input that cannot be canonicalized per §4.3.
 *
 * The optional `code` is a stable, language-independent defect identifier from
 * the conformance vocabulary (`conformance/errors.json`). It exists so a
 * known-answer vector can assert *which defect* was detected without asserting
 * on an English message — the message stays free to change, the code does not.
 *
 * Codes are **diagnostics, not normativity**: the specification mandates
 * dispositions (State Machine §5.4), never error identifiers, and a conforming
 * implementation is free to use its own internal errors. Codes are assigned at
 * the throw sites a conformance vector exercises; sites without a vector carry
 * no code yet, and `code` is therefore optional by design.
 */
export class CanonicalizationError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'CanonicalizationError';
    this.code = code;
  }
}

/**
 * Maximum nesting depth of canonical content. Canonicalization walks the content
 * tree with native recursion (canon, id-relabel, reference-rewrite, byte-invariant
 * validation, JCS serialization), so an unbounded depth is a stack-overflow DoS on
 * document open/sign/verify. This bound is checked iteratively up front, before any
 * recursive walk runs, so a deep input is rejected with a typed CanonicalizationError
 * — never an untyped RangeError a verifier catching only the typed error would miss.
 * Real documents nest a few tens deep at most; this leaves ample headroom while
 * staying well below the native stack limit. This bounds the recursion-overflow
 * (depth) axis; total node count and single-string size are bounded upstream by the
 * container size limits (Container Format §5.2/§5.3 resource bounds).
 */
export const MAX_CANONICALIZATION_DEPTH = 256;

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

/** The CDX-permitted hash algorithms (§3.2). The single allowlist tooling picks
 *  a file-hash algorithm from; a name outside this set is not a valid CDX digest
 *  algorithm even when the host runtime's crypto library would accept it (md5, …). */
export const KNOWN_ALGORITHMS = Object.keys(HEX_DIGEST_LENGTH);

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
export function isValidContentHash(h: unknown): h is string {
  if (typeof h !== 'string') return false;
  const idx = h.indexOf(':');
  if (idx <= 0) return false;
  const algorithm = h.slice(0, idx);
  const digest = h.slice(idx + 1);
  // Object.hasOwn, not a bare index: a hash prefix of '__proto__'/'constructor' must
  // not resolve to an inherited value (the unguarded-lookup class hardened elsewhere).
  const expected = Object.hasOwn(HEX_DIGEST_LENGTH, algorithm) ? HEX_DIGEST_LENGTH[algorithm] : undefined;
  return expected !== undefined && digest.length === expected && /^[0-9a-f]+$/.test(digest);
}

/**
 * Compute `algorithm:hexdigest` over raw bytes, resolving the algorithm through
 * the same `nodeHashName` allowlist `computeDocumentId` uses — so an algorithm the
 * runtime cannot compute (`blake3`, or one absent from this runtime's `crypto`)
 * throws a typed `CanonicalizationError` rather than silently producing a wrong
 * digest. The single place a file-level hash is computed: the document mapper's
 * file-hash verification (State Machine §5.4.2 "File `hash` … mismatch"; §5.1) and
 * the document-ID hashing therefore cannot drift on algorithm handling.
 */
export function hashBytes(algorithm: string, data: Buffer): string {
  const hashName = nodeHashName(algorithm);
  return `${algorithm}:${crypto.createHash(hashName).update(data).digest('hex')}`;
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
  let value: unknown;
  try {
    value = JSON.parse(text); // syntax validation + canonical value semantics
  } catch (err) {
    // JSON.parse can throw an untyped RangeError when an input exhausts a parser
    // resource limit (an over-long string, or — on a runtime with a recursive parser
    // — deep nesting); convert it to the module's typed error so a verifier catching
    // only CanonicalizationError does not crash (Container Format §5.3 resource bounds).
    if (err instanceof RangeError) {
      throw new CanonicalizationError('input exceeds a parser resource limit');
    }
    throw err;
  }
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
          throw new CanonicalizationError(`duplicate object key ${JSON.stringify(key)}`, 'CDX-E-PART-DUPLICATE-KEYS');
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
 * Reject content nested deeper than `maxDepth` with a typed CanonicalizationError.
 * Traverses iteratively with an explicit stack, so the check itself never recurses
 * and cannot overflow while measuring depth. `depth` counts nested containers
 * (objects/arrays); scalars are leaves. A structure exactly `maxDepth` containers
 * deep is accepted; one level deeper is rejected.
 */
export function assertBoundedDepth(root: unknown, maxDepth: number): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (node === null || typeof node !== 'object') continue;
    if (depth > maxDepth) {
      throw new CanonicalizationError(`content nesting exceeds the maximum depth of ${maxDepth}`);
    }
    const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }
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

  // Bound nesting depth *before* any recursive walk (canon, id-relabel,
  // reference-rewrite, byte-invariant validation, JCS) so a deep input is rejected
  // with a typed error instead of overflowing the native stack (Container Format
  // §5.3 resource bounds). Both deep-walked inputs are guarded: `content`, and
  // `dublinCore` — projectMetadata copies its term arrays by reference, so a deeply
  // nested Dublin Core term reaches validateStoredByteInvariants and jcsOf verbatim.
  // (manifest and asset indexes only yield scalar path/hash strings, never deep.)
  assertBoundedDepth(content, MAX_CANONICALIZATION_DEPTH);
  assertBoundedDepth(dublinCore, MAX_CANONICALIZATION_DEPTH);

  const assetMap = buildAssetMap(manifest, parts.assetIndexes);
  const metadata = projectMetadata(dublinCore);
  const canonicalizedContent = canon(content, assetMap);

  // Validate stored-byte invariants (NFC, well-formed Unicode, safe integers) on
  // the transformed content *before* alpha-renaming, so the original id bytes are
  // checked before §4.3.1's relabeling replaces them with canonical names.
  const projected = { content: canonicalizedContent, metadata };
  if (validate) validateStoredByteInvariants(projected);

  // Canonicalize identifiers: relabel block/anchor ids to position-based names
  // and rewrite the Content Anchor URI references to them (§4.3.1 item 5).
  return { content: alphaRenameIds(canonicalizedContent), metadata };
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
  if (!isPlainObject(dublinCore)) {
    throw new CanonicalizationError('Dublin Core part must be a JSON object');
  }
  const terms = dublinCore.terms;
  if (terms === undefined) return out; // absent terms → no projected metadata
  // A malformed term (a non-object `terms`, or a term of the wrong type) is rejected,
  // not silently dropped: dropping would let a malformed value and an absent one
  // project to the same bytes and thus the same document ID (a malleability seam).
  if (!isPlainObject(terms)) {
    throw new CanonicalizationError('Dublin Core `terms` must be an object');
  }

  for (const term of STRING_TERMS) {
    const v = terms[term];
    if (v === undefined) continue;
    if (typeof v !== 'string') {
      throw new CanonicalizationError(`Dublin Core term "${term}" must be a string`);
    }
    if (v !== '') out[term] = v; // omit ""
  }
  for (const term of ARRAY_TERMS) {
    const v = terms[term];
    if (v === undefined) continue; // absent → omit; a present null is malformed (rejected below)
    if (typeof v === 'string') {
      if (v === '') continue; // wholly empty
      out[term] = [v]; // coerce scalar to a one-element array
    } else if (Array.isArray(v)) {
      if (!v.every((e) => typeof e === 'string')) {
        throw new CanonicalizationError(`Dublin Core term "${term}" array must contain only strings`);
      }
      // Drop empty ("") elements; a term left with no elements is omitted, like a
      // wholly-empty array (§4.3.1: non-empty array elements are preserved verbatim).
      const nonEmpty = v.filter((e) => e !== '');
      if (nonEmpty.length === 0) continue; // wholly empty (before or after dropping)
      out[term] = nonEmpty; // non-empty elements, in authored order
    } else {
      throw new CanonicalizationError(`Dublin Core term "${term}" must be a string or array of strings`);
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
 *
 * Exported as the SINGLE definition of which archive path carries which asset hash — the
 * discipline `collectDefinedIds` holds for the identifier namespace. A consumer that
 * re-derived this mapping would resolve references against a set the document ID was never
 * computed over. Note it registers from the INDEX's entries, never from the archive's
 * bytes: an asset listed in the index but absent from the archive still RESOLVES (to its
 * declared hash), because §4.3.1 item 2 binds the declared hash into the ID rather than the
 * bytes — such an asset is a missing hash-bound part (07 §5.4.2), not a dangling reference.
 */
export function buildAssetMap(manifest: unknown, assetIndexes?: Record<string, string>): Map<string, string> {
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
// Block-content positions (§4.3.1 item 4, §4.3.2 item 2)
// ---------------------------------------------------------------------------

/**
 * The property names whose declared array items are block or text content.
 *
 * WHY THIS EXISTS. §4.3.1 item 4 merges "adjacent sibling text nodes", and §4.3.2 item 2
 * binds "the concatenated text content of each BLOCK" — and Anchors and References §3, which
 * both cite, computes that content by traversing a block's text-node CHILDREN. Both rules are
 * therefore properties of WHERE a node sits, not of what it looks like. Implemented on element
 * SHAPE instead — "is this object `{type:"text", value:string}`?" — they reach any array whose
 * members happen to resemble text nodes, and canonicalization then REJECTS conformant
 * documents: two authored `attributes.semantic` values, each individually in NFC, are merged
 * and the merged string fails the per-string check.
 *
 * DERIVED, NOT INVENTED. This set is every property name in the published schemas whose array
 * `items` resolve to `$defs/block` or `$defs/textNode`, through `allOf`/`anyOf`/`oneOf`.
 * `scripts/check-block-content-positions.ts` re-derives it and fails on any disagreement, so a
 * new block type carrying a rich text array cannot silently fall out of scope. Transcribed
 * rather than read at runtime because this module is a specification's reference canonicalizer
 * and stays a pure function of its inputs — no filesystem, no schema loader (which imports
 * FROM here, so reading one would also be a cycle).
 *
 * KEYS, NOT (type, key) PAIRS. Several content arrays hang off sub-objects that carry no
 * `type` at all — an `academic:exercise` part, a `solution`, a phantom's content — so a map
 * keyed on the parent's type cannot reach them. The looser key match costs nothing: the
 * `children` arrays it additionally admits (`list`, `table`, `tableRow`, `figure`,
 * `definitionList`, `definitionItem`) are schema-forbidden from holding a text node at all, so
 * neither rule can fire there on conformant content.
 */
export const BLOCK_CONTENT_KEYS: ReadonlySet<string> = new Set([
  'blocks',    // the root content array, and a phantom's content
  'caption',   // figure, subfigure — a rich caption array, not the string form
  'children',  // every text-bearing and container block, core and extension
  'content',   // a `presentation:footnote` mark's content blocks
  'hints',     // academic exercise and exercise part
  'preamble',  // academic exercise set
]);

/**
 * `attributes` is a hard barrier regardless of the key beneath it. Content Blocks §3.1 makes
 * it a CLOSED set of authored values — `dir`, `lang`, `writingMode`, `style`, `semantic` — and
 * nothing anchors into it, so an object there shaped like a text node is data that merely
 * resembles inline content. The barrier is needed because `attributes.semantic` is a JSON-LD
 * annotation with `additionalProperties: true`, so an author may legitimately put a member
 * named `children` inside it; without the barrier the key match alone would readmit exactly
 * the false REJECT this scoping exists to remove.
 */
export const CONTENT_BARRIER_KEY = 'attributes';

/** True iff an array reached by `key` holds block content (see BLOCK_CONTENT_KEYS). */
function isBlockContentKey(key: string | null): boolean {
  return key !== null && BLOCK_CONTENT_KEYS.has(key);
}

// ---------------------------------------------------------------------------
// Content transform (§4.3.1 "Content transforms")
// ---------------------------------------------------------------------------

function canon(value: unknown, assetMap: Map<string, string>, key: string | null = null, blocked = false): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((v) => canon(v, assetMap, key, blocked));
    // §4.3.1 item 4, scoped to block content. `key` is the property this array was reached
    // by; `blocked` is set once `attributes` has been entered and never cleared. See
    // BLOCK_CONTENT_KEYS for why the rule is a property of position, not of element shape.
    return !blocked && isBlockContentKey(key) ? mergeAdjacentText(mapped) : mapped;
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
    // The barrier STICKS. `attributes.semantic` is a JSON-LD annotation with
    // `additionalProperties: true`, so an author may put a member named `children` inside it
    // at any depth; clearing the flag on the way down would readmit exactly the false REJECT
    // this scoping removes.
    obj[key] = canon(obj[key], assetMap, key, blocked || key === CONTENT_BARRIER_KEY);
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

  return sortDedupMarks(resolved);
}

/**
 * Sort marks by JCS serialization (UTF-16 code-unit order) and remove marks with
 * identical serializations (§4.3.1 item 3). Shared by the marks pipeline and by
 * the post-alpha-rename re-sort — relabeling an `anchor` mark id or a `link`
 * href changes that mark's JCS sort key, so its array must be re-sorted.
 */
function sortDedupMarks(marks: unknown[]): unknown[] {
  const keyed = marks.map((m) => ({ mark: m, jcs: jcsOf(m) }));
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
// Alpha-renaming of block/anchor ids (§4.3.1 item 5 "Canonicalize identifiers")
// ---------------------------------------------------------------------------

export interface CollectedIds {
  /** Every in-namespace id, UNIQUE and in first-occurrence traversal order. A
   *  repeat occurrence lands in `duplicates`, never here — so the index of an id
   *  in this array is its canonical relabel position. */
  ids: string[];
  /** Each id defined more than once, in the order the repeats were reached;
   *  `duplicates[0]` is therefore the first collision the traversal met. */
  duplicates: string[];
  /**
   * The subset of `ids` carried by a block whose `type` is in
   * `PRESERVED_ID_BLOCK_TYPES` — left as authored rather than relabeled
   * (§4.3.1 item 5).
   *
   * These remain MEMBERS of `ids`: they occupy the shared uniqueness namespace and
   * a Content Anchor URI resolves against them exactly as it did before. Only the
   * relabeling skips them. A consumer resolving references or reporting collisions
   * wants `ids`; only `alphaRenameIds` wants this.
   */
  preserved: Set<string>;
  /**
   * Whatever `CollectOptions.classify` returned for each id, keyed by id. Empty when no
   * classifier was supplied.
   *
   * Collected on the SAME walk and under the SAME first-occurrence rule as `ids`, so its
   * key set equals `ids` BY CONSTRUCTION. That is the point: a separate walk to classify
   * ids can silently disagree about which ids exist — and did, until a review caught a
   * second walk here that omitted `rawInput` and so admitted ids from inside `crdt`,
   * letting a decoy shadow a real block. One walk removes the failure mode rather than
   * disciplining it, and no future option can separate the two views.
   *
   * The classifier is INJECTED rather than implemented here because what an id names is
   * an Anchors-and-References concept (§2.2/§3), not a hashing one; this module has no
   * business knowing about text-bearing blocks. Same discipline structural-constraints.ts
   * states for `walkBlocks`, whose block vocabulary is a parameter for the same reason.
   */
  classified: Map<string, unknown>;
}

/** Options for `collectDefinedIds`. */
export interface CollectOptions {
  /**
   * Optional per-id classifier, invoked on the node that DEFINES each id, at the moment
   * the id enters `ids`. Its return value lands in `CollectedIds.classified` under that id.
   *
   * Injected rather than implemented here so this module needs no vocabulary of its own:
   * the only current classifier answers an Anchors-and-References question (does this id
   * name a text-bearing block, an `anchor` mark, or neither), which is not a hashing
   * concern. `alphaRenameIds` passes no options, so it pays nothing for this.
   */
  classify?: (node: Record<string, unknown>, ctx: WalkContext) => unknown;
  /**
   * Set when walking RAW stored content rather than the output of `canon`. A consumer
   * that resolves references against raw content must reproduce every `canon` transform
   * that changes which ids exist, or it will disagree with `computeDocumentId` — in
   * either direction: reporting a collision on a document the canonicalizer accepts, or
   * missing a reference the canonicalizer resolves. Three transforms qualify:
   *   - ADJACENT TEXT MERGING (§4.3.1 item 4): consecutive merge-eligible text nodes
   *     with equal canonical mark sets collapse into one, so the absorbed node's marks
   *     — and any `anchor` id they carry — cease to exist;
   *   - MARK DEDUP (§4.3.1 item 3): marks with an identical canonical serialization
   *     collapse WITHIN one text node's `marks` array — only a `text` node, since
   *     `canon` normalizes `marks` under `case 'text'` alone;
   *   - DERIVED-FIELD DELETION (§4.3.1 item 1; §4.1a): `crdt` on any typed node,
   *     `measurement` `display`, `codeBlock` `tokens`, so an id inside an opaque `crdt`
   *     payload is not in the namespace. This one stops at a text node's `marks`: canon
   *     does NOT recurse into those (they are already final), so a derived field carried
   *     on or under such a mark SURVIVES and its ids ARE relabelled.
   * The remaining `canon` transforms — asset-reference resolution on `link` hrefs and on
   * `image`/`svg`/`signature` sources — cannot affect the namespace directly: none of those
   * nodes defines an id, and `resolveAssetRef` returns a `#`-prefixed value verbatim. They
   * do affect it INDIRECTLY, through the merge above, which is what `assetMap` supplies.
   * Left off (the default) this is a pure traversal, so `alphaRenameIds` is unaffected.
   */
  rawInput?: boolean;
  /**
   * The document's resolved asset map (`buildAssetMap`), used ONLY under `rawInput` and
   * ONLY by the merge key.
   *
   * `normalizeMarks` resolves a `link` mark's href to its asset HASH before
   * `mergeAdjacentText` compares mark sets, so whether two adjacent text nodes merge depends
   * on the asset index: hrefs naming different paths that carry the SAME bytes compare equal
   * and merge, while hrefs naming different bytes do not. Supplying the map makes the raw
   * walk agree with the canonicalizer in both directions.
   *
   * Omitted, every packaged-asset href keys as one placeholder — the conservative fallback
   * for a caller that cannot resolve assets (a missing or malformed index). That OVER-merges:
   * it risks missing a real id collision, rather than manufacturing a false one, which would
   * be an INTEGRITY-ERROR on a document `computeDocumentId` accepts.
   */
  assetMap?: ReadonlyMap<string, string>;
}

/**
 * Collect the shared identifier namespace of §4.3.1 item 5 — the exhaustive set
 * `definedId` defines — by a value-independent traversal (arrays in index order;
 * object keys in sorted order; a node's own id before its descendants), so
 * alpha-equivalent inputs yield identical results regardless of the original labels.
 *
 * The single definition of namespace membership, shared by `alphaRenameIds` (which
 * relabels the NON-PRESERVED members of `ids` to `b0`, `b1`, … in order — the index is
 * the position in that subsequence, not in `ids` — and rejects any duplicate) and by the
 * conformance reference resolver (which resolves Content Anchors against `ids` and reports a
 * duplicate as an id collision, Anchors & References §7.2). Collecting rather than
 * throwing lets the resolver report every collision; `alphaRenameIds` still rejects
 * the first, unchanged.
 */
export function collectDefinedIds(content: unknown, options: CollectOptions = {}): CollectedIds {
  const seen = new Set<string>();
  const ids: string[] = [];
  const duplicates: string[] = [];
  const preserved = new Set<string>();
  const classified = new Map<string, unknown>();

  walkContentNodes(
    content,
    (node, ctx) => {
      const id = definedId(node, ctx.inMarks, ctx.inArray, ctx.parentKey);
      if (id === undefined) return;
      if (seen.has(id)) duplicates.push(id);
      else {
        seen.add(id);
        ids.push(id);
        // Recorded on the FIRST occurrence only, alongside `ids` — a repeat is a
        // duplicate and throws before any of this is consumed.
        if (!ctx.inMarks && typeof node.type === 'string' && PRESERVED_ID_BLOCK_TYPES.has(node.type)) {
          preserved.add(id);
        }
        // Classified on the SAME first-occurrence branch as `ids`, so the two cannot
        // disagree about which ids exist or about which node defines one.
        if (options.classify !== undefined) classified.set(id, options.classify(node, ctx));
      }
    },
    options,
  );

  return { ids, duplicates, preserved, classified };
}

/** Where a visited node sits, which is what decides namespace membership (`definedId`). */
export interface WalkContext {
  /** The node was reached through a `marks` array. */
  inMarks: boolean;
  /** The node is an array item. */
  inArray: boolean;
  /** The field name the node was reached through. */
  parentKey: string | undefined;
  /**
   * The node sits at or below a TEXT node's `marks` — the one subtree `canon` normalizes
   * in place and then skips, so none of its recursive transforms reach inside. A consumer
   * mirroring a transform `canon` applies during recursion (asset-reference resolution on
   * an `image`/`svg`/`signature` source, derived-field deletion) must not apply it here, or
   * it models a rewrite the canonicalizer never performs.
   */
  inTextMarks: boolean;
}

/**
 * Visit every object node of a content tree in the canonical, value-independent order of
 * §4.3.1 item 5 — arrays in index order, object keys sorted, a node before its descendants
 * — calling `visit` with the positional context `definedId` keys off.
 *
 * The single traversal shared by `collectDefinedIds` and the conformance reference
 * resolver, so the id namespace and the references resolved against it can never be
 * gathered by two subtly different walks. See `CollectOptions.rawInput` for the two
 * erasures a raw-content walk must apply.
 */
export function walkContentNodes(
  content: unknown,
  visit: (node: Record<string, unknown>, ctx: WalkContext) => void,
  options: CollectOptions = {},
): void {
  const raw = options.rawInput === true;

  // `inTextMarks` tracks the one subtree canon leaves alone: a text node's `marks` are
  // normalized in place and then SKIPPED by canon's recursion, so neither the merge nor
  // the derived-field deletion reaches inside them.
  const walk = (value: unknown, inMarks: boolean, inArray: boolean, parentKey: string | undefined, inTextMarks: boolean, blocked = false): void => {
    if (Array.isArray(value)) {
      // Scoped exactly as `canon`'s merge is: this walk reproduces canon's view of the tree,
      // so a position where canon no longer merges must not drop a node here. Getting it wrong
      // inverts a verdict rather than losing one — the walks disagree about which ids exist,
      // and a document canon rejects for a duplicate id loads clean.
      const mergesHere = !blocked && isBlockContentKey(parentKey ?? null);
      const items = raw && !inTextMarks && mergesHere ? dropAbsorbedTextNodes(value, options.assetMap) : value;
      for (const el of items) walk(el, inMarks, true, parentKey, inTextMarks, blocked); // items inherit the array's field name
      return;
    }
    if (!isPlainObject(value)) return;
    visit(value, { inMarks, inArray, parentKey, inTextMarks });
    for (const key of Object.keys(value).sort()) {
      if (raw && !inTextMarks && isDerivedField(value, key)) continue; // canon deletes it before relabeling
      const child = value[key];
      // Positional, so it is tracked whether or not `rawInput` is set — the raw-only
      // ERASURES below still gate on `raw`, leaving canonical-path traversal unchanged.
      const childInTextMarks = inTextMarks || (key === 'marks' && value.type === 'text');
      if (raw && key === 'marks' && value.type === 'text') {
        // canon's skip (`type === 'text' && key === 'marks'`) has NO array test, so the
        // whole subtree is preserved either way — `inTextMarks` must be set even for a
        // non-array `marks`, or derived fields inside one get erased here and kept there.
        // `inMarks` still requires an array, matching rewriteIds' dispatch.
        walk(Array.isArray(child) ? dedupByJcs(child) : child, Array.isArray(child), false, key, true, blocked);
        continue;
      }
      // `Array.isArray` matches rewriteIds' own dispatch: a `marks` value that is not an
      // array is not a mark collection to the canonicalizer, so treating its members as
      // marks here would resolve references the canonicalizer never rewrites.
      walk(child, key === 'marks' && Array.isArray(child), false, key, childInTextMarks, blocked || key === CONTENT_BARRIER_KEY);
    }
  };
  walk(content, false, false, undefined, false, false);
}

/**
 * Stands in for a packaged-asset href no asset map could resolve. Written as an explicit
 * escape because it must be a value no conformant href can hold — `safeUri` and
 * `relativePath` both exclude control characters — so two marks compare equal here only
 * when both genuinely reference packaged assets.
 */
const UNRESOLVED_ASSET_HREF = '\u0000unresolved-asset';

/**
 * A `link` href that `resolveAssetRef` would rewrite to an asset hash — a packaged-asset
 * path, i.e. neither an internal `#` reference nor a scheme-bearing URL.
 *
 * Exported as the shared definition of "this reference addresses a packaged asset", so the
 * conformance resolver's dangling-asset-reference row (07 §5.4.2) tests the same predicate
 * `resolveAssetRef` throws on rather than re-deriving it. It does NOT model the `external`
 * carve-out: that flag lives on the referencing NODE, not in the reference string, so the
 * caller applies it exactly as `canon` does at the `image`/`svg`/`signature` call sites.
 */
export function isPackagedAssetRef(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.startsWith('#')) return false; // an internal reference, returned verbatim
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false; // carries a URL scheme
  // Only an `assets/`-rooted path can hit the asset map — every key `buildAssetMap`
  // registers is `assets/<category>/…`, and `resolveAssetRef` returns anything else
  // verbatim. Masking a wider set would collapse hrefs canon keeps DISTINCT, merging
  // nodes it does not and destroying a genuine id collision.
  return value.startsWith('assets/') || normalizePath(value).startsWith('assets/');
}

/**
 * Model one array element as `mergeAdjacentText` sees it, IN CANON'S ORDER: `canon`
 * recurses into a child (stripping its derived fields, normalizing a text node's marks)
 * and only then merges the array. Testing the raw node instead gets both halves wrong —
 * a `crdt`-bearing text node is non-mergeable raw but mergeable to the canonicalizer, and
 * an unsorted mark array keys differently from the normalized one.
 *
 * Returns null when the node is not merge-eligible (so it breaks the run), otherwise the
 * key `marksEqual` compares. Note `marks` is read verbatim when it is not an array:
 * `canon` guards `normalizeMarks` on `Array.isArray`, and `marksEqual` then compares that
 * raw value, so collapsing it to `[]` would merge nodes the canonicalizer keeps apart.
 *
 * ASSET ALIASING: `normalizeMarks` resolves a `link` href to its asset hash BEFORE the
 * comparison, so two hrefs naming distinct paths that carry the same bytes compare EQUAL
 * and their nodes merge, while two naming DIFFERENT bytes stay distinct. `assetMap`
 * reproduces both directions.
 *
 * The lookup is deliberately NOT `resolveAssetRef`, even though that is the function being
 * mirrored: it THROWS for an `assets/`-rooted href the map does not carry, and nothing on
 * this path catches such a throw (`mergeKeyOf`'s own `try` covers `jcsOf` alone). It would
 * propagate out through `dropAbsorbedTextNodes` and `walkContentNodes` to the conformance
 * resolver's catch-all, silently discarding EVERY finding of that pass — the id collision
 * included. One dangling asset href would then switch off an INTEGRITY-ERROR. So a miss
 * falls back to the placeholder instead, which is also what a caller with no map at all
 * gets: over-merging (a possibly missed collision) rather than under-merging (a FALSE
 * INTEGRITY-ERROR on a document the canonicalizer accepts).
 */
function mergeKeyOf(node: unknown, assetMap?: ReadonlyMap<string, string>): string | null {
  if (!isPlainObject(node) || node.type !== 'text' || typeof node.value !== 'string') return null;
  const stripped = Object.keys(node).filter((k) => !isDerivedField(node, k));
  if (!stripped.every((k) => k === 'type' || k === 'value' || k === 'marks')) return null;
  const marks = node.marks;
  // The whole normalization is guarded, not just the final serialization: `sortDedupMarks`
  // calls `jcsOf` per mark, so an unserializable mark throws THERE. That throw is a
  // CanonicalizationError, and on the raw-walk path nothing between here and the conformance
  // resolver's catch-all would stop it discarding every finding of that pass — the id
  // collision included. A node whose marks cannot be serialized simply cannot be PROVEN equal
  // to its neighbour, so it never merges, which is what returning null means.
  try {
    let normalized: unknown;
    if (Array.isArray(marks)) {
      normalized = sortDedupMarks(marks.map((m) => resolveLinkHrefForMerge(m, assetMap)));
    } else {
      normalized = marks ?? [];
    }
    return jcsOf(normalized);
  } catch {
    return null;
  }
}

/**
 * Apply to one mark what `normalizeMarks` applies to a `link` href, WITHOUT `resolveAssetRef`'s
 * throw. The branch order mirrors that function exactly (canonicalize.ts, "Resolve one content
 * asset reference"): a `#` reference and a scheme-bearing URL come back verbatim, then the map
 * is consulted, and only a MISS that is `assets/`-rooted is the case `resolveAssetRef` rejects.
 *
 * Consulting the map for every non-`#`, non-scheme href — rather than only for an
 * `assets/`-rooted one — matters because `buildAssetMap` does not constrain an index entry's
 * `path`: an entry whose path escapes its category directory registers a key that is not
 * `assets/`-rooted at all. Gating the LOOKUP on `assets/`-rootedness would then miss that key,
 * key two aliased hrefs differently, and fail to merge nodes the canonicalizer merges — a
 * false collision. The `assets/` test belongs only on the fallback, where it reproduces
 * exactly which references `resolveAssetRef` throws for.
 */
function resolveLinkHrefForMerge(m: unknown, assetMap?: ReadonlyMap<string, string>): unknown {
  if (!isPlainObject(m) || m.type !== 'link' || typeof m.href !== 'string') return m;
  const href = m.href;
  if (href.startsWith('#')) return m; // an internal reference, returned verbatim
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) return m; // carries a URL scheme
  const resolved = assetMap?.get(normalizePath(href));
  if (resolved !== undefined) return { ...m, href: resolved };
  return isPackagedAssetRef(href) ? { ...m, href: UNRESOLVED_ASSET_HREF } : m;
}

/**
 * Drop each text node `mergeAdjacentText` would absorb into its predecessor (§4.3.1
 * item 4), so a raw walk sees the same nodes — and therefore the same `anchor` ids — as
 * the canonical form. An absorbed node contributes only its `value`, concatenated onto
 * the previous node; its marks are discarded as equal to the survivor's, so two adjacent
 * text nodes carrying the SAME `anchor` id are ONE id after canonicalization, not a
 * collision. An id-bearing text node has a key outside {type, value, marks} and is never
 * absorbed.
 *
 * `assetMap` is threaded to `mergeKeyOf`, whose doc explains why the resolution it performs
 * cannot be `resolveAssetRef` itself.
 */
function dropAbsorbedTextNodes(arr: unknown[], assetMap?: ReadonlyMap<string, string>): unknown[] {
  const out: unknown[] = [];
  let prevKey: string | null = null; // merge key of the last kept node, if mergeable
  for (const node of arr) {
    const key = mergeKeyOf(node, assetMap);
    if (key !== null && prevKey !== null && key === prevKey) continue; // absorbed
    prevKey = key; // null for a non-mergeable element, which breaks the run as canon's does
    out.push(node);
  }
  return out;
}

/** True for a field `canon` strips from this node (§4.3.1 item 1; §4.1a). */
function isDerivedField(node: Record<string, unknown>, key: string): boolean {
  if (typeof node.type !== 'string') return false; // canon only strips under a typed node
  if (key === 'crdt') return true;
  if (key === 'display') return node.type === 'measurement';
  if (key === 'tokens') return node.type === 'codeBlock';
  return false;
}

/**
 * Drop marks with an identical JCS serialization, as `normalizeMarks` does (§4.3.1
 * item 3). Asset resolution is irrelevant to THIS use: dedup only removes a mark that is
 * already byte-identical to another, and a `link` defines no id, so a collapse cannot
 * change the namespace. (It is NOT irrelevant to the adjacent-text MERGE, where a link
 * href decides whether a whole node survives — see `mergeKeyOf`.) A mark that cannot be
 * serialized is kept, since it cannot be proven a duplicate.
 */
function dedupByJcs(marks: unknown[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const mark of marks) {
    let key: string;
    try {
      key = jcsOf(mark);
    } catch {
      out.push(mark);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mark);
  }
  return out;
}
/**
 * Relabel author-chosen identifiers to position-based canonical names so that two
 * documents differing ONLY in their id *labels* canonicalize identically
 * (block-id purity). Runs as the final transform, on the already strip/resolve/
 * marks/merge-canonicalized content; a pure function of that structure.
 *
 * Namespace (relabeled): the `id` of every block (a typed object outside a `marks`
 * array), the `id` of every `anchor` mark, and the `id` of every in-content
 * sub-block element reached as an array item — an academic equation line (in
 * `lines`) and a `subfigure` (in `subfigures`), which carry no block `type`. These
 * share one uniqueness-checked identifier namespace (Anchors & References §4).
 * Membership is keyed on WHERE a node sits, not merely its shape (see `definedId`):
 * an id in a SEPARATE namespace is left as authored — a `semantic:bibliography`
 * entry's CSL citation key (in `entries`; referenced by a `citation` mark), any
 * id-bearing item an extension block carries in its own data array, and a singular
 * named sub-object such as a signature block's `signer` (a Person identifier, not a
 * content-anchor target) — are not relabeled.
 *
 * References rewritten: Content Anchor URIs (`#id[/offset]`) in an enumerated set
 * of reference fields. Identifiers that address OTHER namespaces — footnote /
 * glossary / citation / entity / index / legal marks, and the
 * `academic:algorithm-ref` `line` label — are NOT relabeled, and a `#`-reference
 * resolving to none of the relabeled ids (e.g. a cross-document anchor) is left
 * verbatim. A duplicate id within the namespace is rejected.
 *
 * A `PRESERVED_ID_BLOCK_TYPES` block's id is left as authored, and the `b<i>`
 * sequence COMPACTS over it — the preserved occurrence consumes no index, so the
 * next relabeled block takes the name the preserved one would have had. The
 * alternative (reserving an index) is equally implementable and would produce a
 * different document ID for the same content, so §4.3.1 item 5 states which.
 */
function alphaRenameIds(content: unknown): unknown {
  // Canonical content: `canon` has already stripped derived fields and deduped each
  // text node's marks, so the default (non-raw) collection is exactly pass 1 of the
  // original in-place traversal.
  const { ids, duplicates, preserved } = collectDefinedIds(content);
  if (duplicates.length > 0) {
    throw new CanonicalizationError(`duplicate id "${duplicates[0]}" in the shared identifier namespace`);
  }

  // A preserved id is left as authored, so it MUST NOT spell a generated canonical
  // name: `collectDefinedIds` compares AUTHORED ids, so an authored `b0` here does
  // not collide with the `b0` the sequence below generates for some other block, and
  // both would reach the canonical output carrying the same id — with a `#b0`
  // reference silently binding to whichever the reader met first.
  for (const id of preserved) {
    if (CANONICAL_NAME.test(id)) {
      throw new CanonicalizationError(
        `id "${id}" uses the reserved canonical-name form: the id of a block whose type is left as authored ` +
          `(${[...PRESERVED_ID_BLOCK_TYPES].sort().join(', ')}) must not spell "b<number>"`,
      );
    }
  }

  // NO early return, on an empty rename map OR an empty namespace. `rewriteIds` is
  // not only the renamer: it also enforces the `#b<digits>` prohibition on
  // references that resolve to nothing. Skipping it whenever there is nothing to
  // rename let a dangling `#b0` through in a document with no ids at all — accepted,
  // while the identical reference beside one real id was rejected. Both documents
  // this PR makes common (only preserved ids, or none) take that path.
  const map = new Map(ids.filter((id) => !preserved.has(id)).map((id, i) => [id, `b${i}`]));
  return rewriteIds(content, map, false, false, undefined);
}

/**
 * Field keys whose ARRAY items are relabeled sub-block ids even though they carry
 * no block `type`: an equation group's `lines` (equation lines) and a figure's
 * `subfigures` (§4.3.1 item 5). This is the EXHAUSTIVE set of untyped sub-block id
 * arrays — an untyped id-bearing array item reached through any other key (an id an
 * extension block carries in its own data array) addresses a separate namespace and
 * is left as authored.
 */
const SUB_BLOCK_ID_ARRAYS = new Set(['lines', 'subfigures']);

/**
 * Field keys carrying a block's opaque DATA payload of id-bearing objects whose ids
 * belong to a SEPARATE identifier namespace, not the content-anchor namespace: a
 * `semantic:bibliography` block's CSL `entries`, whose `id` is a citation key
 * (referenced by a `citation` mark's `refs`, left as authored — §4.3.1 item 5). A
 * bibliography entry carries a CSL `type` (`article-journal`, …) so it is shaped
 * like a block; the enclosing key is what distinguishes it from one.
 */
const DATA_PAYLOAD_ID_ARRAYS = new Set(['entries']);

/**
 * Block types whose `id` is IN the shared identifier namespace but is left as
 * AUTHORED rather than relabeled (§4.3.1 item 5).
 *
 * These two blocks are the defining side of a reference that addresses a separate
 * namespace and is itself never relabeled: a `glossary` mark's `ref` and a
 * `semantic:term` `see` resolve against a `semantic:term` block's `id` (Semantic
 * Extension §8.3 rule 2), and a `footnote` mark resolves against a
 * `semantic:footnote` block (§4.5.2). Relabeling the defining side while leaving
 * the referring side as authored made those rules unsatisfiable on the canonical
 * form — the block became `b0` while the `ref` still said `term-algorithm`.
 * Preserving the definition is what makes them true there.
 *
 * Membership is UNCHANGED: a preserved id still occupies the shared uniqueness
 * namespace, a duplicate is still a canonicalization error, and a Content Anchor
 * URI still resolves against it. Only the rename skips it — which is why
 * `definedId` (the single membership test) does not consult this set, and why the
 * `b<digits>` prohibition in `alphaRenameIds` is load-bearing: duplicate detection
 * compares AUTHORED ids, so an authored `b0` here would not collide with a
 * GENERATED `b0` and both would reach the canonical output.
 *
 * Keyed on TYPE, which departs from item 5's "membership is keyed on WHERE an id
 * sits" principle — by necessity, since a term block's id sits directly on the
 * block rather than in a data array. See DD-022.
 */
export const PRESERVED_ID_BLOCK_TYPES: ReadonlySet<string> = new Set(['semantic:term', 'semantic:footnote']);

/**
 * The in-namespace id this node defines, if any — restricted to the EXHAUSTIVE
 * shared identifier namespace of §4.3.1 item 5 (blocks, `anchor` marks, equation
 * `lines`, and `subfigures`), keyed on WHERE the node sits (`parentKey`, the field
 * it was reached through), not merely its shape.
 *
 * Inside a `marks` array only an `anchor` mark contributes an id (other marks
 * address separate namespaces). Outside `marks`: a typed object contributes its
 * `id` as a block, UNLESS it is a data-payload entry (a CSL `bibliographyEntry` in
 * an `entries` array — a citation key, not a content-anchor target); and an untyped
 * object contributes its `id` only as a sub-block array item of `lines` or
 * `subfigures`. A structural heuristic (`has a type` OR `is any array item`) would
 * instead admit a bibliography entry (or any id-bearing item an extension carries in
 * a data array), relabeling a citation key into the block namespace — a wrong
 * document ID and a hash collision.
 */
function definedId(obj: Record<string, unknown>, inMarks: boolean, inArray: boolean, parentKey: string | undefined): string | undefined {
  if (inMarks) {
    return obj.type === 'anchor' && typeof obj.id === 'string' ? obj.id : undefined;
  }
  if (typeof obj.id !== 'string') return undefined;
  // A text node is a block type but its `id` is outside the relabeled namespace: it addresses no
  // relabeled namespace and is preserved verbatim (§4.3.1 item 4 — "a text node
  // that also carries an `id` … is preserved unchanged"; item 5's namespace is
  // exhaustively blocks, `anchor` marks, and equation-line/subfigure sub-blocks).
  // Because it is preserved, a text-node id is content-significant, not a
  // normalized label — two documents differing only in one do not share an id.
  if (obj.type === 'text') return undefined;
  const namedArrayItem = inArray && parentKey !== undefined;
  if (typeof obj.type === 'string') {
    // A typed object is a content block unless it is an item of a data-payload array.
    return namedArrayItem && DATA_PAYLOAD_ID_ARRAYS.has(parentKey) ? undefined : obj.id;
  }
  // An untyped id-bearing object is in the namespace only as a `lines`/`subfigures`
  // sub-block array item; any other untyped array item addresses a separate namespace.
  return namedArrayItem && SUB_BLOCK_ID_ARRAYS.has(parentKey) ? obj.id : undefined;
}

/** Academic inline reference marks whose `target` is a Content Anchor URI. */
function isAnchorRefMark(type: unknown): boolean {
  return type === 'academic:theorem-ref' || type === 'academic:equation-ref' || type === 'academic:algorithm-ref';
}

/**
 * Rewrite id-defining fields and the enumerated Content Anchor URI references
 * using the relabel map. References handled: `link` mark `href`; academic
 * `academic:theorem-ref`/`academic:equation-ref`/`academic:algorithm-ref` mark
 * `target`; `academic:theorem` `uses[]`; `academic:proof` `of`; `semantic:ref`
 * and `presentation:reference` block `target`.
 *
 * ADDING A FIELD HERE MEANS ADDING IT TO reference-resolver.ts TOO, in
 * MARK_REFERENCE_FIELDS or BLOCK_REFERENCE_FIELDS. That module resolves exactly
 * this enumeration, and nothing checks this direction — its own table catches a
 * field DROPPED there, but a field added here alone is silently unresolved. The
 * cost is no longer just a missed dangling report: those tables now decide which
 * State Machine §5.4.2 row an out-of-range POSITION defect takes, so a field
 * known here and unknown there has no row at all.
 */
function rewriteIds(value: unknown, map: Map<string, string>, inMarks: boolean, inArray: boolean, parentKey: string | undefined): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => rewriteIds(v, map, inMarks, true, parentKey));
  }
  if (!isPlainObject(value)) return value;

  const obj: Record<string, unknown> = { ...value };
  const type = obj.type;

  // Recurse first; a TEXT node's `marks` array is re-sorted+deduped after its members
  // are rewritten, since relabeling an anchor id or link href changes a mark's JCS
  // sort key (§4.3.1 item 5's closing sentence, which re-applies item 3). Mark
  // order/multiplicity is non-semantic there, so the re-sort is safe.
  //
  // ONLY a text node's. Item 3 is scoped "within each text node" and `canon`
  // normalizes marks under `case 'text'` alone, so re-sorting a `marks` array carried
  // anywhere else — inside an open JSON-LD annotation or a CSL entry, both of which
  // permit arbitrary members — would normalize a field the canonical form never
  // touched, collapsing two documents that differ only in that array's order onto one
  // document id. The traversal itself is unchanged: every member is still visited with
  // `inMarks`, matching `walkContentNodes`, so namespace membership does not move.
  for (const key of Object.keys(obj)) {
    if (key === 'marks' && Array.isArray(obj[key])) {
      const rewritten = (obj[key] as unknown[]).map((m) => rewriteIds(m, map, true, true, 'marks'));
      obj[key] = type === 'text' ? sortDedupMarks(rewritten) : rewritten;
    } else {
      obj[key] = rewriteIds(obj[key], map, false, false, key);
    }
  }

  // Rewrite this node's own id and any reference fields it carries.
  if (inMarks) {
    if (obj.type === 'anchor' && typeof obj.id === 'string') {
      obj.id = renameId(obj.id, map);
    } else if (obj.type === 'link' && typeof obj.href === 'string') {
      obj.href = rewriteContentAnchor(obj.href, map);
    } else if (isAnchorRefMark(obj.type) && typeof obj.target === 'string') {
      obj.target = rewriteContentAnchor(obj.target, map);
    }
  } else {
    // Gate the id rewrite by the SAME namespace test used to build the map, so a
    // data-payload id (a bibliography entry key) that happens to equal a relabeled
    // block's original id is left as authored rather than rewritten to that block's
    // canonical name.
    const defined = definedId(obj, false, inArray, parentKey);
    if (defined !== undefined) {
      obj.id = renameId(defined, map);
    }
    if (type === 'academic:proof' && typeof obj.of === 'string') {
      obj.of = rewriteContentAnchor(obj.of, map);
    } else if (type === 'academic:theorem' && Array.isArray(obj.uses)) {
      obj.uses = (obj.uses as unknown[]).map((u) => (typeof u === 'string' ? rewriteContentAnchor(u, map) : u));
    } else if ((type === 'semantic:ref' || type === 'presentation:reference') && typeof obj.target === 'string') {
      obj.target = rewriteContentAnchor(obj.target, map);
    }
  }
  return obj;
}

/**
 * Map a defined id to its canonical name.
 *
 * The `?? id` fallback is NOT defensive: a preserved id (`PRESERVED_ID_BLOCK_TYPES`) is
 * deliberately absent from the map, and this fallback is what leaves it as authored.
 * Narrowing this to `map.get(id)!` would assign `undefined`, which JCS serialization then
 * DROPS — so every `semantic:term` and `semantic:footnote` block would silently lose its
 * `id` from the canonical form altogether, leaving the identifier namespace rather than
 * carrying a wrong name.
 */
function renameId(id: string, map: Map<string, string>): string {
  return map.get(id) ?? id;
}

/** Shape of a generated canonical id name: `b` followed by decimal digits. */
const CANONICAL_NAME = /^b\d+$/;

/**
 * Rewrite the id component of a Content Anchor URI (`#id[/offset[-end]]`, Anchors
 * & References §2.1) via the relabel map, preserving any `/offset` suffix. A
 * non-`#` value (e.g. an external URL) or a `#`-reference whose id is not in the RELABEL
 * MAP is returned verbatim — which is not the same as "not in the namespace": a
 * cross-document anchor is in neither, while a preserved id (`PRESERVED_ID_BLOCK_TYPES`)
 * is in the namespace but not the map, and returning it verbatim is exactly how a
 * `#term-x` reference keeps resolving. EXCEPT that an unresolved reference must not itself spell a
 * generated canonical name (`#b0`, `#b1`, …): left verbatim it would be
 * byte-identical to a reference that genuinely resolved to that block, collapsing
 * two distinct documents onto one id. Such a reference is rejected instead.
 */
function rewriteContentAnchor(value: string, map: Map<string, string>): string {
  if (!value.startsWith('#')) return value;
  const slash = value.indexOf('/');
  const id = slash === -1 ? value.slice(1) : value.slice(1, slash);
  const suffix = slash === -1 ? '' : value.slice(slash);
  const mapped = map.get(id);
  if (mapped !== undefined) return `#${mapped}${suffix}`;
  if (CANONICAL_NAME.test(id)) {
    throw new CanonicalizationError(
      `reference "${value}" uses the reserved canonical-name form: a "#b<number>" reference must resolve to a block or anchor id`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Stored-byte invariant validation (§4.3.2) — validate, never normalize
// ---------------------------------------------------------------------------

/**
 * The reason a single number is non-representable per §4.3.2 — non-finite, or an
 * integer whose magnitude exceeds 2^53 - 1 (so the IEEE-754 double the canonicalizer
 * hashes differs from the value the author wrote) — or null if it is representable.
 * The single definition of the number rule, shared by validateStoredByteInvariants
 * (which throws on it during canonicalization) and firstNonRepresentableNumber (the
 * part loader's pre-canonicalization scan), so the boundary and messages cannot drift.
 */
export function nonRepresentableNumberReason(value: number): string | null {
  if (!Number.isFinite(value)) return `non-finite number ${value} cannot be canonicalized`;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return `integer ${value} exceeds the safe-integer range (magnitude > 2^53-1)`;
  }
  return null;
}

/**
 * The detail of the first non-representable number anywhere in `value`, or null.
 * An ITERATIVE walk (explicit stack) so a deeply nested part cannot overflow the
 * native stack. Used to enforce the state-invariant non-representable-number rule
 * (§5.4.3) on a HASHED part at load time, independent of document-ID computation —
 * a pending-id draft is never canonicalized, but the rule still applies in every state.
 */
export function firstNonRepresentableNumber(value: unknown): string | null {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'number') {
      const reason = nonRepresentableNumberReason(v);
      if (reason) return reason;
    } else if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
    } else if (isPlainObject(v)) {
      for (const key of Object.keys(v)) stack.push(v[key]);
    }
  }
  return null;
}

export function validateStoredByteInvariants(value: unknown, key: string | null = null, blocked = false): void {
  if (typeof value === 'string') {
    checkString(value);
  } else if (typeof value === 'number') {
    const reason = nonRepresentableNumberReason(value);
    if (reason) throw new CanonicalizationError(reason, 'CDX-E-PART-NUMBER-NON-REPRESENTABLE');
  } else if (Array.isArray(value)) {
    // Block-level NFC (§4.3.2 item 2): NFC applies to the *concatenated* text
    // content of a block, not merely to each text-node value — an NFC-combining
    // sequence MUST NOT be split across text-node boundaries. Consecutive text
    // nodes at this point differ in marks or carry an id (mergeAdjacentText already
    // merged same-mark runs), so a per-string check misses a combining mark that
    // begins one node and completes a base at the end of the previous. Check the
    // concatenation of each run of two-or-more consecutive text nodes (a single
    // node is already covered by its own checkString). A valid text-bearing block
    // has text-node-only children (Content Blocks §4.13–4.14), so a maximal run
    // equals the block's full text content; resetting the run on any non-text
    // element is a defensive path (a break or a nested block severs adjacency).
    //
    // Same key test as `canon`'s merge, but not the same reachable positions: `canon` skips a
    // text node's `marks`, and `content` occurs only there, so at that position this fires and
    // the merge cannot. Elsewhere a run reported where canon merged would REJECT a document
    // canonicalization accepts. Every string is still checked individually; only the run is withheld.
    const inContent = !blocked && isBlockContentKey(key);
    let run = '';
    let runNodes = 0;
    for (const v of value) {
      if (inContent && isPlainObject(v) && v.type === 'text' && typeof v.value === 'string') {
        run += v.value;
        runNodes++;
      } else {
        if (runNodes >= 2) checkConcatenatedNfc(run);
        run = '';
        runNodes = 0;
      }
      validateStoredByteInvariants(v, key, blocked);
    }
    if (runNodes >= 2) checkConcatenatedNfc(run);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      checkString(key);
      validateStoredByteInvariants(value[key], key, blocked || key === CONTENT_BARRIER_KEY);
    }
  }
}

/** Defect codes for the §4.3.2 stored-byte TEXT invariants (registered in errors.json). */
export const STORED_TEXT_CODE = {
  NOT_NFC: 'CDX-E-PART-STRING-NOT-NFC',
  ILL_FORMED: 'CDX-E-PART-STRING-ILL-FORMED',
} as const;

/**
 * The reason a single string violates §4.3.2 item 2 — an unpaired surrogate (not
 * well-formed Unicode), or not in Normalization Form C — or null if it is conformant.
 *
 * The single definition of the text rule, shared by `checkString` (which throws on it
 * during canonicalization) and `collectStoredTextViolations` (the part loader's
 * pre-canonicalization scan), exactly as `nonRepresentableNumberReason` is shared by the
 * number arm. One predicate, two drivers: the boundary and the codes cannot drift.
 *
 * Order matters, though not for the reason it first appears. `normalize('NFC')` leaves a
 * lone surrogate unchanged, so a string whose ONLY defect is an unpaired surrogate is
 * reported as ill-formed under either order. The order decides the string that carries
 * BOTH defects — decomposed text alongside a lone surrogate — where an NFC-first test
 * reports the non-NFC arm and masks the ill-formed one. Well-formedness is the stronger
 * finding of the two (it is the arm under which two conformant readers disagree on the
 * bytes at all), so it is tested first. Pinned by reject-content-text-ill-formed-and-non-nfc.
 */
export function storedTextViolation(s: string): { code: string; detail: string } | null {
  if (!isWellFormedUnicode(s)) {
    return {
      code: STORED_TEXT_CODE.ILL_FORMED,
      detail: `string contains an unpaired surrogate (not well-formed Unicode): ${JSON.stringify(s)}`,
    };
  }
  if (s.normalize('NFC') !== s) {
    return {
      code: STORED_TEXT_CODE.NOT_NFC,
      detail: `string is not in Normalization Form C (NFC): ${JSON.stringify(s)}`,
    };
  }
  return null;
}

function checkString(s: string): void {
  const v = storedTextViolation(s);
  if (v) throw new CanonicalizationError(v.detail, v.code);
}

/** Reject a run of concatenated text-node values whose NFC form differs (§4.3.2 item 2). */
function checkConcatenatedNfc(run: string): void {
  if (run.normalize('NFC') !== run) {
    throw new CanonicalizationError(
      `concatenated block text is not in NFC — a combining sequence is split across text-node boundaries: ${JSON.stringify(run)}`,
      STORED_TEXT_CODE.NOT_NFC,
    );
  }
}

/**
 * The first §4.3.2 item-2 text violation in the HASHED material of `value`, or null. An
 * ITERATIVE walk (explicit stack) so a deeply nested part cannot overflow the native stack,
 * mirroring `firstNonRepresentableNumber` — and used for the same reason: to enforce a
 * state-invariant stored-byte rule (§5.4.3) on a hashed part at LOAD time, independent of
 * document-ID computation. A pending-id draft is never canonicalized, so a check hung off
 * the recompute would reach almost nothing.
 *
 * SCOPE IS WHAT CANONICALIZATION HASHES, not the whole stored part. §5.4.2's rows and both
 * codes' summaries say "a HASHED object key or string value", and a field `canon` deletes
 * — `crdt`, `measurement.display`, `codeBlock.tokens` — is not hashed: two readers cannot
 * derive different canonical bytes from a field both delete, so the split-view harm that
 * justifies the REJECT cannot reach it. `isDerivedField` is term-for-term canon's own
 * deletion set, so this neither over- nor under-approximates. Suppression stops at a TEXT
 * NODE's `marks`, which canon does not recurse into (above).
 *
 * The relationship to canonicalization is therefore two one-sided properties, NOT an
 * equivalence — stating it as "reports iff canon throws" would be false and the repair for
 * the failing case would be to suppress a genuine defect:
 *   (a) COMPLETENESS — this reports everything `canon` would throw on. That is what stops a
 *       silent arm, and it is the direction that matters.
 *   (b) PRECISION — the only excess is a field canon REWRITES rather than deletes: an asset
 *       path resolved to a content hash (§4.3.1 item 2) is replaced before validation runs,
 *       so canon never sees the stored path. Reporting it is correct, since §4.3.2 binds the
 *       stored bytes; it simply cannot be observed through canon.
 *
 * Object KEYS are checked as well as values (§4.3.2 binds "all object keys and string
 * values"), and each run of two or more adjacent text nodes is checked as a CONCATENATION,
 * since §4.3.2 applies NFC to a block's whole text content. Merging never changes a
 * concatenation, so measuring the run over raw nodes matches the canonical form.
 */
export function collectStoredTextViolations(value: unknown): { code: string; detail: string } | null {
  interface Frame { v: unknown; inDerived: boolean; inTextMarks: boolean; key: string | null; blocked: boolean }
  const stack: Frame[] = [{ v: value, inDerived: false, inTextMarks: false, key: null, blocked: false }];
  const runViolation = (run: string): { code: string; detail: string } | null =>
    run.normalize('NFC') === run
      ? null
      : { code: STORED_TEXT_CODE.NOT_NFC, detail: `concatenated block text is not in NFC — a combining sequence is split across text-node boundaries: ${JSON.stringify(run)}` };

  while (stack.length > 0) {
    const { v, inDerived, inTextMarks, key, blocked } = stack.pop()!;
    if (typeof v === 'string') {
      if (inDerived) continue;
      const violation = storedTextViolation(v);
      if (violation) return violation;
    } else if (Array.isArray(v)) {
      // Same key test as `canon`, over the RAW part rather than the transformed one, so a scope
      // differing by one position shows up as a document canon rejects loading clean. Carries no
      // `marks` skip, so unlike the merge it reaches a footnote mark's `content`.
      const inContent = !blocked && isBlockContentKey(key);
      let run = '';
      let runNodes = 0;
      for (const el of v) {
        if (inContent && isPlainObject(el) && el.type === 'text' && typeof el.value === 'string') {
          run += el.value;
          runNodes++;
        } else {
          if (!inDerived && runNodes >= 2) {
            const violation = runViolation(run);
            if (violation) return violation;
          }
          run = '';
          runNodes = 0;
        }
        stack.push({ v: el, inDerived, inTextMarks, key, blocked });
      }
      if (!inDerived && runNodes >= 2) {
        const violation = runViolation(run);
        if (violation) return violation;
      }
    } else if (isPlainObject(v)) {
      for (const key of Object.keys(v)) {
        if (!inDerived) {
          const violation = storedTextViolation(key);
          if (violation) return violation;
        }
        stack.push({
          v: v[key],
          // `canon` does not recurse into a TEXT NODE's `marks` (see its `case 'text'`), so a
          // derived field carried on or under such a mark SURVIVES canonicalization and canon
          // does throw on it. Without this term a gate keyed on the field NAME alone goes
          // silent on a document canon rejects.
          inDerived: inDerived || (!inTextMarks && isDerivedField(v, key)),
          inTextMarks: inTextMarks || (key === 'marks' && v.type === 'text'),
          key,
          blocked: blocked || key === CONTENT_BARRIER_KEY,
        });
      }
    }
  }
  return null;
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

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isValidPathSegment(seg: string): boolean {
  return seg.length > 0 && seg !== '.' && seg !== '..' && !seg.includes('/');
}

/**
 * Resolve `.`/`..`/empty segments (case-sensitive); join with '/'.
 *
 * Exported because asset-reference resolution outside this module must decide
 * "is this an `assets/`-rooted path?" the way `resolveAssetRef` decides it — which is
 * AFTER normalization, so `./assets/images/x.png` is a packaged-asset reference. A
 * consumer testing only the raw prefix would under-report a dangling asset reference.
 */
export function normalizePath(p: string): string {
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
export function jcsOf(value: unknown): string {
  const s = canonicalize(value);
  if (typeof s !== 'string') {
    throw new CanonicalizationError(`value could not be JCS-serialized: ${JSON.stringify(value)}`);
  }
  return s;
}
