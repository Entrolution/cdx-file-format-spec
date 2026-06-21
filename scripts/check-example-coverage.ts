#!/usr/bin/env npx tsx

/**
 * Checks example coverage for extensions and schemas.
 *
 * This script reports which extensions and schemas have example documents
 * and which are missing coverage.
 */

import * as fs from 'fs';
import * as path from 'path';

const rootDir = path.join(__dirname, '..');
const specExtensionsDir = path.join(rootDir, 'spec', 'extensions');
const examplesDir = path.join(rootDir, 'examples');
const schemasDir = path.join(rootDir, 'schemas');

interface CoverageResult {
  name: string;
  hasExample: boolean;
  examplePath?: string;
}

// Get all extension directories
function getExtensions(): string[] {
  if (!fs.existsSync(specExtensionsDir)) {
    return [];
  }

  return fs.readdirSync(specExtensionsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

// Get all example directories
function getExamples(): string[] {
  if (!fs.existsSync(examplesDir)) {
    return [];
  }

  return fs.readdirSync(examplesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

// Get all schema files
function getSchemas(): string[] {
  if (!fs.existsSync(schemasDir)) {
    return [];
  }

  return fs.readdirSync(schemasDir)
    .filter(file => file.endsWith('.schema.json'));
}

// Check if an example uses a specific extension
function exampleUsesExtension(exampleDir: string, extensionId: string): boolean {
  const manifestPath = path.join(examplesDir, exampleDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const extensions = manifest.extensions || [];
    return extensions.some((ext: { id: string }) =>
      ext.id === `cdx.${extensionId}` || ext.id === extensionId
    );
  } catch {
    return false;
  }
}

// Check if an example uses a specific schema (by having a matching file)
function exampleUsesSchema(exampleDir: string, schemaName: string): boolean {
  const examplePath = path.join(examplesDir, exampleDir);

  // Map schema names to expected file locations
  const schemaFileMap: Record<string, string[]> = {
    'manifest.schema.json': ['manifest.json'],
    'content.schema.json': ['content/document.json'],
    'dublin-core.schema.json': ['metadata/dublin-core.json'],
    'collaboration.schema.json': ['collaboration/comments.json', 'collaboration/changes.json'],
    'forms.schema.json': ['forms/data.json'],
    'phantoms.schema.json': ['phantoms/clusters.json'],
    'security.schema.json': ['security/signatures.json', 'security/annotations.json'],
    'provenance.schema.json': ['provenance/record.json'],
    'asset-index.schema.json': ['assets/images/index.json', 'assets/fonts/index.json', 'assets/embeds/index.json'],
    'precise-layout.schema.json': ['presentation/layouts/letter.json', 'presentation/layouts/a4.json'],
    'presentation.schema.json': ['presentation/paginated.json', 'presentation/continuous.json', 'presentation/responsive.json'],
    'academic.schema.json': ['academic/numbering.json'],
    'semantic.schema.json': ['semantic/bibliography.json'],
    'annotations.schema.json': ['security/annotations.json'],
  };

  const expectedFiles = schemaFileMap[schemaName] || [];

  for (const file of expectedFiles) {
    if (fs.existsSync(path.join(examplePath, file))) {
      return true;
    }
  }

  // Also check if manifest references this extension
  if (schemaName.match(/^(academic|collaboration|forms|legal|phantoms|presentation|security|semantic)\.schema\.json$/)) {
    const extName = schemaName.replace('.schema.json', '');
    return exampleUsesExtension(exampleDir, extName);
  }

  return false;
}

// Main
console.log('Checking example coverage...\n');

const extensions = getExtensions();
const examples = getExamples();
const schemas = getSchemas();

console.log(`Found ${extensions.length} extensions`);
console.log(`Found ${examples.length} example documents`);
console.log(`Found ${schemas.length} schemas\n`);

// Check extension coverage
console.log('Extension Coverage:');
console.log('='.repeat(50));

const extensionResults: CoverageResult[] = [];

for (const ext of extensions) {
  const matchingExamples = examples.filter(ex => exampleUsesExtension(ex, ext));

  extensionResults.push({
    name: ext,
    hasExample: matchingExamples.length > 0,
    examplePath: matchingExamples.length > 0 ? `examples/${matchingExamples[0]}` : undefined
  });
}

const coveredExtensions = extensionResults.filter(r => r.hasExample);
const uncoveredExtensions = extensionResults.filter(r => !r.hasExample);

for (const result of coveredExtensions.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ✓ ${result.name} - ${result.examplePath}`);
}

for (const result of uncoveredExtensions.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ✗ ${result.name} - NO EXAMPLE`);
}

// Check schema coverage
console.log('\nSchema Coverage:');
console.log('='.repeat(50));

const schemaResults: CoverageResult[] = [];

// Schemas that are always used (core schemas)
const coreSchemas = ['manifest.schema.json', 'content.schema.json', 'dublin-core.schema.json'];

// Schemas that don't need direct examples (they define shared types)
const sharedSchemas = ['anchor.schema.json'];

for (const schema of schemas) {
  if (sharedSchemas.includes(schema)) {
    continue; // Skip shared type schemas
  }

  const matchingExamples = examples.filter(ex => exampleUsesSchema(ex, schema));

  schemaResults.push({
    name: schema,
    hasExample: matchingExamples.length > 0,
    examplePath: matchingExamples.length > 0 ? `${matchingExamples.length} example(s)` : undefined
  });
}

const coveredSchemas = schemaResults.filter(r => r.hasExample);
const uncoveredSchemas = schemaResults.filter(r => !r.hasExample);

for (const result of coveredSchemas.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ✓ ${result.name} - ${result.examplePath}`);
}

for (const result of uncoveredSchemas.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ✗ ${result.name} - NO EXAMPLE`);
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('\nSummary:');
console.log(`  Extensions: ${coveredExtensions.length}/${extensionResults.length} covered`);
console.log(`  Schemas: ${coveredSchemas.length}/${schemaResults.length} covered`);

if (uncoveredExtensions.length > 0 || uncoveredSchemas.length > 0) {
  console.log('\nMissing coverage detected.');
  process.exit(1);
} else {
  console.log('\nAll extensions and schemas have example coverage.');
}
