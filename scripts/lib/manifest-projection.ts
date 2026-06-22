/**
 * Reference projector for the CDX signed **manifest projection**.
 *
 * A signature today binds only the document ID (the content hash), so the
 * manifest itself — its lifecycle state, the content/presentation part hashes,
 * the required-extension set, and the lineage — is unauthenticated: an attacker
 * can alter any of it without breaking a signature. The manifest projection is
 * the canonical, signable representation of those security-relevant manifest
 * declarations; a scoped signature covers it via `scope.manifest`
 * (spec/extensions/security/README.md §9.7).
 *
 * Like ./canonicalize.ts (the document-ID canonicalizer) this is a *shared
 * library*: the example/KAT checks and any signing/verifying tooling resolve the
 * projection through this one module, so they cannot drift. It deliberately
 * reuses canonicalize.ts's primitives — strict parsing (duplicate-key
 * rejection), the pinned RFC 8785 (JCS) serializer, and the stored-byte
 * invariants — so the projection's bytes obey the exact same rules as the
 * document ID's.
 *
 * The projection is an explicit *transform* of `manifest.json`; the stored file
 * is never modified. It is **envelope-agnostic**: the bytes `serializeProjection`
 * produces are the payload a future signature envelope (the increment that
 * fixes the trust-anchor model) signs, independent of how that envelope is
 * shaped.
 *
 * What the projection BINDS: `cdx` (spec version), `state`, the content part
 * `{path, hash}`, the `presentation[]` declaration (`{type, path, hash}` plus the
 * default-selection flag), the `extensions[]` set (`{id, version, required}`,
 * plus `config` for a required extension), `lineage` verbatim, and the
 * `signaturePolicy` required-signer set (§3.12) — the credentials that bind the
 * signature SET against stripping/downgrade.
 *
 * What it does NOT bind (negative coverage, by design — see the spec §9.8):
 *  - The document ID / content semantics — carried separately by
 *    `scope.documentId` (the projection never repeats it).
 *  - Embedded fonts and other non-content assets (excluded from the document ID
 *    by design; a later increment may bind them).
 *  - The *bytes* of path-only parts (metadata, provenance, phantoms,
 *    annotations) and of the `security` block — only `content` and
 *    `presentation[]` carry hashes in the manifest.
 *  - Signatures OUTSIDE the declared required set: the `signaturePolicy` binds
 *    only the *declared required* signers, so stripping an optional signature,
 *    signing order, and late-joiners are not detected (§3.12, §9.8). A document
 *    that declares no `signaturePolicy` has no set integrity at all.
 *  - Administrative fields with no integrity meaning: `created`, `modified`,
 *    `hashAlgorithm` (redundant with the document-ID prefix).
 */

import {
  parseStrictJson,
  jcsOf,
  validateStoredByteInvariants,
  isPlainObject,
  isValidContentHash,
  CanonicalizationError,
} from './canonicalize.js';

/**
 * The manifest lifecycle states (mirrors manifest.schema.json). The projector
 * validates `state` against this set so a bogus state fails closed here rather
 * than being bound into a signature — the reference library does not assume the
 * manifest was schema-validated upstream.
 */
const MANIFEST_STATES = new Set(['draft', 'review', 'frozen', 'published']);

/** Order two already-projected array elements by their JCS serialization. */
function byJcs(a: unknown, b: unknown): number {
  const ja = jcsOf(a);
  const jb = jcsOf(b);
  return ja < jb ? -1 : ja > jb ? 1 : 0;
}

/**
 * The authenticated-identity kinds a required-signer entry may carry (§3.12),
 * each mapping to exactly one credential path: `did` → the keyId path's `kid`;
 * `x5tS256` → the X.509 path's leaf-certificate thumbprint; `jkt` → the
 * WebAuthn path's RFC 7638 public-key thumbprint.
 */
const REQUIRED_SIGNER_KINDS = ['did', 'x5tS256', 'jkt'] as const;

/**
 * Validate and project one required-signer entry. An entry MUST carry exactly
 * one identity kind (`did` | `x5tS256` | `jkt`) holding a non-empty string and
 * no other member — any other shape fails closed here rather than being bound
 * into a signature. The verifier matches each kind against the corresponding
 * credential path only, so the kind discriminator also prevents cross-path
 * confusion (e.g. a WebAuthn key satisfying a keyId slot).
 */
