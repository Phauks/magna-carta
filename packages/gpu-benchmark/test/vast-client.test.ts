import { describe, it, expect, vi } from "vitest";
import { createVastClient } from "../src/vast-client.ts";

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("vast-client", () => {
  it("maps offer wire fields to full names, deriving verified from the verification string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        offers: [
          {
            id: 42,
            gpu_name: "RTX 4090",
            num_gpus: 1,
            gpu_ram: 24576,
            dph_total: 0.4,
            reliability: 0.99,
            verification: "verified",
          },
        ],
      }),
    );
    const offers = await createVastClient("KEY", fetchImpl).searchOffers({});
    const [first] = offers;
    expect(first).toMatchObject({
      offerId: 42,
      gpuName: "RTX 4090",
      gpuCount: 1,
      gpuRamMegabytes: 24576,
      dollarsPerHour: 0.4,
      reliability: 0.99,
      verified: true,
    });
  });

  it("derives verified as false when the verification string is not 'verified'", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        offers: [
          {
            id: 43,
            gpu_name: "RTX 4090",
            num_gpus: 1,
            gpu_ram: 24576,
            dph_total: 0.4,
            reliability: 0.99,
            verification: "unverified",
          },
        ],
      }),
    );
    const [first] = await createVastClient("KEY", fetchImpl).searchOffers({});
    expect(first?.verified).toBe(false);
  });

  it("skips a single malformed offer rather than failing the whole batch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        offers: [
          {
            id: 42,
            gpu_name: "RTX 4090",
            num_gpus: 1,
            gpu_ram: 24576,
            dph_total: 0.4,
            reliability: 0.99,
            verification: "verified",
          },
          // Malformed: dph_total (price) is a string, and num_gpus is missing. One bad row must
          // not sink the good offer alongside it.
          { id: 99, gpu_name: "RTX 4090", dph_total: "not-a-number" },
        ],
      }),
    );
    const offers = await createVastClient("KEY", fetchImpl).searchOffers({});
    expect(offers).toHaveLength(1);
    expect(offers[0]?.offerId).toBe(42);
  });

  it("sends the query body via POST and the bearer auth header to the bundles endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ offers: [] }));
    await createVastClient("KEY", fetchImpl).searchOffers({ gpu_name: { in: ["RTX 4090"] } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v0/bundles/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer KEY" }),
        body: JSON.stringify({ gpu_name: { in: ["RTX 4090"] } }),
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
          { id: 1, actual_status: "loading" },
          { id: 777, actual_status: "running" },
        ],
      }),
    );
    const status = await createVastClient("KEY", fetchImpl).getInstance(777);
    expect(status).toEqual({
      status: "running",
      statusMsg: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v1/instances/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps a failed instance's status_msg", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        instances: [
          {
            id: 777,
            actual_status: "exited",
            status_msg: "OCI runtime create failed: unable to start container process",
          },
        ],
      }),
    );
    const status = await createVastClient("KEY", fetchImpl).getInstance(777);
    expect(status.statusMsg).toBe("OCI runtime create failed: unable to start container process");
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

  it("destroyInstance calls the v0 endpoint, not v1 (v1 silently returns Not found without destroying)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await createVastClient("KEY", fetchImpl).destroyInstance(42);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v0/instances/42/",
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

  it("requestLogsUrl PUTs to request_logs with a tail and returns the S3 result_url", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ result_url: "https://s3.example.com/logs/777.txt" }));
    const url = await createVastClient("KEY", fetchImpl).requestLogsUrl(777);
    expect(url).toBe("https://s3.example.com/logs/777.txt");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.vast.ai/api/v0/instances/request_logs/777/",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ tail: "600" }),
      }),
    );
  });
});
