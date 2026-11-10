// @vitest-environment happy-dom
/*
 * The Search and Indexing settings page, mounted over a canned server: what a firm Owner reads
 * before turning file indexing on, and what a save sends.
 *
 * Pinned because the switch alone would let a firm believe something untrue twice over:
 *
 *   - the row says what turning it on does, in plain words — the words inside the firm's files are
 *     read and an index of them kept in the firm's own storage;
 *   - a deployment with no search service is SAID to have none, beneath the switch, so "on" is
 *     never read as "searchable";
 *   - once indexing is on and the service is there, the page says the files already held are read
 *     over days, not at once;
 *   - a save sends exactly the staged change to the settings route;
 *   - a matter's search that answers "turned off" names this page, and the page exists.
 */
import { client } from "@magna-carta/api-client/client";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
import { emptyGroupLine } from "$lib/matters/matter-search-presentation.ts";
import type { SessionBootstrap } from "$lib/matters/matters-api.ts";
import {
  MANAGE_SEARCH_SETTINGS_PERMISSION,
  type SearchSettings,
} from "$lib/settings/search-settings-api.ts";
import { SETTINGS_SECTIONS } from "$lib/settings/settings-sections.ts";
import SearchSettingsPage from "./search-settings-page-harness.svelte";

const ORIGIN = "https://app.example";
const SETTINGS_PATH = "/api/v1/firm/search-settings";
const ROW = "search.file-contents-indexed";

const FRESH_FIRM: SearchSettings = { fileContentsIndexed: false, searchServiceConnected: false };

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let sent: Sent[];

/** Answer the settings route with `settings`, and a PATCH with them merged with what was sent. */
function serve(settings: SearchSettings): void {
  let current = settings;
  const answer = async (method: string, path: string, body: string | null): Promise<Response> => {
    const parsed: unknown = body === null || body === "" ? null : JSON.parse(body);
    sent.push({ method, path, body: parsed });
    if (path !== SETTINGS_PATH) return new Response(null, { status: 404 });
    if (method === "PATCH") current = { ...current, ...(parsed as Partial<SearchSettings>) };
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

function rowText(): string {
  return words(target.querySelector(`#settings-row-${CSS.escape(ROW)}`)?.textContent);
}

function noteBeneathRow(): string {
  // The note beneath a row is the row's next sibling inside the plate's rule rhythm.
  return words(
    target.querySelector(`#settings-row-${CSS.escape(ROW)}`)?.nextElementSibling?.textContent,
  );
}

async function mountAs(permissions: readonly string[], settings: SearchSettings): Promise<void> {
  serve(settings);
  sessionPermissions.session = {
    permissions,
    user: { id: "user_1" },
  } as unknown as SessionBootstrap;
  sessionPermissions.settled = true;
  sessionPermissions.failed = false;
  instance = mount(SearchSettingsPage, { target });
  await settle();
}

function remount(): void {
  void unmount(instance as Record<string, unknown>);
  instance = undefined;
  target.innerHTML = "";
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

describe("the Search and Indexing section", () => {
  it("is a shipped firm section under Data & Platform, in draft mode", () => {
    const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === "search-and-indexing");
    expect(section).toMatchObject({
      label: "Search and Indexing",
      href: "/settings/search-and-indexing",
      group: "data-platform",
      scope: "firm",
      commitMode: "draft",
      editPermissionArea: "search",
      shipped: true,
    });
  });

  it("is the page a matter's search names when the firm has file indexing off", () => {
    const line = emptyGroupLine("not-indexed", "file-contents");
    expect(line).toContain("turned off for this firm");
    const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === "search-and-indexing");
    expect(line).toContain(`under ${section?.label}`);
  });
});

describe("the page, read by a firm Owner", () => {
  it("reads the settings route and says what turning the switch on does", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], FRESH_FIRM);
    expect(sent.some((call) => call.method === "GET" && call.path === SETTINGS_PATH)).toBe(true);

    const row = rowText();
    expect(row).toContain("Search Inside Files");
    expect(row).toContain("Reads the words inside the firm's files");
    expect(row).toContain("in the firm's own storage");
    expect(row).toContain("only to somebody who could already open it");
  });

  it("says the search service is not connected, beneath the switch, only while it is not", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], FRESH_FIRM);
    expect(noteBeneathRow()).toContain("search service is not connected yet");
    expect(noteBeneathRow()).toContain("still found by name");
    remount();

    // On, and still no service: the page must not let "on" read as "searchable".
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], {
      fileContentsIndexed: true,
      searchServiceConnected: false,
    });
    expect(noteBeneathRow()).toContain("search service is not connected yet");
    remount();

    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], {
      fileContentsIndexed: false,
      searchServiceConnected: true,
    });
    expect(target.textContent).not.toContain("search service is not connected");
  });

  it("says existing files are read over days once indexing is on and the service is there", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], {
      fileContentsIndexed: true,
      searchServiceConnected: true,
    });
    expect(noteBeneathRow()).toContain("read as it arrives");
    expect(noteBeneathRow()).toContain("over the following days");
  });

  it("sends exactly the staged change when the Owner saves", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], FRESH_FIRM);
    const indexingSwitch = target.querySelector<HTMLButtonElement>(
      `#${CSS.escape(`settings-${ROW}`)}`,
    );
    expect(indexingSwitch?.getAttribute("role")).toBe("switch");
    indexingSwitch?.click();
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
      { method: "PATCH", path: SETTINGS_PATH, body: { fileContentsIndexed: true } },
    ]);
  });
});

describe("the page, read by a member without the right", () => {
  it("engraves the value and offers no switch and no Save", async () => {
    await mountAs(["search:matter"], { fileContentsIndexed: true, searchServiceConnected: true });
    expect(target.querySelector('button[role="switch"]')).toBeNull();
    expect(
      [...target.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Save",
      ),
    ).toBe(false);
    expect(rowText()).toContain("On");
  });
});
