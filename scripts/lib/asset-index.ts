/**
 * Asset-index loading and hash verification for the document layer (B1b-3b-2) — the
 * §5.4.2 rows that bind an asset category's bytes, plus the resolvability signal every
 * asset-dependent check downstream keys off.
 *
 * WHAT THIS MODULE OWNS.
 *   - Loading each declared category's index from the DERIVED path (05 §3.1);
 *   - the three-step hash chain of 05 §8.1 — the index file against
 *     `manifest.assets[<category>].hash`, then each asset and each image variant against
 *     its own `hash` in the index;
 *   - the presence of every asset the index lists;
 *   - producing the raw index TEXTS the document-ID recompute needs
 *     (`DocumentParts.assetIndexes`) and the resolved path→hash map the content walk and
 *     the reference resolver need (`buildAssetMap`).
 *
 * THE INDEX IS READ FROM THE DERIVED PATH, AND A DIVERGENCE IS A REJECT. 05 §3.1: a
 * category's index MUST live at `assets/<category>/index.json` and the declared
 * `manifest.assets.<category>.index` MUST equal it. §3.1 formerly resolved a disagreement
 * leniently ("the derived path governs"), leaving the document loadable; the erratum
 * deleted that sentence and 07 §5.4.2 now carries a REJECT row, because the divergence
 * opens a real seam: the manifest projection binds the DECLARED path's hash
 * (`collectAssetIndexReferences`, Security Extension §9.7) while the document ID inherits
 * the asset hashes listed in the file at the DERIVED path (§4.3.1 item 2 substitutes each
 * asset's own content hash; it never hashes the index file's bytes), so a signature
 * attests one file while identity depends on another. Rejecting closes the split
 * without changing any projected bytes: for every loadable document the two paths name the
 * same file. The read still uses the derived path — the REJECT is the verdict, not a
 * relocation of where the index is loaded from.
 *
 * RESOLVABILITY IS THE LOAD-BEARING OUTPUT. When a category's index cannot be loaded, every
 * asset reference into that category is INDETERMINATE, not dangling. Reporting them dangling
 * would fan one real defect (a missing index) out into a finding per reference, and skipping
 * the document-ID recompute is mandatory for the same reason `dcResolvable` skips it for an
 * unloadable Dublin Core part: recomputing over a partial asset map compares a different
 * document's basis and manufactures a spurious mismatch. This is why the module reports
 * `unresolvable` per CATEGORY rather than a single boolean — a document with a good `images`
 * index and a broken `fonts` one still resolves its image references honestly.
 *
 * The trap this guards is quiet: `buildAssetMap` skips a category whose index carries no
 * `assets` ARRAY (`if (!Array.isArray(entries)) continue`) without throwing, so a malformed
 * index yields an empty map that no `catch` anywhere would notice.
 *
 * Pure over parsed JSON and the archive's entry set — no filesystem, no module state — so a
 * gate and the conformance reference adapter can both import it, as with
 * structural-constraints.ts and reference-resolver.ts.
 */

import { findEntry, hasEntry, type PartLoad } from './part-loader.js';
import { inflateEntry, type ArchiveEntry } from './zip-reader.js';
import {
  buildAssetMap,
  isPlainObject,
  hashBytes,
  algorithmOf,
  isValidContentHash,
  normalizePath,
  CanonicalizationError,
} from './canonicalize.js';

/** Defect codes this module assigns (registered in conformance/errors.json). */
export const ASSET_CODE = {
  PART_MISSING_BOUND: 'CDX-E-PART-MISSING-BOUND',
  ASSET_INDEX_UNUSABLE: 'CDX-E-ASSET-INDEX-UNUSABLE',
  ASSET_INDEX_HASH_MISMATCH: 'CDX-E-ASSET-INDEX-HASH-MISMATCH',
  ASSET_HASH_MISMATCH: 'CDX-E-ASSET-HASH-MISMATCH',
  ASSET_VARIANT_MISSING: 'CDX-E-ASSET-VARIANT-MISSING',
  ASSET_INDEX_PATH_DIVERGENT: 'CDX-E-ASSET-INDEX-PATH-DIVERGENT',
  // A malformed `manifest.assets` declaration is a mistyped required manifest field
  // (§5.4.2), which these two published codes already name — `assetCategory` requires
  // {count, totalSize, index, hash}, and manifest-projection throws exactly these for the
  // same input. Reused rather than re-minted so one defect keeps one code across layers.
  MANIFEST_HASH_MALFORMED: 'CDX-E-MANIFEST-HASH-MALFORMED',
  MANIFEST_REFERENCE_MALFORMED: 'CDX-E-MANIFEST-REFERENCE-MALFORMED',
} as const;

