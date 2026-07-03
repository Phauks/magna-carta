/*
 * Trial harness for the command palette's entrance animation (owner review 2026-07-02: the
 * scale-from-center entrance read as a jarring delayed "growth"). A persisted developer
 * preference selects which presence recipe the palette's Dialog panel mounts with, so the
 * owner can feel each candidate live and pick by feel. Once a winner is chosen the palette
 * hard-codes that presence and this module plus its console control are removed.
 *
 * Persistence rides the developer-console storage seam (one localStorage key, hazards
 * swallowed there), like the motion module's overrides. The palette re-reads the preference
 * at every open, so changing the select applies on the NEXT open — no live re-render wiring.
 */
import {
  PRESENCE_FADE,
  PRESENCE_NONE,
  PRESENCE_SCALE_FADE,
  PRESENCE_SETTLE_FADE,
  type PresenceClass,
} from "@magna-carta/design-system/internal/floating";
import { createDeveloperConsoleStorage } from "./developer-console-storage.ts";

/** The candidate entrances, labelled by feel for the console's select. */
export const PALETTE_ENTRANCE_VARIANTS = [
  { value: "grow", label: "Grow (current)" },
  { value: "instant", label: "Instant" },
  { value: "fade", label: "Fade" },
  { value: "settle", label: "Settle" },
] as const;

export type PaletteEntranceVariant = (typeof PALETTE_ENTRANCE_VARIANTS)[number]["value"];

/** Each variant's presence recipe — the closed constants from the design system's floating module. */
export const PALETTE_ENTRANCE_PRESENCE: Record<PaletteEntranceVariant, PresenceClass> = {
  grow: PRESENCE_SCALE_FADE,
  instant: PRESENCE_NONE,
  fade: PRESENCE_FADE,
  settle: PRESENCE_SETTLE_FADE,
};

const storage = createDeveloperConsoleStorage<PaletteEntranceVariant>("palette-entrance");

function isPaletteEntranceVariant(value: unknown): value is PaletteEntranceVariant {
  return PALETTE_ENTRANCE_VARIANTS.some((variant) => variant.value === value);
}

/** The persisted choice; anything absent or unrecognized falls back to the shipped entrance. */
export function readPaletteEntranceVariant(): PaletteEntranceVariant {
  const stored = storage.load();
  return isPaletteEntranceVariant(stored) ? stored : "grow";
}

export function savePaletteEntranceVariant(variant: PaletteEntranceVariant): void {
  storage.save(variant);
}
