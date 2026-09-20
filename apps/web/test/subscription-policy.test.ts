/*
 * What a browser asks for in a room of three hundred.
 *
 * THE WHOLE POINT OF THE FUNCTION BEING PURE is this file: the case that matters is a full room,
 * and a full room cannot be rehearsed — three hundred browsers, three hundred cameras and a
 * forwarding unit are not something a test can stand up. Facts in, a plan out, and every rule the
 * room depends on is asserted against the plan rather than against a rendering of it.
 *
 * WHAT IS PINNED HERE is the set of rules that, broken, cost bandwidth or lose somebody: the caps,
 * because a browser that pulls three hundred tracks stops working; the ordering, because a member
 * who pins somebody and then cannot see them has been told the control does nothing; the layer
 * choice, because sixteen full-resolution streams to paint sixteen thumbnails is the whole problem
 * simulcast exists to solve; and the audio-only plan, because a call that pulled a picture would be
 * refused by the room and leave a tile black.
 */
import { describe, expect, it } from "vitest";
import {
  GALLERY_PAGE_SIZE,
  MAX_AUDIO_SUBSCRIPTIONS,
  MAX_VIDEO_SUBSCRIPTIONS,
  SPEAKER_VIEW_PAGE_SIZE,
  subscriptionPolicy,
  type SubscriptionPolicyInput,
  type SubscriptionPolicyParticipant,
} from "$lib/meetings/client/subscription-policy.ts";

const NOW = 1_800_000_000_000;

/** Somebody in the room, publishing a camera and a microphone, silent unless a case says otherwise. */
function participant(
  ordinal: number,
  over: Partial<SubscriptionPolicyParticipant> = {},
): SubscriptionPolicyParticipant {
  const participantId = `attendance_${ordinal}`;
  return {
    participantId,
    sfuSessionId: `session_${ordinal}`,
    tracks: [
      { trackName: `${participantId}:audio`, kind: "audio" },
      { trackName: `${participantId}:video`, kind: "video" },
    ],
    speaking: false,
    muted: false,
    lastSpokeAt: null,
    ...over,
  };
}

/** A room of however many people, this browser first. */
function roomOf(size: number): SubscriptionPolicyParticipant[] {
  return Array.from({ length: size }, (_unused, index) => participant(index + 1));
}

function ask(over: Partial<SubscriptionPolicyInput> = {}): SubscriptionPolicyInput {
  return {
    medium: "video",
    self: "attendance_1",
    participants: roomOf(300),
    pinned: [],
    page: 0,
    pageSize: GALLERY_PAGE_SIZE,
    now: NOW,
    ...over,
  };
}

describe("a room of three hundred", () => {
  it("pulls sixteen cameras and twenty-four microphones, and not one more", () => {
    const plan = subscriptionPolicy(ask());

    expect(plan.video).toHaveLength(MAX_VIDEO_SUBSCRIPTIONS);
    expect(plan.audio).toHaveLength(MAX_AUDIO_SUBSCRIPTIONS);
    expect(plan.screen).toBeNull();
    // Two hundred and ninety-nine other people, sixteen to a page.
    expect(plan.pages).toBe(Math.ceil(299 / GALLERY_PAGE_SIZE));
    expect(plan.shown).toHaveLength(GALLERY_PAGE_SIZE);
  });

  it("never plans this browser's own tracks, which are the capture and not a subscription", () => {
    const plan = subscriptionPolicy(ask());

    expect(plan.shown).not.toContain("attendance_1");
    for (const track of [...plan.video, ...plan.audio]) {
      expect(track.participantId).not.toBe("attendance_1");
    }
  });

  it("shows the next sixteen on the second page, and clamps a page past the end", () => {
    const first = subscriptionPolicy(ask({ page: 0 }));
    const second = subscriptionPolicy(ask({ page: 1 }));

    expect(second.shown).toHaveLength(GALLERY_PAGE_SIZE);
    // The page after the first is the next sixteen of the same order, with nothing repeated.
    expect(second.shown).toEqual(
      roomOf(300)
        .filter((one) => one.participantId !== "attendance_1")
        .slice(GALLERY_PAGE_SIZE, GALLERY_PAGE_SIZE * 2)
        .map((one) => one.participantId),
    );
    expect(first.shown.some((shown) => second.shown.includes(shown))).toBe(false);
    // The cameras follow the page: page two pulls page two's people and closes page one's.
    expect(second.video.map((track) => track.participantId)).toEqual(second.shown);

    const past = subscriptionPolicy(ask({ page: 4000 }));
    expect(past.shown).toEqual(subscriptionPolicy(ask({ page: past.pages - 1 })).shown);
  });

  it("runs in a few milliseconds, which is what lets every delta re-run it", () => {
    const input = ask();
    const started = performance.now();
    for (let run = 0; run < 10; run += 1) subscriptionPolicy(input);
    const each = (performance.now() - started) / 10;

    // A sanity bound rather than a benchmark: reconciliation runs up to four times a second, and a
    // policy that took a visible fraction of that would be felt as the room stuttering.
    expect(each).toBeLessThan(5);
  });
});

