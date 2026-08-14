/**
 * Content block/mark TYPE classifier for the document/part layer (B1b-2).
 *
 * Given a parsed, strict-JSON content value (`{version, blocks:[...]}`), it walks
 * the content tree and classifies every block type and every text-node mark type
 * against the reader's recognized vocabulary, applying the three State-Machine
 * §5.4.2 rows that key off block/mark type recognition:
 *
 *   - Unknown NAMESPACED block/mark type (a well-formed `ns:name`, e.g.
 *     `forms:input`, `myorg:flag`) — IGNORE, render a fallback (block) or the
 *     unmarked text (mark). Open-world forward compatibility (Content Blocks §5,
 *     §5.1). State-invariant.
 *   - Unknown BARE, non-namespaced block/mark type (e.g. a misspelled core
 *     `itlaic`, or any unrecognized type that is not a well-formed namespaced
 *     identifier) — REJECT. §5.1 line 1017 frames the bare-vs-namespaced split
 *     explicitly; a misspelled core type must not be silently accepted as an
 *     unknown mark. State-invariant.
 *   - Structurally malformed block/mark of a KNOWN type — WARNING in draft/review
 *     (§5.4.2). The FROZEN/PUBLISHED escalation to INTEGRITY-ERROR is gated on a
 *     valid signature per §5.3 and lands in B3; this classifier delivers only the
 *     state-invariant unknown-type rows and the draft/review malformation column.
 *
 * WHAT "KNOWN" MEANS. A type is known iff it is in the reader's recognized set —
 * the core block/mark vocabulary PLUS the registered namespaced identifiers
 * (`academic:theorem`, `legal:cite`, …). A registered namespaced type is validated
 * strictly, never treated as an unknown namespaced extension (Content Blocks §5.1
 * line 1019). The vocabulary is derived from content.schema.json (the single source
 * of the recognized sets) and passed in as a PARAMETER — this module holds no
 * schema-derived module state, mirroring structural-constraints.ts.
 *
 * WHAT "NAMESPACED" MEANS. A type is namespaced iff it matches the schema's
 * extension-type pattern `^[A-Za-z0-9_-]+:[A-Za-z0-9._:-]+$` — the exact form
 * content.schema.json's open escape admits for an unknown type. Classification is
 * therefore FAIL-CLOSED and schema-aligned: only a well-formed namespaced
 * identifier earns the lenient IGNORE; every other unrecognized type (a bare word,
 * a colon-malformed string like `:x` or `x:`, or a missing/non-string type) is a
 * bare unknown and REJECTs. This matches what a reader validating against
 * content.schema.json concludes: such a value satisfies neither a known-type branch
 * nor the open-escape pattern.
 *
 * OPAQUE INTERIORS. The walk interprets ONLY a CORE block's interior. An unknown
 * namespaced block is IGNORE — "render a fallback" (§5.4.2) — so a non-supporting
 * reader does not parse its children as CDX; classifying (and maybe rejecting) that
 * interior would contradict the IGNORE disposition and break interop with an extension
 * that reuses `children` for its own non-CDX structure. An unknown bare block already
 * REJECTs, so its interior is moot. A REGISTERED extension block (a namespaced type in
 * the known set, e.g. academic:theorem) is recognized — not an unknown-type defect —
 * but its interior is defined by its extension schema, not core content.schema.json:
 * the core classifier cannot know which of an extension's fields hold blocks/marks
 * (academic:exercise-set nests content in `exercises[]`, not `children`), and
 * descending generically would misread a typed non-block (a codeBlock `tokens[]`
 * highlightToken has a `type`). So the walk descends past NONE of these — only a core
 * block's interior is interpreted; extension interiors are left to full
 * extension-content validation (which loads the extension schemas), deferred to B1b-3.
 *
 * SCOPE (B1b-2). Type classification of every block and mark, plus:
 *   - "malformed known BLOCK" = a CORE block violating the structural constraints
 *     JSON Schema cannot express — upward containment and figure/definitionItem
 *     cardinality (structural-constraints.ts `checkBlock`, reused verbatim) — or
 *     carrying a node-bearing field of the wrong shape (`children`/`subfigures`/`marks`
 *     present but not an array; `caption` present but neither array nor string; a
 *     `subfigures` element that is not an object), a shape defect that also hides its
 *     contents from the walk;
 *   - "malformed known MARK" = a known mark used in a structurally invalid form:
 *     the three CORE structured marks (`link`, `anchor`, `math`) missing a required
 *     field, a core string mark (bold/italic/…) used as an object, or a structured
 *     mark used as a bare string.
 * The interiors of registered EXTENSION BLOCKS (academic:*, forms:*, semantic:*
 * blocks, legal:* blocks, presentation:reference), and the internal field validation
 * of the registered EXTENSION structured MARKS (`citation`, `footnote`, `entity`,
 * `glossary`, `academic:*-ref`, `presentation:*`, `legal:cite`) — whose structures
 * live in their extension schemas — are deferred; those types are in the known set, so
 * they are neither rejected nor ignored here. Other content structural rules structural-constraints.ts
 * already implements for the content part — notably anchor-range (`checkAnchors`,
 * `start < end`) — are NOT applied here; a dangling/invalid content anchor belongs to
 * the reference-resolver row, which owns anchor POSITION validity from B1b-3c-1a.
 *
 * SCOPE (B1b-3c-1a). `checkContentRoot` adds the content part's ROOT ENVELOPE (03 §2.2):
 * an object carrying a string `version` and an array `blocks`, REJECT in every state. It
 * is a sibling of `classifyContent`, not part of it — the envelope is checked even when
 * the type walk cannot run, which is the whole point, since a non-array `blocks` is
 * exactly what silences that walk. NFC normalization of content strings now lives in
 * canonicalize.ts as a stored-byte pre-scan, not here. Still out of this module: full
 * per-type content-schema validation (a `heading` with no `level`), and the interiors of
 * registered extension blocks and marks (B1b-3c-1b). The disposition VALUES for the codes
 * below are authoritative in conformance/errors.json.
 */

