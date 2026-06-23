import type { HttpClient } from "@magna-carta/integrations/http";

export interface RegistrationResult {
  readonly source: "rdap" | "whois-43";
  readonly target: string; // normalized domain or IP queried
  readonly registrar?: string;
  readonly registeredAt?: string; // ISO 8601
  readonly expiresAt?: string;
  readonly lastChangedAt?: string;
  readonly nameservers?: readonly string[];
  readonly statuses?: readonly string[];
  readonly registrant?: string;
  readonly raw?: string; // populated for source "whois-43" (unparsed legacy text)
}

// Opens a port-43 WHOIS connection. Worker backs it with cloudflare:sockets; tests pass a fake.
export interface WhoisSocket {
  query(host: string, request: string): Promise<string>;
}

export interface WhoisDeps {
  readonly http: HttpClient;
  readonly socket: WhoisSocket;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}