describe("what wins a place on the page", () => {
  it("puts a pinned participant first, however far down the roster they are", () => {
    const plan = subscriptionPolicy(ask({ pinned: ["attendance_250"] }));

    expect(plan.shown[0]).toBe("attendance_250");
    expect(plan.video[0]?.participantId).toBe("attendance_250");
  });

  it("keeps pinned participants in the order they were pinned", () => {
    const plan = subscriptionPolicy(ask({ pinned: ["attendance_250", "attendance_80"] }));

    expect(plan.shown.slice(0, 2)).toEqual(["attendance_250", "attendance_80"]);
  });

  it("puts whoever is sharing a screen ahead of the roster, and pulls the share itself", () => {
    const participants = roomOf(300).map((one) =>
      one.participantId === "attendance_120"
        ? {
            ...one,
            tracks: [
              ...one.tracks,
              { trackName: "attendance_120:screen", kind: "screen" as const },
            ],
          }
        : one,
    );

    const plan = subscriptionPolicy(ask({ participants }));

    expect(plan.shown[0]).toBe("attendance_120");
    expect(plan.screen).toEqual({
      sessionId: "session_120",
      trackName: "attendance_120:screen",
      participantId: "attendance_120",
    });
  });

  it("puts a pin ahead even of the screen share, because a pin is what this member asked for", () => {
    const participants = roomOf(300).map((one) =>
      one.participantId === "attendance_120"
        ? {
            ...one,
            tracks: [
              ...one.tracks,
              { trackName: "attendance_120:screen", kind: "screen" as const },
            ],
          }
        : one,
    );

    const plan = subscriptionPolicy(ask({ participants, pinned: ["attendance_250"] }));

    expect(plan.shown.slice(0, 2)).toEqual(["attendance_250", "attendance_120"]);
    // The share is still pulled: it takes the large slot wherever its owner sits in the order.
    expect(plan.screen?.participantId).toBe("attendance_120");
  });

  it("moves recent speakers up past the roster order, the one talking now first", () => {
    const participants = roomOf(300).map((one) => {
      if (one.participantId === "attendance_200") return { ...one, speaking: true };
      if (one.participantId === "attendance_150") return { ...one, lastSpokeAt: NOW - 2_000 };
      if (one.participantId === "attendance_90") return { ...one, lastSpokeAt: NOW - 30_000 };
      return one;
    });

    const plan = subscriptionPolicy(ask({ participants }));

    expect(plan.shown.slice(0, 3)).toEqual(["attendance_200", "attendance_150", "attendance_90"]);
  });

  it("forgets a speaker old enough that the room has moved on", () => {
    const participants = roomOf(300).map((one) =>
      one.participantId === "attendance_200" ? { ...one, lastSpokeAt: NOW - 60 * 60 * 1000 } : one,
    );

    const plan = subscriptionPolicy(ask({ participants }));

    // One word an hour ago does not hold somebody on page one for the rest of the meeting.
    expect(plan.shown).not.toContain("attendance_200");
  });

  it("draws a name tile for somebody who has published nothing, and pulls nothing for them", () => {
    const participants = roomOf(20).map((one) =>
      one.participantId === "attendance_2" ? { ...one, sfuSessionId: null, tracks: [] } : one,
    );

    const plan = subscriptionPolicy(ask({ participants }));

    expect(plan.shown).toContain("attendance_2");
    expect(plan.video.map((track) => track.participantId)).not.toContain("attendance_2");
    expect(plan.audio.map((track) => track.participantId)).not.toContain("attendance_2");
  });
});

