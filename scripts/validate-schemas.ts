#!/usr/bin/env npx tsx

/**
 * Validates that all JSON schemas compile correctly.
 */

import { createAjv, loadSchema } from './lib/ajv-utils.js';

interface DependentSchema {
  schema: string;
  refs: string[];
}

// Standalone schemas (no cross-references)
const standaloneSchemas: string[] = [
  'academic.schema.json',
  'anchor.schema.json',
  'forms.schema.json',
  'legal.schema.json',
  'presentation.schema.json',
  'semantic.schema.json',
];

// Schemas that reference other schemas. manifest/asset-index/provenance/
// precise-layout reference anchor.schema.json#/$defs/contentHash (the shared
// content-hash definition).
const dependentSchemas: DependentSchema[] = [
  { schema: 'annotations.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'asset-index.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'collaboration.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'content.schema.json', refs: ['semantic.schema.json', 'academic.schema.json', 'presentation.schema.json', 'legal.schema.json'] },
  { schema: 'dublin-core.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'manifest.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'phantoms.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'precise-layout.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'provenance.schema.json', refs: ['anchor.schema.json'] },
  { schema: 'security.schema.json', refs: ['anchor.schema.json'] },
];

let hasErrors = false;

console.log('Validating JSON schemas...\n');

// Validate standalone schemas
console.log('Standalone schemas:');
for (const filename of standaloneSchemas) {
  const ajv = createAjv();
  try {
    const schema = loadSchema(filename);
    ajv.compile(schema);
    console.log(`  ✓ ${filename}`);
  } catch (err) {
    console.log(`  ✗ ${filename}`);
    console.log(`    Error: ${err instanceof Error ? err.message : String(err)}`);
    hasErrors = true;
  }
}

// Validate dependent schemas
console.log('\nDependent schemas:');
for (const { schema, refs } of dependentSchemas) {
  const ajv = createAjv();
  try {
    // Load referenced schemas first
    for (const ref of refs) {
      const refSchema = loadSchema(ref);
      ajv.addSchema(refSchema);
    }
    // Compile the main schema
    const mainSchema = loadSchema(schema);
    ajv.compile(mainSchema);
    console.log(`  ✓ ${schema} (refs: ${refs.join(', ')})`);
  } catch (err) {
    console.log(`  ✗ ${schema}`);
    console.log(`    Error: ${err instanceof Error ? err.message : String(err)}`);
    hasErrors = true;
  }
}

console.log('');

if (hasErrors) {
  console.log('Schema validation failed!');
  process.exit(1);
} else {
  console.log('All schemas valid.');
}
