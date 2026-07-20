/**
 * Loader for the conformance defect-code vocabulary (`conformance/errors.json`).
 *
 * The codes are a **non-normative** diagnostic aid: the specification mandates
 * dispositions (State Machine §5.4) and lineage outcomes (09 §3.3), never error
 * identifiers. A conforming implementation maps its own internal errors to these
 * codes in its conformance adapter; it never has to adopt them internally.
 *
 * This module exists so the gates can assert that every code a known-answer
 * vector expects is actually registered — otherwise a typo'd code in a vector
 * would silently assert against a code no implementation could ever emit.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ErrorCodeEntry {
  summary: string;
  clause: string;
  outcome?: string;
  note?: string;
}

interface ErrorVocabulary {
  version: string;
  specVersion: string;
  codes: Record<string, ErrorCodeEntry>;
}

const VOCAB_PATH = path.join(__dirname, '..', '..', 'conformance', 'errors.json');

let cached: ErrorVocabulary | undefined;

export function errorVocabulary(): ErrorVocabulary {
  if (cached === undefined) {
    const raw = fs.readFileSync(VOCAB_PATH, 'utf8');
    cached = JSON.parse(raw) as ErrorVocabulary;
  }
  return cached;
}

/** Shape of a well-formed defect code. */
export const ERROR_CODE_PATTERN = /^CDX-E-[A-Z0-9]+(-[A-Z0-9]+)*$/;

/** True iff `code` is well-formed AND registered in conformance/errors.json. */
export function isRegisteredCode(code: unknown): code is string {
  if (typeof code !== 'string' || !ERROR_CODE_PATTERN.test(code)) return false;
  return Object.prototype.hasOwnProperty.call(errorVocabulary().codes, code);
}

/**
 * Assert every code in `codes` is registered. Returns the problems found so a
 * caller can fold them into its own failure reporting.
 */
export function unregisteredCodes(codes: Iterable<unknown>): string[] {
  const problems: string[] = [];
  for (const c of codes) {
    if (typeof c !== 'string' || !ERROR_CODE_PATTERN.test(c)) {
      problems.push(`"${String(c)}" is not a well-formed CDX-E-* defect code`);
    } else if (!isRegisteredCode(c)) {
      problems.push(`"${c}" is not registered in conformance/errors.json`);
    }
  }
  return problems;
}
