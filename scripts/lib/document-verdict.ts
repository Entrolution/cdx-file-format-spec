/**
 * Defect -> disposition mapper for the document/part layer (B1b), the analogue of
 * archive-verdict.ts one layer up.
 *
 * Given the archive bytes and the container reader's entry set, it loads the CDX
 * parts in memory (part-loader.ts), applies the §5.4.2 / §5.4.3 part-layer failure
 * classes, and resolves each detected defect to the disposition the SPECIFICATION
 * assigns (via the shared resolver, verdict.ts, over conformance/errors.json). The
 * document-level verdict is the most severe (MAX) over per-finding dispositions —
 * the same suite convention as the container layer.
 *
 * SCOPE (B1b-1, Tier 1): the manifest / part-load spine —
 *   - strict-JSON part loading: duplicate keys REJECT in every state (§5.4.3, any
 *     part), via part-loader.ts; a non-representable hashed number REJECTs in every
 *     state (§5.4.3) — applied here to the hashed content part, not to the manifest,
 *     which is not part of the document hash;
 *   - the manifest: absent / unparseable (or not a JSON object) / a malformed
 *     required field / an off-enum state, all REJECT (§5.4.2), reusing
 *     manifest-projection's validateManifestCore;
 *   - version support: an unsupported MAJOR REJECTs, an unsupported MINOR WARNs;
 *   - extension support: an unsupported REQUIRED extension REJECTs, an unsupported
 *     OPTIONAL one is IGNOREd (classified fail-closed — see below);
 *   - the required content part's presence AND parseability: a present-but-unparseable
 *     content part (syntax error, or a decompression / resource-limit failure) REJECTs
 *     in every state, since the content and document identity cannot be established
 *     (§5.4.1; §4.3.2).
 * SCOPE (B1b-2, Tier 2): the content block/mark type classifier — over the parsed
 * content value, every block type and text-node mark type is classified against the
 * reader's recognized vocabulary (content-classifier.ts): an unknown BARE type
 * REJECTs, an unknown NAMESPACED type is IGNOREd, and a structurally malformed
 * KNOWN block/mark WARNs (§5.4.2 rows for §5/§5.1, draft/review column).
 * SCOPE (B1b-3a, Tier 3 part 1): the "declared vs computed" half of the §5.4.2 "File
 * `hash` or document-ID mismatch" row — the file-level content.hash is verified
 * against the exact stored content bytes (§5.1), and, for a document carrying a real
 * (non-pending) id, the canonical document ID is recomputed (canonicalize.ts) and
 * compared to manifest.id (§4.4/§6.3). Both WARN (draft/review); the FROZEN/PUBLISHED
 * INTEGRITY-ERROR escalation is state-keyed (§6.3) and, because soundly trusting the
 * `state` needs a projection-covering signature (§5.4.2 note 3), arrives in B3.
 * SCOPE (B1b-3b-1, Tier 3 part 2): presence of required and path-only-referenced parts,
 * and reference resolution —
 *   - the Dublin Core part: unreferenced, absent, unparseable, or missing a required
 *     term (§3.3.1/§3.3.2), all WARN. Loaded once, shared with the id recompute;
 *   - a manifest reference carrying a path but NO hash — `provenance`, `metadata.jsonld`,
 *     the collaboration comment/change files, the phantom clusters — whose target is
 *     absent WARNs in every state: it binds nothing, so it cannot signal tampering;
 *   - reference resolution over the content tree (reference-resolver.ts): a dangling
 *     core anchor, a dangling extension-block target field, and a dangling extension
 *     cross-reference mark each WARN, and a duplicate id in the shared namespace is an
 *     INTEGRITY-ERROR in every state (Anchors & References §7.2) — the one such ceiling
 *     this layer can assign before B2/B3, because it does not vary by state;
 *   - out-of-hash annotation parts: unparseable WARNs, and an anchor pointing at no
 *     content id WARNs, both state-invariantly.
 * Still deferred: the asset-hash and presentation/asset-index file hash rows, the
 * hash-BOUND missing-part row, dangling asset and presentation references, and the
 * citation/glossary cross-reference namespaces (which live in projection-bound side
 * files) — all B1b-3b-2. Full content-part schema validity beyond the block/mark type
 * rows — the root envelope, anchor-range wiring, extension-block INTERIORS, and NFC
 * normalization — is B1b-3c. Every FROZEN/PUBLISHED INTEGRITY-ERROR escalation is B3.
 * The disposition VALUES are authoritative in errors.json, never invented here.
 */

