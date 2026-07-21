/**
 * Deterministic presentation-selection rules (Presentation Layers §4.3, §8.2).
 *
 * These pin the parts the specification makes DETERMINISTIC — the tie-breaks that
 * make "which presentation / which breakpoint" reproducible across implementations.
 * The target-narrowing of §4.3 step 1 (screen SHOULD prefer continuous/responsive,
 * print SHOULD prefer precise) is advisory and deliberately not modelled here; only
 * the normative "uses the first…" / "greatest minWidth wins" rules are.
 *
 * Pure functions over parsed JSON — no filesystem, no module state — so both a gate
 * and the conformance reference adapter can share them.
 */

/** Parse a CSS px length ("600px") or a bare number to a number; undefined otherwise. */
function pxToNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
    if (m) return Number(m[1]);
  }
  return undefined;
}

export interface Breakpoint {
  name: string;
  minWidth?: string | number;
  maxWidth?: string | number;
}

/**
 * The active breakpoint for a viewport width (§8.2). Bounds are inclusive and an
 * omitted bound is unbounded on that side. When several match, the greatest
 * `minWidth` wins; on a `minWidth` tie the one appearing LATER in the array wins.
 * Returns the winning breakpoint's `name`, or null if none match.
 */
export function selectBreakpoint(breakpoints: Breakpoint[], width: number): string | null {
  let winner: string | null = null;
  let winnerMin = -Infinity;
  let winnerIdx = -1;
  breakpoints.forEach((bp, i) => {
    const min = pxToNumber(bp.minWidth) ?? -Infinity;
    const max = pxToNumber(bp.maxWidth) ?? Infinity;
    if (min <= width && width <= max) {
      // greatest minWidth wins; equal minWidth -> the later array entry wins
      // (iteration is in order, so a later equal-min entry replaces the earlier).
      if (min > winnerMin || (min === winnerMin && i > winnerIdx)) {
        winner = bp.name;
        winnerMin = min;
        winnerIdx = i;
      }
    }
  });
  return winner;
}

/**
 * The default presentation to show, as an INDEX into `candidates` (§4.3). If any
 * entry is marked `default: true`, the FIRST such entry is used; otherwise the
 * first entry. (This operates on an already-narrowed candidate list; the §4.3
 * step-1 target narrowing is advisory and applied by the caller.)
 */
export function selectDefaultPresentation(candidates: Array<Record<string, unknown>>): number {
  const firstDefault = candidates.findIndex((c) => c && c.default === true);
  return firstDefault >= 0 ? firstDefault : 0;
}
