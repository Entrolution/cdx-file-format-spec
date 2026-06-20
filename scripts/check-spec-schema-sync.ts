#!/usr/bin/env npx tsx

/**
 * Checks for drift between spec documentation and JSON schemas.
 *
 * This script:
 * 1. Parses spec markdown files for documented block types
 * 2. Parses JSON schemas for defined block types
 * 3. Reports discrepancies between documented and implemented types
 */

import * as fs from 'fs';
import * as path from 'path';

const rootDir = path.join(__dirname, '..');
const specDir = path.join(rootDir, 'spec');
const schemasDir = path.join(rootDir, 'schemas');

interface BlockType {
  type: string;
  source: string;
  line?: number;
}

interface SyncReport {
  specOnly: BlockType[];
  schemaOnly: BlockType[];
  synced: string[];
}

// Patterns for types that appear in spec JSON examples but are NOT block/mark types
// These are excluded from sync checking as they are:
// - MIME types (asset types, not content blocks)
// - Presentation layer types (layout types, not content blocks)
// - Syntax highlighting token types (code formatting, not blocks)
// - State/enum values (document states, annotation types, etc.)
const EXCLUDED_PATTERNS: RegExp[] = [
  // MIME types (assets, not blocks)
  /^image\//, /^font\//, /^application\//, /^text\//, /^audio\//, /^video\//,
  // Presentation layer types (not content blocks)
  /^(paginated|continuous|responsive|flow|precise)$/,
  // Syntax highlighting token types (note: 'comment' is NOT excluded as it's also a collaboration annotation type)
  /^(keyword|function|class|variable|parameter|string|number|boolean|null|docstring|operator|punctuation|delimiter|type|namespace|decorator|plain)$/,
  // Document state values
  /^(draft|review|frozen|published)$/,
  // Collaboration change types (modification action types, not annotation blocks)
  /^(insert|modify|delete)$/,
  // Form field types that appear in examples as values (not block types themselves)
  /^(textInput|checkbox|select|date|number|radio|email)$/,
  // Dublin Core metadata values (not block types)
  /^(Text|Image|Sound|Collection|Dataset|Event|InteractiveResource|MovingImage|PhysicalObject|Service|Software|StillImage)$/,
  // JSON Schema type values
  /^(object|array|string|integer|number|boolean|null)$/,
  // Provenance evidence types (enum values)
  /^(inclusion|exclusion|rfc3161|blockchain|aggregated|reference)$/,
  // Presentation layout types (not content blocks)
  /^(columns|grid|spot)$/,
  // Citation format types (CSL types, not blocks)
  /^(article-journal|article|book|chapter|paper-conference|thesis|report|webpage|entry-encyclopedia)$/,
  // HTML/markdown styling (not block types)
  /^(strong|em|code|sub|sup)$/,
  // Other enum values that aren't block types
  /^(attachment|embedded|external|required|optional)$/,
];

// Check if a type name should be excluded from sync checking
function isExcludedType(typeName: string): boolean {
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(typeName));
}

// Extract block types from spec markdown files
function extractTypesFromSpec(filePath: string): BlockType[] {
  const types: BlockType[] = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const filename = path.relative(rootDir, filePath);

  // Pattern: "type": "<name>" in JSON examples
  const typePattern = /"type":\s*"([^"]+)"/g;

  // Pattern: `"type": "xxx"` in inline code
  const inlinePattern = /`"type":\s*"([^"]+)"`/g;

  lines.forEach((line, index) => {
    let match;

    // Match JSON examples
    while ((match = typePattern.exec(line)) !== null) {
      const typeName = match[1];
      // Skip "text" as it's always present and not a block type
      // Also skip excluded patterns (MIME types, presentation layer types, etc.)
      if (typeName !== 'text' && !isExcludedType(typeName) && !types.find(t => t.type === typeName)) {
        types.push({
          type: typeName,
          source: filename,
          line: index + 1
        });
      }
    }

    // Match inline code references
    while ((match = inlinePattern.exec(line)) !== null) {
      const typeName = match[1];
      if (typeName !== 'text' && !isExcludedType(typeName) && !types.find(t => t.type === typeName)) {
        types.push({
          type: typeName,
          source: filename,
          line: index + 1
        });
      }
    }
  });

  return types;
}

