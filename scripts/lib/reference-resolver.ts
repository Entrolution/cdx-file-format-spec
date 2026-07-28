/**
 * Reference resolution for the document layer (B1b-3b-1, extended by B1b-3b-2) — the §5.4.2
 * dangling-reference rows, plus the shared-namespace uniqueness rule of Anchors &
 * References §7.2.
 *
 * Every checker is a PURE function over parsed JSON that returns `ResolverFinding`s; none
 * reads the filesystem or holds module-level state, so both a gate and the conformance
 * reference adapter can import it — the same discipline as structural-constraints.ts.
 *
 * WHAT RESOLVES AGAINST WHAT. The document carries ONE uniqueness-checked identifier
 * namespace (Anchors & References §4; Document Hashing §4.3.1 item 5): block ids, `anchor`
 * mark ids, equation-line ids and subfigure ids. `canonicalize.ts` `collectDefinedIds` is
 * the single definition of membership — this module never re-derives it, because a
 * namespace that drifted from the canonicalizer's would resolve references against a set
 * the document ID was never computed over.
 *
 * FOUR ROWS, THREE DISPOSITIONS. §5.4.2's preamble splits references by whether they are
 * part of the document's addressing layer or resolved at render time, and the frozen
 * column differs:
 *   - a CORE ANCHOR (a `link` mark `href` beginning `#`) is signed content's internal
 *     consistency → WARNING in draft/review, INTEGRITY-ERROR when frozen (B3);
 *   - an EXTENSION-BLOCK TARGET FIELD (`academic:proof.of`, `academic:theorem.uses[]`,
 *     `semantic:ref.target`, `presentation:reference.target`) is carried under the same
 *     row, but under a SEPARATE code — §5.4.2's preamble names only *marks* in its
 *     extension-cross-reference carve-out while 03a §11 groups these block fields with the
 *     cross-reference mechanisms, so which side they fall on is genuinely contested. Two
 *     codes let B3 settle the frozen column without re-pointing a published code
 *     (conformance/errors.json is append-only);
 *   - an EXTENSION CROSS-REFERENCE MARK (`academic:theorem-ref`/`equation-ref`/
 *     `algorithm-ref` `target`) resolves at render time to inject a label or number, so a
 *     dangling one degrades rendering only → WARNING in EVERY state;
 *   - an OUT-OF-HASH ANNOTATION ANCHOR (a collaboration comment/change anchor, a phantom
 *     cluster anchor, a core annotation anchor) points INTO content from bytes no
 *     signature covers → WARNING in every state.
 * B1b-3b-2 adds three more, each resolving against a namespace that is NOT the content-anchor
 * one, which is why they waited for the parts that carry those namespaces:
 *   - an ASSET REFERENCE (`image`/`svg` `src`, `signature` `image`, a `link` mark `href`)
 *     resolves against the ASSET MAP the category indexes build → WARNING in draft/review,
 *     INTEGRITY-ERROR when frozen (B3), because §5.4.2 defines the row as a canonicalization
 *     error, i.e. a failure of the very resolution the document ID depends on;
 *   - a PRESENTATION REFERENCE (`blockId`/`blockRefs`/`blockIds`) points INTO content from a
 *     part outside the document-hash boundary → WARNING in every state (04 §13.4);
 *   - a CITATION or GLOSSARY mark resolves against the bibliography / glossary namespaces
 *     carried by the projection-bound side files → WARNING in every state, the same row and
 *     reasoning as the academic cross-reference marks above.
 * A duplicate id is an error in every state (03a §7.2), which §5.4.2's preamble maps onto
 * §5.4's dispositions — the one INTEGRITY-ERROR this layer can assign without B2/B3 trust
 * material, since it is state-invariant.
 *
 * THE REFERENCE SET MIRRORS `rewriteIds`. `canonicalize.ts` `rewriteIds` enumerates
 * exactly which fields hold a Content Anchor URI; REFERENCE_FIELDS below is that same
 * enumeration, split by disposition. Keep the two in step: a field the canonicalizer
 * rewrites but this module ignores is a reference that can dangle unreported, and one this
 * module resolves but the canonicalizer leaves alone addresses a different namespace and
 * would be reported dangling wrongly.
 *
 * EXTENSION-BLOCK INTERIORS ARE NOT OPAQUE HERE, unlike content-classifier.ts, which
 * deliberately stops at a registered extension block's boundary because it cannot know
 * that block's schema. Reference resolution has no such limit: the canonicalizer already
 * descends into extension interiors to resolve and relabel their anchors, so this module
 * must too, or an id defined (or a reference dangling) inside `academic:theorem` would be
 * invisible to a check the document ID depends on.
 */

