/*
 * Who served the measurement, and who you are to them. Cloudflare's own speed test reads this from
 * a CORS-open endpoint that needs no session — which is why this panel fills in even when our own
 * connection route refuses us.
 *
 * Parsing is defensive: a body that is not the shape we expect yields null, so the panel says
 * nothing rather than showing a row of undefineds.
 */
export const META_URL = "https://speed.cloudflare.com/meta";

export interface MeasurementServer {
  readonly clientIp: string;
  readonly asn: number;
  readonly asOrganization: string;
  readonly city: string;
  readonly region: string;
  readonly country: string;
  /** The Cloudflare edge airport code that served the measurement, e.g. "LAS". */
  readonly coloIata: string;
  readonly coloCity: string;
}

/** An IPv6 address contains a colon; an IPv4 address never does. */
export function ipVersion(clientIp: string): "IPv4" | "IPv6" {
  return clientIp.includes(":") ? "IPv6" : "IPv4";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseMeasurementServer(raw: unknown): MeasurementServer | null {
  if (!isRecord(raw) || !isRecord(raw["colo"])) return null;
  const colo = raw["colo"];
  const clientIp = raw["clientIp"];
  const asn = raw["asn"];
  const asOrganization = raw["asOrganization"];
  const city = raw["city"];
  const region = raw["region"];
  const country = raw["country"];
  const coloIata = colo["iata"];
  const coloCity = colo["city"];

  if (
    typeof clientIp !== "string" ||
    typeof asn !== "number" ||
    typeof asOrganization !== "string" ||
    typeof city !== "string" ||
    typeof region !== "string" ||
    typeof country !== "string" ||
    typeof coloIata !== "string" ||
    typeof coloCity !== "string"
  ) {
    return null;
  }

  return { clientIp, asn, asOrganization, city, region, country, coloIata, coloCity };
}

/** Never throws: an unreachable endpoint simply means the panel has nothing to say. */
export async function fetchMeasurementServer(
  fetchJson: (url: string) => Promise<unknown>,
): Promise<MeasurementServer | null> {
  try {
    return parseMeasurementServer(await fetchJson(META_URL));
  } catch {
    return null;
  }
}
