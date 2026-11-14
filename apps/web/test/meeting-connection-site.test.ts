import { describe, expect, it } from "vitest";
import { readCloudflareSite } from "$lib/meetings/screen/meeting-connection.ts";

function answering(body: string, ok = true): typeof fetch {
  return (async () => new Response(body, { status: ok ? 200 : 404 })) as typeof fetch;
}

describe("the Cloudflare site a meeting runs through", () => {
  it("is the trace's three-letter site code", async () => {
    expect(await readCloudflareSite(answering("fl=1\nh=example\ncolo=SJC\nhttp=http/2\n"))).toBe(
      "SJC",
    );
  });

  it("is unknown off Cloudflare, or when the trace says nothing usable", async () => {
    expect(await readCloudflareSite(answering("", false))).toBeNull();
    expect(await readCloudflareSite(answering("colo=<script>"))).toBeNull();
    expect(
      await readCloudflareSite((async () => {
        throw new Error("offline");
      }) as typeof fetch),
    ).toBeNull();
  });
});
