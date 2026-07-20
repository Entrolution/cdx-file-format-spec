/**
 * Reference signature-SET evaluator for the CDX security extension
 * (Security Extension §3.12). Where `evaluateSignatureState` (§3.8) decides one
 * signature in isolation, this decides a DOCUMENT-LEVEL question the per-
 * signature machine deliberately cannot answer: is the signature *set* complete,
 * or has a required signature been stripped / downgraded?
 *
 * It is layered strictly ABOVE `evaluateSignatureState`, whose 8-rule body stays
 * byte-for-byte unchanged: this function consumes the per-signature states that
 * machine already produced (plus each present signature's authenticated
 * identity) and the required-signer set carried in the *signed* manifest
 * projection (`scope.manifest.signaturePolicy`, §9.7). Because the required set
 * rides in bytes every manifest-covering signature signs, removing a required
 * signer is detectable while any such signature survives.
 *
 * Like `evaluateSignatureState` it is a pure function of ABSTRACT verdicts a
 * real verifier computes — it runs no PKI/DID resolution and does no thumbprint
 * computation itself. A spec-repo gate cannot execute a trust store; what it CAN
 * do is pin, once and unambiguously, how a conformant verifier combines those
 * verdicts into a set-integrity outcome, so two implementations cannot disagree.
 *
 * The load-bearing normative rules this encodes (§3.12):
 *  - A required signer is satisfied ONLY by a present signature that (i) is on
 *    the matching credential PATH, (ii) matches the entry's authenticated
 *    identity, and (iii) reached state `valid`. `valid` already subsumes
 *    "anchored + not-revoked + not-expired", so an `untrusted`/`unknown`/
 *    `expired`/`revoked`/`invalid` signature never satisfies a slot.
 *  - Matching is PATH-DISCRIMINATED: a `did` entry matches only the keyId path,
 *    `x5tS256` only X.509, `jkt` only WebAuthn. This is what stops a WebAuthn
 *    key whose RFC 7638 thumbprint collides with a did:web key from satisfying
 *    the did:web slot (the cross-path confusion the design forbids).
 *  - A required entry is NEVER a trust anchor: an entry naming an un-pinned
 *    credential can at best produce an `untrusted` present signature, which does
 *    not satisfy it — so such a document is *unverifiable*, not *trusted*.
 */

import type { SignatureState } from './signature-state.js';

export class SignatureSetError extends Error {
  /** Stable defect identifier from the conformance vocabulary
   * (`conformance/errors.json`); diagnostics only, never normativity —
   * see CanonicalizationError in ./canonicalize.ts. */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'SignatureSetError';
    this.code = code;
  }
}

/** A required-signer entry (§3.12): exactly one authenticated-identity kind. */
export type RequiredSigner = { did: string } | { x5tS256: string } | { jkt: string };

/** The credential path of a present signature. */
export type CredentialPath = 'x509' | 'keyId' | 'webauthn';

/**
 * The per-signature verdict a verifier has ALREADY computed — the abstract
 * inputs to set evaluation. `identity` is the AUTHENTICATED identifier for the
 * signature's path, derived by the verifier before this runs:
 *   • keyId    → the `kid`, fragment-stripped (the §3.11 pin form);
 *   • X.509    → the leaf-certificate `x5t#S256` thumbprint;
 *   • WebAuthn → the RFC 7638 thumbprint of the COSE `publicKey`.
 * `state` is this signature's per-signature state from `evaluateSignatureState`.
 */
export interface PresentSignerVerdict {
  path: CredentialPath;
  identity: string;
  state: SignatureState;
}

export interface RequiredSignersResult {
  /** True iff every required signer is satisfied by a present `valid` signature. */
  satisfied: boolean;
  /** The required entries with no satisfying present `valid` signature (stripped/downgraded). */
  missing: RequiredSigner[];
}

/**
 * Map a required-signer entry to the credential path and authenticated identity
 * it must be matched against. Exactly one identity kind is permitted; any other
 * shape fails closed (the projector enforces this upstream, but a reference
 * combinator must not trust its input was validated).
 */
export function requiredSignerMatcher(r: RequiredSigner): { path: CredentialPath; identity: string } {
  const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';
  const rec = r as Record<string, unknown>;
  const kinds = (['did', 'x5tS256', 'jkt'] as const).filter((k) => rec[k] !== undefined);
  if (kinds.length !== 1 || Object.keys(rec).length !== 1) {
    throw new SignatureSetError('required-signer entry must carry exactly one identity kind (did | x5tS256 | jkt)');
  }
  const kind = kinds[0];
  if (!isStr(rec[kind])) {
    throw new SignatureSetError(`required-signer ${kind} must be a non-empty string`);
  }
  const identity = rec[kind] as string;
  if (kind === 'did') return { path: 'keyId', identity };
  if (kind === 'x5tS256') return { path: 'x509', identity };
  return { path: 'webauthn', identity };
}

/**
 * Evaluate signature-set integrity against the declared required-signer set
 * (§3.12). Returns whether every required signer is satisfied and, if not,
 * which entries are missing (the stripped/downgraded set).
 *
 * The caller invokes this ONLY when the signed projection declares a
 * `signaturePolicy` (an absent policy is the verifier's "MUST warn" case, not a
 * stripping verdict). An empty `required` is vacuously satisfied, but the
 * projector forbids an empty set, so it does not arise from a real document.
 *
 * Idempotent in `present`: two present signatures matching one required entry
 * still satisfy it once; because required entries are de-duplicated by identity
 * upstream and a signature carries exactly one path+identity, a present
 * signature can satisfy at most one entry — there is no double-counting.
 */
export function evaluateRequiredSigners(
  present: PresentSignerVerdict[],
  required: RequiredSigner[],
): RequiredSignersResult {
  const missing: RequiredSigner[] = [];
  for (const entry of required) {
    const { path, identity } = requiredSignerMatcher(entry);
    const satisfied = present.some(
      (p) => p.path === path && p.identity === identity && p.state === 'valid',
    );
    if (!satisfied) missing.push(entry);
  }
  return { satisfied: missing.length === 0, missing };
}
