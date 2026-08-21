import { describe, expect, it } from "vitest";
import type { ApiOutcome, Page } from "../src/lib/api/request.ts";
import { PagedList } from "../src/lib/matters/paged-list.svelte.ts";

interface Row {
  id: string;
}

/** A reader that answers from a scripted list of pages, one per call, in order. */
function reader(...pages: ApiOutcome<Page<Row>>[]): {
  read: (cursor?: string) => Promise<ApiOutcome<Page<Row>>>;
  cursorsSeen: (string | undefined)[];
} {
  const cursorsSeen: (string | undefined)[] = [];
  let call = 0;
  return {
    cursorsSeen,
    read: (cursor?: string) => {
      cursorsSeen.push(cursor);
      const page = pages[call] ?? pages.at(-1);
      call += 1;
      return Promise.resolve(page as ApiOutcome<Page<Row>>);
    },
  };
}

const ok = (ids: string[], nextCursor: string | null): ApiOutcome<Page<Row>> => ({
  kind: "ok",
  value: { data: ids.map((id) => ({ id })), nextCursor },
});

describe("a paged section list", () => {
  it("appends the next page rather than replacing what is on screen", async () => {
    const list = new PagedList<Row>("unreadable");
    const { read, cursorsSeen } = reader(ok(["a", "b"], "CURSOR-1"), ok(["c"], null));
    list.reset("matter_1");

    await list.load(read);
    expect(list.items?.map((row) => row.id)).toEqual(["a", "b"]);
    expect(list.nextCursor).toBe("CURSOR-1");

    await list.loadMore(read);
    expect(list.items?.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(list.nextCursor).toBeNull();
    // The first read carries no cursor; the second carries the one the first handed back.
    expect(cursorsSeen).toEqual([undefined, "CURSOR-1"]);
  });

  it("refuses a further page when the record has no more", async () => {
    const list = new PagedList<Row>("unreadable");
    const { read, cursorsSeen } = reader(ok(["a"], null));
    list.reset("matter_1");
    await list.load(read);

    await list.loadMore(read);
    expect(cursorsSeen).toHaveLength(1);
    expect(list.items?.map((row) => row.id)).toEqual(["a"]);
  });

  it("keeps the rows already read when a FURTHER page fails", async () => {
    // They were read successfully and are still true. Only the first page has nothing to keep.
    const list = new PagedList<Row>("The costs could not be read.");
    const { read } = reader(ok(["a"], "CURSOR-1"), { kind: "transport" });
    list.reset("matter_1");
    await list.load(read);

    await list.loadMore(read);
    expect(list.items?.map((row) => row.id)).toEqual(["a"]);
    expect(list.failure).toBe("Nothing answered. The costs could not be read.");
  });

  it("says the server's own words when it sent any, and its own when it did not", async () => {
    const withDetail = new PagedList<Row>("fallback");
    withDetail.reset("matter_1");
    await withDetail.load(() =>
      Promise.resolve({ kind: "problem", problem: { status: 403, detail: "Not your matter." } }),
    );
    expect(withDetail.failure).toBe("Not your matter.");

    const without = new PagedList<Row>("fallback");
    without.reset("matter_1");
    await without.load(() => Promise.resolve({ kind: "problem", problem: { status: 500 } }));
    expect(without.failure).toBe("fallback");
  });

  it("discards a page that resolves after the subject changed", async () => {
    // The read of the previous matter must not land in the new matter's table. This is the failure
    // the per-screen copies had: an in-flight page resolving against whatever was on screen.
    const list = new PagedList<Row>("unreadable");
    let release: (value: ApiOutcome<Page<Row>>) => void = () => {};
    const slow = new Promise<ApiOutcome<Page<Row>>>((resolve) => {
      release = resolve;
    });

    list.reset("matter_1");
    const inFlight = list.load(() => slow);
    list.reset("matter_2");
    release(ok(["stale"], null));
    await inFlight;

    expect(list.items).toBeNull();
    expect(list.showing("matter_2")).toBe(true);
  });

  it("tells a reload of the same subject from a change of subject", async () => {
    const list = new PagedList<Row>("unreadable");
    list.reset("matter_1");
    await list.load(reader(ok(["a"], null)).read);

    expect(list.showing("matter_1")).toBe(true);
    expect(list.showing("matter_2")).toBe(false);
    // A screen that re-runs its effect for the same matter keeps the table it already has.
    expect(list.items?.map((row) => row.id)).toEqual(["a"]);
  });

  it("settles a sample matter as a complete empty record, not a loading one", async () => {
    const list = new PagedList<Row>("unreadable");
    list.reset("matter_sample");
    list.settleEmpty();
    expect(list.items).toEqual([]);
    expect(list.nextCursor).toBeNull();
    await Promise.resolve();
  });
});