import { loadSchema } from './ajv-utils.js';
import { MAX_CANONICALIZATION_DEPTH } from './canonicalize.js';
import {
  type Finding,
  isRecord,
  findBlockTypeEnum,
  checkBlock,
  ROOT_DOCUMENT,
} from './structural-constraints.js';

/** The block/mark classifier defect codes (registered in conformance/errors.json). */
export const CLASSIFIER_CODE = {
  BLOCK_TYPE_UNKNOWN_BARE: 'CDX-E-BLOCK-TYPE-UNKNOWN-BARE',
  BLOCK_TYPE_UNKNOWN_NAMESPACED: 'CDX-E-BLOCK-TYPE-UNKNOWN-NAMESPACED',
  BLOCK_MALFORMED: 'CDX-E-BLOCK-MALFORMED',
  MARK_TYPE_UNKNOWN_BARE: 'CDX-E-MARK-TYPE-UNKNOWN-BARE',
  MARK_TYPE_UNKNOWN_NAMESPACED: 'CDX-E-MARK-TYPE-UNKNOWN-NAMESPACED',
  MARK_MALFORMED: 'CDX-E-MARK-MALFORMED',
  CONTENT_ROOT_MALFORMED: 'CDX-E-CONTENT-ROOT-MALFORMED',
} as const;

/**
 * The schema's extension-type pattern (content.schema.json `$defs/block` open
 * escape and `$defs/textNode` marks open escape). A type is "namespaced" iff it
 * matches — a non-empty prefix, a colon, and a non-empty suffix.
 */
export const NAMESPACED_TYPE = /^[A-Za-z0-9_-]+:[A-Za-z0-9._:-]+$/;

