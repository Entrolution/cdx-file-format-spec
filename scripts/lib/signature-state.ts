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
 * in §3.9 (trust anchoring), §3.11 (keyId resolution), §6 (WebAuthn) and §7.4
 * (revocation), which are the load-bearing half of the contract. They are
 * **credential-path agnostic**: each input is a verdict about *the signature's
 * credential* — an X.509 chain, a resolved keyId/DID key, or a WebAuthn COSE key —
 * computed by the verifier before this function runs. The state machine therefore does not
 * branch on credential path; only the per-path *derivation* of each input differs.
 * E.g. a chain (or DID) with no path to a configured anchor — including a
 * self-signed chain or an unpinned self-certifying `did:key`/`did:jwk` — yields
 * `chainResult: 'untrusted'`; under an untrusted reference clock a *stapled* X.509
 * revocation response yields `revocationStatus: 'unknown'`.
 */

export type SignatureState = 'valid' | 'invalid' | 'expired' | 'revoked' | 'untrusted' | 'unknown';

export interface SignatureStateInputs {
  /**
   * The signature's structural binding is well-formed and self-consistent — for
   * the JWS paths the signed protected header (§3.4), for WebAuthn the assertion
   * and its challenge binding (§6):
   *   • JWS common: `alg` supported, `b64` false, `crit` exactly `["b64"]`, `sigT`
   *     well-formed and not after the reference time; plus exactly one credential
   *     path that is internally consistent —
   *       – X.509: `x5c` present and signed `x5t#S256` == BASE64URL(SHA-256(DER(x5c[0]))) (§3.10);
   *       – keyId self-certifying (`did:key`/`did:jwk`): `kid` well-formed, NO `jkt`;
   *       – keyId `did:web`: `kid` a well-formed `did:web` DID and `jkt` a valid base64url SHA-256 thumbprint (§3.11).
   *   • WebAuthn (§6): the assertion is well-formed, `clientDataJSON.type == "webauthn.get"`,
   *     the parsed `challenge` equals BASE64URL(SHA-256(JCS(scope))), `algorithm`
   *     agrees with `publicKey`, and the User-Present (UP) flag is set (a `get`
   *     assertion with UP=0 is malformed).
   * This is a SHAPE/binding check only. For `did:web` it MUST NOT depend on DID
   * resolution or key availability (folding those in would misfire rule 1 to
   * `invalid` on a network failure); key-unavailability is carried by `chainResult`.
   * For WebAuthn it is binding integrity ONLY — origin/rpId/UV *policy* is NOT here
   * (that is anchoring; see `chainResult`), so a genuine assertion that fails policy
   * is `untrusted`, never `invalid`.
   */
  headerConsistent: boolean;
  /**
   * The signature verifies under the credential's public key — the leaf certificate
   * `x5c[0]` (X.509), the key encoded in `kid` (self-certifying), the resolved
   * verification method whose RFC 7638 thumbprint equals the signed `jkt` (`did:web`,
   * §3.11), or, for WebAuthn, the assertion signature over
   * `authenticatorData || SHA-256(clientDataJSON)` under the COSE `publicKey` (§6).
   * For an out-of-band credential the verifier computes this ONLY once the matching
   * key is in hand; when no served key matches `jkt` (resolution failed, key rotated
   * away, or a different key is served) the credential is key-unavailable and this
   * input is NOT evaluated — `chainResult: 'unknown'` is the sole carrier of that
   * indeterminacy, so rule 1 never misfires to `invalid` on inability to resolve. A
   * `false` here is a genuine forgery: the matching key was obtained and the
   * signature did not verify.
   */
  signatureVerifies: boolean;
  /**
   * The result of anchoring the credential to verifier-configured trust (§3.9,
   * §3.11, §6): `anchored`, `untrusted`, or `unknown`.
   *   • X.509: `anchored` iff the `x5c` chain reaches a configured trust anchor;
   *     `unknown` iff it could not be evaluated (e.g. a missing intermediate).
   *   • self-certifying `did:key`/`did:jwk`: `anchored` iff the verifier pins the
   *     specific `kid`; otherwise `untrusted`.
   *   • `did:web`: `anchored` iff TLS-validated resolution succeeded, a served
   *     verification method's RFC 7638 thumbprint equals the signed `jkt`, AND the
   *     specific DID (or its exact domain) is pinned; unpinned → `untrusted`;
   *     resolution indeterminate, or no served key matches `jkt` (key-unavailable)
   *     → `unknown`. A DID *method* is never trusted wholesale.
   *   • WebAuthn (§6): `anchored` iff the verifier pins the credential's `publicKey`
   *     AND the assertion's `rpIdHash` matches the configured signing rpId AND the
   *     User-Verified (UV) flag satisfies policy; a genuine but unpinned or
   *     policy-unmet assertion is `untrusted` (never `invalid`). `credentialId` is
   *     advisory, never the anchor.
   * In-document / in-`kid` / served / asserted material is never self-authorizing;
   * the anchor is always verifier-side.
   */
  chainResult: 'anchored' | 'untrusted' | 'unknown';
  /**
   * Credential revocation status (§7.4): `good`, `revoked`, or `unknown`.
   *   • X.509: per OCSP/CRL (a stapled response under an untrusted clock → `unknown`).
   *   • self-certifying `did:key`/`did:jwk` and WebAuthn: no responder — governed by
   *     the pin, so a still-anchored credential is `good` (an unpinned one is already
   *     `untrusted`).
   *   • `did:web`: `revoked` ONLY when the resolved DID document is explicitly
   *     deactivated (`deactivated: true`); otherwise `good`. A key that was rotated
   *     away or whose method is absent is key-unavailable, NOT `revoked` — that is
   *     `chainResult: 'unknown'` (above). `deactivated` is served by the same origin
   *     as the key, hence suppressible: advisory-grade, not a hard guarantee.
   */
  revocationStatus: 'good' | 'revoked' | 'unknown';
  /**
   * The reference time lies within the credential's validity window
   * [notBefore, notAfter]. The reference time is **T**, the genTime of a
   * validated signature-timestamp, when one is present (§3.6); otherwise the
   * self-asserted `sigT`. T is authoritative: a backdated `sigT` cannot move this
   * input, so `signingTimeWithinValidity` MUST be derived from T whenever a
   * timestamp validates. A self-certifying `did:key`/`did:jwk` key, a `did:web`
   * key, and a WebAuthn credential carry no validity window (their lifecycle is
   * rotation/deactivation/un-pinning), so this is `true` by the no-window rule —
   * there is no interval to fall outside of.
   */
  signingTimeWithinValidity: boolean;
  /**
   * The credential is past `notAfter` relative to the **reference clock**: the
   * validated signature-timestamp time T when one is present (long-term
   * validation, §7.5), otherwise the verification-time clock (now). So an
   * expired-at-`now` credential whose signature a validated timestamp dates to T
   * inside the validity window derives `false` here — the signature is rescued
   * from `expired` to `valid` by LTV — WITHOUT any change to the state-machine
   * body (only this derivation moves). Revocation is NOT folded in here; it stays
   * on `revocationStatus`, so an LTV credential whose revocation at T is merely
   * `unknown` still lands on rule 6 (`unknown`), never `valid`. A `did:key`/
   * `did:jwk`, `did:web`, or WebAuthn credential has no `notAfter`, so this is
   * `false` by the no-window rule.
   */
  certCurrentlyExpired: boolean;
  /**
   * The reference time came from a validated trusted timestamp (§3.6) rather than
   * the self-asserted `sigT`. `true` iff a signature-timestamp fully validates:
   * its RFC 3161 token binds this record's signature (the §3.6 imprint), its TSA
   * chain anchors to the verifier's TSA trust store, and the token is within its
   * TSA validity and unrevoked. Then the reference time is the token's genTime T
   * and rule 2 can fire (signed outside validity, provable). A timestamp that
   * does NOT validate leaves this `false` (fall back to the untrusted `sigT`) and
   * MUST NOT make the signature `invalid` — a bad timestamp on a good signature
   * does not poison it (cf. did:web key-unavailability).
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
 *  8. anchored AND good AND within validity                          → valid
 *
 * The trust path (rules 3–6) is an ALLOWLIST: `valid` is reached only when the chain
 * is `anchored` AND revocation is `good`. Any out-of-enum axis value — a future
 * state, a casing/whitespace slip, an unmapped code path — is non-acceptance, never
 * `valid` (§3.8: unknown MUST NOT be acceptance; the machine MUST NOT fail open).
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

  // Trust path — an ALLOWLIST, not a denylist: `valid` is reached only when the chain
  // is `anchored` AND revocation is `good`. Every other value on either axis — the
  // in-enum negatives handled below AND any out-of-enum value (a future state, a
  // casing/whitespace slip, an unmapped code path) — is non-acceptance, never a
  // fall-through to `valid` (§3.8: unknown MUST NOT be acceptance; the machine MUST NOT
  // fail open). The runtime `!==` comparisons enforce this regardless of the declared
  // TS union — narrowing is compile-time only and never removes the check; keeping the
  // union also preserves the compiler's typo guard on the sentinel literals. Revocation
  // is only meaningful for an anchored credential, so the chain axis is decided first.

  // Require an anchored credential. `unknown` (unevaluable) reports as such; every
  // other non-`anchored` value is non-acceptance, floored to `untrusted`.
  if (i.chainResult !== 'anchored') return i.chainResult === 'unknown' ? 'unknown' : 'untrusted';

  // Require good revocation. `revoked` reports as such; `unknown` and every other
  // non-`good` value are non-acceptance (MUST NOT be reported `valid`), floored to `unknown`.
  if (i.revocationStatus !== 'good') return i.revocationStatus === 'revoked' ? 'revoked' : 'unknown';

  // Validity window. A currently-expired (but legitimately-signed) credential is
  // `expired`; a validated timestamp — specified later — is what would let a
  // richer profile keep this `valid`.
  if (i.certCurrentlyExpired) return 'expired';

  return 'valid';
}