import {
  collectDefinedIds,
  walkContentNodes,
  isPlainObject,
  isPackagedAssetRef,
  normalizePath,
  assertBoundedDepth,
  MAX_CANONICALIZATION_DEPTH,
} from './canonicalize.js';
import { categoryOfAssetPath } from './asset-index.js';

/** Defect codes this resolver assigns (registered in conformance/errors.json). */
export const RESOLVER_CODE = {
  ID_COLLISION: 'CDX-E-ID-COLLISION',
  ANCHOR_DANGLING: 'CDX-E-ANCHOR-DANGLING',
  BLOCK_REFERENCE_DANGLING: 'CDX-E-BLOCK-REFERENCE-DANGLING',
  CROSS_REFERENCE_DANGLING: 'CDX-E-CROSS-REFERENCE-DANGLING',
  ANNOTATION_ANCHOR_DANGLING: 'CDX-E-ANNOTATION-ANCHOR-DANGLING',
  ASSET_REFERENCE_DANGLING: 'CDX-E-ASSET-REFERENCE-DANGLING',
  PRESENTATION_REFERENCE_DANGLING: 'CDX-E-PRESENTATION-REFERENCE-DANGLING',
  CITATION_REFERENCE_DANGLING: 'CDX-E-CITATION-REFERENCE-DANGLING',
  GLOSSARY_REFERENCE_DANGLING: 'CDX-E-GLOSSARY-REFERENCE-DANGLING',
} as const;

export interface ResolverFinding {
  code: string;
  /** JSON-ish path to the offending node, for diagnostics only. */
  where: string;
  detail: string;
}

/**
 * The id component of a Content Anchor URI (`#id[/offset[-end]]`), or null when the value
 * is not an internal reference at all. Mirrors `rewriteContentAnchor`: a value that does
 * not begin `#` (an external URL, a cross-document reference) addresses nothing in this
 * document and is left alone.
 */
function anchorTargetId(value: string): string | null {
  if (!value.startsWith('#')) return null;
  const slash = value.indexOf('/');
  return slash === -1 ? value.slice(1) : value.slice(1, slash);
}

/** One reference-bearing field: which node carries it, and which code a dangle earns. */
interface ReferenceField {
  /** Block/mark `type` this field belongs to. */
  type: string;
  field: string;
  /** True when the field holds an ARRAY of Content Anchor URIs rather than one. */
  many?: boolean;
  code: string;
}

/**
 * The Content Anchor URI fields of `canonicalize.ts` `rewriteIds`, split by §5.4.2 row.
 * `anchor` mark `id` is absent by design: it DEFINES an id, it does not reference one.
 */
const MARK_REFERENCE_FIELDS: ReferenceField[] = [
  { type: 'link', field: 'href', code: RESOLVER_CODE.ANCHOR_DANGLING },
  { type: 'academic:theorem-ref', field: 'target', code: RESOLVER_CODE.CROSS_REFERENCE_DANGLING },
  { type: 'academic:equation-ref', field: 'target', code: RESOLVER_CODE.CROSS_REFERENCE_DANGLING },
  { type: 'academic:algorithm-ref', field: 'target', code: RESOLVER_CODE.CROSS_REFERENCE_DANGLING },
];

const BLOCK_REFERENCE_FIELDS: ReferenceField[] = [
  { type: 'academic:proof', field: 'of', code: RESOLVER_CODE.BLOCK_REFERENCE_DANGLING },
  { type: 'academic:theorem', field: 'uses', many: true, code: RESOLVER_CODE.BLOCK_REFERENCE_DANGLING },
  { type: 'semantic:ref', field: 'target', code: RESOLVER_CODE.BLOCK_REFERENCE_DANGLING },
  { type: 'presentation:reference', field: 'target', code: RESOLVER_CODE.BLOCK_REFERENCE_DANGLING },
];

