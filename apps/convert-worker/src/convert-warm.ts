import type { ConvertContainerFetcher } from "./forward-convert.ts";

// Poke the engine container's health endpoint to keep one instance warm within sleepAfter, so a
// conversion doesn't pay engine cold-start. `ready` is the Container's pingEndpoint.
export async function pokeContainer(container: ConvertContainerFetcher): Promise<void> {
  await container.fetch(new Request("http://convert/ready"));
}
