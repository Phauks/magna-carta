// @vitest-environment happy-dom
/*
 * Guests, as the people running a meeting see them: who may be sent a link, who is at the door on
 * one, and who was in the room on one.
 *
 * WHAT IS PINNED is the part a forwarded link turns on. A guest is somebody already on the event
 * and in the Directory, so the panel lists those people and nobody else, and a participant recorded
 * only by name cannot be sent a link. A link sent to somebody since taken off the event stays on the
 * panel, marked, with Withdraw still on it. A host at the door reads BOTH names — the one typed there and
 * the one the link was minted for — and the attendance record keeps both, in one line. The token is
 * never on a screen. Replacing and withdrawing a link each ask first and then reach their routes.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { readWaitingParticipants } from "../src/lib/meetings/client/lobby.ts";
import { attendeeLabel, readAttendanceEntry } from "../src/lib/meetings/meeting-attendance.ts";
import MeetingGuestsPanel from "../src/lib/meetings/meeting-guests-panel.svelte";
import MeetingAttendancePanel from "../src/lib/meetings/meeting-attendance-panel.svelte";
import MeetingRoster from "../src/lib/meetings/screen/meeting-roster.svelte";
import type { MeetingAttendanceEntry } from "@magna-carta/api-client";
import Harness from "./meeting-guests-harness.svelte";
import LobbyPanel from "./meeting-lobby-panel-harness.svelte";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";
const MEETING_ID = "meeting_1";

/** A moment comfortably after every case runs, so a link that expires then is live now. */
const NEXT_YEAR = "2027-09-24T20:00:00.000Z";

const EVENT = {
  event: { id: "matterEvent_1", title: "Settlement conference" },
  participants: [
    {
      id: "participant_member",
      participantKind: "member",
      memberUserId: "usr_1",
      entityId: null,
      participantName: null,
      role: null,
    },
    {
      id: "participant_person",
      participantKind: "entity",
      memberUserId: null,
      entityId: "directoryPerson_1",
      participantName: null,
      role: "Client",
    },
    {
      id: "participant_organization",
      participantKind: "entity",
      memberUserId: null,
      entityId: "directoryOrganization_1",
      participantName: null,
      role: "Opposing party",
    },
    {
      id: "participant_external",
      participantKind: "external",
      memberUserId: null,
      entityId: null,
      participantName: "Judge Amelia Park",
      role: "Judge",
    },
  ],
};

const NAMES = {
  data: [
    {
      entityId: "directoryPerson_1",
      entityKind: "person",
      displayName: "Jane Hollis",
      mergedIntoId: null,
    },
    {
      entityId: "directoryOrganization_1",
      entityKind: "organization",
      displayName: "Acme Corporation",
      mergedIntoId: null,
    },
  ],
};

/** The organization already holds a live link it has been used on twice. */
const INVITATIONS = {
  data: [
    {
      id: "meetingGuestInvitation_1",
      entityKind: "organization",
      entityId: "directoryOrganization_1",
      invitedName: "Acme Corporation",
      expiresAt: NEXT_YEAR,
      revokedAt: null,
      arrivalCount: 2,
      lastArrivalAt: "2026-09-24T18:00:00.000Z",
    },
  ],
};

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** One JSON answer. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A live link sent to somebody who has since been taken off the event: nobody on the event holds it,
 * and it still opens the door.
 */
const DEPARTED_INVITATION = {
  id: "meetingGuestInvitation_9",
  entityKind: "person",
  entityId: "directoryPerson_9",
  invitedName: "Samuel Price",
  expiresAt: NEXT_YEAR,
  revokedAt: null,
  arrivalCount: 0,
  lastArrivalAt: null,
};

