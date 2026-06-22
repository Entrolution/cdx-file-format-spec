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
];
