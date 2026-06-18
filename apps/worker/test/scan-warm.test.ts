import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import type { ScanContainerFetcher } from "../src/files/container-scan-adapter.ts";
import { pokeContainer, pokeScanContainer } from "../src/files/scan-warm.ts";

describe("scan warm-poke", () => {
  it("fetches the container's /ready endpoint", async () => {
    const paths: string[] = [];
    const fake: ScanContainerFetcher = {
      fetch: async (request) => {
        paths.push(new URL(request.url).pathname);
        return new Response("ok");
      },
    };
    await pokeContainer(fake);
    expect(paths).toEqual(["/ready"]);
  });

  it("is a no-op when the scan container is unbound", async () => {
    const env = {} as Bindings;
    await expect(pokeScanContainer(env)).resolves.toBeUndefined();
  });
});