/** The reader's recognized content vocabulary, derived from content.schema.json. */
export interface ContentVocabulary {
  /** Every recognized block type (core + registered namespaced). */
  blockTypes: ReadonlySet<string>;
  /** Every recognized mark identifier (the 7 core string marks + structured marks). */
  knownMarks: ReadonlySet<string>;
  /** The core marks that are valid as a bare string (bold, italic, …). */
  stringMarks: ReadonlySet<string>;
  /**
   * Block types whose `children` are TEXT NODES — the text-bearing blocks of Anchors and
   * References §3, the only blocks a character-offset anchor may target. Derived from the
   * schema rather than listed, like its three siblings, because the distinction is not
   * visible in a node: an empty `paragraph` and an empty `blockquote` are both
   * `{type, id, children: []}` and differ only in `type`.
   */
  textBearingTypes: ReadonlySet<string>;
}

/** One classification finding: the defect code, a JSON-path-ish locator, and detail. */
export interface ClassifierFinding {
  code: string;
  where: string;
  detail: string;
}

/**
 * Locate the recognized mark enum (`$defs/knownMarkTypes.enum`) in a content
 * schema — the 7 core string marks plus the 13 structured mark identifiers. Pure.
 */
export function findMarkTypeEnum(schema: unknown): string[] | null {
  const km = (schema as { $defs?: { knownMarkTypes?: { enum?: unknown } } })?.$defs?.knownMarkTypes?.enum;
  return Array.isArray(km) ? km.filter((v): v is string => typeof v === 'string') : null;
}

// Collect every string-valued `enum` array anywhere in a schema node.
function collectStringEnums(node: unknown, out: string[][]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStringEnums(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.enum) && obj.enum.every((v) => typeof v === 'string')) {
    out.push(obj.enum as string[]);
  }
  for (const v of Object.values(obj)) collectStringEnums(v, out);
}

/**
 * Every `$ref` an `items` schema resolves through — the direct one, and the members of an
 * `allOf` that NARROWS it.
 *
 * The `allOf` arm is not defensive generality. `codeBlock` states its children as
 * `items: { allOf: [{ $ref: .../textNode }, { … marks forbidden … }] }`, because §4's
 * "exactly one marks-free text node" is a text node PLUS a restriction, and that is how JSON
 * Schema spells a restriction. Matching only a direct `$ref` therefore dropped `codeBlock`
 * from the text-bearing set although Anchors & References §3 names it outright — so an anchor
 * into a code block was reported "not a text-bearing block" on conformant content, and an
 * out-of-bounds one was downgraded from the WARNING §7.2 tabulates to the null-disposition
 * structural code. A block type that constrains its text children is still text-bearing.
 */
function itemsRefs(items: unknown): string[] {
  if (typeof items !== 'object' || items === null) return [];
  const direct = (items as { $ref?: unknown }).$ref;
  const refs = typeof direct === 'string' ? [direct] : [];
  const branches = (items as { allOf?: unknown[] }).allOf;
  if (Array.isArray(branches)) {
    for (const b of branches) {
      const r = (b as { $ref?: unknown })?.$ref;
      if (typeof r === 'string') refs.push(r);
    }
  }
  return refs;
}

/**
 * Block types whose `children.items` resolve to a text node — §3's text-bearing set.
 * Structural, like the three sibling derivations, so it tracks the schema instead of restating
 * it — though note the mechanism is a scan of every `$defs` entry carrying an `allOf`, not a walk
 * of the block dispatch. That is wider than it needs to be and happens to be harmless: all five
 * types reach `textNode` through `$defs.block`'s branches. It also means the scan sees only
 * THIS schema's `$defs`, so a block type an EXTENSION schema defines with text-node children is
 * invisible to it (`semantic:ref` is one; see OQ-012).
 *
 * §3's enumeration ("`paragraph`, `heading`, `figcaption`, `definitionTerm`, and
 * `codeBlock`") is prose and reads "such as", so it is not itself the definition — the
 * definition is "a block whose `children` are text nodes", which is what this derives. The
 * two must nevertheless agree, and test-document-verdict.ts pins the derived set against
 * §3's list so a divergence fails loudly rather than silently narrowing what an anchor may
 * address.
 */
