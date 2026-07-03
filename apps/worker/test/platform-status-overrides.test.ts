import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import { mutateAuthored, readAuthored } from "../src/status/authored-store.ts";

const NOW = "2026-07-02T00:00:00.000Z";
beforeEach(async () => env.STATUS_KV.delete(STATUS_KV_KEYS.authored));

test("an override is stored then cleared", async () => {
  await mutateAuthored(env.STATUS_KV, NOW, (c) => ({
    ...c,
    overrides: [{ componentId: "scan", status: "degraded", note: "slow", setAt: NOW, authorUserId: "usr_op" }],
  }));
  expect((await readAuthored(env.STATUS_KV, NOW)).overrides).toHaveLength(1);
  await mutateAuthored(env.STATUS_KV, NOW, (c) => ({
    ...c,
    overrides: c.overrides.filter((o) => o.componentId !== "scan"),
  }));
  expect((await readAuthored(env.STATUS_KV, NOW)).overrides).toHaveLength(0);
});
