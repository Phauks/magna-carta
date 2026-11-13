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
import type { SearchStatus } from "$lib/settings/search-status.ts";
import { SETTINGS_SECTIONS } from "$lib/settings/settings-sections.ts";
import SearchSettingsPage from "./search-settings-page-harness.svelte";

const ORIGIN = "https://app.example";
const SETTINGS_PATH = "/api/v1/firm/search-settings";
const ROW = "search.file-contents-indexed";

const STATUS_PATH = "/api/v1/firm/search-status";
const REBUILD_PATH = "/api/v1/firm/search-status/rebuild";
const REBUILD_REQUESTED_AT = "2026-11-10T14:20:00.000Z";

const FRESH_FIRM: SearchSettings = { fileContentsIndexed: false, searchServiceConnected: false };
const INDEXING: SearchSettings = { fileContentsIndexed: true, searchServiceConnected: true };

/** A firm part-way through having its files read, with one place whose index fell behind. */
const CATCHING_UP: SearchStatus = {
  checkedAt: "2026-11-10T14:12:00.000Z",
  records: {
    places: [
      {
        key: "notes",
        label: "Notes",
        matchedFields: ["the note's text"],
        readBy: ["matter-search"],
        indexed: 3182,
        expected: 3182,
      },
      {
        key: "communications",
        label: "Messaging",
        matchedFields: ["what was said", "the caller's name"],
        readBy: ["matter-search", "conflicts-check"],
        indexed: 9120,
        expected: 9133,
      },
    ],
    rebuild: { requestedAt: null, finishedAt: null, outstanding: false },
  },
  fileContents: {
    turnedOn: true,
    serviceConnected: true,
    filesBelonging: 18240,
    filesIndexed: 6112,
    lastIndexedAt: "2026-11-10T09:02:00.000Z",
    dailyCatchUpLimit: 1000,
  },
  searchByMeaning: { turnedOn: false, serviceConnected: false },
};

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let sent: Sent[];
/** The Idempotency-Key each rebuild request carried, in the order they were sent. */
let rebuildKeys: (string | null)[];

/**
 * Answer the settings route with `settings`, and a PATCH with them merged with what was sent.
 * The status route answers `status` where one is given, and is not there at all where none is.
 * Asking for a rebuild is answered with the moment it was recorded, where the status route exists.
 */
function serve(settings: SearchSettings, status?: SearchStatus): void {
  let current = settings;
  const answer = async (
    method: string,
    path: string,
    body: string | null,
    idempotencyKey: string | null,
  ): Promise<Response> => {
    const parsed: unknown = body === null || body === "" ? null : JSON.parse(body);
    sent.push({ method, path, body: parsed });
    if (path === REBUILD_PATH && method === "POST" && status !== undefined) {
      rebuildKeys.push(idempotencyKey);
      return new Response(JSON.stringify({ requestedAt: REBUILD_REQUESTED_AT }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }
    if (path === STATUS_PATH && status !== undefined) {
      return new Response(JSON.stringify(status), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
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
        new Headers(init?.headers).get("idempotency-key"),
      );
    }
    return answer(
      request.method,
      new URL(request.url).pathname,
      await request.text(),
      request.headers.get("idempotency-key"),
    );
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

async function mountAs(
  permissions: readonly string[],
  settings: SearchSettings,
  status?: SearchStatus,
): Promise<void> {
  serve(settings, status);
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
  rebuildKeys = [];
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
    expect(row).toContain("by its contents, not just its name");
    expect(row).toContain("only show files a person can already open");
  });

  it("says the search service is not connected, beneath the switch, only while it is not", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], FRESH_FIRM);
    expect(noteBeneathRow()).toContain("File content search isn't connected yet");
    expect(noteBeneathRow()).toContain("still be found by name");
    remount();

    // On, and still no service: the page must not let "on" read as "searchable".
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], {
      fileContentsIndexed: true,
      searchServiceConnected: false,
    });
    expect(noteBeneathRow()).toContain("File content search isn't connected yet");
    remount();

    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], {
      fileContentsIndexed: false,
      searchServiceConnected: true,
    });
    expect(target.textContent).not.toContain("File content search isn't connected");
  });

  it("says existing files are read over days once indexing is on and the service is there", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], {
      fileContentsIndexed: true,
      searchServiceConnected: true,
    });
    expect(noteBeneathRow()).toContain("read as they arrive");
    expect(noteBeneathRow()).toContain("over the next few days");
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

