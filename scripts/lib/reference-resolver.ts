/**
 * Reference resolution for the document layer (B1b-3b-1) — the §5.4.2 dangling-reference
 * rows, plus the shared-namespace uniqueness rule of Anchors & References §7.2.
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
  assertBoundedDepth,
  MAX_CANONICALIZATION_DEPTH,
} from './canonicalize.js';

/** Defect codes this resolver assigns (registered in conformance/errors.json). */
export const RESOLVER_CODE = {
  ID_COLLISION: 'CDX-E-ID-COLLISION',
  ANCHOR_DANGLING: 'CDX-E-ANCHOR-DANGLING',
  BLOCK_REFERENCE_DANGLING: 'CDX-E-BLOCK-REFERENCE-DANGLING',
  CROSS_REFERENCE_DANGLING: 'CDX-E-CROSS-REFERENCE-DANGLING',
  ANNOTATION_ANCHOR_DANGLING: 'CDX-E-ANNOTATION-ANCHOR-DANGLING',
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
 * Throws `CanonicalizationError` if the tree is nested deeper than the canonicalizer
 * accepts — the walk is recursive, so the bound is checked iteratively up front rather
 * than risking a native stack overflow (Container Format §5.3).
 */
export function resolveContentReferences(content: unknown): { findings: ResolverFinding[]; ids: ReadonlySet<string> } {
  assertBoundedDepth(content, MAX_CANONICALIZATION_DEPTH);

  const findings: ResolverFinding[] = [];
  const { ids, duplicates } = collectDefinedIds(content, { rawInput: true });

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
    { rawInput: true },
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