export function findTextBearingTypes(schema: unknown): string[] {
  const defs = (schema as { $defs?: Record<string, unknown> })?.$defs ?? {};
  const out: string[] = [];
  for (const def of Object.values(defs)) {
    const branches = (def as { allOf?: unknown[] })?.allOf;
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      const props = (branch as { properties?: Record<string, unknown> })?.properties;
      const items = (props?.children as { items?: unknown })?.items;
      const typeConst = (props?.type as { const?: unknown })?.const;
      if (typeof typeConst === 'string' && itemsRefs(items).some((r) => r.endsWith('/textNode'))) {
        out.push(typeConst);
      }
    }
  }
  return out;
}

/**
 * Locate the core STRING-mark enum in a content schema — the marks valid as a bare
 * string. Identified structurally as the string enum containing `bold` and
 * `italic` but NOT `link`, which uniquely distinguishes it from `knownMarkTypes`
 * (which also lists the structured marks) and from every other enum in the schema.
 * Pure.
 */
export function findStringMarkEnum(schema: unknown): string[] | null {
  const enums: string[][] = [];
  collectStringEnums(schema, enums);
  return enums.find((e) => e.includes('bold') && e.includes('italic') && !e.includes('link')) ?? null;
}

/**
 * Derive the recognized content vocabulary from content.schema.json. Reads the
 * schema (so a caller that already parameterizes its checkers keeps this at its
 * edge, like the reference adapter's READER_SUPPORT). Throws if the schema does not
 * yield all three sets, so schema drift fails loudly rather than silently
 * narrowing recognition to nothing (which would reject every block).
 */
export function deriveContentVocabulary(): ContentVocabulary {
  const schema = loadSchema('content.schema.json') as { $defs?: { block?: unknown } };
  const blockList = findBlockTypeEnum(schema.$defs?.block);
  const markList = findMarkTypeEnum(schema);
  const stringList = findStringMarkEnum(schema);
  const textBearingList = findTextBearingTypes(schema);
  // Throw on an empty text-bearing set for the same reason as its siblings, and the guard
  // earns more here: an empty blockTypes REJECTs every block, which is unmissable, whereas
  // an empty textBearingTypes makes every anchor position INVALID — a null-disposition
  // code that moves no document verdict at all. The quiet failure needs the loud guard.
  // It is not sufficient, though: a PARTIAL schema refactor yields a non-empty but wrong
  // set, which no throw can catch, so test-document-verdict.ts pins the set itself.
  if (!blockList?.length || !markList?.length || !stringList?.length || !textBearingList.length) {
    throw new Error('content-classifier: could not derive the block/mark vocabulary from content.schema.json');
  }
  return {
    blockTypes: new Set(blockList),
    knownMarks: new Set(markList),
    stringMarks: new Set(stringList),
    textBearingTypes: new Set(textBearingList),
  };
}

/**
 * True iff a mark of a KNOWN type is structurally malformed for that type. Covers
 * the core vocabulary content.schema.json defines directly; the registered
 * extension structured marks are not field-validated here (see the module scope).
 */
function isMalformedKnownMark(type: string, mark: Record<string, unknown>, stringMarks: ReadonlySet<string>): boolean {
  switch (type) {
    case 'link':
      return typeof mark.href !== 'string'; // linkMark requires href
    case 'anchor':
      return typeof mark.id !== 'string'; // anchorMark requires id
    case 'math':
      return typeof mark.format !== 'string' || typeof mark.source !== 'string'; // mathMark requires format + source
    default:
      // A core string mark (bold, italic, …) is valid only as a bare string, so an
      // object carrying its type is malformed. Other registered structured marks
      // (citation, footnote, legal:cite, …) are not field-validated in this slice.
      return stringMarks.has(type);
  }
}

/**
 * True iff a node carries a node-bearing field of the wrong schema shape:
 * `children`/`subfigures`/`marks` present but not an array, or `caption` present but
 * neither an array nor a string. Such a field is a structural malformation AND hides
 * its contents from the walk's descent, so it must be flagged rather than silently
 * skipped — otherwise the "unknown bare type REJECTs" guarantee would depend on
 * well-formed containers. Applied both to a block and to each `subfigure` object (the
 * one intermediate container in the core content model that holds node-bearing arrays).
 */