/**
 * Resolve every Content Anchor reference in the parsed CONTENT part against the ids that
 * part defines, and report duplicate definitions.
 *
 * `content` is the RAW stored value, not canonicalized output, so the walk applies the
 * canonicalizer's own erasures (`rawInput`): a derived field `canon` deletes — notably the
 * opaque `crdt` payload — is not content, and marks byte-identical within one text node
 * collapse exactly as §4.3.1 item 3 collapses them. Without that, this module would report
 * collisions and dangling references on documents `computeDocumentId` accepts.
 *
 * `assetMap` is the document's resolved asset map, and it is not optional in spirit: whether
 * two adjacent text nodes MERGE depends on whether their `link` hrefs resolve to the same
 * asset hash, so without it every packaged-asset href keys alike and adjacent nodes
 * over-merge — hiding a real id collision. Omit it only where the map genuinely cannot be
 * built (an absent or malformed index), which is the conservative direction: a missed
 * collision rather than a false INTEGRITY-ERROR.
 *
 * Throws `CanonicalizationError` if the tree is nested deeper than the canonicalizer
 * accepts — the walk is recursive, so the bound is checked iteratively up front rather
 * than risking a native stack overflow (Container Format §5.3).
 */
export function resolveContentReferences(
  content: unknown,
  assetMap?: ReadonlyMap<string, string>,
): { findings: ResolverFinding[]; ids: ReadonlySet<string> } {
  assertBoundedDepth(content, MAX_CANONICALIZATION_DEPTH);

  const findings: ResolverFinding[] = [];
  const { ids, duplicates } = collectDefinedIds(content, { rawInput: true, assetMap });

  // Anchors & References §7.2: an id colliding in the shared namespace is an Error in
  // every state. Reported per distinct colliding id, not per repeat occurrence.
  for (const id of new Set(duplicates)) {
    findings.push({
      code: RESOLVER_CODE.ID_COLLISION,
      where: 'content',
      detail: `id "${id}" is defined more than once in the shared identifier namespace`,
    });
  }

  const defined = new Set(ids);
  const report = (field: ReferenceField, value: unknown, where: string): void => {
    if (typeof value !== 'string') return;
    const target = anchorTargetId(value);
    if (target === null || defined.has(target)) return;
    findings.push({
      code: field.code,
      where,
      detail: `${field.type} ${field.field} "${value}" resolves to no block or anchor id in this document`,
    });
  };

  walkContentNodes(
    content,
    (node, ctx) => {
      if (typeof node.type !== 'string') return;
      for (const field of ctx.inMarks ? MARK_REFERENCE_FIELDS : BLOCK_REFERENCE_FIELDS) {
        if (node.type !== field.type) continue;
        const value = node[field.field];
        if (field.many) {
          if (!Array.isArray(value)) continue;
          value.forEach((v, i) => report(field, v, `${field.type}.${field.field}[${i}]`));
        } else {
          report(field, value, `${field.type}.${field.field}`);
        }
      }
    },
    { rawInput: true, assetMap },
  );

  // The namespace is returned alongside the findings because the caller needs it for the
  // out-of-hash anchor pass; recollecting it would re-walk the tree and re-serialize every
  // mark a third time.
  return { findings, ids: defined };
}

/**
 * The top-level arrays of the out-of-hash annotation parts, and the anchor-bearing fields
 * each element declares. Enumerated from the schemas rather than swept generically, and
 * that restraint is the point: a generic "every `blockId`, every `#…` string" sweep
 * false-positives by construction, and §5.4.3 forbids escalating an out-of-hash layer's
 * internal-graph defect at all.
 *   - phantoms.schema.json `phantomContent.blocks` is a FULL core content tree, so a
 *     phantom's own `link`/`anchor` marks address the phantom's interior, not the document;
 *   - collaboration.schema.json `change.before`/`.after` are verbatim block snapshots
 *     (`additionalProperties: true`) — a delete record's snapshot naming content that no
 *     longer exists is its whole purpose;
 *   - phantoms `connection.target` is a PHANTOM id and `academic:algorithm-ref.line` is a
 *     line label, neither of which lives in the content namespace.
 * `change.position.{before,after}` are BARE block ids ("Block ID to insert after"), not
 * Content Anchor URIs, so they resolve directly. A `reply` carries no anchor of its own.
 */