// Recursively extract type constants from a schema object
function extractTypeConstFromObject(obj: unknown, types: string[]): void {
  if (!obj || typeof obj !== 'object') return;

  const record = obj as Record<string, unknown>;

  // Check if this object has properties.type.const
  if (record.properties && typeof record.properties === 'object') {
    const props = record.properties as Record<string, unknown>;
    if (props.type && typeof props.type === 'object') {
      const typeProp = props.type as Record<string, unknown>;
      if (typeProp.const && typeof typeProp.const === 'string') {
        const typeName = typeProp.const;
        // Skip 'text' as it's ubiquitous (matches spec extraction behavior)
        if (typeName !== 'text' && !types.includes(typeName)) {
          types.push(typeName);
        }
      }
    }
  }

  // Recurse into allOf, anyOf, oneOf arrays
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(record[key])) {
      for (const item of record[key] as unknown[]) {
        extractTypeConstFromObject(item, types);
      }
    }
  }

  // Recurse into if/then/else
  for (const key of ['if', 'then', 'else']) {
    if (record[key] && typeof record[key] === 'object') {
      extractTypeConstFromObject(record[key], types);
    }
  }
}

// Extract block types from JSON schema files
function extractTypesFromSchema(filePath: string): BlockType[] {
  const types: BlockType[] = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.relative(rootDir, filePath);
  const extractedTypes: string[] = [];

  try {
    const schema = JSON.parse(content);

    // Look for const types in $defs
    if (schema.$defs) {
      for (const [_defName, defValue] of Object.entries(schema.$defs)) {
        extractTypeConstFromObject(defValue, extractedTypes);
      }
    }

    // Also check allOf conditionals in block definitions
    if (schema.$defs?.block?.allOf) {
      const allOf = schema.$defs.block.allOf as Array<{
        if?: { properties?: { type?: { const?: string } } };
        then?: unknown;
      }>;
      for (const condition of allOf) {
        if (condition.if?.properties?.type?.const) {
          const typeName = condition.if.properties.type.const;
          // Skip 'text' as it's ubiquitous (matches spec extraction behavior)
          if (typeName !== 'text' && !extractedTypes.includes(typeName)) {
            extractedTypes.push(typeName);
          }
        }
      }
    }

    // Convert to BlockType objects
    for (const typeName of extractedTypes) {
      types.push({
        type: typeName,
        source: filename
      });
    }
  } catch (err) {
    console.error(`Error parsing ${filename}: ${err}`);
  }

  return types;
}

// Recursively find all markdown files
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Find all schema files
function findSchemaFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.schema.json')) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

// Main sync check
function checkSync(): SyncReport {
  console.log('Checking spec-schema synchronization...\n');

  // Collect types from specs
  const specTypes: BlockType[] = [];
  const specFiles = findMarkdownFiles(specDir);
  console.log(`Found ${specFiles.length} spec files`);

  for (const file of specFiles) {
    const types = extractTypesFromSpec(file);
    specTypes.push(...types);
  }

  // Collect types from schemas
  const schemaTypes: BlockType[] = [];
  const schemaFiles = findSchemaFiles(schemasDir);
  console.log(`Found ${schemaFiles.length} schema files`);

  for (const file of schemaFiles) {
    const types = extractTypesFromSchema(file);
    schemaTypes.push(...types);
  }

  // Deduplicate
  const specTypeNames = [...new Set(specTypes.map(t => t.type))];
  const schemaTypeNames = [...new Set(schemaTypes.map(t => t.type))];

  console.log(`\nSpec documents ${specTypeNames.length} unique block types`);
  console.log(`Schemas define ${schemaTypeNames.length} unique block types\n`);

  // Find discrepancies
  const specOnly = specTypes.filter(t => !schemaTypeNames.includes(t.type));
  const schemaOnly = schemaTypes.filter(t => !specTypeNames.includes(t.type));
  const synced = specTypeNames.filter(t => schemaTypeNames.includes(t));

  return {
    specOnly: specOnly.filter((t, i, arr) => arr.findIndex(x => x.type === t.type) === i),
    schemaOnly: schemaOnly.filter((t, i, arr) => arr.findIndex(x => x.type === t.type) === i),
    synced
  };
}

// Run check
const report = checkSync();

// Report results
console.log('='.repeat(60));

if (report.synced.length > 0) {
  console.log(`\n✓ ${report.synced.length} types are synchronized:`);
  report.synced.sort().forEach(t => console.log(`    ${t}`));
}

if (report.specOnly.length > 0) {
  console.log(`\n⚠ ${report.specOnly.length} types documented in spec but not in schema:`);
  report.specOnly.forEach(t => {
    console.log(`    ${t.type}`);
    console.log(`      Source: ${t.source}${t.line ? `:${t.line}` : ''}`);
  });
}

if (report.schemaOnly.length > 0) {
  console.log(`\n⚠ ${report.schemaOnly.length} types in schema but not documented in spec:`);
  report.schemaOnly.forEach(t => {
    console.log(`    ${t.type}`);
    console.log(`      Source: ${t.source}`);
  });
}

console.log('\n' + '='.repeat(60));

// Exit with error if there are discrepancies
if (report.specOnly.length > 0 || report.schemaOnly.length > 0) {
  console.log('\nSpec-schema sync check found discrepancies.');
  process.exit(1);
} else {
  console.log('\nAll documented types have schema definitions.');
}
