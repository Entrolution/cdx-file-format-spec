/**
 * Reference signature-state evaluator for the CDX security extension
 * (Security Extension §3.8). This turns the `signatureState` vocabulary
 * (`valid|invalid|expired|revoked|untrusted|unknown`) from a meaning table into
 * executable **production rules**.
 *
 * It is a pure function of the ABSTRACT verdicts a real verifier computes — it
 * runs no PKI itself (no chain building, no trust store, no OCSP). A spec-repo
 * gate cannot run real PKI; what it CAN do is pin, once and unambiguously, how a
 * conformant verifier must combine those verdicts into a state, so two
 * implementations cannot disagree on the outcome given the same observations.
 *
 * The inputs are bound to observable facts by the normative *derivation rules*
 * in §3.9 (trust anchoring) and §7.4 (revocation), which are the load-bearing
 * half of the contract: e.g. a chain with no path to a configured trust anchor
 * (including a self-signed chain) yields `chainResult: 'untrusted'`, and under an
 * untrusted reference clock a *stapled* revocation response yields
 * `revocationStatus: 'unknown'`.
 */

export type SignatureState = 'valid' | 'invalid' | 'expired' | 'revoked' | 'untrusted' | 'unknown';

export interface SignatureStateInputs {
  /**
   * The signed protected header is well-formed and self-consistent: `alg` is
   * supported, `b64` is false, `crit` is exactly `["b64"]`, `x5c` is present, the
   * signed `x5t#S256` equals BASE64URL(SHA-256(DER(x5c[0]))), and `sigT` is
   * well-formed and not in the future relative to the reference time (§3.10).
   */
  headerConsistent: boolean;
  /** The JWS signature verifies under the public key of the leaf certificate x5c[0]. */
  signatureVerifies: boolean;
  /**
   * The result of validating the x5c chain against the verifier-configured trust
   * store (§3.9): `anchored` (a path to a configured anchor), `untrusted` (no such
   * path — including self-signed), or `unknown` (the chain could not be evaluated).
   */
  chainResult: 'anchored' | 'untrusted' | 'unknown';
  /**
   * Certificate revocation status (§7.4): `good`, `revoked`, or `unknown`
   * (indeterminate — e.g. an unreachable responder, or a stapled response whose
   * freshness cannot be established under an untrusted clock).
   */
  revocationStatus: 'good' | 'revoked' | 'unknown';
  /** The reference time (a validated timestamp if present, else `sigT`) lies within [notBefore, notAfter]. */
  signingTimeWithinValidity: boolean;
  /** The certificate is expired relative to the verification-time clock (now > notAfter). */
  certCurrentlyExpired: boolean;
  /**
   * The reference time came from a validated trusted timestamp rather than the
   * self-asserted `sigT`. Always false until timestamp validation is specified
   * (a later increment); a forward-compatible hook.
   */
  referenceTimeTrusted: boolean;
}

/**
 * Evaluate a single signature's state (§3.8). The result is per-signature and
 * carries NO meaning about the completeness of the signature set (anti-strip /
 * anti-downgrade is a separate, later concern).
 *
 * Precedence (first match wins):
 *  1. bad header or non-verifying signature                          → invalid
 *  2. signed outside the cert's validity, provable via trusted time  → invalid
 *  3. chain could not be evaluated                                   → unknown
 *  4. chain does not anchor to a trust store                         → untrusted
 *  5. certificate revoked                                            → revoked
 *  6. revocation indeterminate                                       → unknown
 *  7. certificate expired at verification time                       → expired
 *  8. otherwise                                                      → valid
 */
export function evaluateSignatureState(i: SignatureStateInputs): SignatureState {
  // The signature itself must be a real, well-formed signature before anything
  // about trust is meaningful — a forged/corrupt signature is `invalid`, never
  // merely `untrusted`.
  if (!i.headerConsistent || !i.signatureVerifies) return 'invalid';

  // Signed outside the certificate's own lifetime, and a trusted clock proves
  // it: the signature was never legitimately produced. (Cannot fire until a
  // validated-timestamp path exists, since reference time is otherwise untrusted.)
  if (i.referenceTimeTrusted && !i.signingTimeWithinValidity) return 'invalid';

  // Trust path. Revocation is only meaningful relative to an anchored chain, so
  // an unevaluable or unanchored chain is decided here, before revocation.
  if (i.chainResult === 'unknown') return 'unknown';
  if (i.chainResult === 'untrusted') return 'untrusted';

  // Revocation (chain is anchored). `unknown` MUST NOT be reported as `valid`.
  if (i.revocationStatus === 'revoked') return 'revoked';
  if (i.revocationStatus === 'unknown') return 'unknown';

  // Validity window. A currently-expired (but legitimately-signed) certificate is
  // `expired`; a validated timestamp — specified later — is what would let a
  // richer profile keep this `valid`.
  if (i.certCurrentlyExpired) return 'expired';

  return 'valid';
}