interface AnchorSource {
  /** Top-level array in the part. */
  array: string;
  /** Path from an element to a ContentAnchor object or Content Anchor URI. */
  anchorField?: string;
  /** Path from an element to an object of BARE block-id fields. */
  blockIdObject?: { field: string; keys: string[] };
}

const ANNOTATION_ANCHOR_SOURCES: AnchorSource[] = [
  { array: 'annotations', anchorField: 'anchor' }, // security/annotations.json
  { array: 'comments', anchorField: 'anchor' }, // collaboration/comments.json
  { array: 'changes', anchorField: 'anchor', blockIdObject: { field: 'position', keys: ['before', 'after'] } },
  { array: 'clusters', anchorField: 'anchor' }, // phantoms/clusters.json
];

/**
 * Resolve the anchors an out-of-hash annotation layer points into content with, against
 * the content's identifier namespace (§5.4.2 "Dangling anchor originating in an
 * out-of-hash annotation layer" — WARNING in every state, since the layer's bytes are in
 * no signature scope so its failure cannot signal tampering).
 *
 * `ids` is the content's defined namespace, from `collectDefinedIds(content, {rawInput:
 * true})`; `where` names the part, for diagnostics.
 */
export function resolveAnnotationAnchors(part: unknown, ids: ReadonlySet<string>, where: string): ResolverFinding[] {
  const findings: ResolverFinding[] = [];
  if (!isPlainObject(part)) return findings;

  const report = (target: string | null, at: string): void => {
    if (target === null || ids.has(target)) return;
    findings.push({
      code: RESOLVER_CODE.ANNOTATION_ANCHOR_DANGLING,
      where: at,
      detail: `anchor target "${target}" resolves to no block or anchor id in the content`,
    });
  };

  for (const source of ANNOTATION_ANCHOR_SOURCES) {
    const elements = part[source.array];
    if (!Array.isArray(elements)) continue;

    elements.forEach((element, i) => {
      if (!isPlainObject(element)) return;
      const at = `${where}.${source.array}[${i}]`;

      if (source.anchorField !== undefined) {
        const anchor = element[source.anchorField];
        // Every position enumerated above is schema-typed as a ContentAnchor OBJECT
        // (`required: [blockId]`, `additionalProperties: false`), so `blockId` is the
        // declared form. The string branch below accepts the equivalent `#id[/offset]`
        // URI too — deliberately permissive, since a layer spelling its anchor that way
        // still points into content and a dangling one still degrades rendering.
        if (isPlainObject(anchor) && typeof anchor.blockId === 'string') {
          report(anchor.blockId, `${at}.${source.anchorField}.blockId`);
        } else if (typeof anchor === 'string') {
          report(anchorTargetId(anchor), `${at}.${source.anchorField}`);
        }
      }

      if (source.blockIdObject !== undefined) {
        const holder = element[source.blockIdObject.field];
        if (!isPlainObject(holder)) return;
        for (const key of source.blockIdObject.keys) {
          const value = holder[key];
          if (typeof value === 'string') report(value, `${at}.${source.blockIdObject.field}.${key}`);
        }
      }
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Asset references (§5.4.2 "Dangling asset reference"; 05 §3.2; 06 §4.3.1 item 2)
// ---------------------------------------------------------------------------

/**
 * Resolve every packaged-asset reference in the content tree against the document's asset
 * map, reporting the ones that resolve to nothing.
 *
 * This row is defined by the canonicalizer's behaviour — §5.4.2 calls it "a canonicalization
 * error once the ID is computed" — so the pass mirrors `canon` node for node rather than
 * sweeping for `assets/`-looking strings:
 *   - `image` / `svg` `src` and `signature` `image`, each honouring the `external` flag
 *     those nodes carry out of schema (05 §9.2);
 *   - a `link` mark's `href`, taken from the TEXT node that owns the marks array, because
 *     `canon` resolves link hrefs only inside `normalizeMarks`, which it calls under
 *     `case 'text'` alone. A `link` sitting in some other node's `marks` is not resolved by
 *     the canonicalizer and so cannot dangle. `external` is deliberately NOT honoured here:
 *     `normalizeMarks` passes `false` unconditionally, so the flag exempts a link mark from
 *     nothing.
 * Anything below a text node's `marks` is skipped for the block fields (`ctx.inTextMarks`):
 * `canon` does not recurse there, so an `image` node parked inside a marks array has its
 * `src` left verbatim.
 *
 * `unresolvableCategories` are the categories whose index could not be loaded. A reference
 * into one of those is INDETERMINATE, not dangling — reporting it would turn one missing
 * index into a finding per reference, and would claim a defect the document may not have.
 */
export function resolveAssetReferences(
  content: unknown,
  assetMap: ReadonlyMap<string, string>,
  unresolvableCategories: ReadonlySet<string>,
): ResolverFinding[] {
  const findings: ResolverFinding[] = [];

  const report = (value: unknown, external: boolean, where: string): void => {
    if (external) return; // explicitly external (05 §9.2), so it addresses no packaged asset
    if (!isPackagedAssetRef(value)) return; // a `#` anchor, a URL, or a non-`assets/` path
    const normalized = normalizePath(value as string);
    if (assetMap.has(normalized)) return;
    const category = categoryOfAssetPath(normalized);
    if (category !== null && unresolvableCategories.has(category)) return; // indeterminate
    findings.push({
      code: RESOLVER_CODE.ASSET_REFERENCE_DANGLING,
      where,
      detail: `asset reference "${String(value)}" resolves to no registered asset`,
    });
  };

  walkContentNodes(
    content,
    (node, ctx) => {
      if (ctx.inTextMarks) return; // canon leaves this subtree alone
      switch (node.type) {
        case 'image':
        case 'svg':
          report(node.src, node.external === true, `${node.type}.src`);
          break;
        case 'signature':
          report(node.image, node.external === true, 'signature.image');
          break;
        case 'text': {
          if (!Array.isArray(node.marks)) break;
          // Deduplicated by href: `normalizeMarks` collapses byte-identical marks within one
          // text node (§4.3.1 item 3), so two identical dangling link marks are ONE mark to
          // the canonicalizer and must not read as two defects.
          const seen = new Set<string>();
          node.marks.forEach((m, i) => {
            if (!isPlainObject(m) || m.type !== 'link' || typeof m.href !== 'string') return;
            if (seen.has(m.href)) return;
            seen.add(m.href);
            report(m.href, false, `text.marks[${i}].href`);
          });
          break;
        }
      }
    },
    { rawInput: true, assetMap },
  );

  return findings;
}

// ---------------------------------------------------------------------------
// Presentation references (§5.4.2 "Dangling presentation reference"; 04 §13.4)
// ---------------------------------------------------------------------------

/**
 * Resolve a presentation part's references into content, against the content's identifier
 * namespace. WARNING in EVERY state: 04 §13.4 — "Because presentation is outside the
 * document-hash boundary, a dangling presentation reference degrades rendering but never
 * impugns document integrity, in any state." The reader omits the rule and renders the
 * affected content with default styling.
 *
 * One traversal serves both file shapes, since a precise layout uses the same
 * `pages[].elements[].blockId` positioning as a reactive `paginated` one:
 *   - `pages[].elements[]` — a `pageElement`'s `blockId`, and a `flowElement`'s `blockIds[]`;
 *   - `sections[].blockRefs[]`.
 * 04 §13.4's prose names only `blockId` and `blockRefs`. `blockIds` on a flow element is
 * included anyway: it references content blocks in exactly the same way (04 §6.4), the
 * disposition is WARNING in every state either way, and omitting it would leave a dangling
 * reference silently unreported. The prose gap is raised as a specification question.
 *
 * These are BARE block ids (`pattern: ^[A-Za-z0-9._-]+$`), not Content Anchor URIs, so they
 * resolve directly against `ids` with no `#` stripping.
 */
export function resolvePresentationReferences(part: unknown, ids: ReadonlySet<string>, where: string): ResolverFinding[] {
  const findings: ResolverFinding[] = [];
  if (!isPlainObject(part)) return findings;

  const report = (value: unknown, at: string): void => {
    if (typeof value !== 'string' || ids.has(value)) return;
    findings.push({
      code: RESOLVER_CODE.PRESENTATION_REFERENCE_DANGLING,
      where: at,
      detail: `presentation reference "${value}" targets no content block`,
    });
  };

  const pages = part.pages;
  if (Array.isArray(pages)) {
    pages.forEach((page, p) => {
      if (!isPlainObject(page) || !Array.isArray(page.elements)) return;
      page.elements.forEach((element, e) => {
        if (!isPlainObject(element)) return;
        const at = `${where}.pages[${p}].elements[${e}]`;
        report(element.blockId, `${at}.blockId`);
        if (Array.isArray(element.blockIds)) {
          element.blockIds.forEach((b, i) => report(b, `${at}.blockIds[${i}]`));
        }
      });
    });
  }

  const sections = part.sections;
  if (Array.isArray(sections)) {
    sections.forEach((section, s) => {
      if (!isPlainObject(section) || !Array.isArray(section.blockRefs)) return;
      section.blockRefs.forEach((b, i) => report(b, `${where}.sections[${s}].blockRefs[${i}]`));
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Extension cross-reference namespaces (§5.4.2 row "Dangling extension
// cross-reference", the citation and glossary marks)
// ---------------------------------------------------------------------------

/**
 * The identifier namespaces a `citation` or `glossary` mark addresses — SEPARATE from the
 * content-anchor namespace, which is exactly why §4.3.1 item 5 leaves both "as authored"
 * rather than relabelling them. A citation key is not a block id and must never be resolved
 * against one.
 *
 * `null` means the namespace is INDETERMINATE rather than empty: the document declares a
 * bibliography or glossary side file that could not be loaded, so its ids are unknown and no
 * mark can honestly be called dangling. An empty SET, by contrast, means the document
 * genuinely defines no such ids, and a mark referencing one does not resolve.
 */
export interface SemanticNamespaces {
  bibliography: ReadonlySet<string> | null;
  glossary: ReadonlySet<string> | null;
}

/**
 * Collect the bibliography namespace a `citation` mark's `refs` resolve against.
 *
 * PRECEDENCE, NOT UNION. Semantic Extension §4.4: a `citation`'s `refs` "resolve against the
 * document's authoritative bibliography source: the external `semantic/bibliography.json`
 * when the manifest declares `semantic.bibliography`; otherwise the inline `entries` of the
 * document's `semantic:bibliography` block. When an external bibliography is declared it is
 * the single authoritative source and inline `entries` are NOT consulted, so the two cannot
 * diverge." Unioning them would accept a `ref` naming an inline entry the authoritative file
 * omits — a dangling reference reported clean.
 *
 * The inline arm is the same namespace §4.3.1 item 5 names when it leaves "a
 * `semantic:bibliography` entry's CSL citation key (in `entries`; referenced by a `citation`
 * mark)" as authored rather than relabelling it.
 */
export function collectBibliographyIds(
  content: unknown,
  sideFile: unknown,
  externalDeclared: boolean,
  assetMap?: ReadonlyMap<string, string>,
): Set<string> {
  const ids = new Set<string>();
  const addEntries = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (isPlainObject(entry) && typeof entry.id === 'string') ids.add(entry.id);
    }
  };
  if (externalDeclared) {
    if (isPlainObject(sideFile)) addEntries(sideFile.entries);
    return ids;
  }
  walkContentNodes(
    content,
    (node) => {
      if (node.type === 'semantic:bibliography') addEntries(node.entries);
    },
    { rawInput: true, assetMap },
  );
  return ids;
}

/**
 * Collect the glossary namespace a `glossary` mark's `ref` — and a `semantic:term`'s `see[]`
 * — resolve against.
 *
 * PRECEDENCE, NOT UNION, and the fallback is IN-DOCUMENT. Semantic Extension §8.3 states the
 * two rules exactly: (1) when the manifest declares an external glossary, "that file is
 * authoritative … a `glossary` `ref` (or a `see`) resolves against the file's term `id`s";
 * (2) "Otherwise, the in-document `semantic:term` blocks are the source … a `glossary` `ref`
 * (or a `see`) resolves against their `id`s." Treating rule 2's namespace as empty would
 * report a dangling glossary reference on every document that defines its terms inline —
 * the common case for a document carrying no external glossary at all.
 *
 * A SPECIFICATION TENSION worth recording rather than papering over: §4.3.1 item 5 relabels a
 * `semantic:term` block's `id` to `b<n>` (it is a block id in the shared namespace) while
 * leaving a `glossary` `ref` as authored, so after canonicalization the two can never match.
 * Resolution here runs over RAW stored content, where they do match, which is the only
 * reading under which §8.3 rule 2 means anything. Raised as a specification question.
 */
export function collectGlossaryIds(
  content: unknown,
  sideFile: unknown,
  externalDeclared: boolean,
  assetMap?: ReadonlyMap<string, string>,
): Set<string> {
  const ids = new Set<string>();
  if (externalDeclared) {
    if (!isPlainObject(sideFile) || !Array.isArray(sideFile.terms)) return ids;
    for (const term of sideFile.terms) {
      if (isPlainObject(term) && typeof term.id === 'string') ids.add(term.id);
    }
    return ids;
  }
  walkContentNodes(
    content,
    (node) => {
      if (node.type === 'semantic:term' && typeof node.id === 'string') ids.add(node.id);
    },
    { rawInput: true, assetMap },
  );
  return ids;
}

/**
 * Resolve the `citation` and `glossary` marks §5.4.2's extension-cross-reference row names
 * alongside the `academic:*-ref` marks already covered by `CDX-E-CROSS-REFERENCE-DANGLING`.
 * WARNING in every state, for the reason the §5.4.2 preamble gives: such a reference is
 * resolved at render time to inject a label or definition, so a dangling one degrades
 * rendering while the signed bytes stay intact and hash-verified.
 *
 * Two codes rather than one, and neither reuses `CDX-E-CROSS-REFERENCE-DANGLING`: that code's
 * published summary enumerates the three academic marks specifically, and
 * conformance/errors.json is append-only, so its meaning cannot be widened after the fact.
 *
 * `semantic:term.see[]` ("Related term IDs") is resolved with the glossary marks — §4.3.1
 * item 5 lists it among the identifiers addressing other namespaces, so it is a
 * cross-reference of exactly this kind.
 *
 * `assetMap` is threaded for the same reason `resolveContentReferences` needs it: these
 * marks live in text nodes' `marks` arrays, and whether two adjacent text nodes MERGE
 * depends on whether their `link` hrefs resolve to the same asset. Without the map the walk
 * over-merges, and a `citation` on the absorbed node is never resolved — a missed finding on
 * a document where the canonicalizer keeps the two nodes apart.
 */
export function resolveSemanticReferences(
  content: unknown,
  namespaces: SemanticNamespaces,
  assetMap?: ReadonlyMap<string, string>,
): ResolverFinding[] {
  const findings: ResolverFinding[] = [];

  const report = (value: unknown, ids: ReadonlySet<string> | null, code: string, kind: string, where: string): void => {
    if (ids === null) return; // the namespace could not be established; not a dangling ref
    if (typeof value !== 'string' || ids.has(value)) return;
    findings.push({ code, where, detail: `${kind} reference "${value}" resolves to no ${kind} entry` });
  };

  walkContentNodes(
    content,
    (node, ctx) => {
      if (ctx.inMarks && node.type === 'citation' && Array.isArray(node.refs)) {
        node.refs.forEach((r, i) =>
          report(r, namespaces.bibliography, RESOLVER_CODE.CITATION_REFERENCE_DANGLING, 'citation', `citation.refs[${i}]`),
        );
      }
      if (ctx.inMarks && node.type === 'glossary') {
        report(node.ref, namespaces.glossary, RESOLVER_CODE.GLOSSARY_REFERENCE_DANGLING, 'glossary', 'glossary.ref');
      }
      if (!ctx.inMarks && node.type === 'semantic:term' && Array.isArray(node.see)) {
        node.see.forEach((s, i) =>
          report(s, namespaces.glossary, RESOLVER_CODE.GLOSSARY_REFERENCE_DANGLING, 'glossary', `semantic:term.see[${i}]`),
        );
      }
    },
    { rawInput: true, assetMap },
  );

  return findings;
}