/** Answer the reads and the three acts, and record every request. */
function serve(
  attendance: unknown = { data: [], nextCursor: null },
  invitations: { data: readonly unknown[] } = INVITATIONS,
): void {
  const stub = (async (request: Request) => {
    const path = new URL(request.url).pathname;
    const text = await request.clone().text();
    requests.push({ method: request.method, path, body: text === "" ? null : JSON.parse(text) });
    if (path === "/api/v1/events/matterEvent_1") return json(EVENT);
    if (path === "/api/v1/directory/entity-names") return json(NAMES);
    if (path === `/api/v1/meetings/${MEETING_ID}/guests`) {
      return request.method === "GET" ? json(invitations) : json(INVITATIONS.data[0], 201);
    }
    if (path === `/api/v1/meetings/${MEETING_ID}/attendance`) return json(attendance);
    return json(INVITATIONS.data[0]);
  }) as unknown as typeof fetch;

  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

async function settle(remaining = 6): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

async function drawGuests(): Promise<void> {
  instance = mount(Harness, {
    target,
    props: {
      surface: MeetingGuestsPanel,
      properties: {
        open: true,
        subject: { facts: ["Settlement conference"] },
        meetingId: MEETING_ID,
        eventKind: "matter",
        eventId: "matterEvent_1",
      },
    },
  });
  flushSync();
  await settle();
}

/** A control anywhere on the page — a panel is portalled to the document — by what it is called. */
function control(name: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
}

/** The commit of whichever question is standing, read from inside that question's own panel. */
function commit(name: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('[role="alertdialog"] button')].find(
    (candidate): candidate is HTMLButtonElement => candidate.textContent?.trim() === name,
  );
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  requests = [];
  queryClient.clear();
  serve();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the Guests panel", () => {
  it("lists the event's people from outside the firm, by their Directory names, and nobody else", async () => {
    await drawGuests();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Jane Hollis");
    expect(text).toContain("Acme Corporation");
    expect(text).toContain("Judge Amelia Park");
    // Whether each has a live link, and how often it has been used.
    expect(text).toContain("No link sent");
    expect(text).toContain("Link works until");
    expect(text).toContain("Used 2 times");
    // The member on the event is somebody at the firm, not a guest.
    expect(requests.map((request) => request.path)).toContain(
      `/api/v1/meetings/${MEETING_ID}/guests`,
    );
  });

  it("never puts a token on the screen, not even part of one", async () => {
    await drawGuests();

    expect(document.body.innerHTML).not.toMatch(/token/iu);
  });

  it("will not send a link to somebody recorded by name only, and says what would", async () => {
    await drawGuests();

    const invites = [...document.body.querySelectorAll("button")].filter(
      (candidate) => candidate.textContent?.trim() === "Invite",
    );
    // Only the external participant's Invite carries no name, because it cannot be pressed at all.
    const external = invites.find((candidate) => candidate.getAttribute("aria-label") === null);
    expect(external?.disabled).toBe(true);
    const addToDirectory = control("Add to Directory");
    expect(addToDirectory?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Not in the Directory");
    expect(document.body.textContent).toContain("Soon");
  });

  it("sends a link to a person on the event who has none", async () => {
    await drawGuests();

    control("Invite Jane Hollis")?.click();
    await settle();

    const minted = requests.find(
      (request) =>
        request.method === "POST" && request.path === `/api/v1/meetings/${MEETING_ID}/guests`,
    );
    expect(minted?.body).toEqual({ entityId: "directoryPerson_1" });
  });

  it("asks before replacing a live link, and then replaces it", async () => {
    await drawGuests();

    control("Send a new link to Acme Corporation")?.click();
    await settle();
    expect(requests.some((request) => request.path.endsWith("/rotation"))).toBe(false);

    commit("Send a New Link")?.click();
    await settle();

    const rotated = requests.find((request) => request.path.endsWith("/rotation"));
    expect(rotated?.method).toBe("POST");
    expect(rotated?.path).toBe(
      `/api/v1/meetings/${MEETING_ID}/guests/meetingGuestInvitation_1/rotation`,
    );
  });

  it("keeps a link sent to somebody since taken off the event, marked, and lets it be withdrawn", async () => {
    serve(undefined, { data: [...INVITATIONS.data, DEPARTED_INVITATION] });
    await drawGuests();

    const row = [...document.body.querySelectorAll("li")].find((candidate) =>
      candidate.textContent?.includes("Samuel Price"),
    );
    expect(row?.textContent).toContain("No longer on the event");
    expect(row?.textContent).toContain("Link works until");
    // Nothing that would send them a link: only taking this one back.
    expect(control("Send a new link to Samuel Price")).toBeUndefined();
    expect(control("Invite Samuel Price")).toBeUndefined();

    control("Withdraw the link for Samuel Price")?.click();
    await settle();
    commit("Withdraw the Link")?.click();
    await settle();

    const withdrawn = requests.find((request) => request.method === "DELETE");
    expect(withdrawn?.path).toBe(`/api/v1/meetings/${MEETING_ID}/guests/meetingGuestInvitation_9`);
    // The event's own people are drawn exactly as before, and none of them is marked.
    const acme = [...document.body.querySelectorAll("li")].find((candidate) =>
      candidate.textContent?.includes("Acme Corporation"),
    );
    expect(acme?.textContent).not.toContain("No longer on the event");
  });

  it("leaves a withdrawn link for somebody no longer on the event on the record, with nothing to press", async () => {
    serve(undefined, {
      data: [{ ...DEPARTED_INVITATION, revokedAt: "2026-09-24T18:30:00.000Z" }],
    });
    await drawGuests();

    const row = [...document.body.querySelectorAll("li")].find((candidate) =>
      candidate.textContent?.includes("Samuel Price"),
    );
    expect(row?.textContent).toContain("No longer on the event");
    expect(row?.textContent).toContain("Link withdrawn");
    expect(row?.querySelectorAll("button")).toHaveLength(0);
  });

  it("asks before withdrawing a live link, and then withdraws it", async () => {
    await drawGuests();

    control("Withdraw the link for Acme Corporation")?.click();
    await settle();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    commit("Withdraw the Link")?.click();
    await settle();

    const withdrawn = requests.find((request) => request.method === "DELETE");
    expect(withdrawn?.path).toBe(`/api/v1/meetings/${MEETING_ID}/guests/meetingGuestInvitation_1`);
  });
});