import { loadPart, hasEntry, type PartLoad } from './part-loader.js';
import { validateManifestCore } from './manifest-projection.js';
import {
  isPlainObject,
  CanonicalizationError,
  firstNonRepresentableNumber,
  hashBytes,
  computeDocumentId,
  algorithmOf,
  isValidContentHash,
} from './canonicalize.js';
import { resolveContentReferences, resolveAnnotationAnchors } from './reference-resolver.js';
import { resolveVerdict, type LayerVerdict, type VerdictFinding } from './verdict.js';
import { classifyContent, type ContentVocabulary } from './content-classifier.js';
import type { ArchiveResult } from './zip-reader.js';

/** Document-layer defect codes this mapper assigns (registered in errors.json). */
export const CODE = {
  MANIFEST_ABSENT: 'CDX-E-MANIFEST-ABSENT',
  MANIFEST_UNPARSEABLE: 'CDX-E-MANIFEST-UNPARSEABLE',
  CONTENT_PART_MISSING: 'CDX-E-CONTENT-PART-MISSING',
  CONTENT_PART_UNPARSEABLE: 'CDX-E-CONTENT-PART-UNPARSEABLE',
  PART_DUPLICATE_KEYS: 'CDX-E-PART-DUPLICATE-KEYS',
  PART_NUMBER_NON_REPRESENTABLE: 'CDX-E-PART-NUMBER-NON-REPRESENTABLE',
  VERSION_MAJOR_UNSUPPORTED: 'CDX-E-VERSION-MAJOR-UNSUPPORTED',
  VERSION_MINOR_UNSUPPORTED: 'CDX-E-VERSION-MINOR-UNSUPPORTED',
  EXTENSION_REQUIRED_UNSUPPORTED: 'CDX-E-EXTENSION-REQUIRED-UNSUPPORTED',
  EXTENSION_OPTIONAL_UNSUPPORTED: 'CDX-E-EXTENSION-OPTIONAL-UNSUPPORTED',
  FILE_HASH_MISMATCH: 'CDX-E-FILE-HASH-MISMATCH',
  DOCUMENT_ID_MISMATCH: 'CDX-E-DOCUMENT-ID-MISMATCH',
  // Reused for a mistyped `metadata` / `metadata.dublinCore`: those ARE malformed manifest
  // references, and §5.4.2 rejects a mistyped required manifest field.
  MANIFEST_REFERENCE_MALFORMED: 'CDX-E-MANIFEST-REFERENCE-MALFORMED',
  METADATA_PART_MISSING: 'CDX-E-METADATA-PART-MISSING',
  METADATA_PART_UNPARSEABLE: 'CDX-E-METADATA-PART-UNPARSEABLE',
  METADATA_TERM_MISSING: 'CDX-E-METADATA-TERM-MISSING',
  PART_MISSING_UNBOUND: 'CDX-E-PART-MISSING-UNBOUND',
  EXTENSION_DATA_PART_UNPARSEABLE: 'CDX-E-EXTENSION-DATA-PART-UNPARSEABLE',
} as const;

/**
 * Out-of-hash extension data parts addressed by CONVENTION rather than by a manifest
 * reference (extensions overview, "Extension Data Files"; the annotations schema's own
 * `$id` description names `security/annotations.json`). The directories are swept by
 * PREFIX: §5.4.2's row is "a collaboration, phantom, or form data file", and an extension
 * is free to add files to its own directory, so membership is by location rather than by
 * an enumerated filename. Everything OUTSIDE these locations stays IGNORE (§5.4.2,
 * unrecognized file) — which is why `security/` is not a swept prefix: `signatures.json`
 * and `encryption.json` are trust material, not annotation data.
 */
