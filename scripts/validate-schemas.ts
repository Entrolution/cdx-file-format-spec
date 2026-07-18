#!/usr/bin/env npx tsx

/**
 * Validates that all JSON schemas compile correctly.
 */

import { createAjv, loadSchema } from './lib/ajv-utils.js';
import { standaloneSchemas, dependentSchemas } from './lib/schema-registry.js';

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
