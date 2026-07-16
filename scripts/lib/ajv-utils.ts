/**
 * Shared AJV utilities for schema validation scripts.
 */

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

const schemasDir = path.join(__dirname, '..', '..', 'schemas');

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    // strict:false relaxes the strictTypes/strictRequired idioms a few schemas
    // legitimately use (e.g. `required` naming a property defined only in a
    // sibling `oneOf` branch, `unevaluatedProperties` on a composed object).
    // strictSchema:true is re-enabled on top of that so an unknown or misspelled
    // keyword is rejected at compile time rather than silently ignored — without
    // it, a typo like `patern` for `pattern` or `additionalProperies` for
    // `additionalProperties` voids that constraint invisibly while validation
    // still reports success. This also makes an unregistered `format` a compile
    // error, so a typo'd format name cannot pass unchecked.
    strict: false,
    strictSchema: true,
    allErrors: true,
  });
  addFormats(ajv);
  return ajv;
}

export function loadSchema(filename: string): object {
  const filepath = path.join(schemasDir, filename);
  const content = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(content);
}
