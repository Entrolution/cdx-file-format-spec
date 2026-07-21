/**
 * Structural content-tree constraints that JSON Schema cannot express — a node's
 * relationship to its parent (upward containment), a cross-field ordering (an
 * anchor range's `start < end`), or a whole-file uniqueness/aggregation property
 * (page numbers, asset-index counts, bibliography/glossary id uniqueness).
 *
 * Each checker is a PURE function over parsed JSON that appends `Finding` objects;
 * none reads the filesystem or holds module-level mutable state, so this module
 * can be imported without side effects — both the `check:structural` gate and the
 * conformance reference adapter use these same functions.
 *
 * The block-type vocabulary is an explicit PARAMETER of `walkBlocks`, never a
 * module-level constant: `walkBlocks` needs to know which `type` strings are
 * content blocks (to track the nearest enclosing block as it descends), and
 * making that an argument keeps this module free of the schema read the gate uses
 * to build its own set — and lets a conformance vector ship exactly the block set
 * a case's outcome depends on.
 */

export interface Finding {
  rule: string;
  where: string;
  message: string;
}

// Sentinels for the parent context of a walked block. A real content file's
// top-level `blocks` array is the document root; a spec fence is an excerpt whose
// real parent is unknown, so an excerpt-root block is exempt from upward
// containment. The leading space guarantees neither can collide with a real block
// `type` string.
export const ROOT_DOCUMENT = ' root-document';
export const ROOT_EXCERPT = ' root-excerpt';

// The block types whose parent is structurally constrained, and the single type
// each one MUST sit under.
export const REQUIRED_PARENT: Record<string, string> = {
  figcaption: 'figure',
  tableCell: 'tableRow',
  tableRow: 'table',
};

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Locate the content-block type enum inside a schema node — the open-world escape
 * `{ not: { properties: { type: { enum: [...] } } } }` in content.schema.json's
 * `$defs/block`. Pure (operates on an in-memory schema object); the gate uses it
 * to derive its full block-type set, but the checkers take the set as a parameter.
 */
export function findBlockTypeEnum(node: unknown): string[] | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findBlockTypeEnum(item);
      if (r) return r;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const not = obj.not as Record<string, unknown> | undefined;
  const typeDef = (not?.properties as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined;
  if (Array.isArray(typeDef?.enum)) {
    return (typeDef!.enum as unknown[]).filter((v): v is string => typeof v === 'string');
  }
  for (const value of Object.values(obj)) {
    const r = findBlockTypeEnum(value);
    if (r) return r;
  }
  return null;
}

// --- content-tree walk -----------------------------------------------------
// Visits every recognized block node, tracking the type of the nearest enclosing
// block. Intermediate non-block containers (a `subfigures` array and its
// subfigure objects, a `marks` array, an `attributes` object) are transparent:
// the parent stays the nearest enclosing block, so a figcaption reached through a
// subfigure is still attributed to its figure.
export type BlockVisitor = (block: Record<string, unknown>, parentType: string, where: string) => void;

export function walkBlocks(node: unknown, parentType: string, where: string, visit: BlockVisitor, blockTypes: ReadonlySet<string>): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkBlocks(item, parentType, `${where}[${i}]`, visit, blockTypes));
    return;
  }
  if (!isRecord(node)) return;
  const type = node.type;
  if (typeof type === 'string' && blockTypes.has(type)) {
    visit(node, parentType, where);
    for (const [k, v] of Object.entries(node)) {
      walkBlocks(v, type, `${where}.${k}`, visit, blockTypes);
    }
  } else {
    for (const [k, v] of Object.entries(node)) {
      walkBlocks(v, parentType, `${where}.${k}`, visit, blockTypes);
    }
  }
}

/** Rules: upward-containment, figure-cardinality, definition-item-cardinality. */
export function checkBlock(block: Record<string, unknown>, parentType: string, where: string, out: Finding[]): void {
  const type = block.type as string;

  // Rule: upward containment. An excerpt root has no known parent, so it is
  // exempt; every other context is checked against the required parent.
  if (type in REQUIRED_PARENT && parentType !== ROOT_EXCERPT) {
    const required = REQUIRED_PARENT[type];
    if (parentType !== required) {
      const parentLabel = parentType === ROOT_DOCUMENT ? 'the document root' : `a '${parentType}'`;
      out.push({
        rule: 'upward-containment',
        where,
        message: `'${type}' must be a child of '${required}', but appears under ${parentLabel}`,
      });
    }
  }

  // Rule: figure cardinality (children form only; the subfigures form is a
  // distinct multi-panel construct with its own arity).
  if (type === 'figure' && Array.isArray(block.children)) {
    let content = 0;
    let caption = 0;
    for (const c of block.children) {
      if (isRecord(c) && c.type === 'figcaption') caption++;
      else content++;
    }
    if (content !== 1) {
      out.push({ rule: 'figure-cardinality', where, message: `figure must contain exactly one content block, found ${content}` });
    }
    if (caption > 1) {
      out.push({ rule: 'figure-cardinality', where, message: `figure must contain at most one figcaption, found ${caption}` });
    }
  }

  // Rule: definitionItem cardinality.
  if (type === 'definitionItem' && Array.isArray(block.children)) {
    let terms = 0;
    let descriptions = 0;
    for (const c of block.children) {
      if (!isRecord(c)) continue;
      if (c.type === 'definitionTerm') terms++;
      else if (c.type === 'definitionDescription') descriptions++;
    }
    if (terms < 1 || descriptions < 1) {
      out.push({
        rule: 'definition-item-cardinality',
        where,
        message: `definitionItem must contain at least one definitionTerm and one definitionDescription, found ${terms} term(s) and ${descriptions} description(s)`,
      });
    }
  }
}

