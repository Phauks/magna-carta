import { describe, it, expect, vi } from "vitest";
import { createVastClient } from "../src/vast-client.ts";

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("vast-client", () => {
  it("maps offer wire fields to full names", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        offers: [
          {
            id: 42,
            gpu_name: "RTX_4090",
            num_gpus: 1,
            gpu_ram: 24576,
            dph_total: 0.4,
            inet_down: 900,
            reliability: 0.99,
            verified: true,
          },
        ],
      }),
    );
    const offers = await createVastClient("KEY", fetchImpl).searchOffers({});
    const [first] = offers;
    expect(first).toMatchObject({
      offerId: 42,
      gpuName: "RTX_4090",
      gpuCount: 1,
      gpuRamMegabytes: 24576,
      dollarsPerHour: 0.4,
      internetDownMbps: 900,
      reliability: 0.99,
      verified: true,
    });
  });

  it("sends the query body and bearer auth header to the bundles endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ offers: [] }));
    await createVastClient("KEY", fetchImpl).searchOffers({ gpu_name: "RTX_4090" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v0/bundles/",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: "Bearer KEY" }),
        body: JSON.stringify({ gpu_name: "RTX_4090" }),
      }),
    );
  });

  it("returns new_contract as instanceId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ new_contract: 777 }));
    const result = await createVastClient("KEY", fetchImpl).createInstance(42, {
      image: "x",
      label: "l",
      onstart: "",
      diskGb: 20,
    });
    expect(result).toEqual({ instanceId: 777 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v0/asks/42/",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("finds an instance by id and maps its status fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        instances: [
          { id: 1, actual_status: "loading", ssh_host: null, ssh_port: null },
          { id: 777, actual_status: "running", ssh_host: "1.2.3.4", ssh_port: 22222 },
        ],
      }),
    );
    const status = await createVastClient("KEY", fetchImpl).getInstance(777);
    expect(status).toEqual({ status: "running", sshHost: "1.2.3.4", sshPort: 22222 });
  });

  it("throws when getInstance cannot find the id in the list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ instances: [] }));
    await expect(createVastClient("KEY", fetchImpl).getInstance(777)).rejects.toThrow(/777/);
  });

  it("destroyInstance treats 404 as success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(createVastClient("KEY", fetchImpl).destroyInstance(777)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v0/instances/777/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("destroyInstance resolves on a normal 200 too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(createVastClient("KEY", fetchImpl).destroyInstance(777)).resolves.toBeUndefined();
  });

  it("never includes the api key in a thrown error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    try {
      await createVastClient("SECRETKEY", fetchImpl).searchOffers({});
      expect.fail("expected searchOffers to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRETKEY");
    }
  });

  it("includes the status and endpoint (but never the key) when destroyInstance fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(createVastClient("SECRETKEY", fetchImpl).destroyInstance(777)).rejects.toThrow(
      /500/,
    );
    try {
      await createVastClient("SECRETKEY", fetchImpl).destroyInstance(777);
      expect.fail("expected destroyInstance to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRETKEY");
    }
  });
});
