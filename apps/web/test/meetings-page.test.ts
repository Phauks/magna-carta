// @vitest-environment happy-dom
/*
 * The Meetings screen, mounted over a canned server: what it asks for, and what it does with the
 * answers.
 *
 * The questions are the part worth pinning. Three scopes are read, not one — and the upcoming scope
 * carries the READER'S own civil day, because a day is a day in a place and the server has no zone
 * to derive one in. A screen that sent no day would be refused by the route; a screen that sent the
 * wrong one would quietly list the wrong meetings, which is worse, so the day it sends is asserted
 * against the zone the test fixes rather than against the same expression the screen used.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { todayCivil } from "../src/lib/calendar/calendar-window.ts";
import Harness from "./meetings-page-harness.svelte";
import type { MeetingSummary } from "@magna-carta/api-client";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let asked: URL[] = [];

function meeting(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    id: "meeting_1",
    eventKind: "matter",
    eventId: "matterEvent_1",
    matterId: "matter_1",
    title: "Hearing preparation",
    startsOn: "2026-09-18",
    startsAtTime: "09:00",
    endsAtTime: "10:00",
    timeZone: "America/Denver",
    status: "live",
    startedAt: "2026-09-18T15:02:00.000Z",
    endedAt: null,
    medium: "video",
    liveCount: 3,
    locked: false,
    lobby: "off",
    configured: true,
    ...overrides,
  };
}

/** Answer each scope with its own page, and record every question asked. */
function answerWith(pages: Record<string, MeetingSummary[]>): void {
  const stub = ((request: Request) => {
    const url = new URL(request.url);
    asked.push(url);
    const scope = url.searchParams.get("scope") ?? "";
    const data = pages[scope] ?? [];
    return Promise.resolve(
      new Response(JSON.stringify({ data, nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

async function draw(): Promise<HTMLElement> {
  instance = mount(Harness, { target, props: {} });
  flushSync();
  // Three reads, each a round trip through the cache: what a case asserts on is the render after.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  return target;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  asked = [];
  queryClient.clear();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the Meetings screen", () => {
  it("asks each scope its own question, and tells the upcoming one which day is the reader's", async () => {
    answerWith({ live: [meeting()], upcoming: [], recent: [] });

    await draw();

    const scopes = asked.map((url) => url.searchParams.get("scope"));
    expect(new Set(scopes)).toEqual(new Set(["live", "upcoming", "recent"]));
    for (const url of asked) {
      expect(url.pathname).toBe("/api/v1/meetings");
      // Only the scope measured from a day carries one; the other two would be filing their answer
      // in the cache under a day that has nothing to do with what they asked.
      const day = url.searchParams.get("today");
      if (url.searchParams.get("scope") === "upcoming") expect(day).toBe(todayCivil());
      else expect(day).toBeNull();
    }
  });

  it("draws what came back under the section it belongs to", async () => {
    answerWith({
      live: [meeting()],
      upcoming: [
        meeting({
          id: "meeting_2",
          title: "Partners meeting",
          status: "scheduled",
        }),
      ],
      recent: [
        meeting({
          id: "meeting_3",
          title: "Case review",
          status: "ended",
          endedAt: "2026-09-17T16:00:00.000Z",
        }),
      ],
    });

    const rendered = await draw();

    expect(rendered.querySelector("h1")?.textContent?.trim()).toBe("Meetings");
    expect(rendered.querySelectorAll("table")).toHaveLength(3);
    expect(rendered.textContent).toContain("Hearing preparation");
    expect(rendered.textContent).toContain("Partners meeting");
    expect(rendered.textContent).toContain("Case review");
    // The room is one press away from the row, without going through the event first.
    expect(rendered.querySelector('a[href="/meetings/meeting_1"]')).not.toBeNull();
  });

  it("says meetings are not turned on rather than listing three empty sections", async () => {
    // The flag rides on the summaries themselves, which is how the server states it.
    answerWith({
      live: [meeting({ configured: false })],
      upcoming: [],
      recent: [],
    });

    const rendered = await draw();

    expect(rendered.textContent).toContain("Meetings Are Not Turned On");
    expect(rendered.querySelector("table")).toBeNull();
  });
});
