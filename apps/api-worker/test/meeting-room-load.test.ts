import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROSTER_DELTA_THRESHOLD } from "@magna-carta/meeting-protocol/frames";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import {
  FAST_PARTICIPANTS,
  FULL_PARTICIPANTS,
  loadRoutingService,
  reportLine,
  runMeetingRoomLoad,
} from "./support/meeting-room-load.ts";

// THE ROOM'S FAN-OUT COST, AS A NUMBER.
//
// The driver is `support/meeting-room-load.ts`; this file is the two ways of running it. The FAST
// variant drives forty fake clients and runs in the ordinary suite, as an assertion on the two
// bounds the room's whole design rests on: a join above the roster-delta threshold costs every other
// socket one frame, and a frame costs the room at most one list of its roster. Forty is chosen
// because it is past the threshold by more than twice, so the delta path is what is being measured
// rather than the full-roster path below it.
//
// The FULL variant drives three hundred — the room's own ceiling — and is run by hand:
//
//   VITE_MEETING_ROOM_LOAD_PARTICIPANTS=300 \
//     pnpm --filter @magna-carta/api-worker exec vp test run test/meeting-room-load.test.ts \
//     --reporter=verbose
//
// The `VITE_` prefix is not decoration: this file is EVALUATED INSIDE WORKERD, which has none of the
// host's environment — a plain variable reaches the runner and stops there. Vite's own env pass is
// what carries a prefixed one across, as `import.meta.env`. The verbose reporter is what shows the
// printed line; the default one hides a passing test's output.
//
// It is not in the ordinary suite because three hundred real socket pairs in one Miniflare process
// is minutes rather than seconds, and a battery that costs that is a battery people stop running.
// Both variants go through the same driver on purpose: a harness that is not what the suite runs is
// a harness that stops working with nobody noticing.
//
// THE COUNTS ARE THE RESULT AND THE WALL TIME IS NOT. This shares a box with other Workers runtimes,
// so a duration here is a fact about the machine; frames per socket and lists per frame are facts
// about the room. The duration is printed anyway, because a change that leaves the counts identical
// and the run four times longer is worth seeing.

const FIRM = "firm_meetingRoomLoadFirm0";

// The full pass is opt-in through the environment rather than through a test name, so the command
// in the comment above is the whole of what somebody has to remember.
function requestedParticipants(): number {
  const viteEnvironment = (import.meta as { env?: Record<string, string | undefined> }).env;
  const requested =
    viteEnvironment?.["VITE_MEETING_ROOM_LOAD_PARTICIPANTS"] ??
    // The node-side reading, kept for a runner that evaluates this outside workerd and therefore
    // has the host's own environment. Neither is set in an ordinary run, which is the fast variant.
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
      "MEETING_ROOM_LOAD_PARTICIPANTS"
    ];
  const parsed = Number(requested ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : FAST_PARTICIPANTS;
}

beforeAll(() => {
  setSfuFetchForTests(loadRoutingService());
});

afterAll(() => {
  setSfuFetchForTests(null);
});

describe("what a room of this size costs", () => {
  it(
    "holds the fan-out bound while the room fills, publishes, talks and turns a page",
    async () => {
      const participants = requestedParticipants();
      const report = await runMeetingRoomLoad(
        FIRM,
        `meeting_load${String(participants).padStart(6, "0")}`,
        participants,
      );
      // Printed rather than only asserted: the assertion says the bound held, and the line says
      // what it held AT — which is the thing somebody comparing two branches actually reads.
      console.log(`[meeting-room-load] ${reportLine(report)}`);

      expect(report.participants).toBe(participants);
      expect(participants).toBeGreaterThan(ROSTER_DELTA_THRESHOLD * 2);

      // ONE FRAME PER JOIN PER SOCKET is what the delta path claims. Two is allowed for, because a
      // join can coincide with another socket's own roster change and the harness cannot tell the
      // two apart from outside; at three the room has gone back to broadcasting full rosters, which
      // is quadratic in the meeting.
      expect(report.framesPerJoinPerSocket).toBeGreaterThan(0);
      expect(report.framesPerJoinPerSocket).toBeLessThanOrEqual(2);

      // ONE LIST PER FRAME is the room's other rule — a list is every key the room holds, which is
      // three hundred of them in a full meeting, so a second one doubles the cost of the busiest
      // thing it does. Presence spends none at all, so the mean sits below one.
      expect(report.storageListsPerFrame).toBeLessThanOrEqual(1);

      // Every socket was still being served at the end: a room that quietly stopped broadcasting
      // would satisfy both bounds above and be broken.
      expect(report.framesOnBusiestSocket).toBeGreaterThan(participants / 2);
      expect(report.framesSent).toBeGreaterThan(participants * 4);
    },
    // The full pass opens three hundred socket pairs one at a time; the fast one is seconds.
    requestedParticipants() >= FULL_PARTICIPANTS ? 600_000 : 120_000,
  );
});
