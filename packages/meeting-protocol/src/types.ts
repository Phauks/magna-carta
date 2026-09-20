/*
 * The values a meeting's wire carries, as both ends read them.
 *
 * WHY THESE ARE HERE AND NOT IN `@magna-carta/meetings`. That package is the DOMAIN — it holds the
 * meeting row, the attendance statements and the service that writes them, and it reaches a
 * database. A browser bundle cannot take any of that, and a wire type that lived beside a Drizzle
 * schema would pull the schema into the browser the first time somebody imported it for a union of
 * two strings. So the wire's vocabulary is declared here, in a package whose only runtime
 * dependency is zod, and the domain keeps its own.
 *
 * The one value declared in both places is the medium (`MEETING_MEDIA` in
 * packages/meetings/src/types.ts). It is two string literals that the record and the wire have to
 * agree on; they are structurally the same type, so a mismatch is a type error at the seam that
 * carries it rather than a silent divergence.
 */

/**
 * WHICH OF A PUBLISHER'S SIMULCAST LAYERS A SUBSCRIBER WANTS: full, half or quarter resolution.
 *
 * A camera publishes all three, and the choice is the subscriber's because only the subscriber knows
 * how large it is drawing the tile — a browser showing sixteen tiles wants sixteen quarter-size
 * streams, not sixteen full ones. `rid` is the routing service's own name for the identifier that
 * distinguishes the layers, and it is spelled its way here so the value travels unchanged.
 *
 * The order is the SIZE order, which is also asciibetical: the routing service is told to fall back
 * "the next one along" and that means "the next size down" without it being told what the names
 * mean.
 */
export const PREFERRED_RIDS = Object.freeze(["f", "h", "q"] as const);

/** Full, half or quarter of a publisher's camera — the three layers a camera offers. */
export type PreferredRid = (typeof PREFERRED_RIDS)[number];

/**
 * What a meeting is made of: pictures and sound, or sound alone.
 *
 * A CALL IS NOT A MEETING WITH THE CAMERAS OFF. It is chosen when the room is opened and never
 * changes, because the people who joined agreed to one thing — so a browser in a call captures no
 * camera, offers no screen share and draws no picture, and the room refuses a picture published
 * into one.
 */
export const MEETING_MEDIA = Object.freeze(["video", "audio"] as const);

export type MeetingMedium = (typeof MEETING_MEDIA)[number];

/** Whether a string off the wire names a medium this protocol speaks. */
export function isMeetingMedium(value: string): value is MeetingMedium {
  return (MEETING_MEDIA as readonly string[]).includes(value);
}

/** One track a participant publishes, as the roster names it to everybody else. */
export interface RosterTrack {
  readonly trackName: string;
  readonly kind: string;
}

/** One person in the room, as every other participant sees them. */
export interface RosterParticipant {
  readonly participantId: string;
  readonly userId: string;
  readonly displayName: string;
  // The routing-service session they publish through, or null until they have published anything.
  // A browser needs it to ask for their tracks, and there is nothing to ask for until it exists.
  readonly sfuSessionId: string | null;
  readonly tracks: readonly RosterTrack[];
  // The two facts a tile shows about somebody whose audio this browser may not even be pulling.
  // They ride on the roster as well as on their own delta frame so that a browser arriving in a
  // room already in progress sees who is talking and who is muted immediately, rather than being
  // blank until each of them next changes.
  readonly speaking: boolean;
  readonly muted: boolean;
}