describe("a guest at the door", () => {
  it("is marked, and carries the name their link was minted for beside the one they typed", () => {
    const waiting = readWaitingParticipants([
      {
        participantId: "attendance_2",
        userId: "usr_2",
        displayName: "Rosalind Chase",
        waitingFrom: "2026-09-24T18:00:00.000Z",
      },
      {
        participantId: "meetingGuestStay_1",
        userId: null,
        displayName: "J. Doe",
        waitingFrom: "2026-09-24T18:01:00.000Z",
        kind: "guest",
        invitedName: "Acme Corporation",
      },
    ]);

    // A row that does not say it is a guest is a member, as every list before guests meant.
    expect(waiting[0]).toMatchObject({ kind: "member", invitedName: null });
    expect(waiting[1]).toMatchObject({ kind: "guest", invitedName: "Acme Corporation" });

    instance = mount(LobbyPanel, {
      target,
      props: {
        open: true,
        subject: { facts: ["Settlement conference"] },
        waiting,
        onAdmit: () => undefined,
        onDeny: () => undefined,
      },
    });
    flushSync();

    const rows = [...document.body.querySelectorAll("li")];
    const guestRow = rows.find((row) => row.textContent?.includes("J. Doe"));
    const memberRow = rows.find((row) => row.textContent?.includes("Rosalind Chase"));
    expect(guestRow?.textContent).toContain("Invited as Acme Corporation");
    expect(guestRow?.textContent).toContain("Guest");
    expect(memberRow?.textContent).not.toContain("Invited as");
    expect(memberRow?.textContent).not.toContain("Guest");
  });
});

