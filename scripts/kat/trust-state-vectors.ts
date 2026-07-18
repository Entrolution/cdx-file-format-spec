/**
 * Known-answer vectors for the signature-state production rules
 * (Security Extension §3.8). Each `expected` state is hand-derived from the
 * §3.8 precedence — the independent oracle is the written rule table, so a bug
 * in `evaluateSignatureState` is caught against it, not snapshotted.
 *
 * Vectors cover one case per precedence rule, the precedence collisions that
 * matter (which state wins when several conditions hold), and the trusted-time
 * cap behaviour (an untrusted `sigT` window-violation is ignored; only a trusted
 * clock promotes it to `invalid`).
 */

import type { SignatureStateInputs, SignatureState } from '../lib/signature-state.js';

export interface TrustStateVector {
  name: string;
  description: string;
  inputs: SignatureStateInputs;
  expected: SignatureState;
}

/** All-good baseline (→ valid); vectors override only the fields they exercise. */
const OK: SignatureStateInputs = {
  headerConsistent: true,
  signatureVerifies: true,
  chainResult: 'anchored',
  revocationStatus: 'good',
  signingTimeWithinValidity: true,
  certCurrentlyExpired: false,
  referenceTimeTrusted: false,
};

const v = (over: Partial<SignatureStateInputs>): SignatureStateInputs => ({ ...OK, ...over });

export const trustStateVectors: TrustStateVector[] = [
  { name: 'valid', description: 'Everything verifies, anchors, not revoked, in validity.', inputs: v({}), expected: 'valid' },

  // Rule 1 — invalid floor.
  { name: 'invalid-bad-signature', description: 'JWS does not verify under the leaf key.', inputs: v({ signatureVerifies: false }), expected: 'invalid' },
  { name: 'invalid-bad-header', description: 'Header inconsistent (e.g. x5t#S256 does not match x5c[0], or crit malformed).', inputs: v({ headerConsistent: false }), expected: 'invalid' },

  // Rule 2 — signed outside validity, proven by a trusted clock (§3.6). The
  // trusted timestamp time T is authoritative, so an antedated `sigT` cannot hide
  // that T fell outside the credential validity window.
  { name: 'invalid-signed-outside-validity-trusted', description: 'A validated timestamp shows the signature existed at T outside the credential validity window (an antedated sigT cannot move T) → rule 2 fires.', inputs: v({ referenceTimeTrusted: true, signingTimeWithinValidity: false }), expected: 'invalid' },

  // Rules 3–4 — trust path.
  { name: 'unknown-chain', description: 'The chain could not be evaluated.', inputs: v({ chainResult: 'unknown' }), expected: 'unknown' },
  { name: 'untrusted-self-signed', description: 'No path to a configured anchor (e.g. the self-signed signed-document example).', inputs: v({ chainResult: 'untrusted' }), expected: 'untrusted' },

  // Rules 5–6 — revocation (chain anchored).
  { name: 'revoked', description: 'The certificate is revoked.', inputs: v({ revocationStatus: 'revoked' }), expected: 'revoked' },
  { name: 'unknown-revocation', description: 'Revocation indeterminate (unreachable responder, or stapled response under an untrusted clock).', inputs: v({ revocationStatus: 'unknown' }), expected: 'unknown' },

  // Rule 7 — expiry.
  { name: 'expired', description: 'Legitimately signed, the certificate has since expired, and no validated timestamp rescues it (reference clock = now) → expired.', inputs: v({ certCurrentlyExpired: true }), expected: 'expired' },

  // Precedence collisions.
  { name: 'invalid-beats-untrusted', description: 'A forged signature is invalid even on an unanchored chain.', inputs: v({ signatureVerifies: false, chainResult: 'untrusted' }), expected: 'invalid' },
  { name: 'untrusted-beats-revoked', description: 'Without an anchored chain, a "revoked" status is not trustworthy → untrusted.', inputs: v({ chainResult: 'untrusted', revocationStatus: 'revoked' }), expected: 'untrusted' },
  { name: 'untrusted-beats-expired', description: 'An unanchored chain is untrusted regardless of expiry.', inputs: v({ chainResult: 'untrusted', certCurrentlyExpired: true }), expected: 'untrusted' },
  { name: 'revoked-beats-expired', description: 'Revocation outranks expiry.', inputs: v({ revocationStatus: 'revoked', certCurrentlyExpired: true }), expected: 'revoked' },

  // Out-of-enum robustness (§3.8) — the trust path is an ALLOWLIST, so any axis value
  // outside the documented enum is non-acceptance, never `valid`. The inputs are
  // TS-typed, so an out-of-enum value can only arise at runtime (a future state, a
  // casing/whitespace slip, an unmapped code path); the `as any` casts model that.
  { name: 'out-of-enum-chain', description: 'A chainResult outside {anchored,untrusted,unknown} floors to untrusted, never valid.', inputs: v({ chainResult: 'error' as any }), expected: 'untrusted' },
  { name: 'casing-slip-chain', description: 'A casing slip ("Anchored" != "anchored") is non-acceptance (untrusted): the allowlist requires the exact token.', inputs: v({ chainResult: 'Anchored' as any }), expected: 'untrusted' },
  { name: 'out-of-enum-revocation', description: 'A revocationStatus outside {good,revoked,unknown} on an anchored credential floors to unknown, never valid.', inputs: v({ revocationStatus: 'indeterminate' as any }), expected: 'unknown' },
  { name: 'whitespace-slip-revocation', description: 'A whitespace slip ("good\\n" != "good") is non-acceptance (unknown), not valid.', inputs: v({ revocationStatus: 'good\n' as any }), expected: 'unknown' },

  // Long-term validation (§7.5): a validated signature-timestamp re-bases the
  // validity-window inputs (certCurrentlyExpired / signingTimeWithinValidity)
  // onto the trusted time T, while revocation stays its own axis (rules 5/6) so
  // an unestablished revocation can never be laundered into `valid`.
  { name: 'valid-expired-but-ltv', description: 'Cert expired at now, but a validated timestamp dates the signature to T inside validity and stapled revocation is good at T → LTV rescues it to valid (certCurrentlyExpired derives false against T).', inputs: v({ referenceTimeTrusted: true, certCurrentlyExpired: false, revocationStatus: 'good' }), expected: 'valid' },
  { name: 'unknown-ltv-revocation-indeterminate', description: 'LTV re-bases expiry (certCurrentlyExpired false against T) but revocation at T cannot be established → rule 6 (unknown), NEVER valid — revocation is not folded into the expiry derivation.', inputs: v({ referenceTimeTrusted: true, certCurrentlyExpired: false, revocationStatus: 'unknown' }), expected: 'unknown' },
  { name: 'revoked-at-T-beats-ltv', description: 'A validated timestamp does not rescue a credential that stapled revocation shows revoked at T → revoked.', inputs: v({ referenceTimeTrusted: true, revocationStatus: 'revoked' }), expected: 'revoked' },

  // Trusted-time cap: an untrusted sigT window-violation is ignored (rule 2 does
  // not fire); the currently-valid cert still yields valid.
  { name: 'untrusted-time-ignores-sigT-window', description: 'sigT claims out-of-window but is untrusted; cert is currently valid → valid (rule 2 needs a trusted clock).', inputs: v({ referenceTimeTrusted: false, signingTimeWithinValidity: false }), expected: 'valid' },
];
