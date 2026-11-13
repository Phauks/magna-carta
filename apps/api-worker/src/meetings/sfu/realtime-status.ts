/*
 * Whether this deployment's meetings can reach Cloudflare Realtime, the outside service that routes
 * a meeting's audio and video, as the Build Information panel reports it beside the Workers.
 *
 * Four states, each a different remedy: "not-configured" (an id or a secret is missing, so no room
 * can open), "refused" (both are set and the service does not accept them), "unreachable" (the
 * service did not answer in time, or answered with a fault), and "connected" (a session opened just
 * now). The probe is the same request a room makes first, so "connected" means a room would open.
 */
import { z } from "@hono/zod-openapi";
import type { Bindings } from "../../bindings.ts";
import { sfuClientForEnv } from "./sfu-client.ts";

export const ConnectedServiceStatus = z
  .object({
    id: z.enum(["realtime"]),
    state: z.enum(["connected", "not-configured", "refused", "unreachable"]),
    // What the probe cost, in milliseconds; null where nothing was asked.
    latencyMilliseconds: z.number().nullable(),
  })
  .openapi("ConnectedServiceStatus");

export type ConnectedServiceStatusReport = z.infer<typeof ConnectedServiceStatus>;

export async function probeRealtimeService(
  env: Pick<Bindings, "REALTIME_SFU_APP_ID" | "REALTIME_SFU_APP_SECRET">,
  timeoutMilliseconds: number,
): Promise<ConnectedServiceStatusReport> {
  const client = sfuClientForEnv(env);
  if (client === null) {
    return { id: "realtime", state: "not-configured", latencyMilliseconds: null };
  }
  const startedAtEpochMilliseconds = Date.now();
  const state = await client.probe(timeoutMilliseconds);
  return { id: "realtime", state, latencyMilliseconds: Date.now() - startedAtEpochMilliseconds };
}