// --- Rule: anchor range ----------------------------------------------------
// A range anchor is identified structurally by carrying both `start` and `end`;
// across every schema `end` names only an anchor range, so this cannot collide
// with an unrelated field. Also matches the inline `#blockId/start-end` URI form.
export const URI_RANGE = /^#[A-Za-z0-9._-]+\/(\d+)-(\d+)$/;

export function checkAnchors(node: unknown, where: string, out: Finding[]): void {
  if (typeof node === 'string') {
    const m = URI_RANGE.exec(node);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (!(start < end)) {
        out.push({ rule: 'anchor-range', where, message: `content anchor URI '${node}' has start (${start}) not less than end (${end})` });
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkAnchors(v, `${where}[${i}]`, out));
    return;
  }
  if (!isRecord(node)) return;

  if (typeof node.start === 'number' && typeof node.end === 'number') {
    const start = node.start;
    const end = node.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || !(start < end)) {
      out.push({ rule: 'anchor-range', where, message: `range anchor has start=${start}, end=${end}; requires 0 <= start < end` });
    }
  }
  for (const [k, v] of Object.entries(node)) {
    checkAnchors(v, `${where}.${k}`, out);
  }
}

// --- Rule: page-number integrity -------------------------------------------
export function checkPreciseLayout(layout: unknown, where: string, out: Finding[]): void {
  if (!isRecord(layout) || !Array.isArray(layout.pages)) return;
  const seen = new Map<number, number>();
  layout.pages.forEach((page, i) => {
    if (!isRecord(page) || typeof page.number !== 'number') return;
    const n = page.number;
    if (seen.has(n)) {
      out.push({ rule: 'page-number-integrity', where, message: `duplicate page number ${n} (pages[${seen.get(n)}] and pages[${i}])` });
    } else {
      seen.set(n, i);
    }
  });
}

// --- Rule: asset-index consistency -----------------------------------------
export function checkAssetCategory(categoryName: string, category: Record<string, unknown>, index: unknown, where: string, out: Finding[]): void {
  if (!isRecord(index) || !Array.isArray(index.assets)) return;
  const assets = index.assets;

  // Asset id uniqueness.
  const seen = new Set<string>();
  for (const asset of assets) {
    if (!isRecord(asset) || typeof asset.id !== 'string') continue;
    if (seen.has(asset.id)) {
      out.push({ rule: 'asset-index-consistency', where, message: `duplicate asset id '${asset.id}' in category '${categoryName}'` });
    } else {
      seen.add(asset.id);
    }
  }

  // Manifest count / totalSize consistency, when declared.
  const actualCount = assets.length;
  let actualTotal = 0;
  for (const asset of assets) {
    if (!isRecord(asset)) continue;
    if (typeof asset.size === 'number') actualTotal += asset.size;
    if (Array.isArray(asset.variants)) {
      for (const variant of asset.variants) {
        if (isRecord(variant) && typeof variant.size === 'number') actualTotal += variant.size;
      }
    }
  }
  if (typeof category.count === 'number' && category.count !== actualCount) {
    out.push({ rule: 'asset-index-consistency', where, message: `category '${categoryName}' manifest count ${category.count} != ${actualCount} asset entries in index` });
  }
  if (typeof category.totalSize === 'number' && category.totalSize !== actualTotal) {
    out.push({ rule: 'asset-index-consistency', where, message: `category '${categoryName}' manifest totalSize ${category.totalSize} != ${actualTotal} summed from index (assets + variants)` });
  }
}

// --- Rule: id uniqueness (bibliography / glossary) -------------------------
export function checkUniqueIds(items: unknown, idKey: string, kind: string, where: string, out: Finding[]): void {
  if (!Array.isArray(items)) return;
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item[idKey] !== 'string') continue;
    const id = item[idKey] as string;
    if (seen.has(id)) {
      out.push({ rule: 'id-uniqueness', where, message: `duplicate ${kind} id '${id}'` });
    } else {
      seen.add(id);
    }
  }
}