export interface AssetFinding {
  code: string;
  /** Archive path or category the finding is about, for diagnostics only. */
  where: string;
  detail: string;
}

export interface AssetIndexResult {
  /**
   * Raw index text per category, exactly as stored — the shape
   * `DocumentParts.assetIndexes` takes. Only RESOLVABLE categories appear, so a caller
   * must check `unresolvable` before using it: `buildAssetMap` throws for a declared
   * category this map omits.
   */
  indexTexts: Record<string, string>;
  /**
   * The resolved archive-path → content-hash map, or null when it could not be built at
   * all (a `buildAssetMap` rejection). Built from the categories that loaded, so it is
   * usable for the resolvable ones even when another category is broken.
   */
  assetMap: ReadonlyMap<string, string> | null;
  /** Declared categories whose index could not be loaded or used. */
  unresolvable: ReadonlySet<string>;
  findings: AssetFinding[];
}

/** The archive path of a category's index file — the DERIVED location (05 §3.1). */
export function derivedIndexPath(category: string): string {
  return `assets/${category}/index.json`;
}

/**
 * The archive path of one index entry, built exactly as `buildAssetMap` builds it: the
 * category directory joined with the entry's `path`, then NORMALIZED (05 §3.2 matches "after
 * path normalization").
 *
 * The normalization is not cosmetic. `assets/images/../fonts/f.woff2` normalizes to
 * `assets/fonts/f.woff2`, which is the key `buildAssetMap` registers and the entry a
 * conformant archive actually stores. Building the presence and hash paths without it would
 * look for an archive entry that cannot exist, so a legitimate document using a dot segment
 * would earn a spurious missing-part finding AND have its asset hash silently skipped —
 * both failure directions from one omission.
 */
function assetArchivePath(category: string, path: string): string {
  return normalizePath(`assets/${category}/${path}`);
}

/**
 * The category a packaged-asset archive path belongs to (`assets/<category>/…`), or null
 * when the path is not category-rooted. Used to decide whether a dangling-looking asset
 * reference is actually just indeterminate.
 */
export function categoryOfAssetPath(normalizedPath: string): string | null {
  const parts = normalizedPath.split('/');
  return parts.length >= 3 && parts[0] === 'assets' && parts[1] !== '' ? parts[1] : null;
}

/**
 * Load, hash-verify and resolve every asset category `manifest.assets` declares.
 *
 * `entries` is the archive's central-directory entry set and `bytes` the raw archive, so
 * asset payloads can be inflated in memory. `load` is the caller's memoizing part loader —
 * shared so an index inflated here is not inflated again by the duplicate-key sweep.
 */
