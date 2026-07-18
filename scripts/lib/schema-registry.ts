/**
 * Single source of truth for how each schema in schemas/ is compiled: whether it
 * stands alone or needs sibling schemas loaded first so its cross-file $refs
 * resolve. validate-schemas.ts compiles from these lists; check-enumeration-
 * coverage.ts asserts the two lists together cover every schemas/*.schema.json
 * file, so a newly added schema cannot silently escape compilation.
 */

export interface DependentSchema {
  schema: string;
  refs: string[];
}

// Standalone schemas (no cross-references).
export const standaloneSchemas: string[] = [
  'anchor.schema.json',
  'legal.schema.json',
];

// Schemas that reference other schemas. manifest/asset-index/provenance/
// precise-layout reference anchor.schema.json#/$defs/contentHash (the shared
// content-hash definition).
export const dependentSchemas: DependentSchema[] = [
  { schema: 'academic.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'annotations.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'asset-index.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'collaboration.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'content.schema.json', refs: ['anchor.schema.json', 'semantic.schema.json', 'academic.schema.json', 'presentation.schema.json', 'legal.schema.json', 'forms.schema.json'] },
  { schema: 'dublin-core.schema.json', refs: ['anchor.schema.json'] },
  // forms/semantic/presentation reference anchor.schema.json#/$defs/safeUri for
  // their author-controlled URI fields (form action, entity uri, cross-reference target).
  { schema: 'forms.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'manifest.schema.json', refs: ['anchor.schema.json'] },
  // presentation also embeds the content block model via footnoteMark.content
  // (the presentation:footnote mark), so it needs content plus content's cluster.
  { schema: 'presentation.schema.json', refs: ['anchor.schema.json', 'content.schema.json', 'semantic.schema.json', 'academic.schema.json', 'legal.schema.json', 'forms.schema.json'] },
  { schema: 'semantic.schema.json', refs: ['anchor.schema.json'] },
  // phantoms embeds the content block model, which dispatches across the whole
  // content + extension-schema cluster.
  { schema: 'phantoms.schema.json', refs: ['anchor.schema.json', 'content.schema.json', 'semantic.schema.json', 'academic.schema.json', 'presentation.schema.json', 'legal.schema.json', 'forms.schema.json'] },
  { schema: 'precise-layout.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'provenance.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'security.schema.json', refs: ['anchor.schema.json'] },
];
