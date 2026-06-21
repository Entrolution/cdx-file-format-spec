/**
 * Known-answer vectors for the signature-SET integrity rules
 * (Security Extension §3.12), exercising `evaluateRequiredSigners`. Each
 * `expectedSatisfied`/`expectedMissing` is hand-derived from the §3.12 matching
 * rule — the independent oracle is the written rule, not a snapshot.
 *
 * The rule under test: a required signer is satisfied ONLY by a present
 * signature that (i) is on the matching credential PATH, (ii) matches the
 * entry's authenticated identity, and (iii) reached state `valid`. Vectors cover
 * the strip and downgrade attacks (a required signer present but not `valid`),
 * the add/shadow attack (extra non-valid signatures do not satisfy a slot), the
 * cross-path confusion guard (same identity string, wrong path), idempotence
 * (two present signatures for one slot), and the malformed/empty edges.
 */

import type {
  PresentSignerVerdict,
  RequiredSigner,
  CredentialPath,
} from '../lib/signature-set.js';
import type { SignatureState } from '../lib/signature-state.js';

export interface SignatureSetVector {
  name: string;
  description: string;
  present: PresentSignerVerdict[];
  required: RequiredSigner[];
  expectedSatisfied: boolean;
  /** Number of required entries with no satisfying present `valid` signature. */
  expectedMissing: number;
}

// Compact present-signature constructor.
const p = (path: CredentialPath, identity: string, state: SignatureState): PresentSignerVerdict => ({ path, identity, state });

// Sample authenticated identities (one per path).
const DID = 'did:web:acme.example.com:notary';
const KEY = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';
const X5T = 'r9aBcD3fGhIjKlMnOpQrStUvWxYz012345678ABCDEF0';
const JKT = 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k';

// Every non-`valid` state must fail to satisfy a slot — exercised one per vector.
const NON_VALID: SignatureState[] = ['invalid', 'expired', 'revoked', 'untrusted', 'unknown'];

export const signatureSetVectors: SignatureSetVector[] = [
  {
    name: 'satisfied-single-did',
    description: 'One required did, a present keyId signature matches and is valid.',
    present: [p('keyId', DID, 'valid')],
    required: [{ did: DID }],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
  {
    name: 'satisfied-all-three-kinds',
    description: 'A did, an x5tS256 and a jkt required; one matching valid signature each.',
    present: [p('keyId', KEY, 'valid'), p('x509', X5T, 'valid'), p('webauthn', JKT, 'valid')],
    required: [{ did: KEY }, { x5tS256: X5T }, { jkt: JKT }],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
  {
    name: 'strip-one-of-two',
    description: 'Two required; only one present (the stronger signature was stripped).',
    present: [p('keyId', KEY, 'valid')],
    required: [{ did: KEY }, { did: DID }],
    expectedSatisfied: false,
    expectedMissing: 1,
  },
  {
    name: 'strip-all',
    description: 'Two required, none present at all.',
    present: [],
    required: [{ did: KEY }, { x5tS256: X5T }],
    expectedSatisfied: false,
    expectedMissing: 2,
  },
  // Downgrade: the required signer is present but reduced to a non-valid state.
  ...NON_VALID.map((state, i): SignatureSetVector => ({
    name: `downgrade-required-${state}`,
    description: `The required signer is present but its state is ${state}, so it does not satisfy the slot.`,
    present: [p('keyId', DID, state), p('keyId', `did:key:zDecoy${i}`, 'valid')],
    required: [{ did: DID }],
    expectedSatisfied: false,
    expectedMissing: 1,
  })),
  {
    name: 'add-shadow-does-not-satisfy',
    description: 'Extra forged/untrusted signatures alongside the genuine required one do not change satisfaction, and cannot manufacture a co-signer.',
    present: [p('keyId', DID, 'valid'), p('keyId', 'did:key:zForged', 'untrusted'), p('x509', 'deadbeefdeadbeefdeadbeefdeadbeef', 'invalid')],
    required: [{ did: DID }],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
  {
    name: 'cross-path-did-not-satisfied-by-webauthn',
    description: 'A webauthn signature whose identity string equals the required did does NOT satisfy a did slot (path-discriminated matching).',
    present: [p('webauthn', DID, 'valid')],
    required: [{ did: DID }],
    expectedSatisfied: false,
    expectedMissing: 1,
  },
  {
    name: 'cross-path-jkt-not-satisfied-by-keyid',
    description: 'A keyId signature whose identity equals a jkt value does NOT satisfy a jkt slot — the cross-path RFC-7638 collision guard.',
    present: [p('keyId', JKT, 'valid')],
    required: [{ jkt: JKT }],
    expectedSatisfied: false,
    expectedMissing: 1,
  },
  {
    name: 'jkt-satisfied-by-webauthn-only',
    description: 'The same jkt value, on the webauthn path, does satisfy the jkt slot.',
    present: [p('webauthn', JKT, 'valid')],
    required: [{ jkt: JKT }],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
  {
    name: 'idempotent-two-present-one-slot',
    description: 'Two present valid signatures with the same identity satisfy a single required slot once (no double counting, no error).',
    present: [p('keyId', DID, 'valid'), p('keyId', DID, 'valid')],
    required: [{ did: DID }],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
  {
    name: 'valid-wins-among-same-identity',
    description: 'When one signature for the required identity is expired and another is valid, the slot is satisfied by the valid one.',
    present: [p('keyId', DID, 'expired'), p('keyId', DID, 'valid')],
    required: [{ did: DID }],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
  {
    name: 'empty-required-vacuous',
    description: 'An empty required set is vacuously satisfied (the projector forbids it, so this does not arise from a real document).',
    present: [],
    required: [],
    expectedSatisfied: true,
    expectedMissing: 0,
  },
];

/** Malformed required-signer entries the matcher MUST reject (fail closed). */
export const malformedRequiredSigners: { name: string; entry: unknown }[] = [
  { name: 'empty-object', entry: {} },
  { name: 'two-kinds', entry: { did: DID, jkt: JKT } },
  { name: 'unknown-kind', entry: { subject: 'CN=Acme' } },
  { name: 'kind-plus-extra', entry: { did: DID, label: 'Notary' } },
  { name: 'empty-string', entry: { did: '' } },
  { name: 'non-string', entry: { x5tS256: 123 } },
];
