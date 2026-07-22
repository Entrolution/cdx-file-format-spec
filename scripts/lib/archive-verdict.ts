/**
 * Defect -> disposition mapper for the container layer.
 *
 * The reference reader (zip-reader.ts) reports the DEFECTS it detected as stable
 * codes; this module resolves each code to the §5.4 disposition the specification
 * assigns (via the shared resolver, verdict.ts, over conformance/errors.json) and
 * takes the document-level verdict as the most severe (MAX) over per-finding
 * dispositions — a suite convention, since §5.4 assigns a disposition per failure
 * class but does not define composition.
 *
 * This is the REFERENCE implementation's mapping of its own reader output to a
 * disposition — the analogue of what a third-party adapter does when it maps its
 * native reader's accept/reject decision to a disposition. The disposition VALUES
 * are authoritative in errors.json (never invented here); a code whose spec
 * disposition is null (a documented spec gap) does not contribute to the document
 * verdict, but is still surfaced as a finding.
 */

import { resolveVerdict, type LayerVerdict, type VerdictFinding } from './verdict.js';
import type { ArchiveFinding } from './zip-reader.js';

export type { VerdictFinding };
export type ArchiveVerdict = LayerVerdict;

/**
 * Map a reader's findings to a document verdict. Findings are de-duplicated by
 * code (a reader may report the same defect class more than once — e.g. two
 * unsafe names — but the verdict cares about the class). The document disposition
 * is the max over the non-null per-finding dispositions; an archive with no
 * finding is `IGNORE` (nothing blocks it).
 */
export function archiveVerdict(findings: readonly ArchiveFinding[]): ArchiveVerdict {
  return resolveVerdict(findings.map((f) => f.code));
}