describe("who this browser hears", () => {
  it("leaves out the muted and holds whoever spoke most recently", () => {
    const participants = roomOf(300).map((one, index) => {
      if (one.participantId === "attendance_299") return { ...one, lastSpokeAt: NOW - 1_000 };
      // Everybody in the first stretch of the roster is muted, so the cap has to be filled from
      // further down rather than from the top of the list.
      return index < 100 ? { ...one, muted: true } : one;
    });

    const plan = subscriptionPolicy(ask({ participants }));

    expect(plan.audio).toHaveLength(MAX_AUDIO_SUBSCRIPTIONS);
    expect(plan.audio[0]?.participantId).toBe("attendance_299");
    const heard = plan.audio.map((track) => track.participantId);
    expect(heard).not.toContain("attendance_50");
  });

  it("pulls somebody who is speaking even where the cap is full of quieter people", () => {
    const participants = roomOf(300).map((one, index) => {
      if (one.participantId === "attendance_280") return { ...one, speaking: true };
      // Thirty people who have all spoken recently: more than the cap, so the cap is contested.
      return index < 30 ? { ...one, lastSpokeAt: NOW - 10_000 } : one;
    });

    const plan = subscriptionPolicy(ask({ participants }));

    expect(plan.audio.map((track) => track.participantId)).toContain("attendance_280");
    expect(plan.audio).toHaveLength(MAX_AUDIO_SUBSCRIPTIONS);
  });

  it("hears people who are nowhere near this page, because hearing is not seeing", () => {
    const participants = roomOf(300).map((one) =>
      one.participantId === "attendance_299" ? { ...one, speaking: true } : one,
    );

    const plan = subscriptionPolicy(ask({ participants, page: 5 }));

    expect(plan.shown).not.toContain("attendance_299");
    expect(plan.audio.map((track) => track.participantId)).toContain("attendance_299");
  });
});

describe("which layer a page is worth", () => {
  it("asks for the full picture up to four tiles, half up to nine, and a quarter beyond", () => {
    const four = subscriptionPolicy(ask({ participants: roomOf(5) }));
    const nine = subscriptionPolicy(ask({ participants: roomOf(10) }));
    const many = subscriptionPolicy(ask({ participants: roomOf(300) }));

    expect(four.shown).toHaveLength(4);
    expect(four.video.every((track) => track.preferredRid === "f")).toBe(true);
    expect(nine.shown).toHaveLength(9);
    expect(nine.video.every((track) => track.preferredRid === "h")).toBe(true);
    expect(many.video.every((track) => track.preferredRid === "q")).toBe(true);
  });

  it("asks for the half layer in speaker view, where the page is one tile and a short strip", () => {
    const plan = subscriptionPolicy(ask({ pageSize: SPEAKER_VIEW_PAGE_SIZE }));

    expect(plan.shown).toHaveLength(SPEAKER_VIEW_PAGE_SIZE);
    expect(plan.video).toHaveLength(SPEAKER_VIEW_PAGE_SIZE);
    expect(plan.video.every((track) => track.preferredRid === "h")).toBe(true);
    // The room is the same room: speaker view pages it more finely rather than hiding it.
    expect(plan.pages).toBe(Math.ceil(299 / SPEAKER_VIEW_PAGE_SIZE));
  });

  it("puts the speaker in the large slot of speaker view", () => {
    const participants = roomOf(300).map((one) =>
      one.participantId === "attendance_77" ? { ...one, speaking: true } : one,
    );

    const plan = subscriptionPolicy(ask({ participants, pageSize: SPEAKER_VIEW_PAGE_SIZE }));

    expect(plan.shown[0]).toBe("attendance_77");
  });
});

describe("a call", () => {
  it("plans sound and nothing else, and still pages the room", () => {
    const participants = roomOf(300).map((one) => ({
      ...one,
      tracks: [{ trackName: `${one.participantId}:audio`, kind: "audio" as const }],
    }));

    const plan = subscriptionPolicy(ask({ medium: "audio", participants }));

    expect(plan.video).toEqual([]);
    expect(plan.screen).toBeNull();
    expect(plan.audio).toHaveLength(MAX_AUDIO_SUBSCRIPTIONS);
    expect(plan.shown).toHaveLength(GALLERY_PAGE_SIZE);
  });

  it("refuses a picture even where somebody published one into it", () => {
    // A modified client publishing a camera into a call is refused by the room; this browser must
    // not ask for the result either way.
    const plan = subscriptionPolicy(ask({ medium: "audio" }));

    expect(plan.video).toEqual([]);
    expect(plan.screen).toBeNull();
  });
});

describe("an empty room", () => {
  it("has one page and nothing on it", () => {
    const plan = subscriptionPolicy(ask({ participants: [participant(1)] }));

    expect(plan.pages).toBe(1);
    expect(plan.shown).toEqual([]);
    expect(plan.video).toEqual([]);
    expect(plan.audio).toEqual([]);
  });
});
