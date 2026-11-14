// @vitest-environment happy-dom
/*
 * The Meetings settings page, mounted over a canned server: what a firm Owner reads before switching
 * anything, and what a save sends.
 *
 * Pinned because each sentence here is the firm being told what a switch does with a privileged
 * conversation, and two of them are facts the switch alone would hide:
 *
 *   - every row says what it does — recording announces itself and adds audio to the matter, a
 *     summary is written from the transcript, captions are for a live meeting, and the ceiling's
 *     maximum is the recorder's memory, stated from the read rather than written into the page;
 *   - a deployment whose recording service is not configured is SAID to be, beneath the switch,
 *     and only then;
 *   - a summary's dependency on third-party AI processing is stated with the way to the AI settings
 *     page, by name, and whether that gate is on;
 *   - a save sends exactly the staged change, sparse, to the settings route.
 */
import { client } from "@magna-carta/api-client/client";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
import type { SessionBootstrap } from "$lib/matters/matters-api.ts";
import {
  MANAGE_MEETING_SETTINGS_PERMISSION,
  type MeetingSettings,
} from "$lib/settings/meeting-settings-api.ts";
import { SETTINGS_SECTIONS } from "$lib/settings/settings-sections.ts";
import MeetingSettingsPage from "./meeting-settings-page-harness.svelte";

const ORIGIN = "https://app.example";
const SETTINGS_PATH = "/api/v1/firm/meetings/settings";

const FRESH_FIRM: MeetingSettings = {
  recordingEnabled: false,
  captionsEnabled: false,
  summariesEnabled: false,
  recordedTrackCeiling: 11,
  recordedTrackCeilingMaximum: 11,
  recordingServiceConfigured: false,
  aiProcessingEligible: false,
};

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let sent: Sent[];

