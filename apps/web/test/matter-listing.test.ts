/*
 * Reading the WHOLE docket.
 *
 * The listing endpoint's default omits unnumbered consultations and its status parameter takes one
 * status, never "all", so "every matter" is two reads merged. That merge is the only place on this
 * screen where a bug is silent: half a docket looks exactly like a small firm. So the properties
 * that make it honest are pinned here — both kinds are asked for, an exhausted stream is never
 * re-read from the top, a "load more" that has nothing left says so, and either read failing fails
 * the whole thing rather than quietly serving half the record.
 */
import { describe, expect, it } from "vitest";
import { listEveryMatter, type MatterSummary } from "../src/lib/matters/matters-api.ts";

function matter(id: string, overrides: Partial<MatterSummary> = {}): MatterSummary {
  return {
    id,
    title: `Matter ${id}`,
    status: "open",
    matterTypeId: null,
    locationId: null,
    responsibleMemberId: "user_osei",
    clientDisplayName: "Eleanor Pemberton",
    clientEntityId: null,
    matterNumber: "2026-0147",
    consultationNumber: null,
    createdAt: "2026-08-14T09:00:00.000Z",
    ...overrides,
  };
}

interface StubPage {
  data: MatterSummary[];
  nextCursor: string | null;
}

/**
 * A fetch that answers each request from a canned page chosen by the request's own query, and
 * records every path it was asked for — which is how "the exhausted stream was not re-read" is
 * asserted without reaching inside the module.
 */
function stubFetch(pages: (path: string) => StubPage | number): {
  fetchImpl: typeof fetch;
  paths: string[];
} {
  const paths: string[] = [];
  const fetchImpl = ((input: string) => {
    paths.push(input);
    const answer = pages(input);
    if (typeof answer === "number") {
      return Promise.resolve(
        new Response(JSON.stringify({ status: answer, title: "no" }), {
          status: answer,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, paths };
}

const numbered = (path: string): boolean => !path.includes("status=consultation");

describe("the whole docket", () => {
  it("asks for the numbered matters AND the consultations, and merges them", async () => {
    const stub = stubFetch((path) =>
      numbered(path)
        ? { data: [matter("matter_open")], nextCursor: null }
        : {
            data: [matter("matter_consult", { status: "consultation", matterNumber: null })],
            nextCursor: null,
          },
    );

    const outcome = await listEveryMatter(stub.fetchImpl);

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.data.map((row) => row.id)).toEqual(["matter_open", "matter_consult"]);
    expect(stub.paths.some((path) => path.includes("status=consultation"))).toBe(true);
    expect(stub.paths.some((path) => !path.includes("status="))).toBe(true);
  });

  it("is complete when both streams are — nothing more to ask for", async () => {
    const stub = stubFetch(() => ({ data: [], nextCursor: null }));
    const outcome = await listEveryMatter(stub.fetchImpl);
    expect(outcome.kind === "ok" && outcome.value.nextCursor).toBeNull();
  });

  it("continues each stream from its OWN place, and never re-reads an exhausted one", async () => {
    const first = stubFetch((path) =>
      numbered(path)
        ? { data: [matter("matter_one")], nextCursor: "numbered-2" }
        : { data: [matter("matter_consult")], nextCursor: null },
    );
    const opening = await listEveryMatter(first.fetchImpl);
    expect(opening.kind).toBe("ok");
    if (opening.kind !== "ok") return;
    const cursor = opening.value.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;

    const second = stubFetch((path) => {
      // The consultations stream was exhausted by the first read; asking it again would serve its
      // first page for ever, so the read must not happen at all.
      expect(numbered(path)).toBe(true);
      expect(path).toContain("cursor=numbered-2");
      return { data: [matter("matter_two")], nextCursor: null };
    });
    const more = await listEveryMatter(second.fetchImpl, { cursor });

    expect(second.paths).toHaveLength(1);
    expect(more.kind === "ok" && more.value.data.map((row) => row.id)).toEqual(["matter_two"]);
    expect(more.kind === "ok" && more.value.nextCursor).toBeNull();
  });

  it("carries the search to both streams", async () => {
    const stub = stubFetch(() => ({ data: [], nextCursor: null }));
    await listEveryMatter(stub.fetchImpl, { search: "Pemberton" });
    expect(stub.paths).toHaveLength(2);
    for (const path of stub.paths) expect(path).toContain("search=Pemberton");
  });

  it("fails the read when EITHER stream fails, rather than serving half a docket", async () => {
    const consultationsRefused = stubFetch((path) =>
      numbered(path) ? { data: [matter("matter_open")], nextCursor: null } : 500,
    );
    const outcome = await listEveryMatter(consultationsRefused.fetchImpl);
    expect(outcome.kind).toBe("problem");

    const numberedRefused = stubFetch((path) =>
      numbered(path) ? 500 : { data: [], nextCursor: null },
    );
    expect((await listEveryMatter(numberedRefused.fetchImpl)).kind).toBe("problem");
  });
});
