/*
 * The matter's paper file, as this app reads and writes it.
 *
 * TWO OFFICES AND THEY ARE NOT THE SAME FACT. A matter names the office it is RUN OUT OF and the
 * office its folder is KEPT AT, and one word ("Location") on two screens is what used to hide that.
 * A reader sent to the wrong building is the failure this file exists to prevent, so the two are
 * pinned as separate values through the read and through the write.
 *
 * The version skew is the other property worth a test: the two paper-file keys are required by the
 * contract and absent from a Worker deployed before they landed, and this app is cached
 * independently of the Worker it is served beside. Absent has to read as "not recorded", never as
 * the string "undefined" on the screen.
 */
import { describe, expect, it } from "vitest";
import { readMatterOffices, updateMatter } from "../src/lib/matters/matters-api.ts";

interface Recorded {
  path: string;
  method: string;
  body: unknown;
}

function stubFetch(answer: unknown, status = 200): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = ((input: string, init?: RequestInit) => {
    calls.push({
      path: input,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: {
          "content-type": status >= 400 ? "application/problem+json" : "application/json",
        },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("reading the two offices a matter names", () => {
  it("keeps the office the matter is run out of apart from the one its file is kept at", async () => {
    const stub = stubFetch({
      id: "matter_x",
      title: "Whitcombe v. Cascade Ridge",
      status: "open",
      locationId: "location_carson",
      locationName: "Carson City",
      physicalFileLocationId: "location_store",
      physicalFileLocationName: "Sparks Records Store",
    });

    const outcome = await readMatterOffices(stub.fetchImpl, "matter_x");

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.locationId).toBe("location_carson");
    expect(outcome.value.locationName).toBe("Carson City");
    expect(outcome.value.physicalFileLocationId).toBe("location_store");
    expect(outcome.value.physicalFileLocationName).toBe("Sparks Records Store");
  });

  it("reads a matter whose file has no recorded office as having none, not as having the matter's", async () => {
    const stub = stubFetch({
      id: "matter_x",
      locationId: "location_carson",
      locationName: "Carson City",
      physicalFileLocationId: null,
      physicalFileLocationName: null,
    });

    const outcome = await readMatterOffices(stub.fetchImpl, "matter_x");

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    // Falling back to the owning office here would put a folder in a building nobody has said it
    // is in, which is worse than saying nothing.
    expect(outcome.value.physicalFileLocationId).toBeNull();
  });

  it("reads a Worker that predates the paper file's office as having nothing to say about it", async () => {
    const stub = stubFetch({
      id: "matter_x",
      locationId: "location_carson",
      locationName: "Carson City",
    });

    const outcome = await readMatterOffices(stub.fetchImpl, "matter_x");

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.physicalFileLocationId).toBeNull();
    expect(outcome.value.physicalFileLocationName).toBeNull();
  });

  it("carries a failure through rather than answering with an empty record", async () => {
    const stub = stubFetch({ status: 404, title: "Not found" }, 404);

    const outcome = await readMatterOffices(stub.fetchImpl, "matter_gone");

    expect(outcome.kind).not.toBe("ok");
  });
});

describe("recording where the paper file is kept", () => {
  it("writes only that office, so a correction cannot move anything else about the matter", async () => {
    const stub = stubFetch({ matterId: "matter_x" });

    await updateMatter(
      stub.fetchImpl,
      "matter_x",
      { physicalFileLocationId: "location_store" },
      "key-1",
    );

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.method).toBe("PATCH");
    expect(stub.calls[0]?.path).toBe("/api/v1/matters/matter_x");
    expect(stub.calls[0]?.body).toEqual({ physicalFileLocationId: "location_store" });
  });

  it("sends null to clear it, because not knowing where a folder is is a real answer", async () => {
    const stub = stubFetch({ matterId: "matter_x" });

    await updateMatter(stub.fetchImpl, "matter_x", { physicalFileLocationId: null }, "key-2");

    expect(stub.calls[0]?.body).toEqual({ physicalFileLocationId: null });
  });
});