const OUT_OF_HASH_DIRECTORIES = ['collaboration/', 'phantoms/', 'forms/'];
const OUT_OF_HASH_FILES = ['security/annotations.json'];

/** Term names the metadata projection carries as strings, and as string arrays (§4.3.1). */
const PROJECTED_STRING_TERMS = ['title', 'description'] as const;
const PROJECTED_ARRAY_TERMS = ['creator', 'subject', 'language'] as const;

/**
 * Classify a loaded Dublin Core part.
 *
 * `malformed` covers everything `projectMetadata` REJECTS — a non-object `terms`, a
 * string term of the wrong type, or an array term that is neither a string nor an array
 * of strings. That distinction matters beyond tidiness: the projection throws on these,
 * so without reporting them the throw lands in the document-ID recompute's catch and
 * silently switches the id check OFF. One malformed *advisory* term (`subject: 42`, or a
 * `creator` array holding a non-string) would otherwise be an attacker-controllable way
 * to disable an integrity check while the document still loads clean.
 *
 * `missing-term` is the narrower §3.3.1/§3.3.2 requirement: `title` a non-empty string,
 * `creator` at least one value. The part still projects, so the id stays verifiable.
 * Malformed is tested FIRST — a wrong-typed required term is unprojectable, not merely absent.
 */
type DublinCoreDefect = 'malformed' | 'missing-term' | null;

function dublinCoreDefect(dublinCore: Record<string, unknown>): DublinCoreDefect {
  const terms = dublinCore.terms;
  if (terms === undefined) return 'missing-term'; // projects as {}, but title/creator are absent
  if (!isPlainObject(terms)) return 'malformed';
  for (const term of PROJECTED_STRING_TERMS) {
    const v = terms[term];
    if (v !== undefined && typeof v !== 'string') return 'malformed';
  }
  for (const term of PROJECTED_ARRAY_TERMS) {
    const v = terms[term];
    if (v === undefined || typeof v === 'string') continue;
    if (!Array.isArray(v) || !v.every((e) => typeof e === 'string')) return 'malformed';
  }
  if (typeof terms.title !== 'string' || terms.title === '') return 'missing-term';
  const creator = terms.creator;
  const hasCreator =
    (typeof creator === 'string' && creator !== '') ||
    (Array.isArray(creator) && creator.some((c) => typeof c === 'string' && c !== ''));
  return hasCreator ? null : 'missing-term';
}

export type { VerdictFinding };
export type DocumentVerdict = LayerVerdict;

/**
 * The reader's support envelope: the single major version it implements, the
 * highest minor version it fully understands, and the set of extension ids it
 * supports. A real reader parameterizes the version/extension degradation rows off
 * exactly this; the reference adapter derives it from its declared capabilities.
 */
export interface ReaderSupport {
  major: number;
  minor: number;
  extensions: ReadonlySet<string>;
}

/**
 * Compute the document-layer verdict for an archive whose container layer has
 * already been read. `archive.entries` is the central-directory entry set;
 * `bytes` is the raw archive so parts can be decompressed in memory on demand.
 * `support` is the reader's version/extension support envelope; `vocab` is the
 * recognized block/mark vocabulary the content classifier compares against
 * (content-classifier.ts, derived from content.schema.json).
 *
 * Container-layer findings are NOT re-mapped here — the caller composes the two
 * verdicts (max over both), so a container REJECT blocks the document regardless of
 * the part-layer read. This function reports only the part-layer findings it detects.
 */
