import type { NumberSegment } from "./segments.ts";

/*
 * The intake sequence: the number an enquiry wears from the moment the firm writes it down, before
 * anybody knows whether it will become a consultation, let alone a matter.
 *
 * WHY AN INTAKE IS NUMBERED AT ALL (owner ruling, 2026-09-14: "everything should have a number,
 * intake would have a number as well"). An intake is a real thing the firm is already doing work on:
 * somebody rang, a person took the call, a conflicts check may already have run, and there are steps
 * to clear before it graduates. Every one of those has to be referred to, and until this existed the
 * only name an intake had was its handle — which is what the platform joins on and what nobody can
 * read back down a telephone. The first ruling on this lifecycle said no number of any kind existed
 * before a matter was active; the consultation number reversed half of that on 2026-08-31 and this
 * reverses the rest.
 *
 * IT IS A THIRD SEQUENCE, not an early draw on either of the others, for exactly the reason the
 * consultation number is not an early draw on the matter number. Most enquiries never become
 * consultations. An intake that goes nowhere must consume no consultation number, because a firm
 * reading its consultation run later cannot tell a declined enquiry from a consultation whose record
 * went missing. Each run counts only what it is a run OF, and each therefore stays dense enough to
 * read.
 *
 * SO A FILE THAT COMES THE WHOLE WAY CARRIES THREE, and keeps all three. Graduation adds the
 * consultation number beside this one and opening adds the matter number beside that; nothing is
 * replaced, so a note filed under the intake number still resolves a year later. What a surface
 * SHOWS is the number for the rung it is on — the newest one the matter has — which is the anchor
 * rule in apps/web/src/lib/communications/anchor-matters.svelte.ts.
 *
 * A firm may configure its own (numbering_scheme rows carry `purpose`). Until it does, this default
 * applies, so an enquiry is numbered from the first one rather than from whenever somebody reaches
 * the settings screen. It renders "I2026-0001": a leading I nobody can mistake for a matter number
 * or a consultation's C, the year, and a per-year counter — the year segment is scoping, so the run
 * restarts each January the way a firm's own file numbers do.
 */
export const DEFAULT_INTAKE_SCHEME: readonly NumberSegment[] = [
  { kind: "literal", text: "I" },
  { kind: "year", digits: 4, scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4, start: 1 },
];

/*
 * Intake draws ride the matter-number counter and allocation tables under scope keys carrying this
 * prefix, on the consultation sequence's own reasoning: a third pair of tables would duplicate the
 * mechanism, and the subtlety that makes it correct, for no gain. The prefix has to be one no matter
 * scope key can produce — scope keys join rendered segment values with ':', and every rendered value
 * is folded into the URL-safe set (A-Z a-z 0-9 . _ ~ -), which contains no '/' — and one no OTHER
 * prefixed run can produce either, which is why it is a distinct word rather than a variation.
 */
export const INTAKE_SCOPE_PREFIX = "intake/";
