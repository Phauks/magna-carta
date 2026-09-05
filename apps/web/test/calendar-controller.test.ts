/*
 * The controller's address: what it reads on start, and what it writes back. The router is not
 * here, so `$app/state` is a page whose address the test sets and `$app/navigation` records what
 * was mirrored; the parsing and the writing are pure and asserted directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalendarController,
  mirroredAddress,
  refinementsFromAddress,
  type CalendarHost,
  type MirroredState,
} from "$lib/calendar/calendar-controller.svelte.ts";
import type { CalendarScope } from "$lib/calendar/calendar-scope.ts";
import type { CalendarView } from "$lib/calendar/calendar-window.ts";

const router = vi.hoisted(() => ({
  page: { url: new URL("https://firm.example/calendar"), state: {} },
  replaceState: vi.fn<(url: URL, state: unknown) => void>(),
}));

vi.mock("$app/state", () => ({ page: router.page }));
vi.mock("$app/navigation", () => ({ replaceState: router.replaceState }));

function parameters(query: string): URLSearchParams {
  return new URL(`https://firm.example/calendar${query}`).searchParams;
}

const firmSide: MirroredState = {
  view: "month",
  anchor: "2026-09-15",
  firmSide: true,
  scopeChoice: "everyone",
  memberChoice: null,
  layers: new Set(),
  hideSettled: false,
};

describe("refinementsFromAddress", () => {
  it("says nothing when the address says nothing", () => {
    expect(refinementsFromAddress(parameters(""))).toEqual({
      scopeChoice: undefined,
      memberChoice: null,
      layers: new Set(),
      hideSettled: false,
    });
  });

  it("reads Mine and Everyone", () => {
    expect(refinementsFromAddress(parameters("?scope=mine")).scopeChoice).toBe("mine");
    expect(refinementsFromAddress(parameters("?scope=everyone")).scopeChoice).toBe("everyone");
  });

  it("reads a colleague as the member after the prefix", () => {
    expect(refinementsFromAddress(parameters("?scope=member:user_ada"))).toMatchObject({
      scopeChoice: "member",
      memberChoice: "user_ada",
    });
  });

  it("says nothing for a colleague with no identifier, or a word it does not know", () => {
    expect(refinementsFromAddress(parameters("?scope=member:"))).toMatchObject({
      scopeChoice: undefined,
      memberChoice: null,
    });
    expect(refinementsFromAddress(parameters("?scope=team")).scopeChoice).toBeUndefined();
  });

  it("keeps the layers the vocabulary carries and drops the rest", () => {
    expect(refinementsFromAddress(parameters("?layers=custody,billing")).layers).toEqual(
      new Set(["custody"]),
    );
    expect(refinementsFromAddress(parameters("?layers=")).layers).toEqual(new Set());
  });

  it("hides the settled only on the one word", () => {
    expect(refinementsFromAddress(parameters("?hide=settled")).hideSettled).toBe(true);
    expect(refinementsFromAddress(parameters("?hide=all")).hideSettled).toBe(false);
  });
});

describe("mirroredAddress", () => {
  it("writes the view, the date and the scope, and leaves every other key as it was", () => {
    const current = new URL("https://firm.example/calendar?entry=matterEvent_1&view=week");
    const mirrored = mirroredAddress(current, firmSide);
    expect(mirrored.searchParams.get("entry")).toBe("matterEvent_1");
    expect(mirrored.searchParams.get("view")).toBe("month");
    expect(mirrored.searchParams.get("date")).toBe("2026-09-15");
    expect(mirrored.searchParams.get("scope")).toBe("everyone");
    expect(mirrored.pathname).toBe("/calendar");
  });

  it("never writes to the address it was given", () => {
    const current = new URL("https://firm.example/calendar");
    mirroredAddress(current, firmSide);
    expect(current.search).toBe("");
  });

  it("names a colleague by the prefix and the member, and a colleague choice with no colleague as Everyone", () => {
    expect(
      mirroredAddress(new URL("https://firm.example/calendar"), {
        ...firmSide,
        scopeChoice: "member",
        memberChoice: "user_ada",
      }).searchParams.get("scope"),
    ).toBe("member:user_ada");
    expect(
      mirroredAddress(new URL("https://firm.example/calendar"), {
        ...firmSide,
        scopeChoice: "member",
        memberChoice: null,
      }).searchParams.get("scope"),
    ).toBe("everyone");
    expect(
      mirroredAddress(new URL("https://firm.example/calendar"), {
        ...firmSide,
        scopeChoice: "mine",
      }).searchParams.get("scope"),
    ).toBe("mine");
  });

  it("writes the layers sorted, and removes the key when none are on", () => {
    const on = mirroredAddress(new URL("https://firm.example/calendar"), {
      ...firmSide,
      layers: new Set(["zeta", "custody"]),
    });
    expect(on.searchParams.get("layers")).toBe("custody,zeta");
    const off = mirroredAddress(new URL("https://firm.example/calendar?layers=custody"), firmSide);
    expect(off.searchParams.has("layers")).toBe(false);
  });

  it("writes the hide on the one word, and removes it otherwise", () => {
    const hidden = mirroredAddress(new URL("https://firm.example/calendar"), {
      ...firmSide,
      hideSettled: true,
    });
    expect(hidden.searchParams.get("hide")).toBe("settled");
    const shown = mirroredAddress(new URL("https://firm.example/calendar?hide=settled"), firmSide);
    expect(shown.searchParams.has("hide")).toBe(false);
  });

  it("drops the scope and the layers off the firm side, where they mean nothing", () => {
    const mirrored = mirroredAddress(
      new URL("https://firm.example/matters/matter_1/calendar?scope=mine&layers=custody"),
      { ...firmSide, firmSide: false, scopeChoice: "mine", layers: new Set(["custody"]) },
    );
    expect(mirrored.searchParams.has("scope")).toBe(false);
    expect(mirrored.searchParams.has("layers")).toBe(false);
    expect(mirrored.searchParams.get("view")).toBe("month");
  });
});

describe("the controller over the router", () => {
  function host(scope: CalendarScope): CalendarHost & { readonly written: string[] } {
    let view: CalendarView = "month";
    let anchor = "2026-09-15";
    const written: string[] = [];
    return {
      written,
      scope: () => scope,
      view: () => view,
      setView: (next) => {
        view = next;
        written.push(`view=${next}`);
      },
      anchor: () => anchor,
      setAnchor: (next) => {
        anchor = next;
        written.push(`date=${next}`);
      },
      address: () => true,
      weekStartsOn: () => 0,
      agendaDays: () => 14,
      memberId: () => "user_me",
      context: () => ({
        matterNumbers: new Map(),
        eventTypesByCode: new Map(),
        readerTimeZone: "UTC",
      }),
      contextReady: () => true,
    };
  }

  beforeEach(() => {
    router.replaceState.mockClear();
  });

  it("reads the address first on start, and hands the view and the date to the host", () => {
    router.page.url = new URL(
      "https://firm.example/calendar?view=week&date=2026-09-02&scope=member:user_ada&layers=custody&hide=settled",
    );
    const controlled = host({ kind: "firm" });
    const controller = new CalendarController(controlled);
    expect(controlled.written).toEqual(["view=week", "date=2026-09-02"]);
    expect(controller.scopeChoice).toBe("member");
    expect(controller.memberChoice).toBe("user_ada");
    expect(controller.layers).toEqual(new Set(["custody"]));
    expect(controller.hideSettled).toBe(true);
    expect(controller.scope).toEqual({ kind: "mine", memberId: "user_ada" });
  });

  it("mirrors nothing when the address already says what is on screen, and replaces it when it does not", () => {
    router.page.url = new URL("https://firm.example/calendar?view=week&date=2026-09-02&scope=mine");
    const controller = new CalendarController(host({ kind: "firm" }));
    controller.mirrorAddress();
    expect(router.replaceState).not.toHaveBeenCalled();

    controller.chooseScope("everyone");
    controller.mirrorAddress();
    expect(router.replaceState).toHaveBeenCalledTimes(1);
    const [mirrored] = router.replaceState.mock.calls[0] ?? [];
    expect(mirrored?.search).toBe("?view=week&date=2026-09-02&scope=everyone");
  });
});
