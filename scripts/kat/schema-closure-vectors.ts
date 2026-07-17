/**
 * Closure vectors for the schema-closure gate (check-schema-closure.ts).
 *
 * Each vector pins one closed object: `validInstance` MUST validate (guards
 * against an over-tight closure) and `invalidInstance` MUST be rejected (proves
 * the closure has teeth). An intentionally-open bag is pinned the other way —
 * its `validInstance` carries an arbitrary key that MUST still be accepted.
 *
 * The set grows with the closure refactor: each increment that closes objects
 * adds its vectors here and its schema to CLOSED_SCHEMAS, and the gate asserts
 * every closed schema owns at least one vector.
 */

export interface ClosureVector {
  /** Schema file name, e.g. 'dublin-core.schema.json'. */
  schema: string;
  /** JSON pointer to the closed subschema; omit for the schema root. */
  ref?: string;
  /** What this vector covers. */
  description: string;
  /** Minimal instance that MUST validate. */
  validInstance: unknown;
  /** Instance (usually validInstance + one unknown key) that MUST be rejected. */
  invalidInstance: unknown;
}

/** Schemas whose objects have been closed; each MUST own >=1 vector below. */
export const CLOSED_SCHEMAS: string[] = [
  'dublin-core.schema.json',
  'asset-index.schema.json',
  'precise-layout.schema.json',
  'provenance.schema.json',
  'presentation.schema.json',
  'manifest.schema.json',
  'security.schema.json',
  'semantic.schema.json',
  'collaboration.schema.json',
  'content.schema.json',
  'academic.schema.json',
  'legal.schema.json',
  'forms.schema.json',
  'phantoms.schema.json',
  'annotations.schema.json',
  'anchor.schema.json',
];

// A syntactically valid algorithm-prefixed digest for hash-typed fields.
const HASH = 'sha256:' + 'a'.repeat(64);

