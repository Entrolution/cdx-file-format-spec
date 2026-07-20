/**
 * Loader for the published conformance vectors (`conformance/vectors/*.json`).
 *
 * The JSON files are the SOURCE OF TRUTH for known-answer data; the modules in
 * scripts/kat/ are typed loaders over them. That direction matters: the bytes a
 * third-party implementation runs are the same bytes this repository's own
 * gates run, so the suite cannot quietly diverge from what we test ourselves.
 *
 * TypeScript's types are erased at runtime (the gates run under tsx, which
 * strips types without checking), so a typo'd field in a JSON vector would
 * otherwise be caught by nothing. Every load therefore validates against
 * conformance/vectors/vectors.schema.json — the schema is enforced on every
 * gate run, not merely shipped alongside.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createAjv } from './ajv-utils.js';

const VECTORS_DIR = path.join(__dirname, '..', '..', 'conformance', 'vectors');

export interface VectorFile<T> {
  suite: string;
  specVersion: string;
  kind: string;
  clause: string;
  description: string;
  /** How the expected values were derived — never from the code under test. */
  oracle: string;
  /** File-level capability keys every vector in the file needs (capabilities.json). */
  requires?: string[];
  vectors: T[];
}

type Validator = ((doc: unknown) => boolean) & { errors?: unknown };

let validator: Validator | undefined;

function vectorValidator(): Validator {
  if (validator === undefined) {
    const schemaPath = path.join(VECTORS_DIR, 'vectors.schema.json');
    let schema: unknown;
    try {
      schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    } catch (err) {
      throw new Error(`cannot read the conformance vector schema at ${schemaPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    validator = createAjv().compile(schema as object) as Validator;
  }
  return validator;
}

/** Read and schema-validate one vector file, returning its whole envelope. */
export function loadVectorFile<T>(kind: string): VectorFile<T> {
  const file = path.join(VECTORS_DIR, `${kind}.json`);
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read conformance vectors "${kind}" (${file}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const validate = vectorValidator();
  if (!validate(doc)) {
    throw new Error(`conformance vectors "${kind}" do not validate: ${JSON.stringify(validate.errors)}`);
  }
  return doc as VectorFile<T>;
}

/** Read one vector file and return just its vectors. */
export function loadVectors<T>(kind: string): T[] {
  return loadVectorFile<T>(kind).vectors;
}

/** Every published vector file, for the coverage and round-trip gates. */
export function allVectorKinds(): string[] {
  return fs
    .readdirSync(VECTORS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Attach this-implementation-only expectations to loaded vectors by name.
 *
 * `local` data (message substrings that pin a throw site, and the site labels
 * that mark deliberate sharing) is deliberately NOT published: it asserts on
 * this implementation's English prose, which no third party can be held to. It
 * therefore lives in the loader module rather than in the exported JSON, which
 * makes the export boundary structural — there is no field to forget to strip.
 *
 * Throws if any vector lacks an entry, so a newly added vector cannot silently
 * lose its site-pinning assertion.
 */
export function withLocal<T extends { name: string }, L>(vectors: T[], local: Record<string, L>): (T & { local: L })[] {
  const missing = vectors.filter((v) => local[v.name] === undefined).map((v) => v.name);
  if (missing.length > 0) {
    throw new Error(`conformance vectors missing local expectations: ${missing.join(', ')}`);
  }
  const unused = Object.keys(local).filter((k) => !vectors.some((v) => v.name === k));
  if (unused.length > 0) {
    throw new Error(`local expectations reference unknown vectors: ${unused.join(', ')}`);
  }
  return vectors.map((v) => ({ ...v, local: local[v.name] }));
}