export function verifyAssetIndexes(
  manifest: Record<string, unknown>,
  entries: readonly ArchiveEntry[],
  bytes: Buffer,
  load: (path: string) => PartLoad,
): AssetIndexResult {
  const findings: AssetFinding[] = [];
  const indexTexts: Record<string, string> = {};
  const unresolvable = new Set<string>();

  const assets = manifest.assets;
  if (assets !== undefined && !isPlainObject(assets)) {
    // A PRESENT-but-mistyped `assets` block. Reported here because nothing else does: the
    // document layer never runs projectManifest (the reference adapter composes the archive
    // and document verdicts only), so without this the mistyped required field is silently
    // dropped while §5.4.2 rejects it.
    findings.push({
      code: ASSET_CODE.MANIFEST_REFERENCE_MALFORMED,
      where: 'manifest.assets',
      detail: 'manifest.assets is present but is not an object',
    });
  }
  if (!isPlainObject(assets)) {
    // Nothing to resolve, and an empty map is the correct basis: a document with no
    // registered assets resolves no packaged-asset reference.
    return { indexTexts, assetMap: new Map(), unresolvable, findings };
  }

  for (const category of Object.keys(assets)) {
    const declared = assets[category];
    const indexPath = derivedIndexPath(category);

    // 05 §3.1: the declared `index` MUST equal the derived path, and a divergence is a
    // REJECT (07 §5.4.2). It is reported, never obeyed — §4.3.1 builds asset paths from
    // the category key alone, so the read below stays on the derived path.
    // Compared after normalization, as 05 §3.1 and the §5.4.2 row require: `.` and `..`
    // segments are not a divergence, and REJECT is too severe a disposition to hang on a
    // spelling the specification treats as equal. Case-sensitive, per the same clause.
    // `normalizePath` also collapses EMPTY segments, which the cited rule does not mention;
    // that is unreachable for a schema-valid declaration (`relativePath` forbids them) and
    // errs toward not rejecting, which is the safe direction for the harshest disposition.
    if (
      isPlainObject(declared) &&
      typeof declared.index === 'string' &&
      normalizePath(declared.index) !== indexPath
    ) {
      findings.push({
        code: ASSET_CODE.ASSET_INDEX_PATH_DIVERGENT,
        where: category,
        detail: `manifest.assets["${category}"].index is "${declared.index}" but 05 section 3.1 requires it to equal the derived index path "${indexPath}"`,
      });
    }

    const index = load(indexPath);
    if (index.status === 'absent') {
      findings.push({
        code: ASSET_CODE.PART_MISSING_BOUND,
        where: indexPath,
        detail: `asset category "${category}" is declared but its index file is absent from the archive`,
      });
      unresolvable.add(category);
      continue;
    }
    if (index.status === 'unobtainable') {
      // The index is PRESENT and intact; this reader simply lacks the decoder for a method
      // §3.2 permits. The container layer already reports the entry integrity-indeterminate,
      // and §5.4.2 note 6 forbids the missing-part rows from firing — so nothing is added
      // here. The category is still unresolvable, which suspends its asset references and
      // the document-ID recompute rather than accusing the document of anything.
      unresolvable.add(category);
      continue;
    }
    if (index.status === 'defect') {
      // A CODED defect (duplicate keys) is the part-agnostic state-invariant REJECT the
      // caller's any-part sweep reports; `code: null` is the uncoded parse or decompression
      // failure this row owns. Either way the category cannot be resolved.
      if (index.code === null) {
        findings.push({
          code: ASSET_CODE.ASSET_INDEX_UNUSABLE,
          where: indexPath,
          detail: `asset category "${category}" has an index file that cannot be parsed`,
        });
      }
      unresolvable.add(category);
      continue;
    }
    // --- The index file's own hash (05 §8.1 step 3) --------------------------
    // Verified FIRST — before the index's structure is even examined — because §8.1 makes
    // it the anchor for every per-asset and per-variant hash the index carries: a signed
    // manifest projection binds this one hash (Security Extension §9.7), so the whole
    // category is tamper-evident through it. Checking it only for a well-formed index would
    // let a tampered one escape the row by ALSO being malformed.
    const declaredIndexHash = isPlainObject(declared) ? declared.hash : undefined;
    if (isValidContentHash(declaredIndexHash)) {
      const actual = hashOrNull(declaredIndexHash, index.bytes);
      if (actual !== null && actual !== declaredIndexHash) {
        findings.push({
          code: ASSET_CODE.ASSET_INDEX_HASH_MISMATCH,
          where: indexPath,
          detail: `asset index for category "${category}" hashes to ${actual}, not the declared ${declaredIndexHash}`,
        });
      }
    } else {
      // NO SILENT ESCAPE. Without this arm a category declaring a malformed hash, no hash at
      // all, or a non-object body simply skipped the comparison and the document loaded
      // clean — a one-character manifest edit disabling the anchor for the entire category's
      // tamper-evidence (05 §3.1, §8.1 step 3), which is the opposite of what hash-pinning
      // the index is for. `assetCategory` requires {count, totalSize, index, hash}
      // (manifest.schema.json), so this is §5.4.2's mistyped-required-field row, and it is
      // reported under the codes manifest-projection already throws for the same input.
      // NOT marked unresolvable: the index's CONTENTS are intact, so the asset map and the
      // document-ID basis are both still determinate. What is missing is the BINDING.
      findings.push({
        code: isPlainObject(declared) ? ASSET_CODE.MANIFEST_HASH_MALFORMED : ASSET_CODE.MANIFEST_REFERENCE_MALFORMED,
        where: `manifest.assets["${category}"]`,
        detail: isPlainObject(declared)
          ? `asset category "${category}" declares no well-formed index hash, so its index is bound by nothing`
          : `manifest.assets["${category}"] is not an object`,
      });
    }

    if (!isPlainObject(index.value) || !Array.isArray(index.value.assets)) {
      // `buildAssetMap` would skip this category silently, leaving an empty map that no
      // catch notices — the quiet failure this module exists to make loud.
      findings.push({
        code: ASSET_CODE.ASSET_INDEX_UNUSABLE,
        where: indexPath,
        detail: `asset category "${category}" has an index carrying no \`assets\` array`,
      });
      unresolvable.add(category);
      continue;
    }

    indexTexts[category] = index.text;

    // --- Each asset, and each image variant (05 §8.1 steps 1-4) --------------
    // A mismatched index hash does NOT stop this: the index's bytes exist and parse, so the
    // per-asset hashes it carries are still checkable, and reporting both defects is more
    // informative than reporting the outer one alone. It does mean a tampered index can
    // make honest assets look wrong — which is exactly why the index hash is reported too.
    for (const asset of index.value.assets) {
      if (!isPlainObject(asset)) continue;
      verifyAssetEntry(category, asset, entries, bytes, findings, conflictingPathsIn(category, index.value.assets));
    }
  }

  // `buildAssetMap` is the SINGLE definition of the path→hash mapping (canonicalize.ts), so
  // it is called rather than re-derived. It rejects an index whose entries carry a malformed
  // hash, two entries resolving to one archive path under different hashes, and a category
  // key that is not a valid path segment — each of which leaves the document's asset
  // resolution ambiguous, hence every category indeterminate.
  //
  // Called over only the categories that LOADED. `buildAssetMap` throws for a declared
  // category it was given no index for, which is the already-reported absent/unusable case;
  // letting it throw again here would report that one defect twice, the second time under a
  // code that misdescribes it ("present but unusable" for a file that is absent). Narrowing
  // `assets` keeps buildAssetMap authoritative while scoping it to what exists.
  const loadedAssets: Record<string, unknown> = {};
  for (const category of Object.keys(assets)) {
    if (!unresolvable.has(category)) loadedAssets[category] = assets[category];
  }
  let assetMap: ReadonlyMap<string, string> | null = null;
  try {
    assetMap = buildAssetMap({ ...manifest, assets: loadedAssets }, indexTexts);
  } catch (err) {
    if (!(err instanceof CanonicalizationError)) throw err;
    findings.push({
      code: ASSET_CODE.ASSET_INDEX_UNUSABLE,
      where: 'manifest.assets',
      detail: `the asset map could not be built: ${err.message}`,
    });
    for (const category of Object.keys(assets)) unresolvable.add(category);
    // Keep `indexTexts`' documented invariant true — only resolvable categories appear.
    // Inert today (no caller reads it once `assetsResolvable` is false), but this module's
    // whole thesis is that a wrong model of the asset map is what manufactures false
    // INTEGRITY-ERRORs, so a contract a future caller will trust must not be quietly false.
    for (const category of Object.keys(indexTexts)) delete indexTexts[category];
  }

  return { indexTexts, assetMap, unresolvable, findings };
}