describe("what the indexes hold, beneath the setting", () => {
  function statusRow(id: string): string {
    return words(target.querySelector(`#settings-row-${CSS.escape(id)}`)?.textContent);
  }

  function tableRows(): string[] {
    return [...target.querySelectorAll("table tbody tr")].map((row) => words(row.textContent));
  }

  it("counts once when the page opens, and states each index's standing with its figure", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    expect(sent.filter((call) => call.path === STATUS_PATH)).toHaveLength(1);

    // One place behind makes the record index behind; the figure is every place added up.
    expect(statusRow("search.status.records")).toContain("Behind");
    expect(statusRow("search.status.records")).toContain("12,302 records");
    expect(statusRow("search.status.file-contents")).toContain("Partly Indexed");
    expect(statusRow("search.status.file-contents")).toContain("6,112 of 18,240 files");
    expect(statusRow("search.status.search-by-meaning")).toContain("Turned Off");
  });

  it("says why the files figure is short, beneath the row it is about", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    const note = words(
      target.querySelector(`#settings-row-${CSS.escape("search.status.file-contents")}`)
        ?.nextElementSibling?.textContent,
    );
    expect(note).toContain("up to 1,000 a day");
    expect(note).toContain("such as scanned pages");
  });

  it("lists every indexed place with what it holds, who reads it and what is matched there", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    const rows = tableRows().join(" | ");
    expect(rows).toContain("Notes");
    expect(rows).toContain("The note's text");
    expect(rows).toContain("Matter Search, Conflicts Check");
    expect(rows).toContain("9,120");
    // Thirteen messages the index does not hold, and the place says so.
    expect(rows).toContain("13");
    expect(rows).toContain("Behind");
    expect(rows).toContain("Inside Files");
    expect(rows).toContain("12,128");
    expect(words(target.textContent)).toContain(
      "Review sets are searched only from inside the set",
    );
  });

  it("counts again only when asked to", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    const again = [...target.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Count Again",
    );
    expect(again).toBeDefined();
    again?.click();
    await settle();
    expect(sent.filter((call) => call.path === STATUS_PATH)).toHaveLength(2);
  });

  it("says the count could not be made, and keeps the setting usable", async () => {
    // No status route at all: the settings above it must not be taken down with it.
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], FRESH_FIRM);
    expect(words(target.textContent)).toContain("The Indexes Could Not Be Counted");
    expect(target.querySelector('button[role="switch"]')).not.toBeNull();
    expect(target.querySelector("table")).toBeNull();
  });

  it("is not asked for on behalf of a member who could not be answered", async () => {
    await mountAs(["search:matter"], INDEXING, CATCHING_UP);
    expect(sent.some((call) => call.path === STATUS_PATH)).toBe(false);
    expect(target.textContent).not.toContain("What Is Indexed");
  });
});

describe("rebuilding a place that is behind", () => {
  const UP_TO_DATE: SearchStatus = {
    ...CATCHING_UP,
    records: {
      ...CATCHING_UP.records,
      places: CATCHING_UP.records.places.map((place) => ({ ...place, expected: place.indexed })),
    },
  };

  function button(label: string): HTMLButtonElement | undefined {
    return [...target.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function row(id: string): Element | null {
    return target.querySelector(`#settings-row-${CSS.escape(id)}`);
  }

  it("offers Rebuild beneath Records while a place is behind", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    expect(row("search.status.records")?.nextElementSibling).toBe(row("search.status.rebuild"));
    expect(words(row("search.status.rebuild")?.textContent)).toContain(
      "Nothing the firm holds is changed.",
    );
    expect(button("Rebuild")).toBeDefined();
  });

  it("offers nothing to press while every place is up to date", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, UP_TO_DATE);
    expect(row("search.status.rebuild")).toBeNull();
    expect(row("search.status.rebuild-asked-for")).toBeNull();
    expect(button("Rebuild")).toBeUndefined();
  });

  it("asks once on a press, names no place, and then says when it was asked for", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    button("Rebuild")?.click();
    await settle();

    expect(sent.filter((call) => call.path === REBUILD_PATH)).toEqual([
      { method: "POST", path: REBUILD_PATH, body: null },
    ]);
    expect(rebuildKeys).toHaveLength(1);
    expect(rebuildKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    // The counts were not asked for again: nothing in them has changed yet.
    expect(sent.filter((call) => call.path === STATUS_PATH)).toHaveLength(1);

    expect(row("search.status.rebuild")).toBeNull();
    const askedFor = words(row("search.status.rebuild-asked-for")?.textContent);
    expect(askedFor).toContain("Rebuild Asked For");
    expect(askedFor).toContain("Count again to see where it stands.");
    expect(askedFor).toContain("2026");
    // The place still reads Behind until a count says otherwise.
    expect(words(row("search.status.records")?.textContent)).toContain("Behind");
  });

  it("says a rebuild is outstanding when the server says so, on a page opened afterwards", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, {
      ...CATCHING_UP,
      records: {
        ...CATCHING_UP.records,
        rebuild: { requestedAt: REBUILD_REQUESTED_AT, finishedAt: null, outstanding: true },
      },
    });
    expect(row("search.status.rebuild")).toBeNull();
    expect(row("search.status.rebuild-asked-for")).not.toBeNull();
    expect(button("Ask Again")).toBeDefined();
  });

  it("says the rebuild was not asked for when the request fails", async () => {
    await mountAs([MANAGE_SEARCH_SETTINGS_PERMISSION], INDEXING, CATCHING_UP);
    // The status stands; the route to ask on is gone.
    vi.stubGlobal("fetch", (async () => new Response(null, { status: 500 })) as typeof fetch);
    client.setConfig({
      baseUrl: ORIGIN,
      fetch: (async () => new Response(null, { status: 500 })) as typeof fetch,
    });
    button("Rebuild")?.click();
    await settle();
    expect(words(target.textContent)).toContain("The Rebuild Was Not Asked For");
    // Still offered, and nothing claims it was asked for.
    expect(button("Rebuild")).toBeDefined();
    expect(row("search.status.rebuild-asked-for")).toBeNull();
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
