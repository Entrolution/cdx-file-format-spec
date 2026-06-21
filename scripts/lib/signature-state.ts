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
 * in §3.9 (trust anchoring), §3.11 (keyId resolution) and §7.4 (revocation),
 * which are the load-bearing half of the contract. They are **credential-path
 * agnostic**: each input is a verdict about *the signature's credential* — an
 * X.509 certificate chain (`x5c`) or a resolved keyId/DID key (`kid`) — computed
 * by the verifier before this function runs. The state machine therefore does not
 * branch on credential path; only the per-path *derivation* of each input differs.
 * E.g. a chain (or DID) with no path to a configured anchor — including a
 * self-signed chain or an unpinned self-certifying `did:key`/`did:jwk` — yields
 * `chainResult: 'untrusted'`; under an untrusted reference clock a *stapled* X.509
 * revocation response yields `revocationStatus: 'unknown'`.
 */

export type SignatureState = 'valid' | 'invalid' | 'expired' | 'revoked' | 'untrusted' | 'unknown';

export interface SignatureStateInputs {
  /**
   * The signed protected header is well-formed and self-consistent (§3.4): `alg`
   * is supported, `b64` is false, `crit` is exactly `["b64"]`, `sigT` is
   * well-formed and not in the future relative to the reference time, and the
   * header carries exactly one credential path that is internally consistent —
   *   • X.509: `x5c` present and the signed `x5t#S256` equals
   *     BASE64URL(SHA-256(DER(x5c[0]))) (§3.10); or
   *   • keyId, self-certifying (`did:key`/`did:jwk`): `kid` present and well-formed,
   *     with NO `jkt` (the key is encoded in `kid`); or
   *   • keyId, `did:web`: `kid` a well-formed `did:web` DID and `jkt` a
   *     syntactically valid base64url SHA-256 thumbprint (§3.11).
   * This is a header-SHAPE check only. It MUST NOT depend on DID resolution, key
   * availability, or whether a resolved key is usable with `alg`: for the
   * out-of-band `did:web` path those are unknowable at header-check time, and
   * folding them in here would misfire rule 1 to `invalid` on a mere network
   * failure. Key-unavailability is carried by `chainResult` (below), never here.
   */
  headerConsistent: boolean;
  /**
   * The JWS signature verifies under the credential's public key — the leaf
   * certificate `x5c[0]` (X.509), the key encoded in `kid` (self-certifying), or
   * the resolved verification method whose RFC 7638 thumbprint equals the signed
   * `jkt` (`did:web`, §3.11). For an out-of-band credential the verifier computes
   * this ONLY once that matching key is in hand; when no served key matches `jkt`
   * (resolution failed, key rotated away, or a different key is served) the
   * credential is key-unavailable and this input is NOT evaluated —
   * `chainResult: 'unknown'` is the sole carrier of that indeterminacy, so rule 1
   * never misfires to `invalid` on inability to resolve. A `false` here is a
   * genuine forgery: the matching key was obtained and the signature did not verify.
   */
  signatureVerifies: boolean;
  /**
   * The result of anchoring the credential to verifier-configured trust (§3.9,
   * §3.11): `anchored`, `untrusted`, or `unknown`.
   *   • X.509: `anchored` iff the `x5c` chain reaches a configured trust anchor;
   *     `unknown` iff it could not be evaluated (e.g. a missing intermediate).
   *   • self-certifying `did:key`/`did:jwk`: `anchored` iff the verifier pins the
   *     specific `kid`; otherwise `untrusted`.
   *   • `did:web`: `anchored` iff TLS-validated resolution succeeded, a served
   *     verification method's RFC 7638 thumbprint equals the signed `jkt`, AND the
   *     specific DID (or its exact domain) is pinned; unpinned → `untrusted`;
   *     resolution indeterminate, or no served key matches `jkt` (key-unavailable)
   *     → `unknown`. A DID *method* is never trusted wholesale.
   * In-document / in-`kid` / served material is never self-authorizing; the anchor
   * is always verifier-side.
   */
  chainResult: 'anchored' | 'untrusted' | 'unknown';
  /**
   * Credential revocation status (§7.4): `good`, `revoked`, or `unknown`.
   *   • X.509: per OCSP/CRL (a stapled response under an untrusted clock → `unknown`).
   *   • self-certifying `did:key`/`did:jwk`: no responder — governed by the pin, so a
   *     still-anchored key is `good` (an unpinned one is already `untrusted`).
   *   • `did:web`: `revoked` ONLY when the resolved DID document is explicitly
   *     deactivated (`deactivated: true`); otherwise `good`. A key that was rotated
   *     away or whose method is absent is key-unavailable, NOT `revoked` — that is
   *     `chainResult: 'unknown'` (above). `deactivated` is served by the same origin
   *     as the key, hence suppressible: advisory-grade, not a hard guarantee.
   */
  revocationStatus: 'good' | 'revoked' | 'unknown';
  /**
   * The reference time (a validated timestamp if present, else `sigT`) lies within
   * the credential's validity window [notBefore, notAfter]. A self-certifying
   * `did:key`/`did:jwk` key, and a `did:web` key, carry no validity window (their
   * lifecycle is rotation/deactivation), so this is `true` by the §3.11 no-window
   * rule — there is no interval to fall outside of.
   */
  signingTimeWithinValidity: boolean;
  /**
   * The credential is expired relative to the verification-time clock (now >
   * notAfter). A `did:key`/`did:jwk` or `did:web` key has no `notAfter`, so this is
   * `false` by the §3.11 no-window rule.
   */
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
 *  2. signed outside validity, provable via trusted time             → invalid
 *  3. credential could not be evaluated                              → unknown
 *  4. credential does not anchor to verifier-configured trust        → untrusted
 *  5. credential revoked                                             → revoked
 *  6. revocation indeterminate                                       → unknown
 *  7. credential expired at verification time                        → expired
 *  8. otherwise                                                      → valid
 */
export function evaluateSignatureState(i: SignatureStateInputs): SignatureState {
  // The signature itself must be a real, well-formed signature before anything
  // about trust is meaningful — a forged/corrupt signature is `invalid`, never
  // merely `untrusted`.
  if (!i.headerConsistent || !i.signatureVerifies) return 'invalid';

  // Signed outside the credential's own validity window, and a trusted clock
  // proves it: the signature was never legitimately produced. (Cannot fire until a
  // validated-timestamp path exists, since reference time is otherwise untrusted.)
  if (i.referenceTimeTrusted && !i.signingTimeWithinValidity) return 'invalid';

  // Trust path. Revocation is only meaningful relative to an anchored credential,
  // so an unevaluable or unanchored credential is decided here, before revocation.
  if (i.chainResult === 'unknown') return 'unknown';
  if (i.chainResult === 'untrusted') return 'untrusted';

  // Revocation (credential is anchored). `unknown` MUST NOT be reported as `valid`.
  if (i.revocationStatus === 'revoked') return 'revoked';
  if (i.revocationStatus === 'unknown') return 'unknown';

  // Validity window. A currently-expired (but legitimately-signed) credential is
  // `expired`; a validated timestamp — specified later — is what would let a
  // richer profile keep this `valid`.
  if (i.certCurrentlyExpired) return 'expired';

  return 'valid';
}
