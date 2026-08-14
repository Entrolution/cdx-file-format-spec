/**
 * Exact comparison of unsigned decimal DIGIT STRINGS, for the places a Content Anchor URI's
 * bounds must be ordered before they are converted to a number.
 *
 * Its own module because both consumers need it and neither may depend on the other. The
 * operative reason is DIRECTION: `reference-resolver.ts` is document-layer and sits on top of
 * `canonicalize.ts`, while `structural-constraints.ts` sits below it, so having the lower
 * module import the higher one to reach a comparison would invert the layering. (It would not
 * cycle, and both consumers' own callers already import `canonicalize.ts` directly, so the
 * tempting "keeps a gate free of the hashing stack" argument is not in fact a live property —
 * do not restate it.) A leaf with no imports of its own keeps the direction honest.
 *
 * WHY NOT `Number()`. Anchors & References §2.1 and `anchor.schema.json`'s `contentAnchorUri`
 * pattern admit an unbounded `[0-9]+`, so a bound can exceed what an IEEE-754 double
 * represents. Two DISTINCT integers above 2^53 then round to the same value and `start < end`
 * is false, which reads as an inverted range: `#p1/9007199254740992-9007199254740993` is
 * well-ordered but reported as a defect, under a message naming the same number twice. The
 * Python oracle uses arbitrary-precision integers and reaches the correct answer, so this is
 * also where the reference and the oracle would disagree.
 *
 * This is for ORDERING only. Comparing a bound against a target's text length does not need
 * it: a length is a real array length, so any value a double rounds at already exceeds it and
 * the rounded number is on the correct side.
 */

/**
 * Strip leading zeros so two digit strings compare by MAGNITUDE. `[0-9]+` admits `007`, so
 * without this a length-first comparison calls `#p1/007-10` inverted and reports a conformant
 * anchor — `Number()` got that case right, and an exact comparison must not regress it. The
 * lookahead keeps the final digit, so `000` normalizes to `0` rather than the empty string.
 */
function normalizeDigits(d: string): string {
  return d.replace(/^0+(?=\d)/, '');
}

/**
 * Negative, zero, or positive as `a` is less than, equal to, or greater than `b`. Both
 * arguments must match `/^[0-9]+$/`; the callers take them from a regex capture, so a sign,
 * a separator or an empty string cannot reach here.
 */
export function compareDigits(a: string, b: string): number {
  const x = normalizeDigits(a);
  const y = normalizeDigits(b);
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}
