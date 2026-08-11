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
 *   - the Dublin Core part: referenced but absent, unparseable, or missing a required
 *     term (§3.3.1/§3.3.2), all WARN. An absent `metadata`/`metadata.dublinCore` FIELD is
 *     not here — that is a malformed manifest, REJECT. Loaded once, shared with the id
 *     recompute;
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
 * SCOPE (B1b-3b-2, Tier 3 part 3): the hash-BOUND material outside the content part —
 *   - asset categories (asset-index.ts): each category's index is loaded from its DERIVED
 *     path (05 §3.1) and hash-verified, then every asset and image variant it lists is
 *     verified against its own hash and checked for presence (05 §8.1). A category whose
 *     index cannot be loaded is INDETERMINATE, which suspends both its asset references and
 *     the document-ID recompute rather than reporting defects the document may not have;
 *   - the document-ID recompute now RECEIVES those index texts. Before this slice it passed
 *     none, so `buildAssetMap` threw for any `manifest.assets` and every asset-bearing
 *     document silently skipped its id verification inside the catch below;
 *   - dangling asset references (§5.4.2's canonicalization-error row) and the citation /
 *     glossary cross-reference namespaces carried by the projection-bound side files;
 *   - declared `presentation[]` layers: presence, file hash, and the dangling `blockId` /
 *     `blockRefs` row — the last state-invariant, since presentation sits outside the
 *     document-hash boundary (04 §13.4). An UNDECLARED presentation file is reported too:
 *     no hash binds it, and §5.4.2's preamble refuses to treat it as a benign out-of-hash
 *     layer;
 *   - extension config-slot `{path, hash}` side files: presence and hash, over exactly the
 *     set `collectConfigFileReferences` binds into the projection.
 * Still deferred: the declared-MIME-mismatch row (§5.4.2 row for 05 §11.1, which needs
 * magic-byte sniffing), asset `size` against actual bytes (05 §11.1 item 4, no §5.4.2 row),
 * the manifest/file presentation `type` agreement (04 §13.3, likewise no row), and 04 §13.5's
 * precise-layout coverage gap. Full content-part schema validity beyond the block/mark type
 * rows — the root envelope, anchor-range wiring, extension-block INTERIORS, and NFC
 * normalization — is B1b-3c. Every FROZEN/PUBLISHED INTEGRITY-ERROR escalation is B3.
 * The disposition VALUES are authoritative in errors.json, never invented here.
 */

import { loadPart, hasEntry, type PartLoad } from './part-loader.js';
import { validateManifestCore, collectConfigFileReferences } from './manifest-projection.js';
import {
  isPlainObject,
  CanonicalizationError,
  firstNonRepresentableNumber,
  hashBytes,
  computeDocumentId,
  algorithmOf,
  isValidContentHash,
} from './canonicalize.js';
import {
  resolveContentReferences,
  resolveAnnotationAnchors,
  resolveAssetReferences,
  resolvePresentationReferences,
  resolveSemanticReferences,
  collectBibliographyIds,
  collectGlossaryIds,
  type SemanticNamespaces,
} from './reference-resolver.js';
import { verifyAssetIndexes } from './asset-index.js';
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
  MANIFEST_FIELD_MISSING: 'CDX-E-MANIFEST-FIELD-MISSING',
  METADATA_PART_MISSING: 'CDX-E-METADATA-PART-MISSING',
  METADATA_PART_UNPARSEABLE: 'CDX-E-METADATA-PART-UNPARSEABLE',
  METADATA_TERM_MISSING: 'CDX-E-METADATA-TERM-MISSING',
  PART_MISSING_UNBOUND: 'CDX-E-PART-MISSING-UNBOUND',
  EXTENSION_DATA_PART_UNPARSEABLE: 'CDX-E-EXTENSION-DATA-PART-UNPARSEABLE',
  // B1b-3b-2: the hash-BOUND parts. `PART_MISSING_BOUND` is shared with asset-index.ts,
  // which reports it for an absent index or a listed-but-absent asset; here it covers an
  // absent `manifest.presentation[]` layer, the other part the projection binds by hash.
  PART_MISSING_BOUND: 'CDX-E-PART-MISSING-BOUND',
  PRESENTATION_HASH_MISMATCH: 'CDX-E-PRESENTATION-HASH-MISMATCH',
  PRESENTATION_UNDECLARED: 'CDX-E-PRESENTATION-UNDECLARED',
  CONFIG_PART_MISSING: 'CDX-E-CONFIG-PART-MISSING',
  CONFIG_FILE_HASH_MISMATCH: 'CDX-E-CONFIG-FILE-HASH-MISMATCH',
} as const;