export function documentVerdict(bytes: Buffer, archive: ArchiveResult, support: ReaderSupport, vocab: ContentVocabulary): DocumentVerdict {
  const codes: string[] = [];
  const add = (code: string): void => {
    codes.push(code);
  };

  // Every part is inflated at most once: the Dublin Core, out-of-hash and duplicate-key
  // sweeps otherwise walk overlapping path sets and would decompress the same entry
  // repeatedly.
  const loads = new Map<string, PartLoad>();
  const load = (path: string): PartLoad => {
    let part = loads.get(path);
    if (part === undefined) {
      part = loadPart(bytes, archive.entries, path);
      loads.set(path, part);
    }
    return part;
  };

  // --- Manifest: presence + strict-JSON parse (§5.4.2 / §5.4.3) --------------
  const m = load('manifest.json');
  if (m.status === 'absent') {
    add(CODE.MANIFEST_ABSENT);
    return resolveVerdict(codes); // no manifest => nothing further can be established
  }
  if (m.status === 'defect') {
    // A duplicate-key defect (=> PART-DUPLICATE-KEYS, state-invariant REJECT,
    // §5.4.3) is attributed to that class; a bare JSON syntax error is the
    // "manifest unparseable" row (§5.4.2).
    add(m.code ?? CODE.MANIFEST_UNPARSEABLE);
    return resolveVerdict(codes); // an unusable manifest blocks the load
  }
  if (!isPlainObject(m.value)) {
    // Valid JSON, but not a manifest object (an array or scalar) — unparseable AS A
    // MANIFEST (§5.4.2, the "manifest ... unparseable" row); projectManifest treats
    // the same input the same way.
    add(CODE.MANIFEST_UNPARSEABLE);
    return resolveVerdict(codes);
  }
  const manifest = m.value;

  // --- Required manifest fields (cdx / state / content) — §5.4.2 -------------
  // Reuse manifest-projection's core validator: an off-enum state or a malformed
  // required field is a REJECT in every state. Unlike projectManifest, this applies
  // to a pending-id draft too (there is no projection, but the field rules stand).
  let core;
  try {
    core = validateManifestCore(manifest);
  } catch (err) {
    add(err instanceof CanonicalizationError && err.code ? err.code : CODE.MANIFEST_UNPARSEABLE);
    return resolveVerdict(codes); // a malformed required field blocks the load
  }

  // --- Version support (§5.4.2) ----------------------------------------------
  // core.cdx is a validated "<major>.<minor>" string. An unsupported MAJOR is a
  // REJECT (the reader cannot assume it understands the format); an unsupported
  // MINOR is a WARNING (process known fields, ignore unknown additions).
  const [major, minor] = core.cdx.split('.').map((n) => parseInt(n, 10));
  if (major !== support.major) {
    add(CODE.VERSION_MAJOR_UNSUPPORTED);
    return resolveVerdict(codes); // an unknown major version blocks further interpretation
  }
  if (minor > support.minor) {
    add(CODE.VERSION_MINOR_UNSUPPORTED);
  }

  // --- Extension support (§5.4.2) --------------------------------------------
  // An unsupported REQUIRED extension REJECTs; an unsupported OPTIONAL one is
  // IGNOREd. Classified FAIL-CLOSED: an entry counts as optional only when
  // `required` is explicitly `false`; a missing or non-boolean `required` is
  // treated as required, so a malformed entry cannot silently downgrade an
  // unsupported namespace from REJECT to IGNORE. (Malformed extension entries are
  // otherwise not a Tier-1 row; the classification only governs the support rows.)
  const extensions = manifest.extensions;
  if (Array.isArray(extensions)) {
    for (const ext of extensions) {
      if (isPlainObject(ext) && typeof ext.id === 'string' && !support.extensions.has(ext.id)) {
        add(ext.required === false ? CODE.EXTENSION_OPTIONAL_UNSUPPORTED : CODE.EXTENSION_REQUIRED_UNSUPPORTED);
      }
    }
  }

  // --- Required metadata: the Dublin Core part and its terms (§5.4.2) --------
  // Loaded HERE rather than inside the document-ID recompute below, so one load serves
  // both the missing-metadata row and the id basis. Four ways this row fires: the
  // manifest names no Dublin Core at all, the named part is absent, it is present but
  // unparseable (or not an object), or it omits a required term.
  //
  // The "names no Dublin Core" arm has a competing reading: `metadata.dublinCore` is a
  // REQUIRED manifest field, so §5.4.2's "Manifest ... missing ... a required field" row
  // would make it a REJECT. This row is the more specific of the two and WARNING is the
  // narrower change, so it is taken here; widening validateManifestCore instead would
  // change REJECT behaviour and is left as a decision for the spec, not assumed.
  // (§5.4.2 note 5: an ENCRYPTED part mapped to a stored `.enc` entry satisfies presence
  // and MUST NOT fire a missing-part row. No encryption support exists before B2 and no
  // fixture exercises it; the guard belongs with the security extension's part mapping.)
  let dublinCore = '{}';
  let dcResolvable = true;
  // MISTYPED is not the same as absent. `metadata` is a required manifest field and
  // `metadata.dublinCore` a required member of it, so a present-but-wrong-typed one is
  // unambiguously §5.4.2's "Manifest ... missing or MISTYPING a required field" REJECT —
  // the reading below only ever applies to genuine absence. Without this, replacing
  // `"dublinCore": "…"` with an object downgrades a REJECT to a WARNING and quietly
  // switches the id recompute to an empty-metadata basis.
  const metadata = manifest.metadata;
  const dcRef = isPlainObject(metadata) ? metadata.dublinCore : undefined;
  const referenceMistyped = (metadata !== undefined && !isPlainObject(metadata)) || (dcRef !== undefined && typeof dcRef !== 'string');
  if (referenceMistyped) {
    add(CODE.MANIFEST_REFERENCE_MALFORMED);
    // The DECLARATION is unusable, so the metadata basis is indeterminate — not empty.
    // Falling through to the absent arm would both misreport (the document does declare
    // metadata) and recompute the id over `{}`, manufacturing the spurious mismatch this
    // block avoids for a referenced-but-unloadable part.
    dcResolvable = false;
  } else if (typeof dcRef !== 'string') {
    // Unreferenced. `{}` IS the correct id basis (§4.3.1 projects absent metadata as
    // empty), so the recompute still proceeds — the document is missing metadata, not
    // indeterminate.
    add(CODE.METADATA_PART_MISSING);
  } else {
    const dc = load(dcRef);
    if (dc.status === 'absent') {
      add(CODE.METADATA_PART_MISSING);
      dcResolvable = false; // the id was computed over the real terms; `{}` would be a different document
    } else if (dc.status === 'defect') {
      // A CODED defect is a part-agnostic state-invariant REJECT (duplicate keys),
      // reported once by the any-part sweep below; `code: null` is the uncoded parse or
      // decompression failure that this row's unparseable arm owns.
      if (dc.code === null) add(CODE.METADATA_PART_UNPARSEABLE);
      dcResolvable = false;
    } else if (!isPlainObject(dc.value)) {
      // Parseable but not a Dublin Core object: projectMetadata rejects it, so the id
      // basis is indeterminate too (the flag would otherwise still read `true` here and
      // the recompute would fail silently inside its catch).
      add(CODE.METADATA_PART_UNPARSEABLE);
      dcResolvable = false;
    } else {
      const defect = dublinCoreDefect(dc.value);
      if (defect === 'malformed') {
        // Unprojectable: the metadata cannot enter the document ID, so the id basis is
        // indeterminate. Reported here so the recompute's catch is never the only thing
        // that notices — a silent skip there is an integrity check switched off.
        add(CODE.METADATA_PART_UNPARSEABLE);
        dcResolvable = false;
      } else {
        dublinCore = dc.text;
        if (defect === 'missing-term') add(CODE.METADATA_TERM_MISSING);
      }
    }
  }

  // --- Referenced parts OUTSIDE the hash and projection (§5.4.2) -------------
  // A manifest reference carrying a path but NO hash binds nothing: it is neither in the
  // document hash nor in the manifest projection, so a missing target degrades a layer
  // rather than impugning integrity — WARNING in every state. The hash-BOUND references
  // (a presentation layer, an asset index) are a different row and arrive in B1b-3b-2.
  // `security.{signatures,encryption}` are path-only too, but belong with B2's trust
  // material rather than here.
  const collaboration = isPlainObject(manifest.collaboration) ? manifest.collaboration : undefined;
  const phantoms = isPlainObject(manifest.phantoms) ? manifest.phantoms : undefined;
  // `metadata.custom` is an open map of path references (manifest schema: "Custom
  // metadata references"), so its values are path-only references like the named ones.
  const customMetadata = isPlainObject(metadata) && isPlainObject(metadata.custom) ? Object.values(metadata.custom) : [];
  const unboundRefs = [
    manifest.provenance,
    isPlainObject(metadata) ? metadata.jsonld : undefined,
    ...customMetadata,
    collaboration?.comments,
    collaboration?.changes,
    phantoms?.clusters,
  ].filter((ref): ref is string => typeof ref === 'string');
  for (const ref of unboundRefs) {
    if (!hasEntry(archive.entries, ref)) add(CODE.PART_MISSING_UNBOUND);
  }

  // --- Required content part: presence + strict-JSON parse -------------------
  // The content part is required in every state (§5.4.2 "Missing the required
  // content part" => REJECT). Its path was validated safe by validateManifestCore.
  //
  // The content's identifier namespace, once known, is what an out-of-hash annotation
  // layer's anchors resolve against (below). Null while it cannot be established.
  let contentIds: ReadonlySet<string> | null = null;
  if (!hasEntry(archive.entries, core.content.path)) {
    add(CODE.CONTENT_PART_MISSING);
  } else {
    const c = load(core.content.path);
    if (c.status === 'defect') {
      // A coded state-invariant reject (duplicate keys), or — for an uncoded parse /
      // decompression / resource-limit failure — the required content part cannot
      // yield a JSON value, so the document's content and identity cannot be
      // established: REJECT in every state (§5.4.1; §4.3.2 requires canonical JSON).
      // Symmetric with the manifest path above.
      add(c.code ?? CODE.CONTENT_PART_UNPARSEABLE);
    } else if (c.status === 'ok') {
      // The content part IS hashed, so the state-invariant non-representable-number
      // rule (§5.4.3) applies to it even for a pending-id draft that is never
      // canonicalized.
      if (firstNonRepresentableNumber(c.value) !== null) add(CODE.PART_NUMBER_NON_REPRESENTABLE);
      // B1b-2: classify every block/mark type in the parsed content tree. An unknown
      // bare type REJECTs, an unknown namespaced type is IGNOREd, a malformed known
      // block/mark WARNs (§5.4.2, §5/§5.1). resolveVerdict maps each code's disposition.
      for (const f of classifyContent(c.value, vocab)) add(f.code);

      // --- B1b-3b-1: reference resolution over the content tree ------------------
      // Runs BEFORE the id recompute below so a duplicate id surfaces as its own
      // finding: the recompute's catch would otherwise swallow the very same defect
      // (alphaRenameIds throws on it) and the document would load clean.
      // resolveContentReferences walks RAW stored content, applying the canonicalizer's
      // own erasures so it cannot report a collision computeDocumentId would accept.
      try {
        const resolved = resolveContentReferences(c.value);
        for (const f of resolved.findings) add(f.code);
        contentIds = resolved.ids;
      } catch (err) {
        // Content nested deeper than the canonicalizer accepts: references and the id
        // namespace are both indeterminate, exactly as the recompute below treats it.
        // Not a dangling reference, so nothing is emitted.
        if (!(err instanceof CanonicalizationError)) throw err;
      }

      // --- B1b-3a: file-hash + document-ID recompute ("declared vs computed") ----
      // Both run only on a present-AND-parseable content part: c.bytes are the exact
      // stored bytes (§5.1), and computeDocumentId re-parses `content`, so a parseable
      // part means it can only throw a typed CanonicalizationError (never a bare
      // SyntaxError). An unparseable/dup-key content is already the dominant REJECT.

      // File-hash mismatch (§5.4.2 row "File `hash` … mismatch"; §5.1/§6.3): the file
      // hash pins the EXACT stored bytes, so hash c.bytes directly, not the re-encoded
      // text. content.hash was validated well-formed by validateManifestCore, so
      // algorithmOf won't throw — but hashBytes → nodeHashName throws for an algorithm
      // this runtime cannot compute (blake3), which is integrity-INDETERMINATE, not a
      // mismatch and not clean; no 3a fixture exercises it (capability-scoped away in
      // the adapter), so the reader simply cannot verify and emits nothing.
      try {
        if (hashBytes(algorithmOf(core.content.hash), c.bytes) !== core.content.hash) {
          add(CODE.FILE_HASH_MISMATCH);
        }
      } catch (err) {
        if (!(err instanceof CanonicalizationError)) throw err;
      }

      // Document-ID mismatch (§5.4.2 same row; §4.4/§6.3): recompute the canonical id
      // and compare to manifest.id. Only for a document carrying a real id — a draft's
      // id is `pending` (§7.1), skipped by isValidContentHash (which also skips a
      // malformed id). The recompute is deliberately NOT state-gated: a draft carrying
      // a real, stale id that mismatches is still a WARNING (§6.3 draft = Warning);
      // `pending` is the only draft id in practice. A review/frozen/published document
      // carrying `id: "pending"` MUST NOT exist (§7.2) but is not a *mismatch* — it is
      // left for a future state-model slice, not silently blessed here.
      // The Dublin Core part's metadata projects into the id (§4.3.1), so the recompute
      // needs its bytes — loaded once above, where the missing-metadata row also reads
      // it. Two DC states let the recompute proceed: UNREFERENCED (the id was computed
      // over empty metadata, so `{}` is the correct basis) and REFERENCED-AND-CLEAN (its
      // text). A REFERENCED-BUT-UNLOADABLE DC is NOT `{}` — the id was computed over the
      // real terms, so recomputing over `{}` would compare a different document's basis
      // and manufacture a spurious mismatch; `dcResolvable` is false there and the
      // recompute is skipped as indeterminate, the defect itself being reported above.
      if (isValidContentHash(manifest.id) && dcResolvable) {
        try {
          const recomputed = computeDocumentId({ manifest: m.text, content: c.text, dublinCore }, algorithmOf(manifest.id));
          if (recomputed !== manifest.id) add(CODE.DOCUMENT_ID_MISMATCH);
        } catch (err) {
          // Cannot recompute, so the id is INDETERMINATE — not a mismatch, and emitting
          // nothing here is never a substitute for the row that owns the underlying
          // defect. canonicalContent throws for:
          //   - an id algorithm this runtime cannot compute (blake3) — a capability limit;
          //   - a malformed Dublin Core term — reported above, CDX-E-METADATA-PART-UNPARSEABLE;
          //   - a duplicate id — reported above, CDX-E-ID-COLLISION;
          //   - a `#b<n>` reference using the reserved canonical-name form — reported above
          //     as dangling (it resolves to no id), though at a disposition that understates
          //     it: the document's identity cannot be computed at all;
          //   - content past MAX_CANONICALIZATION_DEPTH, and a stored-byte invariant
          //     violation (non-NFC, an unpaired surrogate, an unsafe integer) — NEITHER has
          //     a reporting row yet: §5.4.2 has no document-layer depth row (Container
          //     Format §5.3 bounds the archive), and NFC/Unicode is B1b-3c;
          //   - once assets exist, a dangling asset reference or conflicting asset hashes
          //     — B1b-3b-2.
          // Only the last two bullets are still silent; the rest now fire before this catch.
          if (!(err instanceof CanonicalizationError)) throw err;
        }
      }
    }
  }

  // --- Out-of-hash extension data parts (§5.4.2) -----------------------------
  // Two rows over the same part set. Both are WARNING in EVERY state: these bytes are in
  // no signature scope and in no hash, so their failure cannot signal tampering
  // (extensions overview, Integrity Status; §5.4.3's out-of-hash-layer rule).
  //   - present but UNPARSEABLE => the missing-or-unparseable out-of-hash data row. Runs
  //     unconditionally: it does not depend on the content part.
  //   - anchors that point INTO content => the dangling out-of-hash anchor row. Needs the
  //     content's identifier namespace, so it runs only where that could be established.
  //     Usually that means the content part is absent or unparseable and the document
  //     already REJECTs. It can ALSO mean content nested past the canonicalizer's depth
  //     bound, which parses cleanly and carries no row of its own — there the anchor pass,
  //     the reference resolver and the id recompute all go quiet together. That gap is
  //     recorded, not hidden: a document-layer disposition for over-deep content needs a
  //     §5.4.2 row that does not yet exist (Container Format §5.3 bounds the ARCHIVE).
  // A part MISSING at a manifest-declared path is the unbound-reference row above, not
  // here — `load` reports it absent and this sweep skips it.
  const outOfHashPaths = new Set<string>();
  for (const entry of archive.entries) {
    if (!entry.name.endsWith('.json')) continue;
    if (OUT_OF_HASH_FILES.includes(entry.name) || OUT_OF_HASH_DIRECTORIES.some((dir) => entry.name.startsWith(dir))) {
      outOfHashPaths.add(entry.name);
    }
  }
  // Every path-only manifest reference too, wherever it points — the same set whose
  // ABSENCE is the row above. Covering absence but not corruption would report the
  // milder defect and stay silent on the worse one, and it would miss a part placed
  // outside its conventional directory. (The projection-BOUND side files — a semantic
  // bibliography or glossary, academic numbering — are a different row and arrive in
  // B1b-3b-2 with the rest of the hash-bound part handling.)
  for (const ref of unboundRefs) outOfHashPaths.add(ref);
  // The manifest and content parts have their own rows; sweeping them here would
  // double-report one defect under two codes.
  outOfHashPaths.delete('manifest.json');
  outOfHashPaths.delete(core.content.path);

  // ANCHOR resolution is scoped more tightly than the unparseable check. The unparseable
  // row applies to any out-of-hash data part, but only an ANNOTATION layer anchors into
  // content, and reference-resolver.ts resolves solely the positions those schemas
  // declare. Running it over every path-only reference would read an unrelated part — a
  // provenance record that happened to carry a `changes` array, say — as an annotation
  // layer, which is exactly the location discipline the resolver argues for.
  const annotationPaths = new Set<string>(OUT_OF_HASH_FILES);
  for (const path of outOfHashPaths) {
    if (OUT_OF_HASH_DIRECTORIES.some((dir) => path.startsWith(dir))) annotationPaths.add(path);
  }
  for (const ref of [collaboration?.comments, collaboration?.changes, phantoms?.clusters]) {
    if (typeof ref === 'string') annotationPaths.add(ref);
  }
  for (const path of [...outOfHashPaths].sort()) {
    const p = load(path);
    if (p.status === 'defect') {
      // As above: a coded defect (a duplicate key) is the state-invariant REJECT the
      // sweep below reports; `code: null` is the uncoded parse failure this row owns.
      if (p.code === null) add(CODE.EXTENSION_DATA_PART_UNPARSEABLE);
    } else if (p.status === 'ok' && contentIds !== null && annotationPaths.has(path)) {
      for (const f of resolveAnnotationAnchors(p.value, contentIds, path)) add(f.code);
    }
  }

  // --- Duplicate keys in ANY part (§5.4.3, state-invariant) ------------------
  // "Any part containing an object with duplicate keys MUST be rejected before
  // hashing or verification, in every state" — a split-view substitution vector,
  // and §5.4.3 explicitly overrides the per-state table. The manifest and content
  // parts are checked above; sweep every OTHER JSON part (Dublin Core, and any
  // presentation / asset-index / extension part) for the same defect. A legitimate
  // document has no duplicate key anywhere, so this never false-rejects. (The
  // non-representable-NUMBER rule is NOT swept: only the content part is free-form
  // hashed content — Dublin Core projects string terms only, §4.6 — so a number
  // outside the content part is not a hashed number.)
  // Swept by extension OR by manifest declaration: a JSON part is not obliged to be
  // named `.json` (relativePath permits any name), and the metadata / provenance /
  // collaboration / phantom references are declared paths whose duplicate keys must
  // reject just the same. The arms above delegate their CODED defects to this sweep, so
  // a part it skipped would lose a state-invariant REJECT entirely.
  const declaredParts = new Set<string>([...unboundRefs, ...(typeof dcRef === 'string' ? [dcRef] : [])]);
  for (const entry of archive.entries) {
    if (!entry.name.endsWith('.json') && !declaredParts.has(entry.name)) continue;
    if (entry.name === 'manifest.json' || entry.name === core.content.path) continue;
    const p = load(entry.name);
    if (p.status === 'defect' && p.code === CODE.PART_DUPLICATE_KEYS) add(p.code);
  }

  return resolveVerdict(codes);
}