function hasMalformedContainer(node: Record<string, unknown>): boolean {
  return (
    ('children' in node && !Array.isArray(node.children)) ||
    ('subfigures' in node && !Array.isArray(node.subfigures)) ||
    ('marks' in node && !Array.isArray(node.marks)) ||
    ('caption' in node && !Array.isArray(node.caption) && typeof node.caption !== 'string')
  );
}

/**
 * Check the content part's ROOT ENVELOPE (03 §2.2, §7.1 item 5): the parsed value is an
 * object carrying `version` (string) and `blocks` (array). REJECT in every state
 * (§5.4.2's dedicated row), because a `blocks` that is not an array withdraws every
 * content-level row in that table at once — `classifyContent`'s trailing guard walks the
 * tree only when `blocks` IS an array, so one bracket turns a document the table rejects
 * into one that reports nothing, while the id stays computable and a signature over it
 * still verifies.
 *
 * The root is deliberately OPEN: content.schema.json declares no root
 * `additionalProperties: false`, and the published corpus relies on that (the
 * non-representable-number fixtures carry an extra root key), so an unrecognized member
 * is NOT a defect here.
 *
 * The `version` VALUE is not checked, only its type. content.schema.json constrains it to
 * `^\d+\.\d+$`, but a well-formed field carrying a bad value ("0.1.0", "9.9") is a
 * different defect class from a missing or mistyped one, and §5.4.2 assigns it no row —
 * its version rows govern the manifest's `cdx` version, not the content model's. Reporting
 * it would mean choosing a disposition the specification does not state.
 */
export function checkContentRoot(value: unknown): ClassifierFinding[] {
  if (!isRecord(value)) {
    return [{
      code: CLASSIFIER_CODE.CONTENT_ROOT_MALFORMED,
      where: 'content',
      detail: `content root is a ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}, not an object`,
    }];
  }
  const bad: string[] = [];
  if (!('version' in value)) bad.push('`version` is absent');
  else if (typeof value.version !== 'string') bad.push(`\`version\` is a ${value.version === null ? 'null' : typeof value.version}, not a string`);
  if (!('blocks' in value)) bad.push('`blocks` is absent');
  else if (!Array.isArray(value.blocks)) bad.push(`\`blocks\` is a ${value.blocks === null ? 'null' : typeof value.blocks}, not an array`);
  if (bad.length === 0) return [];
  return [{ code: CLASSIFIER_CODE.CONTENT_ROOT_MALFORMED, where: 'content', detail: bad.join('; ') }];
}

/**
 * Classify every block type and mark type in a parsed content value, returning one
 * finding per detected defect (the caller resolves each `code` to its §5.4
 * disposition via conformance/errors.json and takes the MAX). A well-formed content
 * tree yields no findings.
 */