function projectRequiredSigner(entry: unknown): Record<string, unknown> {
  if (!isPlainObject(entry)) {
    throw new CanonicalizationError('each requiredSigners entry must be an object');
  }
  const present = REQUIRED_SIGNER_KINDS.filter((k) => entry[k] !== undefined);
  if (present.length !== 1) {
    throw new CanonicalizationError(`each requiredSigners entry must carry exactly one of: ${REQUIRED_SIGNER_KINDS.join(', ')}`);
  }
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new CanonicalizationError(`a requiredSigners entry must have no members beyond its identity kind (found: ${keys.join(', ')})`);
  }
  const kind = present[0];
  const value = entry[kind];
  if (typeof value !== 'string' || value === '') {
    throw new CanonicalizationError(`requiredSigners ${kind} must be a non-empty string`);
  }
  return { [kind]: value };
}

/**
 * Build the canonical manifest projection from the raw text of `manifest.json`.
 * Returns a plain object; serialize it with `serializeProjection` to obtain the
 * signable bytes.
 *
 * Throws `CanonicalizationError` when the manifest cannot yield a projection —
 * notably when `id` is `"pending"` (a draft has no fixed document identity, so a
 * projection over it would be meaningless and is forbidden).
 */
export function projectManifest(manifestText: string): Record<string, unknown> {
  const manifest = parseStrictJson(manifestText);
  if (!isPlainObject(manifest)) {
    throw new CanonicalizationError('manifest is not a JSON object');
  }

  // A projection is only defined once the document identity is fixed. A draft
  // carries `id: "pending"` (07 §5.3) and is never signed; forbid it explicitly
  // rather than project an unstable manifest.
  if (manifest.id === 'pending') {
    throw new CanonicalizationError('manifest id is "pending"; a manifest projection is undefined until the document id is assigned');
  }

  const projection: Record<string, unknown> = {};

  // --- cdx (spec version) — always present (manifest required field) ---------
  if (typeof manifest.cdx !== 'string') {
    throw new CanonicalizationError('manifest.cdx must be a string');
  }
  projection.cdx = manifest.cdx;

  // --- state (lifecycle) — always present ------------------------------------
  if (typeof manifest.state !== 'string' || !MANIFEST_STATES.has(manifest.state)) {
    throw new CanonicalizationError(`manifest.state must be one of: ${[...MANIFEST_STATES].join(', ')}`);
  }
  projection.state = manifest.state;

  // --- content {path, hash} — always present; the content file's integrity ----
  const content = manifest.content;
  if (!isPlainObject(content) || typeof content.path !== 'string' || typeof content.hash !== 'string') {
    throw new CanonicalizationError('manifest.content must be an object with string path and hash');
  }
  if (!isValidContentHash(content.hash)) {
    throw new CanonicalizationError(`manifest.content.hash "${content.hash}" is malformed`);
  }
  projection.content = { path: content.path, hash: content.hash };

  // --- presentation[] (optional) — the presentation *declaration* -------------
  // Binds each presentation manifest's {type, path, hash} plus which one is the
  // default. This authenticates the manifest's selection of presentation parts;
  // it does NOT attest visual rendering (precise-layout attestation remains the
  // separate `scope.layouts` mechanism). The array is author-ordered, so it is
  // sorted by JCS to a canonical order; the default-selection is bound as a flag
  // present only on the default entry (no default-value materialization).
  const presentation = manifest.presentation;
  if (Array.isArray(presentation) && presentation.length > 0) {
    const items = presentation.map((entry) => {
      if (!isPlainObject(entry) || typeof entry.type !== 'string' || typeof entry.path !== 'string' || typeof entry.hash !== 'string') {
        throw new CanonicalizationError('each manifest.presentation[] entry must have string type, path and hash');
      }
      if (!isValidContentHash(entry.hash)) {
        throw new CanonicalizationError(`presentation "${entry.path}" has a malformed hash "${entry.hash}"`);
      }
      const projected: Record<string, unknown> = { type: entry.type, path: entry.path, hash: entry.hash };
      if (entry.default === true) projected.default = true;
      return projected;
    });
    items.sort(byJcs);
    for (let i = 1; i < items.length; i++) {
      if (jcsOf(items[i]) === jcsOf(items[i - 1])) {
        throw new CanonicalizationError('duplicate manifest.presentation[] entry');
      }
    }
    projection.presentation = items;
  }

  // --- extensions[] (optional) — the required-extension set -------------------
  // Binds {id, version, required}. `config` is bound only for a *required*
  // extension: a required extension's configuration can change how the document
  // is interpreted, so it is part of what a signature must attest; a
  // non-required extension's config is advisory and left out.
  const extensions = manifest.extensions;
  if (Array.isArray(extensions) && extensions.length > 0) {
    const seen = new Set<string>();
    const items = extensions.map((entry) => {
      if (!isPlainObject(entry) || typeof entry.id !== 'string' || typeof entry.version !== 'string' || typeof entry.required !== 'boolean') {
        throw new CanonicalizationError('each manifest.extensions[] entry must have a string id, string version and boolean required');
      }
      if (seen.has(entry.id)) {
        throw new CanonicalizationError(`duplicate extension id "${entry.id}"`);
      }
      seen.add(entry.id);
      const projected: Record<string, unknown> = { id: entry.id, version: entry.version, required: entry.required };
      if (entry.required === true && entry.config !== undefined) {
        projected.config = entry.config; // semantics-affecting config of a required extension
      }
      return projected;
    });
    items.sort(byJcs);
    projection.extensions = items;
  }

  // --- lineage (optional) — bound verbatim -----------------------------------
  // The whole lineage object (parent, ancestors, version, depth, branch,
  // mergedFrom, note) is security-relevant provenance, so it is bound as
  // authored. Explicit `null` (e.g. `parent: null`) is preserved; an absent
  // lineage is omitted (absent ≠ a present lineage with null fields).
  if (manifest.lineage !== undefined && manifest.lineage !== null) {
    if (!isPlainObject(manifest.lineage)) {
      throw new CanonicalizationError('manifest.lineage must be an object');
    }
    projection.lineage = manifest.lineage;
  }

  // --- signaturePolicy (optional) — the required-signer set (§3.12) -----------
  // Binds the signature SET against stripping/downgrade: the declared required
  // signers ride in the signed projection, so any manifest-covering signature
  // attests them, and removing a required signer is detectable while any
  // signature survives. Each entry names a credential in AUTHENTICATED terms
  // (one of a keyId `did`, an X.509 `x5tS256` thumbprint, or a WebAuthn `jkt`
  // thumbprint) — never an advisory signer field. An empty required-signer set
  // is forbidden, so "absent policy" and "empty policy" are not both
  // expressible; an absent policy is omitted (a document with no policy has no
  // set integrity — surfaced as a verifier-side warning, §3.12, not bound here).
  if (manifest.signaturePolicy !== undefined && manifest.signaturePolicy !== null) {
    const policy = manifest.signaturePolicy;
    if (!isPlainObject(policy)) {
      throw new CanonicalizationError('manifest.signaturePolicy must be an object');
    }
    const required = policy.requiredSigners;
    if (!Array.isArray(required) || required.length === 0) {
      throw new CanonicalizationError('manifest.signaturePolicy.requiredSigners must be a non-empty array');
    }
    const items = required.map((entry) => projectRequiredSigner(entry));
    items.sort(byJcs);
    for (let i = 1; i < items.length; i++) {
      if (jcsOf(items[i]) === jcsOf(items[i - 1])) {
        throw new CanonicalizationError('duplicate manifest.signaturePolicy.requiredSigners entry');
      }
    }
    projection.signaturePolicy = { requiredSigners: items };
  }

  // The projected bytes obey the same stored-byte invariants as the document ID
  // (NFC, well-formed Unicode, safe integers) — validate, never normalize.
  validateStoredByteInvariants(projection);

  return projection;
}

/** Serialize a projection to its canonical RFC 8785 (JCS) bytes — the signable form. */
export function serializeProjection(projection: unknown): string {
  return jcsOf(projection);
}

/**
 * Convenience: project `manifest.json` text straight to its canonical JCS bytes.
 */
export function projectManifestToJcs(manifestText: string): string {
  return serializeProjection(projectManifest(manifestText));
}
