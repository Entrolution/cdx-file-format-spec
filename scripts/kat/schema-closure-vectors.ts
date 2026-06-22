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
    validInstance: { path: 'img-2x.png', width: 2, size: 10 },
    invalidInstance: { path: 'img-2x.png', width: 2, size: 10, bogus: 1 },
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
    ref: '#/$defs/presentationReference',
    description: 'presentationReference',
    validInstance: { type: 'presentation:reference', target: '#b1' },
    invalidInstance: { type: 'presentation:reference', target: '#b1', bogus: 1 },
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
];