/**
 * The archive paths this index registers more than once under DIFFERENT hashes.
 *
 * `buildAssetMap` rejects such an index outright — the reference would resolve
 * order-dependently — and that ambiguity is the whole defect, reported as
 * CDX-E-ASSET-INDEX-UNUSABLE. Comparing the bytes against each declaration in turn would
 * additionally report the loser as a byte-level ASSET-HASH-MISMATCH, which describes the
 * symptom rather than the cause: at most one of two conflicting declarations can match, so
 * a mismatch there is guaranteed and says nothing. A path repeated with the SAME hash is not
 * ambiguous and is not suppressed.
 */
function conflictingPathsIn(category: string, entries: readonly unknown[]): Set<string> {
  const byPath = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || typeof entry.hash !== 'string') continue;
    const archivePath = assetArchivePath(category, entry.path);
    const existing = byPath.get(archivePath);
    if (existing !== undefined && existing !== entry.hash) conflicting.add(archivePath);
    else byPath.set(archivePath, entry.hash);
  }
  return conflicting;
}

/** Verify one index entry's bytes, and those of every image variant it declares. */
function verifyAssetEntry(
  category: string,
  asset: Record<string, unknown>,
  entries: readonly ArchiveEntry[],
  bytes: Buffer,
  findings: AssetFinding[],
  conflictingPaths: ReadonlySet<string>,
): void {
  const label = typeof asset.id === 'string' ? asset.id : String(asset.path ?? '?');

  if (typeof asset.path === 'string') {
    const archivePath = assetArchivePath(category, asset.path);
    if (!hasEntry(entries, archivePath)) {
      // An `aliasOf` entry is exempt, and 05 §10.2 is explicit about why: it "marks that an
      // entry's bytes are identical to another entry's — a hint that storage tooling MAY keep
      // the bytes once". A document following that guidance stores one copy, so reporting the
      // alias's own path as missing would flag the specification's own worked example — and
      // at a row that escalates to INTEGRITY-ERROR in B3. The entry still resolves: §10.2
      // requires reference resolution to use "the entry's own `path` and `hash`" without
      // dereferencing `aliasOf`, which `buildAssetMap` does.
      if (asset.aliasOf === undefined) {
        // Otherwise the asset still RESOLVES — §4.3.1 binds the index's declared hash into
        // the document ID, not the bytes — so this is a missing hash-bound part (§5.4.2),
        // never a dangling reference. 05 §11.1 item 1 requires a referenced asset to exist.
        findings.push({
          code: ASSET_CODE.PART_MISSING_BOUND,
          where: archivePath,
          detail: `asset "${label}" in category "${category}" is listed in the index but absent from the archive`,
        });
      }
    } else if (isValidContentHash(asset.hash) && !conflictingPaths.has(archivePath)) {
      compareStoredHash(archivePath, asset.hash, entries, bytes, findings, `asset "${label}" in category "${category}"`);
    }
  }

  if (!Array.isArray(asset.variants)) return;
  for (const variant of asset.variants) {
    if (!isPlainObject(variant) || typeof variant.path !== 'string') continue;
    const variantPath = assetArchivePath(category, variant.path);
    if (!hasEntry(entries, variantPath)) {
      // 05 §4.3: "If a variant file is missing from the archive, implementations MUST fall
      // back to the full-resolution image. Missing variants SHOULD produce a warning but
      // MUST NOT prevent the image from being displayed." So this is NOT the escalating
      // missing-hash-bound-part row — the document renders correctly without it.
      findings.push({
        code: ASSET_CODE.ASSET_VARIANT_MISSING,
        where: variantPath,
        detail: `variant "${variant.path}" of asset "${label}" is listed in the index but absent from the archive`,
      });
      continue;
    }
    if (isValidContentHash(variant.hash) && !conflictingPaths.has(variantPath)) {
      // A variant that IS present must match its own hash: 05 §4.3 makes the variant, not
      // the parent, what a viewer actually sees, so an unbound swap would substitute
      // displayed content while the parent hash, the document ID and every signature still
      // verify.
      compareStoredHash(variantPath, variant.hash, entries, bytes, findings, `variant "${variant.path}" of asset "${label}"`);
    }
  }
}

