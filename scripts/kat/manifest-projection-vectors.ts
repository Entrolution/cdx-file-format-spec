/**
 * Known-answer test (KAT) vectors for the signed manifest projection and the
 * scoped-signature serialization.
 *
 * As with the document-ID vectors, each `expectedJcs` is the canonical RFC 8785
 * (JCS) byte string a faithful projector/serializer MUST produce, and
 * `expectedSha256` is the SHA-256 of those exact bytes computed by an
 * independent serializer (Python's `json` + `hashlib`, NOT this repo's
 * `canonicalize` package). The gate (check-manifest-projection.ts) asserts the
 * implementation reproduces BOTH — so a transform or serializer bug is caught
 * against an independent oracle, not snapshotted.
 *
 * Repeated-character hashes are built with `sha()` so digest lengths are exact
 * (64 hex for sha256) and identical between a vector's input and its expected
 * output; the `expectedSha256` anchors the true structure regardless.
 *
 * `scopeVectors` pin the EXISTING `JCS(scope)` signing construction
 * (spec/extensions/security/README.md §9.5) — which until now had no
 * known-answer test at all — before `scope.manifest` extends it.
 *
 * Typed loader over `conformance/vectors/manifest-*.json`, which are the source
 * of truth. `local` expectations are NOT published — they assert on this
 * implementation's English prose, which no third party can be held to — so they
 * live here and are merged back by vector name at load time. That makes the
 * export boundary structural: there is no field to forget to strip.
 */

import { loadVectors, withLocal } from '../lib/conformance-vectors.js';

export interface ProjectionVector {
  name: string;
  description: string;
  /** Raw JSON text of a manifest.json (the projector's input contract). */
  manifest: string;
  /** Hand-specified canonical JCS of the projection the manifest yields. */
  expectedJcs: string;
  /** sha256 of the UTF-8 bytes of expectedJcs (computed out-of-band). */
  expectedSha256: string;
}

export interface ScopeVector {
  name: string;
  description: string;
  /** A signature `scope` object whose JCS bytes are what a signature signs. */
  scope: unknown;
  expectedJcs: string;
  expectedSha256: string;
}

export interface ErrorVector {
  name: string;
  description: string;
  manifest: string;
  /**
   * PORTABLE expectations — the only part exported to the conformance suite.
   * Everything an external implementation can be held to lives here.
   */
  expect: {
    /** Stable defect code (`conformance/errors.json`), which carries the
     * normative disposition for this defect class. */
    code: string;
  };
  /**
   * NON-PORTABLE, this implementation only — never exported. Nesting (rather
   * than a sibling field) makes the export boundary structural: the exporter
   * emits `expect` and drops `local`, so a future non-portable field cannot
   * leak into the published suite by being forgotten from a denylist.
   */
  local: {
    /** Substring the message must contain. Pins the specific throw site so a
     * code cannot silently start being emitted from somewhere else. */
    messageIncludes: string;
    /**
     * Stable label of the guard this vector targets. REQUIRED only when two
     * vectors deliberately exercise different branches of the SAME guard and
     * therefore share a (code, messageIncludes) pair; declaring it marks the
     * sharing intentional, so accidental sharing across different sites still
     * fails the gate.
     */
    site?: string;
  };
}

/**
 * This-implementation-only expectations, merged by vector name. `messageIncludes`
 * pins the throw site so a code cannot silently start being emitted elsewhere;
 * `site` marks two vectors that deliberately exercise one guard. `withLocal`
 * throws if a vector has no entry, so a new vector cannot lose its pin.
 */
const ERROR_LOCALS: Record<string, { messageIncludes: string; site?: string }> = {
  "pending-id-forbidden": {
    messageIncludes: "pending"
  },
  "malformed-content-hash": {
    messageIncludes: "manifest.content.hash"
  },
  "duplicate-extension-id": {
    messageIncludes: "duplicate extension id"
  },
  "unknown-state-rejected": {
    messageIncludes: "manifest.state must be one of"
  },
  "duplicate-required-signer": {
    messageIncludes: "duplicate manifest.signaturePolicy.requiredSigners"
  },
  "empty-required-signers": {
    messageIncludes: "must be a non-empty array"
  },
  "required-signer-two-kinds": {
    messageIncludes: "exactly one of",
    site: "projectRequiredSigner:exactly-one-kind"
  },
  "config-file-conflicting-hash": {
    messageIncludes: "config file \""
  },
  "asset-index-missing-hash": {
    messageIncludes: "index hash"
  },
  "malformed-cdx-version": {
    messageIncludes: "version string"
  },
  "presentation-unknown-type": {
    messageIncludes: "is not one of"
  },
  "presentation-traversal-path": {
    messageIncludes: "manifest.presentation[] path"
  },
  "required-signer-malformed-did": {
    messageIncludes: "malformed for its identity kind"
  },
  "access-control-malformed-hash": {
    messageIncludes: "manifest.security.accessControl hash"
  },
  "access-control-traversal-path": {
    messageIncludes: "manifest.security.accessControl path"
  },
  "access-control-reference-malformed": {
    messageIncludes: "must be a {path, hash} reference"
  },
  "required-signer-zero-kinds": {
    messageIncludes: "exactly one of",
    site: "projectRequiredSigner:exactly-one-kind"
  }
};

export const projectionVectors: ProjectionVector[] = loadVectors<ProjectionVector>('manifest-projection');
export const scopeVectors: ScopeVector[] = loadVectors<ScopeVector>('manifest-scope');
export const errorVectors = withLocal(loadVectors<ErrorVector>('manifest-projection-errors'), ERROR_LOCALS);
