#!/usr/bin/env npx tsx

/**
 * Checks for drift between the spec documentation and the JSON schemas.
 *
 * This is a NAMES-PRESENT gate, not a structure-equivalence check. It verifies
 * that every type discriminator and every REQUIRED property a schema defines is
 * at least mentioned somewhere in the spec prose, and surfaces (as warnings)
 * optional fields and enum values the spec never mentions. It deliberately does
 * NOT diff field types or required-ness structurally: the spec documents fields,
 * enum values, units and type names in the same `| `x` |` table format with no
 * reliable way to tell them apart, so gating on that direction produces false
 * positives — which is how the previous version's 78-name exclusion denylist
 * grew, and why field-level drift previously went undetected.
 *
 * Directions:
 *   schema -> spec (gated):  a type.const or required property absent from the
 *                            spec corpus is drift.
 *   spec  -> schema (gated): a block/mark type the spec formally declares via the
 *                            `Always `"<type>"`` table idiom with no schema is drift.
 *   schema -> spec (warned): optional properties / enum values absent from the spec.
 *
 * Matching is exact-token (see specTokens), so `config` does not spuriously match
 * `configuration`. The token class includes ':' so namespaced discriminators like
 * `academic:theorem` are matched whole.
 *
 * Future: generate the spec's field tables from the schemas so drift is
 * impossible by construction rather than detected after the fact.
 */

import * as fs from 'fs';
import * as path from 'path';

const rootDir = path.join(__dirname, '..');
const specDir = path.join(rootDir, 'spec');
const schemasDir = path.join(rootDir, 'schemas');

// Recursively find all markdown files under a directory.
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

// Find all schema files (flat directory).
function findSchemaFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.schema.json'))
    .map(e => path.join(dir, e.name));
}

// Tokenize spec text into the set of identifier-ish tokens it contains. The
// character class includes ':' (namespaced types `academic:theorem`), '@'
// (JSON-LD keys `@context`), '-' and '.' (hyphenated/dotted names); leading and
// trailing '.'/':' are stripped so prose "...month." yields the token `month`.
// Membership is exact, never substring.
function specTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.match(/[A-Za-z0-9_@.:-]+/g) ?? []) {
    const t = raw.replace(/^[.:]+/, '').replace(/[.:]+$/, '');
    if (t) out.add(t);
  }
  return out;
}

// Block/mark types the spec formally declares via the `Always `"<type>"`` table
// idiom (the quoted form is hyphen-safe and never collides with enum values or
// units, unlike a bare `"type": "x"` scan).
function specDeclaredTypes(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/Always\s+`"([^"]+)"`/g)) out.add(m[1]);
  return out;
}

// Facts collected from the schemas. Each name maps to the first schema file that
// declared it (for human-readable drift messages).
interface SchemaFacts {
  typeConsts: Map<string, string>; // discriminator const under properties.type
  required: Map<string, string>;   // required property names
  props: Map<string, string>;      // all property names
  enums: Map<string, string>;      // enum string values
}

function relSchema(file: string): string {
  return path.relative(rootDir, file);
}