/** Hash an archive entry's stored bytes and report a mismatch against `declared`. */
function compareStoredHash(
  archivePath: string,
  declared: string,
  entries: readonly ArchiveEntry[],
  bytes: Buffer,
  findings: AssetFinding[],
  label: string,
): void {
  const entry = findEntry(entries, archivePath);
  if (entry === undefined) return;
  let stored: Buffer;
  try {
    stored = inflateEntry(bytes, entry);
  } catch {
    // The bytes cannot be produced, so the asset hash is unverifiable — which is not a
    // mismatch, and reporting one would accuse a document of tampering when the reader simply
    // could not decode it.
    //
    // Staying silent here is honest because every such entry already draws a container-layer
    // finding — but NOT by the single mechanism an earlier version of this comment claimed.
    // The CRC pass does not see them all: it `continue`s before its try for a bomb-flagged
    // entry and for one whose local header is absent or name-mismatched. The accurate account
    // is that the routes are plural — a forbidden method via the central-directory sweep, an
    // undecodable or bomb entry via the CRC pass, and an absent/mismatched local header via
    // the LFH-CD-disagreement and data-outside-CD rows. Each is REJECT, and the container and
    // document verdicts compose MAX, so the defect reaches the document verdict without this
    // module double-reporting it under an asset code that would misdescribe it.
    return;
  }
  const actual = hashOrNull(declared, stored);
  if (actual !== null && actual !== declared) {
    findings.push({
      code: ASSET_CODE.ASSET_HASH_MISMATCH,
      where: archivePath,
      detail: `${label} hashes to ${actual}, not the declared ${declared}`,
    });
  }
}

/**
 * Digest `data` under the algorithm named by `declared`'s own prefix, or null when this
 * runtime cannot compute it (blake3). An uncomputable algorithm makes the hash
 * INDETERMINATE — not a mismatch and not clean — so the caller emits nothing, the same
 * treatment the content part's file hash gets (document-verdict.ts).
 */
function hashOrNull(declared: string, data: Buffer): string | null {
  try {
    return hashBytes(algorithmOf(declared), data);
  } catch (err) {
    if (!(err instanceof CanonicalizationError)) throw err;
    return null;
  }
}
