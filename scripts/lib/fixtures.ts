/**
 * Level-1 fixture loader (the document/fixture track).
 *
 * A fixture case is a directory `conformance/fixtures/<kind>/<case>/` holding:
 *   - `case.json` — the case descriptor (fixtures.schema.json): a deterministic
 *     archive build `recipe` (interpreted by zip-writer.ts) plus the expected
 *     verdict and metadata.
 *   - `case.cdx`  — the committed byte-stable archive (== buildZip(recipe)).
 *
 * The corpus is generated from scripts/lib/fixture-corpus.ts (the reviewed source
 * of truth) by scripts/build-fixtures.ts and re-verified by scripts/check-fixtures.ts,
 * mirroring this repo's kat -> vectors pattern.
 *
 * This module enumerates cases and adapts them to the shared comparison engine
 * (conformance-suite.ts): each case becomes a SuiteVector whose `expect` the
 * `container` comparator reads, grouped by kind. Both the reference adapter (to
 * produce actuals) and the harness (to compare) enumerate through here, so they
 * cannot disagree on the corpus.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteCaseGroup, SuiteVector } from './conformance-suite.js';
import type { Disposition, DispositionInterval } from './disposition.js';

export interface FixtureVerdict {
  documentDisposition: DispositionInterval;
  findings: Array<{ code: string; atLeast: Disposition; atMost: Disposition }>;
}

/** The on-disk case.json shape (subset the loader needs). */
export interface FixtureCaseFile {
  description: string;
  layer: 'container' | 'document';
  requires?: string[];
  clause?: string;
  recipe: unknown;
  expect: FixtureVerdict;
}

export interface FixtureCase {
  kind: string; // the <kind> directory (e.g. "container")
  name: string; // the <case> directory name; the engine keys results as "<kind>/<name>"
  dir: string; // absolute path to the case directory
  requires: string[];
  expect: FixtureVerdict;
}

/** Enumerate every fixture case under `<suiteRoot>/fixtures`. */
export function loadFixtures(suiteRoot: string): FixtureCase[] {
  const root = path.join(suiteRoot, 'fixtures');
  if (!fs.existsSync(root)) return [];
  const cases: FixtureCase[] = [];
  for (const kind of fs.readdirSync(root).sort()) {
    const kindDir = path.join(root, kind);
    if (!fs.statSync(kindDir).isDirectory()) continue; // skip fixtures.schema.json etc.
    for (const caseName of fs.readdirSync(kindDir).sort()) {
      const dir = path.join(kindDir, caseName);
      if (!fs.statSync(dir).isDirectory()) continue;
      const casePath = path.join(dir, 'case.json');
      if (!fs.existsSync(casePath)) continue;
      const doc = JSON.parse(fs.readFileSync(casePath, 'utf8')) as FixtureCaseFile;
      cases.push({ kind, name: caseName, dir, requires: doc.requires ?? [], expect: doc.expect });
    }
  }
  return cases;
}

/** Group fixture cases into SuiteCaseGroups the engine can evaluate. */
export function fixtureGroups(cases: FixtureCase[]): SuiteCaseGroup[] {
  const byKind = new Map<string, SuiteVector[]>();
  for (const c of cases) {
    const vector: SuiteVector = { name: c.name, requires: c.requires, expect: c.expect };
    const list = byKind.get(c.kind) ?? [];
    list.push(vector);
    byKind.set(c.kind, list);
  }
  return [...byKind.entries()].map(([kind, vectors]) => ({ kind, vectors }));
}
