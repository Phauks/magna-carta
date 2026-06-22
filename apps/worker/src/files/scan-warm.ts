import { getContainer } from "@cloudflare/containers";
import type { Bindings } from "../app.ts";
import type { ScanContainerFetcher } from "./container-scan-adapter.ts";

// Pokes a scan container's health endpoint to keep it warm.
export async function pokeContainer(container: ScanContainerFetcher): Promise<void> {
  await container.fetch(new Request("http://scan/ready"));
}

// Keeps one scan-container instance warm: a cron fetches its /ready before the 30-minute sleepAfter
// lapses, so clamd stays resident (its ~1-2 GiB signature database is slow to reload on a cold start).
// A no-op when the container is unbound, so the cron is dormant until the deploy-time engine activation.
export async function pokeScanContainer(env: Bindings): Promise<void> {
  if (env.SCAN_CONTAINER === undefined) return;
  await pokeContainer(getContainer(env.SCAN_CONTAINER, "scan"));
}
