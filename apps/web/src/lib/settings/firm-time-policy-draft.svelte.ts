/*
 * The firm's time-capture policy as a settings draft — the two settings the Billing page renders,
 * and what each staged value means as a change to send.
 *
 * The staging, counting, confirming and saving are the shared server-backed draft's
 * (./server-backed-draft.svelte.ts); this module is the field mapping and the words.
 *
 * THE INCREMENT'S OPTION LIST IS A PRESENTATION, NOT THE VOCABULARY. The server accepts any whole
 * number of minutes up to an hour; these seven are the increments law firms actually bill at. A
 * firm holding something else is real and must not be shown a control that would silently offer to
 * change it — `isOfferedIncrement` is what lets the page state such a value instead of rendering a
 * select that cannot express it.
 */
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import {
  readFirmTimePolicy,
  updateFirmTimePolicy,
  type FirmTimePolicy,
  type FirmTimePolicyPatch,
  type RoundingDirection,
} from "./firm-time-policy-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const BILLING_SECTION_ID = "billing";

/** The increments the select offers, in ascending order. */
const OFFERED_INCREMENTS = [1, 6, 10, 12, 15, 30, 60] as const;

export function isOfferedIncrement(minutes: number): boolean {
  return OFFERED_INCREMENTS.some((candidate) => candidate === minutes);
}

export const INCREMENT_DEFINITION: SettingDefinition = {
  id: "billing.time-increment",
  sectionId: BILLING_SECTION_ID,
  plateLabel: "Time Capture",
  label: "Time Increment",
  description:
    "The smallest unit a captured duration rounds to. It is also what one billing unit is worth.",
  kind: "select",
  options: [
    { value: "1", label: "1 minute — actual time" },
    { value: "6", label: "6 minutes (0.1 hour)" },
    { value: "10", label: "10 minutes" },
    { value: "12", label: "12 minutes (0.2 hour)" },
    { value: "15", label: "15 minutes (0.25 hour)" },
    { value: "30", label: "30 minutes (0.5 hour)" },
    { value: "60", label: "60 minutes (1 hour)" },
  ],
  defaultValue: "6",
  sensitivity: "open",
  // Consequential: every hour captured after the change is measured by a different unit, and a
  // firm moving from tenths to quarter hours has changed what "two units" means on every invoice.
  confirm: true,
  audited: true,
};

export const ROUNDING_DIRECTION_DEFINITION: SettingDefinition = {
  id: "billing.time-rounding",
  sectionId: BILLING_SECTION_ID,
  plateLabel: "Time Capture",
  label: "Time Rounding",
  description: "How a duration that falls between increments lands.",
  kind: "select",
  options: [
    { value: "nearest", label: "Round to the nearest increment" },
    { value: "up", label: "Always round up" },
    { value: "down", label: "Always round down" },
  ],
  defaultValue: "nearest",
  sensitivity: "open",
  audited: true,
};

/** Every definition the page renders, in reading order. */
export const BILLING_DEFINITIONS: readonly SettingDefinition[] = [
  INCREMENT_DEFINITION,
  ROUNDING_DIRECTION_DEFINITION,
];

const ROUNDING_DIRECTIONS: readonly RoundingDirection[] = ["up", "nearest", "down"];

function directionFromValue(value: SettingValue): RoundingDirection | null {
  return ROUNDING_DIRECTIONS.find((direction) => direction === value) ?? null;
}

/**
 * The typed increment, or null for anything that is not a whole number of minutes from 1 to 60.
 * The bound is the server's own; refusing here as well is what keeps a value the server would
 * answer 422 for from ever being sent.
 */
export function incrementFromValue(value: SettingValue): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= 1 && parsed <= 60 ? parsed : null;
}

const FIELDS: readonly ServerBackedField<FirmTimePolicy, FirmTimePolicyPatch>[] = [
  {
    definition: INCREMENT_DEFINITION,
    valueOf: (settings) => String(settings.incrementMinutes),
    applyTo: (patch, value) => {
      const incrementMinutes = incrementFromValue(value);
      if (incrementMinutes === null) return null;
      return { ...patch, incrementMinutes };
    },
  },
  {
    definition: ROUNDING_DIRECTION_DEFINITION,
    valueOf: (settings) => settings.roundingDirection,
    applyTo: (patch, value) => {
      const roundingDirection = directionFromValue(value);
      if (roundingDirection === null) return null;
      return { ...patch, roundingDirection };
    },
  },
];

export function createFirmTimePolicyDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<FirmTimePolicy, FirmTimePolicyPatch> {
  return new ServerBackedSettingsDraft({
    sectionId: BILLING_SECTION_ID,
    fields: FIELDS,
    read: () => readFirmTimePolicy(fetchImpl),
    write: (patch, idempotencyKey) => updateFirmTimePolicy(fetchImpl, patch, idempotencyKey),
  });
}