export const closureVectors: ClosureVector[] = [
  // --- dublin-core ---------------------------------------------------------
  {
    schema: 'dublin-core.schema.json',
    description: 'root',
    validInstance: { version: '1.0', terms: { title: 'T', creator: 'A' } },
    invalidInstance: { version: '1.0', terms: { title: 'T', creator: 'A' }, extra: 1 },
  },
  {
    schema: 'dublin-core.schema.json',
    ref: '#/properties/terms',
    description: 'terms',
    validInstance: { title: 'T', creator: 'A' },
    invalidInstance: { title: 'T', creator: 'A', bogus: 1 },
  },
  {
    schema: 'dublin-core.schema.json',
    ref: '#/$defs/rightsObject',
    description: 'rightsObject',
    validInstance: { statement: 'All rights reserved' },
    invalidInstance: { statement: 'All rights reserved', bogus: 1 },
  },
  {
    schema: 'dublin-core.schema.json',
    ref: '#/$defs/creatorObject',
    description: 'creatorObject',
    validInstance: { name: 'Ada Lovelace' },
    invalidInstance: { name: 'Ada Lovelace', bogus: 1 },
  },

  // --- asset-index ---------------------------------------------------------
  {
    schema: 'asset-index.schema.json',
    description: 'root',
    validInstance: { version: '1.0', assets: [] },
    invalidInstance: { version: '1.0', assets: [], bogus: 1 },
  },
  {
    schema: 'asset-index.schema.json',
    ref: '#/$defs/asset',
    description: 'asset closed; metadata stays open',
    // metadata carries an arbitrary key — it MUST be accepted (intentional bag).
    validInstance: { id: 'a1', path: 'img.png', type: 'image/png', size: 1, hash: HASH, metadata: { anyKey: 'ok', nested: { x: 1 } } },
    // a stray top-level asset key MUST be rejected (asset is closed).
    invalidInstance: { id: 'a1', path: 'img.png', type: 'image/png', size: 1, hash: HASH, bogus: 1 },
  },
  {
    schema: 'asset-index.schema.json',
    ref: '#/$defs/imageVariant',
    description: 'imageVariant',
    validInstance: { path: 'img-2x.png', width: 2, size: 10, hash: HASH },
    invalidInstance: { path: 'img-2x.png', width: 2, size: 10, hash: HASH, bogus: 1 },
  },
  {
    schema: 'asset-index.schema.json',
    ref: '#/$defs/fontFamily',
    description: 'fontFamily',
    validInstance: { name: 'Inter', fonts: [] },
    invalidInstance: { name: 'Inter', fonts: [], bogus: 1 },
  },
  {
    schema: 'asset-index.schema.json',
    ref: '#/$defs/fontFamily/properties/fonts/items',
    description: 'fontFamily.fonts item',
    validInstance: { id: 'inter-regular', weight: 400, style: 'normal' },
    invalidInstance: { id: 'inter-regular', weight: 400, style: 'normal', bogus: 1 },
  },
  {
    schema: 'asset-index.schema.json',
    ref: '#/$defs/license',
    description: 'license',
    validInstance: { name: 'CC-BY-4.0' },
    invalidInstance: { name: 'CC-BY-4.0', bogus: 1 },
  },

  // --- precise-layout ------------------------------------------------------
  {
    schema: 'precise-layout.schema.json',
    description: 'root',
    validInstance: { version: '1.0', presentationType: 'precise', targetFormat: 'letter', pageSize: { width: '8.5in', height: '11in' }, contentHash: HASH, generatedAt: '2020-01-01T00:00:00Z', pages: [{ number: 1, elements: [] }] },
    invalidInstance: { version: '1.0', presentationType: 'precise', targetFormat: 'letter', pageSize: { width: '8.5in', height: '11in' }, contentHash: HASH, generatedAt: '2020-01-01T00:00:00Z', pages: [{ number: 1, elements: [] }], bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/properties/pageSize',
    description: 'pageSize',
    validInstance: { width: '1in', height: '1in' },
    invalidInstance: { width: '1in', height: '1in', bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/page',
    description: 'page',
    validInstance: { number: 1, elements: [] },
    invalidInstance: { number: 1, elements: [], bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/preciseElement',
    description: 'preciseElement',
    validInstance: { blockId: 'b1', x: '0', y: '0', width: '1in', height: '1in' },
    invalidInstance: { blockId: 'b1', x: '0', y: '0', width: '1in', height: '1in', bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/transform',
    description: 'transform',
    validInstance: { rotate: '90deg' },
    invalidInstance: { rotate: '90deg', bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/transform/properties/scale/oneOf/1',
    description: 'transform.scale object branch',
    validInstance: { x: 1.5, y: 2 },
    invalidInstance: { x: 1.5, y: 2, z: 3 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/transform/properties/origin/oneOf/1',
    description: 'transform.origin object branch',
    validInstance: { x: '1in', y: '2in' },
    invalidInstance: { x: '1in', y: '2in', z: '3in' },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/linePrecision',
    description: 'linePrecision',
    validInstance: { number: 1, y: '0', height: '1em' },
    invalidInstance: { number: 1, y: '0', height: '1em', bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/pageTemplate',
    description: 'pageTemplate',
    validInstance: {},
    invalidInstance: { bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/pageTemplate/properties/margins',
    description: 'pageTemplate.margins',
    validInstance: { top: '1in' },
    invalidInstance: { top: '1in', bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/headerFooter',
    description: 'headerFooter',
    validInstance: { content: '{pageNumber}' },
    invalidInstance: { content: '{pageNumber}', bogus: 1 },
  },
  {
    schema: 'precise-layout.schema.json',
    ref: '#/$defs/fontMetrics',
    description: 'fontMetrics',
    validInstance: { family: 'Inter', style: 'normal', weight: 400 },
    invalidInstance: { family: 'Inter', style: 'normal', weight: 400, bogus: 1 },
  },

  // --- provenance ----------------------------------------------------------
  {
    schema: 'provenance.schema.json',
    description: 'root',
    validInstance: { version: '1.0', documentId: HASH, created: '2020-01-01T00:00:00Z' },
    invalidInstance: { version: '1.0', documentId: HASH, created: '2020-01-01T00:00:00Z', bogus: 1 },
  },
  {
    schema: 'provenance.schema.json',
    ref: '#/properties/lineage',
    description: 'lineage',
    validInstance: { parent: null },
    invalidInstance: { parent: null, bogus: 1 },
  },
  {
    schema: 'provenance.schema.json',
    ref: '#/properties/merkle',
    description: 'merkle',
    validInstance: { root: HASH },
    invalidInstance: { root: HASH, bogus: 1 },
  },
  {
    schema: 'provenance.schema.json',
    ref: '#/$defs/actor',
    description: 'actor',
    validInstance: { name: 'Ada Lovelace' },
    invalidInstance: { name: 'Ada Lovelace', bogus: 1 },
  },
  {
    schema: 'provenance.schema.json',
    ref: '#/$defs/derivation',
    description: 'derivation',
    validInstance: { documentId: HASH, relationship: 'excerpt' },
    invalidInstance: { documentId: HASH, relationship: 'excerpt', bogus: 1 },
  },

  // --- presentation --------------------------------------------------------
  {
    schema: 'presentation.schema.json',
    description: 'root closed; defaults + styles map stay open',
    // defaults carries a vendor key and styles carries a custom key — both MUST be accepted (open bags).
    validInstance: { version: '0.1', type: 'continuous', defaults: { vendorKey: 1 }, styles: { custom: { fontSize: '1pt' } } },
    invalidInstance: { version: '0.1', type: 'continuous', defaults: {}, styles: {}, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/properties/typography',
    description: 'typography',
    validInstance: { widows: 2 },
    invalidInstance: { widows: 2, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/properties/typography/properties/hyphenation',
    description: 'typography.hyphenation',
    validInstance: { enabled: true },
    invalidInstance: { enabled: true, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/properties/typography/properties/baselineGrid',
    description: 'typography.baselineGrid',
    validInstance: { enabled: true },
    invalidInstance: { enabled: true, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/page',
    description: 'page',
    validInstance: { number: 1, elements: [] },
    invalidInstance: { number: 1, elements: [], bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/pageElement',
    description: 'pageElement',
    validInstance: { blockId: 'b1', position: { x: '0', y: '0', width: '1in' } },
    invalidInstance: { blockId: 'b1', position: { x: '0', y: '0', width: '1in' }, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/flowElement',
    description: 'flowElement',
    validInstance: { type: 'flow', blockIds: ['b1'], regions: [{ page: 1, position: { x: '0', y: '0', width: '1in' } }] },
    invalidInstance: { type: 'flow', blockIds: ['b1'], regions: [{ page: 1, position: { x: '0', y: '0', width: '1in' } }], bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/flowElement/properties/regions/items',
    description: 'flowElement region item',
    validInstance: { page: 1, position: { x: '0', y: '0', width: '1in' } },
    invalidInstance: { page: 1, position: { x: '0', y: '0', width: '1in' }, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/position',
    description: 'position',
    validInstance: { x: '0', y: '0', width: '1in' },
    invalidInstance: { x: '0', y: '0', width: '1in', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/transform',
    description: 'transform',
    validInstance: { rotate: '90deg' },
    invalidInstance: { rotate: '90deg', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/transform/properties/scale/oneOf/1',
    description: 'transform.scale object branch',
    validInstance: { x: 1.5, y: 2 },
    invalidInstance: { x: 1.5, y: 2, z: 3 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/transform/properties/origin/oneOf/1',
    description: 'transform.origin object branch',
    validInstance: { x: '1in', y: '2in' },
    invalidInstance: { x: '1in', y: '2in', z: '3in' },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/pageTemplate',
    description: 'pageTemplate',
    validInstance: {},
    invalidInstance: { bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/pageTemplate/properties/odd',
    description: 'pageTemplate.odd',
    validInstance: {},
    invalidInstance: { bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/pageTemplate/properties/even',
    description: 'pageTemplate.even',
    validInstance: {},
    invalidInstance: { bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/layout/oneOf/0',
    description: 'layout columns branch (cross-branch reject)',
    validInstance: { type: 'columns', columns: 1, gap: '0.25in' },
    invalidInstance: { type: 'columns', rows: 3 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/layout/oneOf/1',
    description: 'layout grid branch',
    validInstance: { type: 'grid', columns: 12, rows: 'auto' },
    invalidInstance: { type: 'grid', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/layout/oneOf/0/properties/rule',
    description: 'layout columns rule',
    validInstance: { width: '1pt' },
    invalidInstance: { width: '1pt', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/layout/oneOf/1/properties/areas/items',
    description: 'layout grid area item',
    validInstance: { name: 'main' },
    invalidInstance: { name: 'main', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/flowRegion',
    description: 'flowRegion',
    validInstance: { id: 'f1', regions: [] },
    invalidInstance: { id: 'f1', regions: [], bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/flowRegion/properties/regions/items',
    description: 'flowRegion region item',
    validInstance: { page: 1 },
    invalidInstance: { page: 1, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/printSettings',
    description: 'printSettings',
    validInstance: { cropMarks: true },
    invalidInstance: { cropMarks: true, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/printSettings/properties/bleed',
    description: 'printSettings.bleed',
    validInstance: { top: '0.125in' },
    invalidInstance: { top: '0.125in', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/printSettings/properties/trim',
    description: 'printSettings.trim',
    validInstance: { width: '6in' },
    invalidInstance: { width: '6in', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/printSettings/properties/outputIntent',
    description: 'printSettings.outputIntent',
    validInstance: { profile: 'sRGB' },
    invalidInstance: { profile: 'sRGB', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/masterPage',
    description: 'masterPage',
    validInstance: { basedOn: 'default' },
    invalidInstance: { basedOn: 'default', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/masterPage/properties/margins',
    description: 'masterPage.margins',
    validInstance: { top: '1in', outside: '0.75in' },
    invalidInstance: { top: '1in', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/masterRule',
    description: 'masterRule',
    validInstance: { match: { first: true }, master: 'chapter-start' },
    invalidInstance: { match: { first: true }, master: 'chapter-start', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/masterRule/properties/match',
    description: 'masterRule.match closed',
    validInstance: { contains: 'full-bleed-image' },
    invalidInstance: { contains: 'full-bleed-image', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/masterRule/properties/match',
    description: 'masterRule.match minProperties (empty rejected)',
    validInstance: { default: true },
    invalidInstance: {},
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/colorDefinition/oneOf/0',
    description: 'colorDefinition rgb (cross-branch reject)',
    validInstance: { type: 'rgb', value: '#0033a0' },
    invalidInstance: { type: 'rgb', name: 'x', value: '#0033a0' },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/colorDefinition/oneOf/1',
    description: 'colorDefinition cmyk',
    validInstance: { type: 'cmyk', value: '0,0,0,1' },
    invalidInstance: { type: 'cmyk', value: '0,0,0,1', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/colorDefinition/oneOf/2',
    description: 'colorDefinition spot (fallback required)',
    validInstance: { type: 'spot', name: 'PANTONE 286 C', fallback: '#0033a0' },
    invalidInstance: { type: 'spot', name: 'PANTONE 286 C' },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/tableOfContentsConfig',
    description: 'tableOfContentsConfig',
    validInstance: { title: 'Contents' },
    invalidInstance: { title: 'Contents', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/listOfConfig',
    description: 'listOfConfig',
    validInstance: { title: 'Figures' },
    invalidInstance: { title: 'Figures', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/indexConfig',
    description: 'indexConfig',
    validInstance: { title: 'Index' },
    invalidInstance: { title: 'Index', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/indexConfig/properties/style',
    description: 'indexConfig.style',
    validInstance: {},
    invalidInstance: { bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/footnotesConfig',
    description: 'footnotesConfig',
    validInstance: { numbering: '1' },
    invalidInstance: { numbering: '1', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/footnotesConfig/properties/separator',
    description: 'footnotesConfig.separator',
    validInstance: { width: '2in' },
    invalidInstance: { width: '2in', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/endnotesConfig',
    description: 'endnotesConfig',
    validInstance: { title: 'Notes' },
    invalidInstance: { title: 'Notes', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/headerFooterContent/oneOf/1',
    description: 'headerFooterContent inner object',
    validInstance: { variable: 'section-title' },
    invalidInstance: { variable: 'section-title', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/lineNumbering',
    description: 'lineNumbering',
    validInstance: { enabled: true },
    invalidInstance: { enabled: true, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/lineNumbering/properties/style',
    description: 'lineNumbering.style',
    validInstance: { fontSize: '8pt' },
    invalidInstance: { fontSize: '8pt', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/indexMark',
    description: 'indexMark',
    validInstance: { type: 'index', term: 'entropy' },
    invalidInstance: { type: 'index', term: 'entropy', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/style',
    description: 'style closed; style.base stays open',
    // base carries a vendor key — it MUST be accepted (open responsive bag).
    validInstance: { fontSize: '12pt', base: { vendorKey: 1 } },
    invalidInstance: { fontSize: '12pt', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/style/properties/dropCap',
    description: 'style.dropCap',
    validInstance: { lines: 3 },
    invalidInstance: { lines: 3, bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/float',
    description: 'float',
    validInstance: { position: 'top' },
    invalidInstance: { position: 'top', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/section',
    description: 'section closed; attributes stays open',
    validInstance: { blockRefs: ['b1'], attributes: { vendorKey: 1 } },
    invalidInstance: { blockRefs: ['b1'], bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/breakpoint',
    description: 'breakpoint',
    validInstance: { name: 'mobile' },
    invalidInstance: { name: 'mobile', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/pageHeaderFooter',
    description: 'pageHeaderFooter',
    validInstance: { height: '0.5in' },
    invalidInstance: { height: '0.5in', bogus: 1 },
  },
  {
    schema: 'presentation.schema.json',
    ref: '#/$defs/pageHeaderFooter/properties/content',
    description: 'pageHeaderFooter.content',
    validInstance: { left: null },
    invalidInstance: { left: null, bogus: 1 },
  },

  // --- manifest ------------------------------------------------------------
  {
    schema: 'manifest.schema.json',
    description: 'root closed; extension-config slot accepted',
    // the `academic` extension-config slot is accepted and is an open object.
    validInstance: { cdx: '0.1', id: HASH, state: 'draft', created: '2020-01-01T00:00:00Z', modified: '2020-01-01T00:00:00Z', content: { path: 'content/document.json', hash: HASH }, metadata: { dublinCore: 'metadata/dublin-core.json' }, academic: { numbering: 'academic/numbering.json' } },
    invalidInstance: { cdx: '0.1', id: HASH, state: 'draft', created: '2020-01-01T00:00:00Z', modified: '2020-01-01T00:00:00Z', content: { path: 'content/document.json', hash: HASH }, metadata: { dublinCore: 'metadata/dublin-core.json' }, bogusRoot: 1 },
  },
  {
    schema: 'manifest.schema.json',
    description: 'advisory profile declaration accepted as a string',
    // the optional `profile` hint is accepted (a bare string); a non-string is rejected.
    // Removing the schema slot makes the valid instance fail (closed root rejects the key) — the field's teeth.
    validInstance: { cdx: '0.1', id: HASH, state: 'draft', created: '2020-01-01T00:00:00Z', modified: '2020-01-01T00:00:00Z', content: { path: 'content/document.json', hash: HASH }, metadata: { dublinCore: 'metadata/dublin-core.json' }, profile: 'simple' },
    invalidInstance: { cdx: '0.1', id: HASH, state: 'draft', created: '2020-01-01T00:00:00Z', modified: '2020-01-01T00:00:00Z', content: { path: 'content/document.json', hash: HASH }, metadata: { dublinCore: 'metadata/dublin-core.json' }, profile: 123 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/$defs/fileReference',
    description: 'fileReference',
    validInstance: { path: 'content/document.json', hash: HASH },
    invalidInstance: { path: 'content/document.json', hash: HASH, bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/$defs/presentationReference',
    description: 'presentationReference',
    validInstance: { type: 'continuous', path: 'presentation/continuous.json', hash: HASH },
    invalidInstance: { type: 'continuous', path: 'presentation/continuous.json', hash: HASH, bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/$defs/assetCategory',
    description: 'assetCategory',
    validInstance: { count: 1, totalSize: 100, index: 'assets/images/index.json', hash: HASH },
    invalidInstance: { count: 1, totalSize: 100, index: 'assets/images/index.json', hash: HASH, bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/$defs/extension',
    description: 'extension closed; config stays open',
    // config carries an arbitrary key — it MUST be accepted (open bag).
    validInstance: { id: 'cdx.academic', version: '0.1', required: false, config: { anyKey: 1, nested: { x: 1 } } },
    invalidInstance: { id: 'cdx.academic', version: '0.1', required: false, bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/properties/security',
    description: 'manifest.security',
    validInstance: { signatures: 'security/signatures.json' },
    invalidInstance: { signatures: 'security/signatures.json', bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/properties/metadata',
    description: 'manifest.metadata closed; custom stays open',
    validInstance: { dublinCore: 'metadata/dublin-core.json', custom: { vendorKey: 'path/to/file' } },
    invalidInstance: { dublinCore: 'metadata/dublin-core.json', bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/properties/metadata/properties/custom',
    description: 'manifest.metadata.custom (open key, string value)',
    validInstance: { vendorKey: 'metadata/vendor.json' },
    invalidInstance: { vendorKey: 5 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/properties/phantoms',
    description: 'manifest.phantoms',
    validInstance: { clusters: 'phantoms/clusters.json' },
    invalidInstance: { clusters: 'phantoms/clusters.json', bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/properties/lineage',
    description: 'manifest.lineage (now closed)',
    validInstance: { parent: null, version: 2 },
    invalidInstance: { parent: null, version: 2, bogus: 1 },
  },
  {
    schema: 'manifest.schema.json',
    ref: '#/properties/assets',
    description: 'manifest.assets map (open category key, value constrained)',
    validInstance: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json', hash: HASH }, customcat: { count: 0, totalSize: 0, index: 'assets/customcat/index.json', hash: HASH } },
    invalidInstance: { images: { count: 1 } },
  },

  // --- security (Phase 3 closed most of this; register + teeth-test, prioritising the no-example encryption/ACL/algorithm shapes) ---
  {
    schema: 'security.schema.json',
    ref: '#/$defs/algorithmStatus',
    description: 'algorithmStatus + inner per-algorithm objects',
    validInstance: { ES256: { status: 'required' }, 'ML-DSA-65': { status: 'experimental', note: 'post-quantum' } },
    invalidInstance: { ES256: { status: 'required', bogus: 1 } },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/signaturesFile',
    description: 'signaturesFile',
    validInstance: { version: '1.0', documentId: HASH, signatures: [{ id: 's1', scope: { documentId: HASH }, protected: 'aaaa', signature: 'bbbb' }] },
    invalidInstance: { version: '1.0', documentId: HASH, signatures: [{ id: 's1', scope: { documentId: HASH }, protected: 'aaaa', signature: 'bbbb' }], bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/signatureScope',
    description: 'signatureScope',
    validInstance: { documentId: HASH },
    invalidInstance: { documentId: HASH, bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/manifestProjection',
    description: 'manifestProjection',
    validInstance: { cdx: '0.1', state: 'frozen', content: { path: 'content/document.json', hash: HASH } },
    invalidInstance: { cdx: '0.1', state: 'frozen', content: { path: 'content/document.json', hash: HASH }, bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/encryptionFile',
    description: 'encryptionFile (no example coverage)',
    validInstance: { version: '1.0', algorithm: 'A256GCM', keyManagement: 'ECDH-ES+A256KW', recipients: [{ id: 'r1', encryptedKey: 'aaaa' }], encryptedContent: [{ iv: 'aaaa', tag: 'bbbb', path: 'content.enc' }] },
    invalidInstance: { version: '1.0', algorithm: 'A256GCM', keyManagement: 'ECDH-ES+A256KW', recipients: [{ id: 'r1', encryptedKey: 'aaaa' }], encryptedContent: [{ iv: 'aaaa', tag: 'bbbb', path: 'content.enc' }], bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/encryptionRecipient',
    description: 'encryptionRecipient (no example coverage)',
    validInstance: { id: 'r1', encryptedKey: 'aaaa' },
    invalidInstance: { id: 'r1', encryptedKey: 'aaaa', bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/encryptedPart',
    description: 'encryptedPart (no example coverage)',
    validInstance: { iv: 'aaaa', tag: 'bbbb', path: 'content.enc' },
    invalidInstance: { iv: 'aaaa', tag: 'bbbb', path: 'content.enc', bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/accessControl',
    description: 'accessControl (no example coverage)',
    validInstance: { default: { view: true } },
    invalidInstance: { default: { view: true }, bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/permission',
    description: 'permission (no example coverage)',
    validInstance: { view: true, print: false },
    invalidInstance: { view: true, bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/principalPermission',
    description: 'principalPermission (no example coverage)',
    validInstance: { principal: 'user:a@example.com', grants: { view: true } },
    invalidInstance: { principal: 'user:a@example.com', grants: { view: true }, bogus: 1 },
  },
  // Phase-3-closed security objects — teeth-tested now that security is registered.
  {
    schema: 'security.schema.json',
    ref: '#/$defs/signature',
    description: 'signature (JWS path, closed under oneOf)',
    validInstance: { id: 's1', scope: { documentId: HASH }, protected: 'aaaa', signature: 'bbbb' },
    invalidInstance: { id: 's1', scope: { documentId: HASH }, protected: 'aaaa', signature: 'bbbb', bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/webauthnAssertion',
    description: 'webauthnAssertion',
    validInstance: { algorithm: 'ES256', authenticatorData: 'aaaa', clientDataJSON: 'bbbb', signature: 'cccc', publicKey: { kty: 'EC', crv: 'P-256', x: 'aaaa', y: 'bbbb' } },
    invalidInstance: { algorithm: 'ES256', authenticatorData: 'aaaa', clientDataJSON: 'bbbb', signature: 'cccc', publicKey: { kty: 'EC', crv: 'P-256', x: 'aaaa', y: 'bbbb' }, bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/publicJwk',
    description: 'publicJwk (OKP branch)',
    validInstance: { kty: 'OKP', crv: 'Ed25519', x: 'aaaa' },
    invalidInstance: { kty: 'OKP', crv: 'Ed25519', x: 'aaaa', bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/trustedTimestamp',
    description: 'trustedTimestamp',
    validInstance: { token: 'aaaa' },
    invalidInstance: { token: 'aaaa', bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/ltvData',
    description: 'ltvData',
    validInstance: { certificates: ['aaaa'] },
    invalidInstance: { certificates: ['aaaa'], bogus: 1 },
  },
  {
    schema: 'security.schema.json',
    ref: '#/$defs/ltvData/properties/revocationInfo',
    description: 'ltvData.revocationInfo',
    validInstance: { ocsp: ['aaaa'] },
    invalidInstance: { ocsp: ['aaaa'], bogus: 1 },
  },

  // --- semantic (file-shape parts; marks/blocks are content-reached → 4.1e) ---
  {
    schema: 'semantic.schema.json',
    description: 'root (manifest config {bibliography, glossary} as {path,hash})',
    validInstance: { bibliography: { path: 'semantic/bibliography.json', hash: HASH } },
    invalidInstance: { bibliography: { path: 'semantic/bibliography.json', hash: HASH }, bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/bibliographyFile',
    description: 'bibliographyFile',
    validInstance: { version: '0.1', entries: [] },
    invalidInstance: { version: '0.1', entries: [], bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/bibliographyEntry',
    description: 'bibliographyEntry stays OPEN (CSL)',
    // CSL is an open vocabulary — an arbitrary entry field MUST be accepted; teeth via the `id` required.
    validInstance: { id: 'x', type: 'book', vendorField: 1 },
    invalidInstance: { type: 'book' },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/glossaryFile',
    description: 'glossaryFile',
    validInstance: { version: '0.1', terms: [] },
    invalidInstance: { version: '0.1', terms: [], bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/glossaryTerm',
    description: 'glossaryTerm (file term, no type const)',
    validInstance: { id: 'algorithm', term: 'Algorithm', definition: 'A finite sequence of instructions.' },
    invalidInstance: { id: 'algorithm', term: 'Algorithm', definition: 'A finite sequence of instructions.', bogus: 1 },
  },

  // --- collaboration -------------------------------------------------------
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/commentsFile',
    description: 'commentsFile',
    validInstance: { version: '0.2', comments: [] },
    invalidInstance: { version: '0.2', comments: [], bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/manifestConfig',
    description: 'manifestConfig (comments/changes paths) closed',
    validInstance: { comments: 'collaboration/comments.json', changes: 'collaboration/changes.json' },
    invalidInstance: { comments: 'collaboration/comments.json', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/changesFile',
    description: 'changesFile',
    validInstance: { version: '0.2', changes: [] },
    invalidInstance: { version: '0.2', changes: [], bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/crdtFormat',
    description: 'crdtFormat is an open vocabulary (a non-enumerated CRDT library accepted); a non-string is rejected',
    validInstance: 'loro',
    invalidInstance: 42,
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/comment',
    description: 'comment (unevaluatedProperties teeth over open baseComment)',
    validInstance: { id: 'c1', type: 'comment', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', content: 'hi' },
    invalidInstance: { id: 'c1', type: 'comment', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', content: 'hi', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/highlight',
    description: 'highlight carries color + content note; stays closed',
    validInstance: { id: 'h1', type: 'highlight', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', color: '#ffeb3b', content: 'note' },
    invalidInstance: { id: 'h1', type: 'highlight', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/suggestion',
    description: 'suggestion',
    validInstance: { id: 's1', type: 'suggestion', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', originalText: 'a', suggestedText: 'b' },
    invalidInstance: { id: 's1', type: 'suggestion', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', originalText: 'a', suggestedText: 'b', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/reaction',
    description: 'reaction',
    validInstance: { id: 'r1', type: 'reaction', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', emoji: 'thumbsup' },
    invalidInstance: { id: 'r1', type: 'reaction', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', emoji: 'thumbsup', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/reply',
    description: 'reply',
    validInstance: { id: 'rp1', author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', content: 'ok' },
    invalidInstance: { id: 'rp1', author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', content: 'ok', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/change',
    description: 'change closed; before/after stay open block snapshots',
    // before/after carry arbitrary block-snapshot keys that MUST be accepted; teeth via a stray top-level key.
    validInstance: { id: 'ch1', type: 'modify', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, timestamp: '2025-01-01T00:00:00Z', before: { type: 'paragraph', children: [] }, after: { type: 'heading', level: 2 } },
    invalidInstance: { id: 'ch1', type: 'modify', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, timestamp: '2025-01-01T00:00:00Z', bogus: 1 },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/changePosition',
    description: 'changePosition',
    validInstance: { after: 'b1' },
    invalidInstance: { after: 'b1', bogus: 1 },
  },

  // --- content: block dispatch, open-escape, leaf + mark closure (4.1e) -----
  // The block dispatch is exercised through content#/$defs/block: a valid block
  // is accepted (incl. the shared blockBase id/attributes) and the same block
  // with one unknown key is rejected (the self-contained branch has teeth).
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'core block carries shared blockBase id/attributes',
    validInstance: { type: 'paragraph', id: 'p1', attributes: { dir: 'ltr', lang: 'en' }, children: [] },
    invalidInstance: { type: 'paragraph', id: 'p1', children: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'open escape: unknown namespaced block passes; bare unknown type rejected',
    // A namespaced extension we do not recognise is open-world (fields unchecked);
    // a bare (non-namespaced) unknown type is malformed per Content Blocks section 5.
    validInstance: { type: 'myorg:widget', anything: 1, more: [true] },
    invalidInstance: { type: 'bogus', anything: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'text node block (dual-context leaf) closed',
    validInstance: { type: 'text', value: 'hi', marks: ['bold'] },
    invalidInstance: { type: 'text', value: 'hi', bogus: 1 },
  },
  // Mark open escape (6.2): unknown marks MUST be namespaced — the mark analogue
  // of the block dispatch escape above. A namespaced unknown mark passes as a bare
  // string or a typed object; a bare unknown mark (incl. a misspelled core mark)
  // is rejected; a known mark name in the wrong form is rejected (no smuggling).
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'mark escape: unknown namespaced mark (bare string) passes; bare unknown mark rejected',
    validInstance: { type: 'text', value: 'x', marks: ['myorg:flag'] },
    invalidInstance: { type: 'text', value: 'x', marks: ['highlight'] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'mark escape: unknown namespaced mark (typed object) passes; misspelled core mark rejected',
    validInstance: { type: 'text', value: 'x', marks: [{ type: 'myorg:flag', data: 1 }] },
    invalidInstance: { type: 'text', value: 'x', marks: ['itlaic'] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'mark escape excludes known marks: core mark accepted; known namespaced mark in bare-string form rejected',
    validInstance: { type: 'text', value: 'x', marks: ['bold'] },
    invalidInstance: { type: 'text', value: 'x', marks: ['legal:cite'] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'image with bound presentation float',
    validInstance: { type: 'image', src: 'assets/images/x.png', alt: 'x', float: { position: 'top', span: 'column' } },
    invalidInstance: { type: 'image', src: 'assets/images/x.png', alt: 'x', float: { position: 'top' }, bogus: 1 },
  },
  // External-reference fields (6.3): image/svg/signature MAY carry `external`, and an
  // image MAY carry a `fallback` path. Optional + closure intact (bogus key rejected).
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'external image: external + fallback accepted; def stays closed',
    validInstance: { type: 'image', src: 'https://example.com/logo.png', alt: 'Logo', external: true, fallback: 'assets/images/logo-fallback.png' },
    invalidInstance: { type: 'image', src: 'https://example.com/logo.png', alt: 'Logo', external: true, bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'external svg: external flag accepted; def stays closed',
    validInstance: { type: 'svg', src: 'https://example.com/x.svg', alt: 'x', external: true },
    invalidInstance: { type: 'svg', src: 'https://example.com/x.svg', alt: 'x', external: true, bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'external signature image: external flag accepted; def stays closed',
    validInstance: { type: 'signature', signatureType: 'digital', image: 'https://example.com/sig.png', external: true },
    invalidInstance: { type: 'signature', signatureType: 'digital', image: 'https://example.com/sig.png', external: true, bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'figure children constrained to figure-content item types',
    validInstance: { type: 'figure', children: [{ type: 'image', src: 'a.png', alt: 'a' }, { type: 'figcaption', children: [] }] },
    invalidInstance: { type: 'figure', children: [{ type: 'paragraph', children: [] }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'figure numberingConfig bound + closed (presentation extension)',
    validInstance: { type: 'figure', children: [{ type: 'image', src: 'a.png', alt: 'a' }], numberingConfig: { style: 'Figure #', chapter: true } },
    invalidInstance: { type: 'figure', children: [{ type: 'image', src: 'a.png', alt: 'a' }], numberingConfig: { style: 'Figure #', bogus: 1 } },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'signature.signer (inline ad-hoc person) closed',
    validInstance: { type: 'signature', signatureType: 'digital', signer: { name: 'Ada', title: 'CEO' } },
    invalidInstance: { type: 'signature', signatureType: 'digital', signer: { name: 'Ada', bogus: 1 } },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/blockAttributes',
    description: 'blockAttributes closed (semantic JSON-LD stays open)',
    validInstance: { dir: 'rtl', lang: 'ar', semantic: { '@type': 'Article', vocabExtra: true } },
    invalidInstance: { dir: 'rtl', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/linkMark',
    description: 'linkMark closed',
    validInstance: { type: 'link', href: '#x', title: 't' },
    invalidInstance: { type: 'link', href: '#x', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/anchorMark',
    description: 'anchorMark closed',
    validInstance: { type: 'anchor', id: 'a1' },
    invalidInstance: { type: 'anchor', id: 'a1', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/mathMark',
    description: 'mathMark closed',
    validInstance: { type: 'math', format: 'latex', source: 'x^2' },
    invalidInstance: { type: 'math', format: 'latex', source: 'x^2', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/highlightToken',
    description: 'highlightToken closed',
    validInstance: { type: 'keyword', value: 'const' },
    invalidInstance: { type: 'keyword', value: 'const', bogus: 1 },
  },

  // --- extension block dispatch teeth (4.1e) -------------------------------
  // Each authored extension block type is now wired into content#/$defs/block.
  // A minimal valid instance is accepted and the same block with an unknown key
  // is rejected (the wired branch closes via unevaluatedProperties:false).
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:abstract wired + closed',
    validInstance: { type: 'academic:abstract', children: [] },
    invalidInstance: { type: 'academic:abstract', children: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:abstract structured sections are an ordered array of {label, children}; a section item stays closed',
    validInstance: { type: 'academic:abstract', sections: [{ label: 'Background', children: [] }] },
    invalidInstance: { type: 'academic:abstract', sections: [{ label: 'Background', children: [], bogus: 1 }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'presentation:footnote mark is dispatched strictly (content-bearing, closed), not via the open escape',
    validInstance: { type: 'text', value: 'claim', marks: [{ type: 'presentation:footnote', id: 'fn1', content: [{ type: 'text', value: 'note' }] }] },
    invalidInstance: { type: 'text', value: 'claim', marks: [{ type: 'presentation:footnote', id: 'fn1', content: [{ type: 'text', value: 'note' }], bogus: 1 }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:theorem wired + closed',
    validInstance: { type: 'academic:theorem', variant: 'theorem', id: 't1', children: [] },
    invalidInstance: { type: 'academic:theorem', variant: 'theorem', children: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:proof wired + closed',
    validInstance: { type: 'academic:proof', children: [] },
    invalidInstance: { type: 'academic:proof', children: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:algorithm wired + closed',
    validInstance: { type: 'academic:algorithm', lines: [] },
    invalidInstance: { type: 'academic:algorithm', lines: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:equation-group wired + closed',
    validInstance: { type: 'academic:equation-group', lines: [] },
    invalidInstance: { type: 'academic:equation-group', lines: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:exercise-set wired + closed',
    validInstance: { type: 'academic:exercise-set', exercises: [] },
    invalidInstance: { type: 'academic:exercise-set', exercises: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:exercise wired + closed (top-level + nested)',
    validInstance: { type: 'academic:exercise', children: [] },
    invalidInstance: { type: 'academic:exercise', children: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:footnote wired + closed',
    validInstance: { type: 'semantic:footnote', number: 1, content: 'note' },
    invalidInstance: { type: 'semantic:footnote', number: 1, content: 'note', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:bibliography wired + closed',
    validInstance: { type: 'semantic:bibliography', style: 'apa' },
    invalidInstance: { type: 'semantic:bibliography', style: 'apa', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:term wired + closed',
    validInstance: { type: 'semantic:term', term: 'T', definition: 'D' },
    invalidInstance: { type: 'semantic:term', term: 'T', definition: 'D', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:ref wired + closed',
    validInstance: { type: 'semantic:ref', target: '#x' },
    invalidInstance: { type: 'semantic:ref', target: '#x', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:glossary wired + closed',
    validInstance: { type: 'semantic:glossary', sort: 'alphabetical' },
    invalidInstance: { type: 'semantic:glossary', sort: 'alphabetical', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:measurement wired + closed',
    validInstance: { type: 'semantic:measurement', value: 1, unit: 'm' },
    invalidInstance: { type: 'semantic:measurement', value: 1, unit: 'm', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'legal:caption wired + closed',
    validInstance: { type: 'legal:caption', court: 'Supreme Court' },
    invalidInstance: { type: 'legal:caption', court: 'Supreme Court', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'legal:signatureBlock wired + closed',
    validInstance: { type: 'legal:signatureBlock', role: 'counsel', signer: { name: 'Ada' } },
    invalidInstance: { type: 'legal:signatureBlock', role: 'counsel', signer: { name: 'Ada' }, bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'legal:tableOfAuthorities wired + closed',
    validInstance: { type: 'legal:tableOfAuthorities', title: 'Authorities' },
    invalidInstance: { type: 'legal:tableOfAuthorities', title: 'Authorities', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:form wired + closed (children allow core + field blocks)',
    validInstance: { type: 'forms:form', children: [{ type: 'heading', level: 2, children: [] }, { type: 'forms:submit' }] },
    invalidInstance: { type: 'forms:form', children: [], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:textInput wired + closed; baseFormField props accepted (allOf fix)',
    // The latent forms bug rejected baseFormField fields (name/label/placeholder)
    // across the $ref; the unevaluatedProperties:false restructure accepts them.
    validInstance: { type: 'forms:textInput', name: 'email', label: 'Email', placeholder: 'you@x.com', inputType: 'email' },
    invalidInstance: { type: 'forms:textInput', name: 'email', notAField: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:textArea wired + closed',
    validInstance: { type: 'forms:textArea', name: 'bio', label: 'Bio', rows: 6 },
    invalidInstance: { type: 'forms:textArea', name: 'bio', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:checkbox wired + closed',
    validInstance: { type: 'forms:checkbox', name: 'agree', label: 'Agree', defaultChecked: false },
    invalidInstance: { type: 'forms:checkbox', name: 'agree', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:radioGroup wired + closed',
    validInstance: { type: 'forms:radioGroup', name: 'plan', options: [{ value: 'a', label: 'A' }] },
    invalidInstance: { type: 'forms:radioGroup', name: 'plan', options: [{ value: 'a', label: 'A' }], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:dropdown wired + closed',
    validInstance: { type: 'forms:dropdown', name: 'country', options: [{ value: 'gb', label: 'UK' }] },
    invalidInstance: { type: 'forms:dropdown', name: 'country', options: [{ value: 'gb', label: 'UK' }], bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:datePicker wired + closed',
    validInstance: { type: 'forms:datePicker', name: 'dob', label: 'DOB' },
    invalidInstance: { type: 'forms:datePicker', name: 'dob', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:signature wired + closed',
    validInstance: { type: 'forms:signature', name: 'sig', label: 'Sign' },
    invalidInstance: { type: 'forms:signature', name: 'sig', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:submit wired + closed',
    validInstance: { type: 'forms:submit', label: 'Send' },
    invalidInstance: { type: 'forms:submit', label: 'Send', bogus: 1 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'presentation:reference wired + closed',
    validInstance: { type: 'presentation:reference', target: '#fig1', format: 'Figure #' },
    invalidInstance: { type: 'presentation:reference', target: '#fig1', bogus: 1 },
  },

  // --- per-schema fragment coverage for CLOSED_SCHEMAS (4.1e) ---------------
  // The extension block teeth above run through content#/$defs/block, so each
  // extension schema also owns a self-contained closed-def vector so the
  // CLOSED_SCHEMAS coverage check (every closed schema owns >=1 vector) holds.
  {
    schema: 'academic.schema.json',
    ref: '#/$defs/equationLine',
    description: 'academic equationLine closed',
    validInstance: { value: 'e=mc^2', number: '1' },
    invalidInstance: { value: 'e=mc^2', bogus: 1 },
  },
  {
    schema: 'legal.schema.json',
    ref: '#/$defs/legalCiteMark',
    description: 'legalCiteMark reporter form (parties/volume/reporter/page) valid + closed',
    validInstance: { type: 'legal:cite', category: 'cases', form: 'reporter', parties: 'Celotex Corp. v. Catrett', volume: '477', reporter: 'U.S.', page: '317', year: '1986', shortForm: 'Celotex' },
    invalidInstance: { type: 'legal:cite', category: 'cases', form: 'reporter', volume: '477', reporter: 'U.S.', page: '317', bogus: 1 },
  },
  {
    schema: 'legal.schema.json',
    ref: '#/$defs/legalCiteMark',
    description: 'legalCiteMark reporter form requires volume/reporter/page (oneOf teeth)',
    validInstance: { type: 'legal:cite', category: 'cases', form: 'reporter', volume: '477', reporter: 'U.S.', page: '317' },
    invalidInstance: { type: 'legal:cite', category: 'cases', form: 'reporter', volume: '477', reporter: 'U.S.' },
  },
  {
    schema: 'legal.schema.json',
    ref: '#/$defs/legalCiteMark',
    description: 'legalCiteMark code form (title/code/section) valid; missing section rejected',
    validInstance: { type: 'legal:cite', category: 'statutes', form: 'code', title: '42', code: 'U.S.C.', section: '2000e', suffix: 'et seq.' },
    invalidInstance: { type: 'legal:cite', category: 'statutes', form: 'code', title: '42', code: 'U.S.C.' },
  },
  {
    schema: 'legal.schema.json',
    ref: '#/$defs/legalCiteMark',
    description: 'legalCiteMark other form (verbatim text) valid; missing text rejected',
    validInstance: { type: 'legal:cite', category: 'treatises', form: 'other', text: 'Restatement (Second) of Torts § 402A' },
    invalidInstance: { type: 'legal:cite', category: 'treatises', form: 'other' },
  },
  {
    schema: 'legal.schema.json',
    ref: '#/$defs/citationCategory',
    description: 'citationCategory is an open vocabulary (a non-enumerated category accepted); a non-string is rejected',
    validInstance: 'foreign-statutes',
    invalidInstance: 42,
  },
  {
    schema: 'legal.schema.json',
    ref: '#/$defs/citationFormat',
    description: 'citationFormat is an open vocabulary (a non-enumerated style accepted); a non-string is rejected',
    validInstance: 'aglc',
    invalidInstance: 42,
  },
  {
    schema: 'forms.schema.json',
    ref: '#/$defs/validation',
    description: 'forms validation closed',
    validInstance: { required: true, minLength: 1, message: 'required' },
    invalidInstance: { required: true, bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/citationMark',
    description: 'semantic citationMark closed',
    validInstance: { type: 'citation', refs: ['doe2020'], locator: '12' },
    invalidInstance: { type: 'citation', refs: ['doe2020'], bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/footnoteMark',
    description: 'semantic footnoteMark closed',
    validInstance: { type: 'footnote', number: 1 },
    invalidInstance: { type: 'footnote', number: 1, bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/entityMark',
    description: 'semantic entityMark closed',
    validInstance: { type: 'entity', uri: 'https://www.wikidata.org/wiki/Q1' },
    invalidInstance: { type: 'entity', uri: 'https://www.wikidata.org/wiki/Q1', bogus: 1 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/entityMark',
    description: 'entityType is an open vocabulary (a non-enumerated Schema.org/custom type accepted); a non-string is rejected',
    validInstance: { type: 'entity', uri: 'https://www.wikidata.org/wiki/Q5', entityType: 'Movie' },
    invalidInstance: { type: 'entity', uri: 'https://www.wikidata.org/wiki/Q5', entityType: 42 },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/glossaryMark',
    description: 'semantic glossaryMark closed',
    validInstance: { type: 'glossary', ref: 'term-1' },
    invalidInstance: { type: 'glossary', ref: 'term-1', bogus: 1 },
  },

  // --- safe-URI allowlist (anchor safeUri/safeImageUri + the fields applying them) -
  // These $defs are string allowlists, so the vector pins them the string way:
  // validInstance is an allowlisted URI that MUST pass, invalidInstance is a
  // dangerous-scheme URI that MUST be rejected (the allowlist has teeth).
  {
    schema: 'anchor.schema.json',
    ref: '#/$defs/safeUri',
    description: 'safeUri admits https; rejects javascript:',
    validInstance: 'https://example.com/page',
    invalidInstance: 'javascript:alert(1)',
  },
  {
    schema: 'anchor.schema.json',
    ref: '#/$defs/safeUri',
    description: 'safeUri admits relative/fragment refs; rejects data: documents',
    validInstance: 'assets/embeds/quarterly-data.xlsx',
    invalidInstance: 'data:text/html,<script>alert(1)</script>',
  },
  {
    schema: 'anchor.schema.json',
    ref: '#/$defs/safeImageUri',
    description: 'safeImageUri admits data:image raster; rejects data:image/svg+xml (active content)',
    validInstance: 'data:image/png;base64,iVBORw0KGgo=',
    invalidInstance: 'data:image/svg+xml,<svg onload=alert(1)>',
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/linkMark',
    description: 'linkMark.href safe-scheme teeth (javascript: rejected)',
    validInstance: { type: 'link', href: 'https://example.com' },
    invalidInstance: { type: 'link', href: 'javascript:alert(1)' },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'forms:form action safe-scheme teeth (javascript: rejected)',
    validInstance: { type: 'forms:form', action: 'https://api.example.com/submit', children: [{ type: 'forms:submit' }] },
    invalidInstance: { type: 'forms:form', action: 'javascript:alert(1)', children: [{ type: 'forms:submit' }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:ref target safe-scheme teeth (javascript: rejected)',
    validInstance: { type: 'semantic:ref', target: '#section-3' },
    invalidInstance: { type: 'semantic:ref', target: 'javascript:alert(1)' },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'presentation:reference target safe-scheme teeth (javascript: rejected)',
    validInstance: { type: 'presentation:reference', target: '#fig1', format: 'Figure #' },
    invalidInstance: { type: 'presentation:reference', target: 'javascript:alert(1)', format: 'Figure #' },
  },
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/entityMark',
    description: 'entity.uri safe-scheme teeth (javascript: rejected)',
    validInstance: { type: 'entity', uri: 'https://www.wikidata.org/wiki/Q1' },
    invalidInstance: { type: 'entity', uri: 'javascript:alert(1)' },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/author',
    description: 'author.avatar safe-image teeth (javascript: rejected)',
    validInstance: { name: 'Ada', avatar: 'https://example.com/avatars/jane.png' },
    invalidInstance: { name: 'Ada', avatar: 'javascript:alert(1)' },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'image.src safe-image teeth (javascript: rejected)',
    validInstance: { type: 'image', src: 'assets/images/figure1.avif', alt: 'x' },
    invalidInstance: { type: 'image', src: 'javascript:alert(1)', alt: 'x' },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'svg.src safe-image teeth (javascript: rejected)',
    validInstance: { type: 'svg', src: 'assets/diagrams/d.svg', alt: 'x' },
    invalidInstance: { type: 'svg', src: 'javascript:alert(1)', alt: 'x' },
  },

  // --- documented-field representability (S8) -------------------------------
  // The optional crdt sync field is accepted on a block (and stripped before
  // hashing); the block stays closed otherwise.
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'block carries optional crdt sync object; def stays closed',
    validInstance: { type: 'paragraph', crdt: { clientId: 7, clock: 3 }, children: [] },
    invalidInstance: { type: 'paragraph', crdt: { clientId: 7 }, children: [], bogus: 1 },
  },
  // Relaxed phantom asset index: per-asset hash is OPTIONAL (out-of-hash), but
  // the index and each asset stay closed.
  {
    schema: 'phantoms.schema.json',
    ref: '#/$defs/assetIndex',
    description: 'phantom assetIndex (no required hash/version) closed',
    validInstance: { assets: [{ id: 'a', path: 'phantoms/assets/x.png', type: 'image/png', size: 1 }] },
    invalidInstance: { assets: [{ id: 'a', path: 'phantoms/assets/x.png', type: 'image/png', size: 1 }], bogus: 1 },
  },
  {
    schema: 'phantoms.schema.json',
    ref: '#/$defs/phantomAsset',
    description: 'phantomAsset requires id/path/type/size; hash optional; closed',
    validInstance: { id: 'a', path: 'phantoms/assets/x.png', type: 'image/png', size: 1 },
    invalidInstance: { id: 'a', path: 'phantoms/assets/x.png', type: 'image/png', size: 1, bogus: 1 },
  },

  // --- referenceable-id namespace + reference-target shape ------------------
  // Every block id shares the document-wide anchor namespace, so blockBase.id is
  // charset-constrained; a stray-character id is rejected. Reference targets are
  // constrained to the Content Anchor URI shape so a malformed internal target
  // fails at authoring time.
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'core blockBase.id charset (bad-character id rejected)',
    validInstance: { type: 'paragraph', id: 'sec.1-intro', children: [] },
    invalidInstance: { type: 'paragraph', id: 'bad id', children: [] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/subfigure',
    description: 'subfigure.id charset (bad-character id rejected)',
    validInstance: { id: 'fig-a', children: [{ type: 'paragraph', children: [] }] },
    invalidInstance: { id: 'fig a', children: [{ type: 'paragraph', children: [] }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic block id inherits patterned blockBase (no local redeclaration); bad-character id rejected',
    validInstance: { type: 'academic:theorem', variant: 'theorem', id: 'thm-ivt', children: [] },
    invalidInstance: { type: 'academic:theorem', variant: 'theorem', id: 'thm ivt', children: [] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'legal block id inherits patterned blockBase (no local redeclaration); bad-character id rejected',
    validInstance: { type: 'legal:tableOfAuthorities', id: 'toa-1' },
    invalidInstance: { type: 'legal:tableOfAuthorities', id: 'toa 1' },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'equationLine.id charset (sub-block id, not blockBase); bad-character id rejected',
    validInstance: { type: 'academic:equation-group', lines: [{ value: 'x', id: 'eq-exp' }] },
    invalidInstance: { type: 'academic:equation-group', lines: [{ value: 'x', id: 'eq exp' }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic footnote mark id charset (bad-character id rejected)',
    validInstance: { type: 'text', value: 'x', marks: [{ type: 'footnote', number: 1, id: 'fn-1' }] },
    invalidInstance: { type: 'text', value: 'x', marks: [{ type: 'footnote', number: 1, id: 'fn 1' }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'presentation:footnote mark id charset (bad-character id rejected)',
    validInstance: { type: 'text', value: 'x', marks: [{ type: 'presentation:footnote', id: 'pf-1', content: [{ type: 'text', value: 'n' }] }] },
    invalidInstance: { type: 'text', value: 'x', marks: [{ type: 'presentation:footnote', id: 'pf 1', content: [{ type: 'text', value: 'n' }] }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:theorem-ref target = Content Anchor URI (bare non-anchor target rejected)',
    validInstance: { type: 'text', value: 'x', marks: [{ type: 'academic:theorem-ref', target: '#thm-ivt' }] },
    invalidInstance: { type: 'text', value: 'x', marks: [{ type: 'academic:theorem-ref', target: 'thm-ivt' }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:equation-ref target = Content Anchor URI (bare non-anchor target rejected)',
    validInstance: { type: 'text', value: 'x', marks: [{ type: 'academic:equation-ref', target: '#eq-exp' }] },
    invalidInstance: { type: 'text', value: 'x', marks: [{ type: 'academic:equation-ref', target: 'eq-exp' }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'academic:algorithm-ref target = Content Anchor URI (bare non-anchor target rejected)',
    validInstance: { type: 'text', value: 'x', marks: [{ type: 'academic:algorithm-ref', target: '#alg-bisection' }] },
    invalidInstance: { type: 'text', value: 'x', marks: [{ type: 'academic:algorithm-ref', target: 'alg-bisection' }] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'proof.of = Content Anchor URI (bare non-anchor target rejected)',
    validInstance: { type: 'academic:proof', of: '#thm-ivt', children: [] },
    invalidInstance: { type: 'academic:proof', of: 'thm-ivt', children: [] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'theorem.uses items = Content Anchor URIs (bare non-anchor target rejected)',
    validInstance: { type: 'academic:theorem', variant: 'theorem', id: 'thm-1', uses: ['#def-continuous'], children: [] },
    invalidInstance: { type: 'academic:theorem', variant: 'theorem', id: 'thm-1', uses: ['def-continuous'], children: [] },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:ref internal target (external false/absent) MUST be a Content Anchor URI (non-anchor rejected)',
    validInstance: { type: 'semantic:ref', target: '#sec-3' },
    invalidInstance: { type: 'semantic:ref', target: 'section-3' },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'semantic:ref external target (external true) is a safe URI (https accepted, javascript rejected)',
    validInstance: { type: 'semantic:ref', target: 'https://example.com/spec', external: true },
    invalidInstance: { type: 'semantic:ref', target: 'javascript:alert(1)', external: true },
  },

  // --- schema closure hygiene ----------------------------------------------
  // Conditional-validation sentinels are pinned to true (the false form has no
  // defined meaning).
  {
    schema: 'forms.schema.json',
    ref: '#/$defs/conditionalValidation/properties/when',
    description: 'when.isEmpty/isNotEmpty are sentinel true (false rejected)',
    validInstance: { field: 'pw', isEmpty: true },
    invalidInstance: { field: 'pw', isEmpty: false },
  },
  // The clusters.json file root is closed (unknown top-level keys rejected).
  {
    schema: 'phantoms.schema.json',
    description: 'phantoms file root closed',
    validInstance: { version: '1.0', clusters: [] },
    invalidInstance: { version: '1.0', clusters: [], bogus: 1 },
  },
  // An equation line carries a number or a tag, not both.
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'equation line number xor tag (both rejected)',
    validInstance: { type: 'academic:equation-group', lines: [{ value: 'x', number: '1' }] },
    invalidInstance: { type: 'academic:equation-group', lines: [{ value: 'x', number: '1', tag: '*' }] },
  },
  // replies/resolved are comment+suggestion fields only — a highlight/reaction
  // cannot carry them; a comment can.
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/highlight',
    description: 'highlight rejects resolved (comment/suggestion-only field)',
    validInstance: { id: 'h1', type: 'highlight', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', color: '#ffeb3b' },
    invalidInstance: { id: 'h1', type: 'highlight', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', color: '#ffeb3b', resolved: true },
  },
  {
    schema: 'collaboration.schema.json',
    ref: '#/$defs/comment',
    description: 'comment accepts resolved + replies; stays closed',
    validInstance: { id: 'c1', type: 'comment', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', content: 'hi', resolved: true, replies: [] },
    invalidInstance: { id: 'c1', type: 'comment', anchor: { blockId: 'b1' }, author: { name: 'Ada' }, created: '2025-01-01T00:00:00Z', content: 'hi', bogus: 1 },
  },

  // --- open-vocabulary enums (locator type, glossary sort) ------------------
  {
    schema: 'semantic.schema.json',
    ref: '#/$defs/citationMark',
    description: 'locatorType is an open vocabulary (a non-enumerated CSL locator accepted); a non-string is rejected',
    validInstance: { type: 'citation', refs: ['e1'], locatorType: 'column' },
    invalidInstance: { type: 'citation', refs: ['e1'], locatorType: 42 },
  },
  {
    schema: 'content.schema.json',
    ref: '#/$defs/block',
    description: 'glossary sort is an open vocabulary (a non-enumerated order accepted); a non-string is rejected',
    validInstance: { type: 'semantic:glossary', sort: 'reverse-alphabetical' },
    invalidInstance: { type: 'semantic:glossary', sort: 42 },
  },

  // --- annotations / anchor (the unauthenticated annotation file and the shared
  // definition library both close their objects; enrolled so a flipped closure is
  // teeth-tested) --------------------------------------------------------------
  {
    schema: 'annotations.schema.json',
    description: 'security/annotations.json root rejects unknown top-level keys',
    validInstance: { version: '0.1', annotations: [] },
    invalidInstance: { version: '0.1', annotations: [], bogus: 1 },
  },
  {
    schema: 'anchor.schema.json',
    ref: '#/$defs/contentAnchor',
    description: 'ContentAnchor rejects unknown keys (a stray key alongside a range anchor)',
    validInstance: { blockId: 'intro', start: 10, end: 25 },
    invalidInstance: { blockId: 'intro', start: 10, end: 25, bogus: 1 },
  },
  // Phantom content excludes active forms:* blocks — a phantom layer is out-of-hash
  // and must not carry a credential-phishing surface (Renderer Safety §6). A normal
  // block passes; an otherwise-valid forms:submit block is rejected by the exclusion.
  {
    schema: 'phantoms.schema.json',
    ref: '#/$defs/phantomContent',
    description: 'phantom content accepts a normal block but rejects an active forms:* block',
    validInstance: { blocks: [{ type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'x' }] }] },
    invalidInstance: { blocks: [{ type: 'forms:submit' }] },
  },
];