// Recursively collect facts from one schema document. `const` is only treated as
// a type discriminator when it sits under properties.type — collecting every
// `const` would pull in status/format enums (pending, experimental, precise, ...)
// and cause false drift. Required names are collected unconditionally (some
// `required` arrays have no sibling `properties`).
function collectFacts(node: unknown, file: string, facts: SchemaFacts): void {
  if (Array.isArray(node)) {
    for (const v of node) collectFacts(v, file, facts);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  const props = obj.properties;
  if (props && typeof props === 'object') {
    const typeProp = (props as Record<string, unknown>).type;
    if (typeProp && typeof typeProp === 'object') {
      const c = (typeProp as Record<string, unknown>).const;
      if (typeof c === 'string' && !facts.typeConsts.has(c)) facts.typeConsts.set(c, relSchema(file));
    }
    for (const key of Object.keys(props as Record<string, unknown>)) {
      if (!facts.props.has(key)) facts.props.set(key, relSchema(file));
    }
  }

  if (Array.isArray(obj.required)) {
    for (const r of obj.required) {
      if (typeof r === 'string' && !facts.required.has(r)) facts.required.set(r, relSchema(file));
    }
  }

  if (Array.isArray(obj.enum)) {
    for (const e of obj.enum) {
      if (typeof e === 'string' && !facts.enums.has(e)) facts.enums.set(e, relSchema(file));
    }
  }

  for (const v of Object.values(obj)) collectFacts(v, file, facts);
}

// Names from `names` whose token is absent from the spec, sorted, with source.
function undocumented(names: Map<string, string>, tokens: Set<string>): Array<[string, string]> {
  return [...names.entries()]
    .filter(([name]) => !tokens.has(name))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function printList(items: Array<[string, string]>): void {
  for (const [name, source] of items) {
    console.log(`    ${name}`);
    console.log(`      ${source}`);
  }
}

// ---- run --------------------------------------------------------------------

console.log('Checking spec ↔ schema synchronization...\n');

const specFiles = findMarkdownFiles(specDir);
const schemaFiles = findSchemaFiles(schemasDir);
const specText = specFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const tokens = specTokens(specText);
const declaredTypes = specDeclaredTypes(specText);

const facts: SchemaFacts = {
  typeConsts: new Map(),
  required: new Map(),
  props: new Map(),
  enums: new Map(),
};
let parseFailed = false;
for (const file of schemaFiles) {
  try {
    collectFacts(JSON.parse(fs.readFileSync(file, 'utf8')), file, facts);
  } catch (err) {
    console.error(`Error parsing ${relSchema(file)}: ${err}`);
    parseFailed = true;
  }
}

const optional = new Map(
  [...facts.props.entries()].filter(([name]) => !facts.required.has(name))
);

console.log(`Found ${specFiles.length} spec files (${tokens.size} tokens), ${schemaFiles.length} schemas.`);
console.log(
  `Schema surface: ${facts.typeConsts.size} type discriminators, ${facts.required.size} required props, ` +
  `${optional.size} optional props, ${facts.enums.size} enum values.\n`
);

// Gated drift (schema -> spec): discriminators / required props with no mention.
const undocumentedTypes = undocumented(facts.typeConsts, tokens);
const undocumentedRequired = undocumented(facts.required, tokens);

// Gated drift (spec -> schema): a type the spec declares via the idiom but no
// schema implements.
const declaredWithoutSchema = [...declaredTypes]
  .filter(t => !facts.typeConsts.has(t))
  .sort()
  .map(t => [t, 'spec via `Always "<type>"` idiom'] as [string, string]);

// Warnings (schema -> spec): optional fields / enum values with no mention.
const undocumentedOptional = undocumented(optional, tokens);
const undocumentedEnums = undocumented(facts.enums, tokens);

const gatedCount =
  undocumentedTypes.length + undocumentedRequired.length + declaredWithoutSchema.length;

console.log('='.repeat(60));

if (undocumentedTypes.length > 0) {
  console.log(`\n✗ ${undocumentedTypes.length} type discriminator(s) defined in a schema but absent from the spec:`);
  printList(undocumentedTypes);
}
if (undocumentedRequired.length > 0) {
  console.log(`\n✗ ${undocumentedRequired.length} required propert${undocumentedRequired.length === 1 ? 'y' : 'ies'} absent from the spec:`);
  printList(undocumentedRequired);
}
if (declaredWithoutSchema.length > 0) {
  console.log(`\n✗ ${declaredWithoutSchema.length} type(s) declared in the spec but defined by no schema:`);
  printList(declaredWithoutSchema);
}

if (undocumentedOptional.length > 0) {
  console.log(`\n⚠ ${undocumentedOptional.length} optional schema field(s) not mentioned in the spec (review: document or remove):`);
  printList(undocumentedOptional);
}
if (undocumentedEnums.length > 0) {
  console.log(`\n⚠ ${undocumentedEnums.length} enum value(s) not found in the spec (informational; values containing '/' or '+' may be tokenization artifacts):`);
  printList(undocumentedEnums);
}

// Coverage note (no silent caps): the spec->schema check only sees types declared
// via the `Always "<type>"` idiom; types using other doc conventions are checked
// only schema->spec.
const idiomUncovered = facts.typeConsts.size - [...declaredTypes].filter(t => facts.typeConsts.has(t)).length;
console.log(
  `\nNote: spec→schema type drift is checked only for the ${declaredTypes.size} types ` +
  `declared via the \`Always "<type>"\` idiom; ${idiomUncovered} schema type(s) use other ` +
  `doc conventions and are checked only schema→spec. This is a names-present gate, not a ` +
  `structural-equivalence check (see header; the future fix is to generate the tables from the schemas).`
);

console.log('\n' + '='.repeat(60));

if (gatedCount > 0 || parseFailed) {
  if (parseFailed) console.log('\nOne or more schemas could not be parsed (see errors above).');
  if (gatedCount > 0) console.log(`\nSpec-schema sync found ${gatedCount} gated drift issue(s); document or remove them.`);
  process.exit(1);
} else {
  console.log('\nAll type discriminators and required properties are documented in the spec.');
  if (undocumentedOptional.length + undocumentedEnums.length > 0) {
    console.log(`(${undocumentedOptional.length + undocumentedEnums.length} non-gating warning(s) above.)`);
  }
}
