import type { NumberSegment } from "./segments.ts";

/*
 * The consultation sequence: the tentative number a prospective matter wears from the moment it is
 * created, until (and after) opening draws the permanent matter number.
 *
 * It is a SEPARATE sequence from the matter number, not a preview of it. A firm's matter numbers are
 * the spine of its file room, and a consultation that never becomes a matter must not consume one —
 * a gap in that run reads as a lost file. So consultations count on their own, in their own shape,
 * and the two never share a counter.
 *
 * A firm may configure its own (numbering_scheme rows carry `purpose`). Until it does, this default
 * applies, so a consultation is numbered from the first one rather than from whenever somebody
 * reaches the settings screen. It renders "C2026-0001": a leading C nobody can mistake for a matter
 * number, the year, and a per-year counter — the year segment is scoping, so the run restarts each
 * January the way a firm's own file numbers do.
 */
export const DEFAULT_CONSULTATION_SCHEME: readonly NumberSegment[] = [
  { kind: "literal", text: "C" },
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4, start: 1 },
];

/*
 * Consultation draws ride the matter-number counter and allocation tables under scope keys carrying
 * this prefix, rather than a second pair of tables that would duplicate the mechanism (and the
 * subtlety that makes it correct) for no gain. The prefix has to be one a matter scope key cannot
 * produce: scope keys join rendered segment values with ':', and every rendered value is folded into
 * the URL-safe set (A-Z a-z 0-9 . _ ~ -), which contains no '/'. So no combination of scheme and
 * matter can render a key that starts with this.
 */
export const CONSULTATION_SCOPE_PREFIX = "consultation/";