/**
 * Where a presentation or precise-layout file lives (04 §12.1: "Precise layouts are stored
 * in `presentation/layouts/`"). Swept by PREFIX so the undeclared-layout check does not
 * depend on an enumerated filename, exactly as OUT_OF_HASH_DIRECTORIES is swept.
 */
const PRESENTATION_DIRECTORY = 'presentation/';

/**
 * The closed presentation-type set (04 §13.3; mirrors manifest.schema.json
 * `presentationReference.type`). A file under the presentation directory is only treated as
 * a layout when it carries one of these as its own discriminator — `presentationType` for a
 * precise layout, `type` for a reactive one.
 */
const PRESENTATION_TYPES = new Set(['paginated', 'continuous', 'responsive', 'precise']);

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
  if (m.status === 'unobtainable') {
    // The manifest is PRESENT but compressed with a permitted method this reader has not
    // implemented. Nothing about the document can be established, yet it is not defective —
    // the container layer reports the entry integrity-indeterminate and §5.4.2 note 6
    // forbids reporting it missing. Blaming the document for the reader's capability
    // envelope is precisely what note 6 exists to prevent.
    return resolveVerdict(codes);
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
  // both the missing-metadata row and the id basis. Three ways the PART-level row fires:
  // the named part is absent, it is present but unparseable (or not an object), or it
  // omits a required term. A manifest that names no Dublin Core at all is NOT this row —
  // see the absent-field arm below.
  // (§5.4.2 note 5: an ENCRYPTED part mapped to a stored `.enc` entry satisfies presence
  // and MUST NOT fire a missing-part row. No encryption support exists before B2 and no
  // fixture exercises it; the guard belongs with the security extension's part mapping.)
  let dublinCore = '{}';
  let dcResolvable = true;
  // MISTYPED is not the same as absent. `metadata` is a required manifest field and
  // `metadata.dublinCore` a required member of it, so a present-but-wrong-typed one is
  // unambiguously §5.4.2's "Manifest ... missing or MISTYPING a required field" REJECT —
  // the arm below only ever applies to genuine absence. Without this, replacing
  // `"dublinCore": "…"` with an object reports the wrong code and quietly switches the id
  // recompute to an empty-metadata basis. Since the erratum the DISPOSITION is REJECT
  // either way, so do not read this guard as the thing carrying it.
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
    // ABSENT REQUIRED FIELD, not a part-level metadata defect: `metadata` is required by
    // the manifest schema and `dublinCore` is required within it, so a manifest carrying
    // neither is malformed exactly as one missing `content` is — §5.4.2's "Manifest ...
    // missing ... a required field" REJECT. This arm covers both an absent `metadata` and
    // a present `metadata` with no `dublinCore`; the spec's metadata row is explicitly
    // PART-level and does not reach either.
    //
    // NO EARLY RETURN. Sibling REJECT arms above exit, but findings are push-only and the
    // disposition resolves once at the end, so a return here would buy nothing and would
    // silently switch off every later pass for this document — the block/mark classifier,
    // reference resolution, verifyAssetIndexes, the duplicate-key sweep and the file-hash
    // and document-ID recompute. The suite would not notice: the only fixture reaching
    // this arm asserts a single finding, and a subset comparator cannot see what stopped
    // being reported. `{}` remains the correct id basis (§4.3.1 projects absent metadata
    // as empty), so `dcResolvable` stays true and the recompute below still runs.
    add(CODE.MANIFEST_FIELD_MISSING);
  } else {
    const dc = load(dcRef);
    if (dc.status === 'absent') {
      add(CODE.METADATA_PART_MISSING);
      dcResolvable = false; // the id was computed over the real terms; `{}` would be a different document
    } else if (dc.status === 'unobtainable') {
      // Present, intact, undecodable HERE. Not a missing-metadata defect (§5.4.2 note 6),
      // but the id basis is indeterminate, so the recompute is suspended exactly as it is
      // for a referenced-but-unloadable DC part.
      dcResolvable = false;
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

  // --- Asset categories: index load + the 05 §8.1 hash chain (§5.4.2) --------
  // Runs BEFORE the content part, for two reasons. The asset map decides whether two
  // adjacent text nodes MERGE (a `link` href resolves to its asset hash before the mark
  // sets are compared, §4.3.1 items 2-4), so the raw content walk below cannot report id
  // collisions honestly without it. And the map is what the dangling-asset-reference row
  // resolves against. Depends only on `manifest.assets`, so it is unconditional: a document
  // whose content part is missing still has verifiable asset hashes.
  const assetResult = verifyAssetIndexes(manifest, archive.entries, bytes, load);
  for (const f of assetResult.findings) add(f.code);
  // Every asset-dependent check downstream is suspended when ANY declared category failed
  // to load: the recompute would otherwise run over a partial asset map and manufacture a
  // spurious id mismatch, exactly as it would over an empty Dublin Core basis.
  const assetsResolvable = assetResult.unresolvable.size === 0 && assetResult.assetMap !== null;
  /** The map for the categories that DID load — enough to resolve their own references. */
  const assetMap = assetResult.assetMap ?? new Map<string, string>();
  /**
   * The map the raw CONTENT WALK may use, and only a COMPLETE one qualifies.
   *
   * A partial map is worse than no map for merge purposes. `mergeKeyOf` resolves an href it
   * can find to a real hash and falls back to a placeholder for one it cannot, so with one
   * category missing two adjacent text nodes whose links point into DIFFERENT categories key
   * differently and fail to merge — while the canonicalizer, holding every index, resolves
   * both to the same hash and merges them. The raw walk then reports a duplicate id the
   * canonicalizer does not: a FALSE CDX-E-ID-COLLISION, an INTEGRITY-ERROR on a document
   * `computeDocumentId` accepts, which is the single worst outcome this layer can produce.
   * Passing `undefined` instead restores the documented conservative fallback — every
   * packaged href keys alike, so the walk over-merges and can only MISS a collision.
   */
  const trustedAssetMap = assetsResolvable ? assetMap : undefined;

  // --- Extension config-slot side files: presence + hash (§5.4.2) ------------
  // `collectConfigFileReferences` is the projection's own definition of which config files
  // are hash-bound (Security Extension §9.7), reused rather than re-listed so the check can
  // never bind a different set than the signature does. It throws on a traversal-unsafe path
  // or a hash conflict — both manifest-level defects the projection reports on its own
  // terms — and there the set is indeterminate, so nothing is checked here.
  //
  // §5.4.2's row for a MISSING or unparseable one is settled by erratum: the out-of-hash
  // row's examples formerly named these files while its "path-only" qualifier excluded a
  // `{path, hash}` declaration, and the examples were removed — the hash-bound row governs.
  // WARNING in draft/review, which is what is emitted; the frozen INTEGRITY-ERROR is B3.
  let configRefs: Array<{ path: string; hash: string }> = [];
  try {
    configRefs = collectConfigFileReferences(manifest);
  } catch (err) {
    if (!(err instanceof CanonicalizationError)) throw err;
  }
  /** Loaded config side files by path, for the namespaces the semantic marks resolve against. */
  const configValues = new Map<string, unknown>();
  for (const ref of configRefs) {
    const part = load(ref.path);
    if (part.status === 'absent') {
      add(CODE.CONFIG_PART_MISSING);
      continue;
    }
    if (part.status === 'unobtainable') {
      // Present but not decodable by this reader: §5.4.2 note 6 forbids the missing-part
      // row here. The namespace it carries stays indeterminate (`configValues` is left
      // unset), which suspends the citation/glossary rows rather than reporting them.
      continue;
    }
    if (part.status === 'defect') {
      // A coded defect (duplicate keys) is the any-part sweep's state-invariant REJECT; an
      // uncoded parse failure leaves the file unusable, which for a hash-bound side file is
      // the same practical outcome as its absence.
      if (part.code === null) add(CODE.CONFIG_PART_MISSING);
      continue;
    }
    configValues.set(ref.path, part.value);
    // The declared hash pins the exact stored bytes (§5.1), so hash the bytes, never the
    // re-encoded text. An algorithm this runtime cannot compute leaves the file
    // integrity-INDETERMINATE, which is neither a mismatch nor clean.
    try {
      if (hashBytes(algorithmOf(ref.hash), part.bytes) !== ref.hash) add(CODE.CONFIG_FILE_HASH_MISMATCH);
    } catch (err) {
      if (!(err instanceof CanonicalizationError)) throw err;
    }
  }

  // The bibliography and glossary namespaces a `citation` / `glossary` mark resolves
  // against. `null` is INDETERMINATE, not empty: the document declares a side file that
  // could not be loaded, so its ids are unknown and no mark can honestly be called
  // dangling. A document declaring no side file at all gets an empty set instead — there
  // the marks genuinely resolve to nothing.
  const semanticSlot = isPlainObject(manifest.semantic) ? manifest.semantic : undefined;
  const sideFileState = (slot: unknown): { declared: boolean; value: unknown } => {
    const path = isPlainObject(slot) ? slot.path : undefined;
    if (typeof path !== 'string') return { declared: false, value: undefined };
    // `configValues` holds only the refs the PROJECTION binds — exactly `{path, hash}`,
    // nothing more, nothing less (manifest-projection.ts `isFileReference`). A declaration
    // written path-only, or carrying a third member, is therefore absent from it while still
    // naming a file that is present and perfectly loadable. Reading only `configValues` would
    // leave such a document with an indeterminate namespace and silently switch the ENTIRE
    // citation or glossary row off — the wrong response to a declaration that binds less than
    // it should. So fall back to loading by path. (semantic.schema.json requires both members,
    // so this shape is non-conformant; the Semantic Extension README nonetheless contemplates
    // a path-only declaration, and its hash-binding defect is a separate matter from whether
    // the namespace can be established.)
    const cached = configValues.get(path);
    if (cached !== undefined) return { declared: true, value: cached };
    const part = load(path);
    return { declared: true, value: part.status === 'ok' ? part.value : undefined };
  };
  const bibliographyFile = sideFileState(semanticSlot?.bibliography);
  const glossaryFile = sideFileState(semanticSlot?.glossary);

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
        // The asset map is passed so the walk merges adjacent text nodes exactly as canon
        // does; without it every packaged-asset href keys alike and the walk over-merges,
        // hiding a real id collision (see CollectOptions.assetMap).
        const resolved = resolveContentReferences(c.value, trustedAssetMap);
        for (const f of resolved.findings) add(f.code);
        contentIds = resolved.ids;

        // --- B1b-3b-2: dangling asset references (§5.4.2) --------------------
        // Only where the map is trustworthy. With an unresolvable category the map is
        // partial, and reporting against it would turn one missing index into a dangling
        // finding for every reference into that category. `resolveAssetReferences` also
        // suppresses per-category, so this outer guard covers only the whole-map failure.
        if (assetResult.assetMap !== null) {
          for (const f of resolveAssetReferences(c.value, assetMap, assetResult.unresolvable)) add(f.code);
        }

        // --- B1b-3b-2: citation / glossary cross-references (§5.4.2) ---------
        // Semantic Extension §4.4 / §8.3 make each namespace a PRECEDENCE, not a union: the
        // external side file when the manifest declares one, the in-document
        // `semantic:bibliography` entries / `semantic:term` blocks otherwise. `declared` is
        // therefore passed through, never inferred from whether a value happened to load.
        const namespaces: SemanticNamespaces = {
          bibliography: bibliographyFile.declared && bibliographyFile.value === undefined
            ? null
            : collectBibliographyIds(c.value, bibliographyFile.value, bibliographyFile.declared, trustedAssetMap),
          glossary: glossaryFile.declared && glossaryFile.value === undefined
            ? null
            : collectGlossaryIds(c.value, glossaryFile.value, glossaryFile.declared, trustedAssetMap),
        };
        for (const f of resolveSemanticReferences(c.value, namespaces, trustedAssetMap)) add(f.code);
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
      // Asset indexes enter the basis the same way (§4.3.1 item 2 replaces every content
      // asset reference with the referenced asset's hash), so an unloadable category makes
      // the id INDETERMINATE just as an unloadable Dublin Core part does.
      //
      // `assetsResolvable` is defence in depth, and is honest about being so: unlike
      // `dcResolvable` — without which the recompute really would run over `{}` and
      // manufacture a mismatch — an unresolvable category makes `buildAssetMap` throw
      // anyway, so removing this conjunct changes no output today and no test catches it
      // (verified by mutation). It is kept because the alternative is to let a THROW inside
      // a catch be the only thing suppressing an integrity check, which is precisely how a
      // check goes silently missing: if `buildAssetMap` ever became lenient about a category
      // it was handed no index for, the recompute would start comparing a partial-map basis
      // against the declared id and report every asset-bearing document as tampered.
      //
      // The `assetIndexes` argument below is the opposite — load-bearing, and pinned by
      // warn-asset-document-id-mismatch. Before B1b-3b-2 it was omitted entirely, so
      // `buildAssetMap` threw for any `manifest.assets` and the catch silently switched the
      // id check off for EVERY asset-bearing document.
      if (isValidContentHash(manifest.id) && dcResolvable && assetsResolvable) {
        try {
          const recomputed = computeDocumentId(
            { manifest: m.text, content: c.text, dublinCore, assetIndexes: assetResult.indexTexts },
            algorithmOf(manifest.id),
          );
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
          //   - content OR Dublin Core past MAX_CANONICALIZATION_DEPTH, and a stored-byte
          //     UNICODE violation (non-NFC, an unpaired surrogate) — NEITHER has a reporting
          //     row yet: §5.4.2 has no document-layer depth row (Container Format §5.3
          //     bounds the archive), and NFC/Unicode is B1b-3c. The third stored-byte arm,
          //     an unsafe integer, is NOT silent: the pre-canonicalization scan at
          //     `firstNonRepresentableNumber(c.value)` above fires
          //     CDX-E-PART-NUMBER-NON-REPRESENTABLE, and it reaches every number this
          //     throw could (canon only deletes numbers, and a Dublin Core number is
          //     rejected by `projectMetadata` first);
          //   - a dangling asset reference — reported above, CDX-E-ASSET-REFERENCE-DANGLING;
          //   - conflicting or malformed asset hashes in an index — reported above,
          //     CDX-E-ASSET-INDEX-UNUSABLE, which also makes `assetsResolvable` false so
          //     this recompute never runs on such a document;
          //   - a `semantic:term`/`semantic:footnote` id spelling a canonical name
          //     (Document Hashing §4.3.1 item 5) — NOT reported anywhere. §5.4.2 assigns
          //     no row and there is no code, so a document carrying such an id loads with
          //     its declared `manifest.id` UNVERIFIED and nothing said. All three silent
          //     arms suppress the id signal identically — what differs is reachability:
          //     excess depth and a Unicode violation need structurally anomalous content,
          //     whereas `id: "b0"` is innocuous on its face and valid under the schema's
          //     id pattern, so an injected block carrying it suppresses the mismatch for
          //     the whole document without looking like an attack. Tracked as OQ-007.
          // The depth, Unicode and preserved-id bullets are silent; the rest fire before
          // this catch.
          if (!(err instanceof CanonicalizationError)) throw err;
        }
      }
    }
  }

  // --- Declared presentation layers (§5.4.2) ---------------------------------
  // A `manifest.presentation[]` entry is a `{type, path, hash}` reference the projection
  // binds (Security Extension §9.7), so its absence is the hash-BOUND missing-part row and
  // its hash mismatch is the file-hash row. Runs unconditionally — a document with no
  // readable content part still declares presentation layers whose bytes are verifiable.
  //
  // The DANGLING-reference row inside such a layer is different in kind: 04 §13.4 puts
  // presentation outside the document-hash boundary, so a stale `blockId` degrades rendering
  // and never impugns integrity, in ANY state. It needs the content's identifier namespace,
  // so it is gated on that having been established — the same gate the annotation-anchor
  // pass below uses.
  const declaredPresentation = new Set<string>();
  const presentation = manifest.presentation;
  if (Array.isArray(presentation)) {
    for (const entry of presentation) {
      if (!isPlainObject(entry) || typeof entry.path !== 'string') continue;
      declaredPresentation.add(entry.path);
      const part = load(entry.path);
      if (part.status === 'absent') {
        add(CODE.PART_MISSING_BOUND);
        continue;
      }
      if (part.status === 'unobtainable') {
        // Present and intact; this reader lacks the decoder for a method §3.2 permits.
        // §5.4.2 note 6 forbids the missing-part row here — reporting a hash-bound part
        // missing because of the READER's capability envelope would, on a frozen document,
        // become an INTEGRITY-ERROR accusing an intact archive of tampering. The container
        // layer reports the entry integrity-indeterminate, which is the honest statement.
        continue;
      }
      if (part.status === 'defect') {
        // A coded defect is the any-part sweep's state-invariant REJECT; an uncoded parse
        // failure leaves a hash-bound part unusable, the same practical outcome as absence.
        if (part.code === null) add(CODE.PART_MISSING_BOUND);
        continue;
      }
      if (isValidContentHash(entry.hash)) {
        try {
          if (hashBytes(algorithmOf(entry.hash), part.bytes) !== entry.hash) add(CODE.PRESENTATION_HASH_MISMATCH);
        } catch (err) {
          if (!(err instanceof CanonicalizationError)) throw err;
        }
      }
      if (contentIds !== null) {
        for (const f of resolvePresentationReferences(part.value, contentIds, entry.path)) add(f.code);
      }
    }
  }

  // An UNDECLARED presentation or precise-layout file (04 §12): it carries no bound hash, so
  // no manifest-covering signature attests it, and §5.4.2's preamble expressly refuses to
  // treat it as a benign out-of-hash layer — "an injected layout is an attempt to alter
  // signed content". The normative requirement it backs is that a renderer MUST NOT present
  // such a file as the document's appearance.
  //
  // Membership is decided by the file's own DISCRIMINATOR, not merely by its location. A
  // location-only sweep would collide with §5.4.2's "Unrecognized file or directory in the
  // archive → IGNORE" row and report a WARNING for any unrelated byte someone parked under
  // `presentation/`. What 04 §12 actually warns about is a file a renderer could MISTAKE for
  // authoritative appearance, and 04 §13.3 names exactly what makes it one: a precise layout
  // carries `presentationType`, a reactive presentation carries a `type` of
  // `paginated`, `continuous`, or `responsive`. Anything else under the directory stays IGNORE.
  for (const entry of archive.entries) {
    if (!entry.name.startsWith(PRESENTATION_DIRECTORY) || entry.name.endsWith('/')) continue;
    if (declaredPresentation.has(entry.name)) continue;
    const part = load(entry.name);
    if (part.status !== 'ok' || !isPlainObject(part.value)) continue; // not a readable layout
    const discriminator = part.value.presentationType ?? part.value.type;
    if (typeof discriminator === 'string' && PRESENTATION_TYPES.has(discriminator)) add(CODE.PRESENTATION_UNDECLARED);
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