export function classifyContent(value: unknown, vocab: ContentVocabulary): ClassifierFinding[] {
  const { blockTypes, knownMarks, stringMarks } = vocab;
  const out: ClassifierFinding[] = [];
  const push = (code: string, where: string, detail: string): void => {
    out.push({ code, where, detail });
  };

  // --- mark-type classification (§5.1) ---------------------------------------
  // A mark is a bare string (a core string mark or an unknown namespaced string)
  // or a typed object (a structured mark or an unknown namespaced object).
  const classifyMark = (m: unknown, where: string): void => {
    if (typeof m === 'string') {
      if (stringMarks.has(m)) return; // a valid core string mark
      if (knownMarks.has(m)) {
        push(CLASSIFIER_CODE.MARK_MALFORMED, where, `known mark '${m}' used as a bare string`);
        return;
      }
      if (NAMESPACED_TYPE.test(m)) {
        push(CLASSIFIER_CODE.MARK_TYPE_UNKNOWN_NAMESPACED, where, `unknown namespaced mark '${m}'`);
        return;
      }
      push(CLASSIFIER_CODE.MARK_TYPE_UNKNOWN_BARE, where, `unknown bare mark '${m}'`);
      return;
    }
    if (isRecord(m)) {
      const type = m.type;
      if (typeof type !== 'string') {
        push(CLASSIFIER_CODE.MARK_TYPE_UNKNOWN_BARE, where, 'mark object has no string type');
        return;
      }
      if (knownMarks.has(type)) {
        if (isMalformedKnownMark(type, m, stringMarks)) {
          push(CLASSIFIER_CODE.MARK_MALFORMED, where, `structurally malformed '${type}' mark`);
        }
        return;
      }
      if (NAMESPACED_TYPE.test(type)) {
        push(CLASSIFIER_CODE.MARK_TYPE_UNKNOWN_NAMESPACED, where, `unknown namespaced mark '${type}'`);
        return;
      }
      push(CLASSIFIER_CODE.MARK_TYPE_UNKNOWN_BARE, where, `unknown bare mark '${type}'`);
      return;
    }
    // A mark that is neither a string nor an object (a number/boolean/null).
    push(CLASSIFIER_CODE.MARK_TYPE_UNKNOWN_BARE, where, `mark is a ${m === null ? 'null' : typeof m}, not a string or object`);
  };

  // --- content-tree walk -----------------------------------------------------
  // A single position-aware walk over the block tree. It descends ONLY through the
  // node-bearing arrays content.schema.json defines (`children`, `subfigures[]`'s
  // `children`, and the rich-text `caption` arrays), never into `marks`, `tokens`,
  // `attributes`, `signer`, … — so a typed non-block (e.g. a codeBlock `tokens[]`
  // highlightToken whose `type` is "keyword") is never misread as a bare block.
  //
  // Crucially, it descends ONLY INTO KNOWN BLOCKS. An unknown namespaced block is
  // IGNORE — "render a fallback" (§5.4.2) — so a non-supporting reader does not
  // interpret its interior as CDX content; validating (and possibly rejecting) that
  // interior would contradict the IGNORE disposition and break interop with an
  // extension that reuses `children` for its own non-CDX structure. An unknown bare
  // block already REJECTs the document, so its interior is moot. Thus only a
  // recognized block's interior is interpreted. Marks are classified on the known
  // blocks that carry them (text nodes), which the walk reaches through the same
  // descent, so no separate whole-tree mark pass (which would reach into opaque
  // extension interiors) is needed.
  //
  // A registered EXTENSION block (a namespaced type IN the known set, e.g.
  // academic:theorem) is likewise not descended: it is recognized (so not an
  // unknown-type defect), but its interior is defined by its own extension schema,
  // not core content.schema.json — the core classifier cannot know which of an
  // extension's fields hold blocks/marks. Only a CORE block's interior is interpreted.
  //
  // `parentType` is the nearest enclosing recognized block, so checkBlock's
  // upward-containment rule sees the right parent. `depth` bounds the recursion:
  // JSON.parse (part-loader.ts) accepts arbitrarily deep content, so an unbounded
  // recursive walk is a native-stack-overflow DoS — the same hazard canonicalize.ts
  // guards with assertBoundedDepth before its recursive walks. Here the walk stops
  // descending at the bound so it cannot overflow; content nested past it is not
  // further classified in this slice. Its rejection as a resource-limit violation is
  // NOT enforced here — it arrives with the hashing / resource-bound work (§5.3;
  // B1b-3). The residual (a bare block nested past the bound escaping classification)
  // needs 256 levels of nested core blocks, orders of magnitude beyond real content.
  const walk = (elements: unknown[], parentType: string, where: string, depth: number): void => {
    if (depth > MAX_CANONICALIZATION_DEPTH) return; // recursion bound (see above)
    elements.forEach((el, i) => {
      const w = `${where}[${i}]`;
      if (!isRecord(el)) {
        // A non-object where a block was required: no type to classify and no
        // namespace to defer rendering to → fail closed (bare unrecognized).
        push(CLASSIFIER_CODE.BLOCK_TYPE_UNKNOWN_BARE, w, `block position holds a ${el === null ? 'null' : typeof el}, not an object`);
        return;
      }
      const type = el.type;
      if (typeof type === 'string' && blockTypes.has(type)) {
        if (NAMESPACED_TYPE.test(type)) {
          // Registered EXTENSION block (academic:*, forms:*, semantic:* blocks, …):
          // recognized, so NOT an unknown-type defect — but its interior is defined by
          // its extension schema, not core content.schema.json, and the core classifier
          // cannot know which of its fields are block/mark positions (e.g.
          // academic:exercise-set nests content in `exercises[]`, not `children`).
          // Recognized and left opaque; full extension-content validation (which reaches
          // these interiors with the extension schemas loaded) is deferred to B1b-3.
          return; // recognized; no finding, no descent
        }
        // CORE known block: interpret its interior with the core content model. Check
        // the structural constraints JSON Schema cannot express, plus a container-shape
        // check — a node-bearing field present but not of its schema shape (arrays for
        // children/subfigures/marks; string-or-array for caption; object elements in
        // subfigures) is a structural malformation AND would otherwise silently hide its
        // contents from the descent below, so the "unknown bare type REJECTs" guarantee
        // must not depend on well-formed containers. Both map to the malformed-known
        // WARNING (draft/review).
        const findings: Finding[] = [];
        checkBlock(el, parentType, w, findings);
        // Shape-check the block AND each of its subfigures (an object that itself
        // holds node-bearing `children`/`caption` arrays); a non-object subfigure
        // element is malformed too. A wrong-shape container would otherwise hide its
        // contents from the descent below.
        const badContainer =
          hasMalformedContainer(el) ||
          (Array.isArray(el.subfigures) && el.subfigures.some((sf) => !isRecord(sf) || hasMalformedContainer(sf)));
        if (findings.length > 0 || badContainer) {
          const detail = findings.map((f) => f.message).join('; ') || 'a node-bearing field (children/subfigures/marks/caption) is present but not of its array/string shape';
          push(CLASSIFIER_CODE.BLOCK_MALFORMED, w, detail);
        }
        // Classify the marks this block carries (marks belong to text nodes).
        if (Array.isArray(el.marks)) el.marks.forEach((m, j) => classifyMark(m, `${w}.marks[${j}]`));
        // Descend into the CORE block's interpreted child content only.
        if (Array.isArray(el.children)) walk(el.children, type, `${w}.children`, depth + 1);
        if (Array.isArray(el.caption)) walk(el.caption, type, `${w}.caption`, depth + 1); // figure/subfigure rich caption (text nodes)
        if (Array.isArray(el.subfigures)) {
          el.subfigures.forEach((sf, j) => {
            if (!isRecord(sf)) return;
            if (Array.isArray(sf.children)) walk(sf.children, type, `${w}.subfigures[${j}].children`, depth + 1);
            if (Array.isArray(sf.caption)) walk(sf.caption, type, `${w}.subfigures[${j}].caption`, depth + 1);
          });
        }
        return;
      }
      if (typeof type === 'string' && NAMESPACED_TYPE.test(type)) {
        // Unknown namespaced block: IGNORE, render a fallback. Opaque — not descended.
        push(CLASSIFIER_CODE.BLOCK_TYPE_UNKNOWN_NAMESPACED, w, `unknown namespaced block type '${type}'`);
        return;
      }
      // Unknown bare block (bare/misspelled type, colon-malformed, or missing/non-string
      // type): REJECT. Opaque — the document is refused, so its interior is moot.
      push(
        CLASSIFIER_CODE.BLOCK_TYPE_UNKNOWN_BARE,
        w,
        typeof type === 'string' ? `unknown bare block type '${type}'` : 'block has no string type',
      );
    });
  };

  if (isRecord(value) && Array.isArray(value.blocks)) {
    walk(value.blocks, ROOT_DOCUMENT, 'blocks', 1);
  }
  return out;
}
