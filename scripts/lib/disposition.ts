/**
 * The failure-disposition lattice and interval logic (State Machine 07 §5.4.1).
 *
 * A reader's response to a failure is exactly one of four values, in increasing
 * severity: `IGNORE < WARNING < INTEGRITY-ERROR < REJECT`. This module is the
 * single definition of that ordering, used by both:
 *
 *  - the fixture disposition MAPPER (adapter side), which resolves each detected
 *    defect code to its §5.4 disposition and takes the document-level verdict as
 *    the MAX over findings; and
 *  - the fixture COMPARATOR (engine side), which checks the reported disposition
 *    lies within a case's expected `[atLeast, atMost]` interval.
 *
 * Why an interval, not equality (07 §5.4.1): INTEGRITY-ERROR is a *floor* with
 * MAY-escalation to refusal, so a defect whose spec disposition is INTEGRITY-ERROR
 * is satisfied by INTEGRITY-ERROR *or* REJECT. Encoding expectations as equality
 * would let an implementation that refuses to load everything pass every REJECT
 * and INTEGRITY-ERROR case — the ceilings (`atMost`) are where the teeth are.
 */

export const DISPOSITIONS = ['IGNORE', 'WARNING', 'INTEGRITY-ERROR', 'REJECT'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** Severity rank; higher is more severe. */
const RANK: Record<Disposition, number> = {
  IGNORE: 0,
  WARNING: 1,
  'INTEGRITY-ERROR': 2,
  REJECT: 3,
};

export function isDisposition(v: unknown): v is Disposition {
  return typeof v === 'string' && (DISPOSITIONS as readonly string[]).includes(v);
}

/**
 * The document-level disposition is the most severe (MAX) over per-finding
 * dispositions. This is a SUITE convention, not a spec quotation: §5.4 assigns a
 * disposition per failure class but does not define how to compose several
 * simultaneous findings; most-severe-wins is the natural reading (any REJECT
 * blocks the document). Returns `IGNORE` for an empty finding set — a document
 * with no detected defect is not blocked.
 */
export function maxDisposition(dispositions: readonly Disposition[]): Disposition {
  let worst: Disposition = 'IGNORE';
  for (const d of dispositions) {
    if (RANK[d] > RANK[worst]) worst = d;
  }
  return worst;
}

/** An expected disposition interval over the lattice (07 §5.4.1). */
export interface DispositionInterval {
  atLeast: Disposition;
  atMost: Disposition;
}

/** True iff `actual` lies within `[atLeast, atMost]` inclusive. */
export function inInterval(actual: Disposition, interval: DispositionInterval): boolean {
  return RANK[actual] >= RANK[interval.atLeast] && RANK[actual] <= RANK[interval.atMost];
}

/** Validate that an interval is well-formed (`atLeast <= atMost`). */
export function isWellFormedInterval(interval: DispositionInterval): boolean {
  return RANK[interval.atLeast] <= RANK[interval.atMost];
}
