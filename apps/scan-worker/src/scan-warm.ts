import type { ScanContainerFetcher } from "./forward-scan.ts";

// Poke the scan container's health endpoint to keep one instance warm.
// The /ready endpoint is the Container's pingEndpoint — a fast, side-effect-free probe
// that keeps clamd's ~1–2 GiB signature database resident between scans.
export async function pokeContainer(container: ScanContainerFetcher): Promise<void> {
  await container.fetch(new Request("http://scan/ready"));
}