describe("the attendance record", () => {
  const GUEST_ENTRY: MeetingAttendanceEntry = {
    id: "meetingGuestStay_1",
    participantKind: "guest",
    userId: null,
    displayName: "Jane Hollis",
    entityId: "directoryOrganization_1",
    invitedName: "Acme Corporation",
    joinedAt: "2026-09-24T18:01:00.000Z",
    leftAt: "2026-09-24T19:00:00.000Z",
    waitingFrom: "2026-09-24T18:01:00.000Z",
    admittedAt: "2026-09-24T18:02:00.000Z",
    endedReason: "left",
  };
  const MEMBER_ENTRY: MeetingAttendanceEntry = {
    id: "attendance_1",
    participantKind: "member",
    userId: "usr_1",
    displayName: "Rosalind Chase",
    entityId: null,
    invitedName: null,
    joinedAt: "2026-09-24T18:00:00.000Z",
    leftAt: null,
    waitingFrom: null,
    admittedAt: null,
    endedReason: null,
  };

  it("names a guest by the name they gave, marked, with the invited name beside it", () => {
    expect(attendeeLabel(readAttendanceEntry(GUEST_ENTRY))).toBe(
      "Jane Hollis (Guest, invited as Acme Corporation)",
    );
    expect(attendeeLabel(readAttendanceEntry(MEMBER_ENTRY))).toBe("Rosalind Chase");
    expect(readAttendanceEntry(GUEST_ENTRY).userId).toBeNull();
  });

  it("draws both kinds of stay in the one record", async () => {
    serve({ data: [MEMBER_ENTRY, GUEST_ENTRY], nextCursor: null });
    instance = mount(Harness, {
      target,
      props: {
        surface: MeetingAttendancePanel,
        properties: {
          open: true,
          meetingId: MEETING_ID,
          subject: { facts: ["Settlement conference"] },
        },
      },
    });
    flushSync();
    await settle();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Rosalind Chase");
    expect(text).toContain("Jane Hollis (Guest, invited as Acme Corporation)");
  });
});

describe("the roster a guest reads", () => {
  const ROOM = [
    {
      participantId: "meetingGuestStay_1",
      userId: "",
      displayName: "Jane Hollis",
      sfuSessionId: null,
      tracks: [],
      speaking: false,
      muted: false,
      hand: false,
      handRaisedAt: null,
      hostRole: null,
    },
    {
      participantId: "attendance_2",
      userId: "usr_2",
      displayName: "Rosalind Chase",
      sfuSessionId: "session_2",
      tracks: [],
      speaking: false,
      muted: false,
      hand: false,
      handRaisedAt: null,
      hostRole: "host" as const,
    },
  ];
  /** A per-row menu that prints the member handle it was handed, which is what must never reach a guest. */
  const handleMenu = createRawSnippet((participant: () => { userId: string }) => ({
    render: () => `<button>Menu for ${participant().userId}</button>`,
  }));

  it("hands nothing on the rail a member handle when identifiers are off", async () => {
    instance = mount(Harness, {
      target,
      props: {
        surface: MeetingRoster,
        properties: {
          participants: ROOM,
          ownParticipantId: "meetingGuestStay_1",
          hostMenu: handleMenu,
          showIdentifiers: false,
        },
      },
    });
    flushSync();
    await settle(1);

    expect(target.textContent).toContain("Rosalind Chase");
    expect(target.innerHTML).not.toContain("usr_2");
    expect(control("Menu for usr_2")).toBeUndefined();
  });

  it("keeps the rail as it was for a member, where the default leaves identifiers on", async () => {
    instance = mount(Harness, {
      target,
      props: {
        surface: MeetingRoster,
        properties: {
          participants: ROOM,
          ownParticipantId: "meetingGuestStay_1",
          hostMenu: handleMenu,
        },
      },
    });
    flushSync();
    await settle(1);

    expect(control("Menu for usr_2")).toBeDefined();
  });
});
