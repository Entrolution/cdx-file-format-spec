/**
 * Shared part-file → schema mapping and validator factory.
 *
 * Both validate-examples.ts (which checks the example corpus) and
 * generate-template.ts (which self-checks its own output) resolve a part file to
 * its schema through this SAME rule table and validator, so the generator can
 * never emit a shape the validator would reject.
 */

import { ValidateFunction } from 'ajv/dist/2020';
import { createAjv, loadSchema } from './ajv-utils.js';

// Schema dependencies (schemas that need other schemas loaded first so their
// cross-file $refs resolve at compile time).
const schemaDependencies: Record<string, string[]> = {
  'content.schema.json': ['anchor.schema.json', 'semantic.schema.json', 'academic.schema.json', 'presentation.schema.json', 'legal.schema.json', 'forms.schema.json'],
  // academic references anchor.schema.json#/$defs/contentAnchorUri for its
  // cross-reference target fields (the academic:*-ref mark targets, uses, of).
  'academic.schema.json': ['anchor.schema.json'],
  'collaboration.schema.json': ['anchor.schema.json'],
  // forms/semantic/presentation reference anchor.schema.json#/$defs/safeUri (the
  // shared safe-URI definition) for their author-controlled URI fields.
  'forms.schema.json': ['anchor.schema.json'],
  'semantic.schema.json': ['anchor.schema.json'],
  // presentation also embeds the content block model via footnoteMark.content
  // (the presentation:footnote mark), so it needs content plus content's cluster.
  'presentation.schema.json': ['anchor.schema.json', 'content.schema.json', 'semantic.schema.json', 'academic.schema.json', 'legal.schema.json', 'forms.schema.json'],
  // phantoms embeds the core content block model (phantomContent.blocks → content
  // block dispatch), so it needs content plus content's whole cross-file cluster.
  'phantoms.schema.json': ['anchor.schema.json', 'semantic.schema.json', 'academic.schema.json', 'presentation.schema.json', 'legal.schema.json', 'forms.schema.json', 'content.schema.json'],
  'security.schema.json': ['anchor.schema.json'],
  'annotations.schema.json': ['anchor.schema.json'],
  // dublin-core references anchor.schema.json#/$defs/mimeType (the shared
  // MIME-type definition) for its terms.format field.
  'dublin-core.schema.json': ['anchor.schema.json'],
  // manifest/asset-index/provenance/precise-layout reference
  // anchor.schema.json#/$defs/contentHash (the shared content-hash definition).
  'manifest.schema.json': ['anchor.schema.json'],
  'asset-index.schema.json': ['anchor.schema.json'],
  'provenance.schema.json': ['anchor.schema.json'],
  'precise-layout.schema.json': ['anchor.schema.json'],
};

// Validators compiled once, cached per (schema, ref) pair. The ref must be part
// of the key: the same schema can be compiled both at its root and at a $def.
const validators: Record<string, ValidateFunction> = {};

export function getValidator(schemaName: string, ref?: string): ValidateFunction {
  const key = ref ? `${schemaName}${ref}` : schemaName;
  if (!validators[key]) {
    const ajv = createAjv();
    for (const dep of schemaDependencies[schemaName] ?? []) {
      ajv.addSchema(loadSchema(dep));
    }
    const schema = loadSchema(schemaName) as { $id: string };
    ajv.addSchema(schema);
    validators[key] = ref ? ajv.compile({ $ref: schema.$id + ref }) : ajv.compile(schema);
  }
  return validators[key];
}

export interface Rule {
  test: RegExp;
  schema: string;
  ref?: string;
}

// Ordered rule table — FIRST match wins, so more-specific paths come first
// (e.g. presentation/layouts/* before the presentation/* catch-all).
// Paths are relative to each examples/<doc>/ directory, using '/' separators.
export const rules: Rule[] = [
  { test: /^manifest\.json$/, schema: 'manifest.schema.json' },
  { test: /^content\/document\.json$/, schema: 'content.schema.json' },
  { test: /^metadata\/dublin-core\.json$/, schema: 'dublin-core.schema.json' },
  { test: /^metadata\/jsonld\.json$/, schema: 'semantic.schema.json', ref: '#/$defs/jsonLdDocument' },
  // academic.schema's root is the manifest-level academic config ({numbering: path});
  // the numbering data file is described by the numberingConfig $def.
  { test: /^academic\/numbering\.json$/, schema: 'academic.schema.json', ref: '#/$defs/numberingConfig' },
  { test: /^collaboration\/(comments|changes)\.json$/, schema: 'collaboration.schema.json' },
  // Per-category index files: assets/<category>/index.json (images, fonts, embeds, …).
  { test: /^assets\/[^/]+\/index\.json$/, schema: 'asset-index.schema.json' },
  { test: /^presentation\/layouts\/[^/]+\.json$/, schema: 'precise-layout.schema.json' },
  { test: /^presentation\/[^/]+\.json$/, schema: 'presentation.schema.json' },
  { test: /^provenance\/record\.json$/, schema: 'provenance.schema.json' },
  { test: /^forms\/data\.json$/, schema: 'forms.schema.json' },
  { test: /^phantoms\/clusters\.json$/, schema: 'phantoms.schema.json' },
  // Phantom assets use a relaxed index (no required per-asset hash); the core
  // asset rule is start-anchored on `assets/` and does not match `phantoms/assets/`.
  { test: /^phantoms\/assets\/index\.json$/, schema: 'phantoms.schema.json', ref: '#/$defs/assetIndex' },
  { test: /^security\/signatures\.json$/, schema: 'security.schema.json' },
  { test: /^security\/annotations\.json$/, schema: 'annotations.schema.json' },
  // semantic file parts validate against their file-shape $defs (the schema root
  // is the manifest-level config, not the file contents).
  { test: /^semantic\/bibliography\.json$/, schema: 'semantic.schema.json', ref: '#/$defs/bibliographyFile' },
  { test: /^semantic\/glossary\.json$/, schema: 'semantic.schema.json', ref: '#/$defs/glossaryFile' },
];

export function ruleFor(relPath: string): Rule | undefined {
  return rules.find(r => r.test.test(relPath));
}
