import { z } from "zod";

const BASE_URL = "https://console.vast.ai";

/**
 * A rentable GPU offer as returned by vast.ai's marketplace search, with vast.ai's wire field
 * names mapped to full names. The wire names themselves stay confined to this module.
 */
export interface VastOffer {
  readonly offerId: number;
  readonly gpuName: string;
  readonly gpuCount: number;
  readonly gpuRamMegabytes: number;
  readonly dollarsPerHour: number;
  readonly internetDownMbps: number;
  readonly reliability: number;
  readonly verified: boolean;
}

export interface CreateInstanceParams {
  readonly image: string;
  readonly label: string;
  readonly onstart: string;
  readonly diskGb: number;
}

export interface VastInstanceHandle {
  readonly instanceId: number;
}

export interface VastInstanceStatus {
  readonly status: string;
  readonly sshHost: string | null;
  readonly sshPort: number | null;
}

/**
 * A live vast.ai instance as returned by the instance-list endpoint, reduced to the two fields the
 * billing-reconciliation sweep needs: its id (to destroy it) and its label (to recognize it as a
 * benchmark rig regardless of which run created it).
 */
export interface VastInstanceSummary {
  readonly instanceId: number;
  readonly label: string;
}

export interface VastClient {
  searchOffers(query: Record<string, unknown>): Promise<VastOffer[]>;
  createInstance(offerId: number, params: CreateInstanceParams): Promise<VastInstanceHandle>;
  getInstance(instanceId: number): Promise<VastInstanceStatus>;
  listInstances(): Promise<VastInstanceSummary[]>;
  destroyInstance(instanceId: number): Promise<void>;
}

/**
 * Thrown for any non-2xx vast.ai response. The message carries the HTTP status and the endpoint
 * path only — never the API key, even though the key was on the request that produced it.
 */
export class VastApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VastApiError";
  }
}

const vastOfferWireSchema = z.object({
  id: z.number(),
  gpu_name: z.string(),
  num_gpus: z.number(),
  gpu_ram: z.number(),
  dph_total: z.number(),
  inet_down: z.number(),
  reliability: z.number(),
  verified: z.boolean(),
});

const searchOffersResponseSchema = z.object({
  offers: z.array(vastOfferWireSchema),
});

const createInstanceResponseSchema = z.object({
  new_contract: z.number(),
});

const vastInstanceWireSchema = z.object({
  id: z.number(),
  actual_status: z.string().nullish(),
  ssh_host: z.string().nullish(),
  ssh_port: z.number().nullish(),
  label: z.string().nullish(),
});

const listInstancesResponseSchema = z.object({
  instances: z.array(vastInstanceWireSchema),
});

function toVastOffer(wire: z.infer<typeof vastOfferWireSchema>): VastOffer {
  return {
    offerId: wire.id,
    gpuName: wire.gpu_name,
    gpuCount: wire.num_gpus,
    gpuRamMegabytes: wire.gpu_ram,
    dollarsPerHour: wire.dph_total,
    internetDownMbps: wire.inet_down,
    reliability: wire.reliability,
    verified: wire.verified,
  };
}

/**
 * Builds a typed client over the four vast.ai REST endpoints the GPU-benchmark harness uses:
 * searching marketplace offers, renting an offer as an instance, polling that instance's status,
 * and destroying it when the recovery run ends. Accepts an injectable `fetch` so callers can test
 * against a mock without reaching the network.
 *
 * Every non-2xx response throws `VastApiError` with the HTTP status and endpoint path — the API
 * key is never interpolated into a thrown message or otherwise logged.
 */
export function createVastClient(apiKey: string, fetchImpl: typeof fetch = fetch): VastClient {
  async function requestJson(path: string, method: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new VastApiError(
        `vast.ai request to ${method} ${path} failed with status ${response.status}`,
      );
    }
    return response.json();
  }

  return {
    async searchOffers(query) {
      const raw = await requestJson("/api/v0/bundles/", "PUT", query);
      const parsed = searchOffersResponseSchema.parse(raw);
      return parsed.offers.map(toVastOffer);
    },

    async createInstance(offerId, params) {
      const raw = await requestJson(`/api/v0/asks/${offerId}/`, "PUT", {
        image: params.image,
        disk: params.diskGb,
        onstart: params.onstart,
        label: params.label,
        runtype: "ssh",
      });
      const parsed = createInstanceResponseSchema.parse(raw);
      return { instanceId: parsed.new_contract };
    },

    async getInstance(instanceId) {
      const raw = await requestJson("/api/v0/instances/", "GET");
      const parsed = listInstancesResponseSchema.parse(raw);
      const found = parsed.instances.find((instance) => instance.id === instanceId);
      if (found === undefined) {
        throw new VastApiError(`instance ${instanceId} not found in vast.ai instance list`);
      }
      return {
        status: found.actual_status ?? "unknown",
        sshHost: found.ssh_host ?? null,
        sshPort: found.ssh_port ?? null,
      };
    },

    async listInstances() {
      const raw = await requestJson("/api/v0/instances/", "GET");
      const parsed = listInstancesResponseSchema.parse(raw);
      return parsed.instances.map((instance) => ({
        instanceId: instance.id,
        label: instance.label ?? "",
      }));
    },

    async destroyInstance(instanceId) {
      const path = `/api/v0/instances/${instanceId}/`;
      const response = await fetchImpl(`${BASE_URL}${path}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (response.status === 404 || response.ok) return;
      throw new VastApiError(
        `vast.ai request to DELETE ${path} failed with status ${response.status}`,
      );
    },
  };
}
