/**
 * Defect -> disposition mapper for the document/part layer (B1b), the analogue of
 * archive-verdict.ts one layer up.
 *
 * Given the archive bytes and the container reader's entry set, it loads the CDX
 * parts in memory (part-loader.ts), applies the §5.4.2 / §5.4.3 part-layer failure
 * classes, and resolves each detected defect to the disposition the SPECIFICATION
 * assigns (via the shared resolver, verdict.ts, over conformance/errors.json). The
 * document-level verdict is the most severe (MAX) over per-finding dispositions —
 * the same suite convention as the container layer.
 *
 * SCOPE (B1b-1, Tier 1): the manifest / part-load spine —
 *   - strict-JSON part loading: duplicate keys REJECT in every state (§5.4.3, any
 *     part), via part-loader.ts; a non-representable hashed number REJECTs in every
 *     state (§5.4.3) — applied here to the hashed content part, not to the manifest,
 *     which is not part of the document hash;
 *   - the manifest: absent / unparseable (or not a JSON object) / a malformed
 *     required field / an off-enum state, all REJECT (§5.4.2), reusing
 *     manifest-projection's validateManifestCore;
 *   - version support: an unsupported MAJOR REJECTs, an unsupported MINOR WARNs;
 *   - extension support: an unsupported REQUIRED extension REJECTs, an unsupported
 *     OPTIONAL one is IGNOREd (classified fail-closed — see below);
 *   - the required content part's presence AND parseability: a present-but-unparseable
 *     content part (syntax error, or a decompression / resource-limit failure) REJECTs
 *     in every state, since the content and document identity cannot be established
 *     (§5.4.1; §4.3.2).
 * The document-ID / file-hash recompute (§5.4.2 "File hash or document-ID
 * mismatch"), full content canonical-validity beyond parseability (block/mark
 * structure, NFC), the Dublin Core / provenance missing-part rows, the block/mark
 * classifier, and the reference resolver arrive in B1b-2 / B1b-3; the
 * FROZEN/PUBLISHED INTEGRITY-ERROR ceilings (which §5.3 gates on a valid signature)
 * arrive in B3. The disposition VALUES are authoritative in errors.json, never
 * invented here.
 */

import { loadPart, hasEntry } from './part-loader.js';
import { validateManifestCore } from './manifest-projection.js';
import { isPlainObject, CanonicalizationError, firstNonRepresentableNumber } from './canonicalize.js';
import { resolveVerdict, type LayerVerdict, type VerdictFinding } from './verdict.js';
import type { ArchiveResult } from './zip-reader.js';

/** Document-layer defect codes this mapper assigns (registered in errors.json). */
export const CODE = {
  MANIFEST_ABSENT: 'CDX-E-MANIFEST-ABSENT',
  MANIFEST_UNPARSEABLE: 'CDX-E-MANIFEST-UNPARSEABLE',
  CONTENT_PART_MISSING: 'CDX-E-CONTENT-PART-MISSING',
  CONTENT_PART_UNPARSEABLE: 'CDX-E-CONTENT-PART-UNPARSEABLE',
  PART_DUPLICATE_KEYS: 'CDX-E-PART-DUPLICATE-KEYS',
  PART_NUMBER_NON_REPRESENTABLE: 'CDX-E-PART-NUMBER-NON-REPRESENTABLE',
  VERSION_MAJOR_UNSUPPORTED: 'CDX-E-VERSION-MAJOR-UNSUPPORTED',
  VERSION_MINOR_UNSUPPORTED: 'CDX-E-VERSION-MINOR-UNSUPPORTED',
  EXTENSION_REQUIRED_UNSUPPORTED: 'CDX-E-EXTENSION-REQUIRED-UNSUPPORTED',
  EXTENSION_OPTIONAL_UNSUPPORTED: 'CDX-E-EXTENSION-OPTIONAL-UNSUPPORTED',
} as const;

export type { VerdictFinding };
export type DocumentVerdict = LayerVerdict;

/**
 * The reader's support envelope: the single major version it implements, the
 * highest minor version it fully understands, and the set of extension ids it
 * supports. A real reader parameterizes the version/extension degradation rows off
 * exactly this; the reference adapter derives it from its declared capabilities.
 */
export interface ReaderSupport {
  major: number;
  minor: number;
  extensions: ReadonlySet<string>;
}

/**
 * Compute the document-layer verdict for an archive whose container layer has
 * already been read. `archive.entries` is the central-directory entry set;
 * `bytes` is the raw archive so parts can be decompressed in memory on demand.
 * `support` is the reader's version/extension support envelope.
 *
 * Container-layer findings are NOT re-mapped here — the caller composes the two
 * verdicts (max over both), so a container REJECT blocks the document regardless of
 * the part-layer read. This function reports only the part-layer findings it detects.
 */
