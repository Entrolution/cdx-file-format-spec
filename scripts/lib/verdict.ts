/**
 * Shared defect-code -> verdict resolution for the Level-1 fixture layers.
 *
 * Both the container mapper (archive-verdict.ts) and the document mapper
 * (document-verdict.ts) turn a list of detected defect codes into a layer verdict
 * the same way: de-duplicate by code, resolve each code's §5.4 disposition from
 * conformance/errors.json (null where the specification assigns none — surfaced as
 * a finding but not raising the verdict), and take the document-level disposition
 * as the most severe (MAX) over the non-null per-finding dispositions. The
 * disposition VALUES are authoritative in errors.json, never invented here.
 */

import { errorVocabulary } from './error-codes.js';
import { type Disposition, isDisposition, maxDisposition } from './disposition.js';

export interface VerdictFinding {
  code: string;
  /** The §5.4 disposition from errors.json, or null where the spec assigns none. */
  disposition: Disposition | null;
}

export interface LayerVerdict {
  documentDisposition: Disposition;
  findings: VerdictFinding[];
}

/**
 * Resolve a list of detected defect codes to a verdict. Findings are de-duplicated
 * by code (a reader may report the same class more than once, but the verdict cares
 * about the class); the document disposition is the MAX over non-null dispositions,
 * and an empty finding set is `IGNORE` (nothing blocks the document).
 */
export function resolveVerdict(codes: readonly string[]): LayerVerdict {
  const vocab = errorVocabulary().codes;
  const seen = new Set<string>();
  const findings: VerdictFinding[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    const entry = vocab[code];
    const disposition = entry && isDisposition(entry.disposition) ? entry.disposition : null;
    findings.push({ code, disposition });
  }
  const dispositions = findings.map((f) => f.disposition).filter(isDisposition);
  return { documentDisposition: maxDisposition(dispositions), findings };
}
