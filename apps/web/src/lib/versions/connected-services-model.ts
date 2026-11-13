/*
 * The outside services the deployment depends on, as the Build Information panel shows them: today
 * only Cloudflare Realtime, which carries a meeting's audio and video. They run no build of ours, so
 * they are not Workers rows; what a reader needs is whether each is set up and accepting this
 * deployment, which is what the versions read reports (`connectedServices`). Pure, like the panel's
 * other models, so the words are testable without a browser.
 */
import type { HealthReading } from "./database-health-model.ts";
import { countPill, type SectionPill } from "./version-overlay-model.ts";

export type ConnectedServiceState = "connected" | "not-configured" | "refused" | "unreachable";

export interface ConnectedServiceStatus {
  id: "realtime";
  state: ConnectedServiceState;
  latencyMilliseconds: number | null;
}

/** The heading over the section, which is also its fold toggle's label. */
export const CONNECTED_SERVICES_SECTION_LABEL = "Connected services";

const SERVICE_NAMES: Record<ConnectedServiceStatus["id"], string> = {
  realtime: "Cloudflare Realtime (meetings)",
};

const STATE_WORDS: Record<
  ConnectedServiceState,
  { status: string; reading: HealthReading; detail: string }
> = {
  connected: {
    status: "Connected",
    reading: "healthy",
    detail: "A meeting session opened just now, so rooms can carry audio and video.",
  },
  "not-configured": {
    status: "Not configured",
    reading: "attention",
    detail:
      "The Realtime application id or secret is not set on the magna-carta Worker, so no meeting can open.",
  },
  refused: {
    status: "Refused",
    reading: "fault",
    detail:
      "The service did not accept the Realtime application id and secret. Check that both are the pair on the Realtime application.",
  },
  unreachable: {
    status: "Not answering",
    reading: "fault",
    detail: "The service did not answer in time, or answered with a fault. Meetings may not open.",
  },
};

export interface ConnectedServiceRow {
  readonly id: string;
  readonly name: string;
  readonly reading: HealthReading;
  readonly status: string;
  readonly detail: string;
}

export function connectedServiceRow(service: ConnectedServiceStatus): ConnectedServiceRow {
  const words = STATE_WORDS[service.state];
  return { id: service.id, name: SERVICE_NAMES[service.id], ...words };
}

/** What the shut heading says: how many services it hides, and how many are not working. */
export function connectedServicesSectionPills(
  services: readonly ConnectedServiceStatus[],
): SectionPill[] {
  const pills: SectionPill[] = [countPill(services.length, "service")];
  const failing = services.filter((service) => STATE_WORDS[service.state].reading !== "healthy");
  if (failing.length > 0) {
    pills.push({ label: `${String(failing.length)} not working`, variant: "danger" });
  }
  return pills;
}