export function documentVerdict(bytes: Buffer, archive: ArchiveResult, support: ReaderSupport): DocumentVerdict {
  const codes: string[] = [];
  const add = (code: string): void => {
    codes.push(code);
  };

  // --- Manifest: presence + strict-JSON parse (§5.4.2 / §5.4.3) --------------
  const m = loadPart(bytes, archive.entries, 'manifest.json');
  if (m.status === 'absent') {
    add(CODE.MANIFEST_ABSENT);
    return resolveVerdict(codes); // no manifest => nothing further can be established
  }
  if (m.status === 'defect') {
    // A duplicate-key defect (=> PART-DUPLICATE-KEYS, state-invariant REJECT,
    // §5.4.3) is attributed to that class; a bare JSON syntax error is the
    // "manifest unparseable" row (§5.4.2).
    add(m.code ?? CODE.MANIFEST_UNPARSEABLE);
    return resolveVerdict(codes); // an unusable manifest blocks the load
  }
  if (!isPlainObject(m.value)) {
    // Valid JSON, but not a manifest object (an array or scalar) — unparseable AS A
    // MANIFEST (§5.4.2, the "manifest ... unparseable" row); projectManifest treats
    // the same input the same way.
    add(CODE.MANIFEST_UNPARSEABLE);
    return resolveVerdict(codes);
  }
  const manifest = m.value;

  // --- Required manifest fields (cdx / state / content) — §5.4.2 -------------
  // Reuse manifest-projection's core validator: an off-enum state or a malformed
  // required field is a REJECT in every state. Unlike projectManifest, this applies
  // to a pending-id draft too (there is no projection, but the field rules stand).
  let core;
  try {
    core = validateManifestCore(manifest);
  } catch (err) {
    add(err instanceof CanonicalizationError && err.code ? err.code : CODE.MANIFEST_UNPARSEABLE);
    return resolveVerdict(codes); // a malformed required field blocks the load
  }

  // --- Version support (§5.4.2) ----------------------------------------------
  // core.cdx is a validated "<major>.<minor>" string. An unsupported MAJOR is a
  // REJECT (the reader cannot assume it understands the format); an unsupported
  // MINOR is a WARNING (process known fields, ignore unknown additions).
  const [major, minor] = core.cdx.split('.').map((n) => parseInt(n, 10));
  if (major !== support.major) {
    add(CODE.VERSION_MAJOR_UNSUPPORTED);
    return resolveVerdict(codes); // an unknown major version blocks further interpretation
  }
  if (minor > support.minor) {
    add(CODE.VERSION_MINOR_UNSUPPORTED);
  }

  // --- Extension support (§5.4.2) --------------------------------------------
  // An unsupported REQUIRED extension REJECTs; an unsupported OPTIONAL one is
  // IGNOREd. Classified FAIL-CLOSED: an entry counts as optional only when
  // `required` is explicitly `false`; a missing or non-boolean `required` is
  // treated as required, so a malformed entry cannot silently downgrade an
  // unsupported namespace from REJECT to IGNORE. (Malformed extension entries are
  // otherwise not a Tier-1 row; the classification only governs the support rows.)
  const extensions = manifest.extensions;
  if (Array.isArray(extensions)) {
    for (const ext of extensions) {
      if (isPlainObject(ext) && typeof ext.id === 'string' && !support.extensions.has(ext.id)) {
        add(ext.required === false ? CODE.EXTENSION_OPTIONAL_UNSUPPORTED : CODE.EXTENSION_REQUIRED_UNSUPPORTED);
      }
    }
  }

  // --- Required content part: presence + strict-JSON parse -------------------
  // The content part is required in every state (§5.4.2 "Missing the required
  // content part" => REJECT). Its path was validated safe by validateManifestCore.
  if (!hasEntry(archive.entries, core.content.path)) {
    add(CODE.CONTENT_PART_MISSING);
  } else {
    const c = loadPart(bytes, archive.entries, core.content.path);
    if (c.status === 'defect') {
      // A coded state-invariant reject (duplicate keys), or — for an uncoded parse /
      // decompression / resource-limit failure — the required content part cannot
      // yield a JSON value, so the document's content and identity cannot be
      // established: REJECT in every state (§5.4.1; §4.3.2 requires canonical JSON).
      // Symmetric with the manifest path above.
      add(c.code ?? CODE.CONTENT_PART_UNPARSEABLE);
    } else if (c.status === 'ok' && firstNonRepresentableNumber(c.value) !== null) {
      // The content part IS hashed, so the state-invariant non-representable-number
      // rule (§5.4.3) applies to it even for a pending-id draft that is never
      // canonicalized.
      add(CODE.PART_NUMBER_NON_REPRESENTABLE);
    }
  }

  // --- Duplicate keys in ANY part (§5.4.3, state-invariant) ------------------
  // "Any part containing an object with duplicate keys MUST be rejected before
  // hashing or verification, in every state" — a split-view substitution vector,
  // and §5.4.3 explicitly overrides the per-state table. The manifest and content
  // parts are checked above; sweep every OTHER JSON part (Dublin Core, and any
  // presentation / asset-index / extension part) for the same defect. A legitimate
  // document has no duplicate key anywhere, so this never false-rejects. (The
  // non-representable-NUMBER rule is NOT swept: only the content part is free-form
  // hashed content — Dublin Core projects string terms only, §4.6 — so a number
  // outside the content part is not a hashed number.)
  for (const entry of archive.entries) {
    if (!entry.name.endsWith('.json')) continue;
    if (entry.name === 'manifest.json' || entry.name === core.content.path) continue;
    const p = loadPart(bytes, archive.entries, entry.name);
    if (p.status === 'defect' && p.code === CODE.PART_DUPLICATE_KEYS) add(p.code);
  }

  return resolveVerdict(codes);
}