/** Answer the settings route with `settings`, and a PATCH with them merged with what was sent. */
function serve(settings: MeetingSettings): void {
  let current = settings;
  const answer = async (method: string, path: string, body: string | null): Promise<Response> => {
    const parsed: unknown = body === null || body === "" ? null : JSON.parse(body);
    sent.push({ method, path, body: parsed });
    if (path !== SETTINGS_PATH) return new Response(null, { status: 404 });
    if (method === "PATCH") current = { ...current, ...(parsed as Partial<MeetingSettings>) };
    return new Response(JSON.stringify(current), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const stub = (async (request: Request | string, init?: RequestInit) => {
    if (typeof request === "string") {
      return answer(
        init?.method ?? "GET",
        new URL(request, ORIGIN).pathname,
        typeof init?.body === "string" ? init.body : null,
      );
    }
    return answer(request.method, new URL(request.url).pathname, await request.text());
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
  vi.stubGlobal("fetch", stub);
}

async function settle(remaining = 6): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

/** Text as a reader reads it: the template's line breaks are one space. */
function words(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function rowText(id: string): string {
  return words(target.querySelector(`#settings-row-${CSS.escape(id)}`)?.textContent);
}

function plateTextAfter(id: string): string {
  // The note beneath a row is the row's next sibling inside the plate's rule rhythm.
  return words(
    target.querySelector(`#settings-row-${CSS.escape(id)}`)?.nextElementSibling?.textContent,
  );
}

async function mountAs(permissions: readonly string[], settings: MeetingSettings): Promise<void> {
  serve(settings);
  sessionPermissions.session = {
    permissions,
    user: { id: "user_1" },
  } as unknown as SessionBootstrap;
  sessionPermissions.settled = true;
  sessionPermissions.failed = false;
  instance = mount(MeetingSettingsPage, { target });
  await settle();
}

beforeEach(() => {
  sent = [];
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  document.body.innerHTML = "";
  sessionPermissions.session = null;
  sessionPermissions.settled = false;
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
  vi.unstubAllGlobals();
});

describe("the Meetings section", () => {
  it("is a shipped firm section under Practice, in draft mode", () => {
    const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === "meetings");
    expect(section).toMatchObject({
      href: "/settings/meetings",
      group: "practice",
      scope: "firm",
      commitMode: "draft",
      editPermissionArea: "meetings",
      shipped: true,
    });
  });
});

describe("the page, read by a firm Owner", () => {
  it("reads the settings route and explains each setting in plain words", async () => {
    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], FRESH_FIRM);
    expect(sent.some((call) => call.method === "GET" && call.path === SETTINGS_PATH)).toBe(true);

    const recording = rowText("meetings.recording-enabled");
    expect(recording).toContain("Record Meetings");
    expect(recording).toContain("Everyone in the meeting is told");
    expect(recording).toContain("added to the matter");

    const summaries = rowText("meetings.summaries-enabled");
    expect(summaries).toContain("Summarize Recorded Meetings");
    expect(summaries).toContain("transcript");

    const captions = rowText("meetings.captions-enabled");
    expect(captions).toContain("Live Captions");
    expect(captions).toContain("during a live meeting");

    const ceiling = rowText("meetings.recorded-track-ceiling");
    expect(ceiling).toContain("People Recorded at Once");
    expect(ceiling).toContain("from 1 to 11");
    expect(ceiling).toContain("the most the recorder can handle");
  });

  it("states the ceiling's maximum from the read, not from the page", async () => {
    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], {
      ...FRESH_FIRM,
      recordedTrackCeiling: 7,
      recordedTrackCeilingMaximum: 9,
    });
    const ceiling = rowText("meetings.recorded-track-ceiling");
    expect(ceiling).toContain("from 1 to 9");
    const field = target.querySelector<HTMLInputElement>(
      `#${CSS.escape("settings-meetings.recorded-track-ceiling")}`,
    );
    expect(field?.max).toBe("9");
    expect(field?.value).toBe("7");
  });

  it("says the recording service is not configured, beneath the recording switch, only while it is not", async () => {
    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], FRESH_FIRM);
    expect(plateTextAfter("meetings.recording-enabled")).toContain("recording isn't set up yet");
    void unmount(instance as Record<string, unknown>);
    instance = undefined;
    target.innerHTML = "";

    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], {
      ...FRESH_FIRM,
      recordingServiceConfigured: true,
    });
    expect(target.textContent).not.toContain("recording service is not configured");
  });

  it("links a summary's dependency to AI and the Assistant, saying whether it is on", async () => {
    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], FRESH_FIRM);
    const note = target.querySelector(
      `#settings-row-${CSS.escape("meetings.summaries-enabled")}`,
    )?.nextElementSibling;
    const link = note?.querySelector<HTMLAnchorElement>('a[href="/settings/ai"]');
    expect(link?.textContent?.trim()).toBe("AI and the Assistant");
    expect(words(note?.textContent)).toContain("which is off");
    expect(words(note?.textContent)).toContain("No summary is written");
    void unmount(instance as Record<string, unknown>);
    instance = undefined;
    target.innerHTML = "";

    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], {
      ...FRESH_FIRM,
      aiProcessingEligible: true,
    });
    expect(plateTextAfter("meetings.summaries-enabled")).toContain("which is on");
  });

  it("sends exactly the staged change when the Owner saves", async () => {
    await mountAs([MANAGE_MEETING_SETTINGS_PERMISSION], FRESH_FIRM);
    const recordingSwitch = target.querySelector<HTMLButtonElement>(
      `#${CSS.escape("settings-meetings.recording-enabled")}`,
    );
    expect(recordingSwitch?.getAttribute("role")).toBe("switch");
    recordingSwitch?.click();
    flushSync();

    const save = [...target.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save",
    );
    expect(save).toBeDefined();
    save?.click();
    await settle();
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save Changes",
    );
    expect(confirm).toBeDefined();
    confirm?.click();
    await settle();

    const patches = sent.filter((call) => call.method === "PATCH");
    expect(patches).toEqual([
      { method: "PATCH", path: SETTINGS_PATH, body: { recordingEnabled: true } },
    ]);
  });
});

describe("the page, read by a member without the right", () => {
  it("engraves the values and offers no switch and no Save", async () => {
    await mountAs(["meetings:record"], { ...FRESH_FIRM, recordingEnabled: true });
    expect(target.querySelector('button[role="switch"]')).toBeNull();
    expect(
      [...target.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Save",
      ),
    ).toBe(false);
    expect(rowText("meetings.recording-enabled")).toContain("On");
  });
});
