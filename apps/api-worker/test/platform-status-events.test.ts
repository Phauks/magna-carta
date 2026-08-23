import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import { mutateAuthored, readAuthored } from "../src/status/authored-store.ts";

const NOW = "2026-07-02T00:00:00.000Z";

beforeEach(async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
});

test("mutateAuthored appends an event and stamps updatedAt", async () => {
  const doc = await mutateAuthored(env.STATUS_KV, NOW, (current) => ({
    ...current,
    events: [
      ...current.events,
      {
        id: "serviceEvent_1",
        title: "Editing degraded",
        impact: "major",
        lifecycle: "investigating",
        affectedComponentIds: ["collabora"],
        authorUserId: "usr_op",
        startedAt: NOW,
        resolvedAt: null,
        updates: [
          { at: NOW, lifecycle: "investigating", body: "Investigating.", authorUserId: "usr_op" },
        ],
      },
    ],
  }));
  expect(doc.events).toHaveLength(1);
  const reread = await readAuthored(env.STATUS_KV, NOW);
  expect(reread.events[0]?.title).toBe("Editing degraded");
});
