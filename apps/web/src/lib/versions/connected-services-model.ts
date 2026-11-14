/*
 * The outside services the deployment depends on, as the Build Information panel shows them:
 * Cloudflare Realtime, which carries a meeting's audio and video, and the two calendar providers. They run no build of ours, so
 * they are not Workers rows; what a reader needs is whether each is set up and accepting this
 * deployment, which is what the versions read reports (`connectedServices`). Pure, like the panel's
 * other models, so the words are testable without a browser.
 */
import type { HealthReading } from "./database-health-model.ts";
import { countPill, type SectionPill } from "./version-overlay-model.ts";

export type ConnectedServiceState = "connected" | "not-configured" | "refused" | "unreachable";

export interface ConnectedServiceStatus {
  id: "realtime" | "googleCalendar" | "microsoftCalendar";
  state: ConnectedServiceState;
  latencyMilliseconds: number | null;
}

/** The heading over the section, which is also its fold toggle's label. */
export const CONNECTED_SERVICES_SECTION_LABEL = "Connected services";

const SERVICE_NAMES: Record<ConnectedServiceStatus["id"], string> = {
  realtime: "Cloudflare Realtime (meetings)",
  googleCalendar: "Google (calendar sync)",
  microsoftCalendar: "Microsoft (calendar sync)",
};

const STATE_STATUS: Record<ConnectedServiceState, { status: string; reading: HealthReading }> = {
  connected: { status: "Connected", reading: "healthy" },
  "not-configured": { status: "Not configured", reading: "attention" },
  refused: { status: "Refused", reading: "fault" },
  unreachable: { status: "Not answering", reading: "fault" },
};

// What each state means for each service, and what to check. A calendar provider is asked whether
// it accepts this deployment's application; no member's account is involved.
function calendarDetails(
  company: string,
  product: string,
  settings: string,
): Record<ConnectedServiceState, string> {
  return {
    connected: `${company} accepted this deployment's application just now, so members can connect ${product}.`,
    "not-configured": `${settings} are not both set, so no member can connect ${product}.`,
    refused: `${company} did not accept the application's client ID and secret. Check that both are the pair on the application registered with ${company}.`,
    unreachable: `Couldn't connect to ${company}. Connecting ${product} may not work right now. Check again in a minute.`,
  };
}

const STATE_DETAILS: Record<ConnectedServiceStatus["id"], Record<ConnectedServiceState, string>> = {
  realtime: {
    connected: "A meeting session opened just now, so rooms can carry audio and video.",
    "not-configured":
      "The Realtime application id or secret is not set on the magna-carta Worker, so no meeting can open.",
    refused:
      "The service did not accept the Realtime application id and secret. Check that both are the pair on the Realtime application.",
    unreachable:
      "The service did not answer in time, or answered with a fault. Meetings may not open.",
  },
  googleCalendar: calendarDetails(
    "Google",
    "Google Calendar",
    "GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET",
  ),
  microsoftCalendar: calendarDetails(
    "Microsoft",
    "Outlook",
    "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET",
  ),
};

export interface ConnectedServiceRow {
  readonly id: string;
  readonly name: string;
  readonly reading: HealthReading;
  readonly status: string;
  readonly detail: string;
}

export function connectedServiceRow(service: ConnectedServiceStatus): ConnectedServiceRow {
  return {
    id: service.id,
    name: SERVICE_NAMES[service.id],
    ...STATE_STATUS[service.state],
    detail: STATE_DETAILS[service.id][service.state],
  };
}

/** What the shut heading says: how many services it hides, and how many are not working. */
export function connectedServicesSectionPills(
  services: readonly ConnectedServiceStatus[],
): SectionPill[] {
  const pills: SectionPill[] = [countPill(services.length, "service")];
  const failing = services.filter((service) => STATE_STATUS[service.state].reading !== "healthy");
  if (failing.length > 0) {
    pills.push({ label: `${String(failing.length)} not working`, variant: "danger" });
  }
  return pills;
}
