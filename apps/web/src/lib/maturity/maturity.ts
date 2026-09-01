/*
 * The maturity system — one visual vocabulary for signalling how finished a UI surface is, so a
 * half-built feature reads as honestly in-progress instead of silently broken. Every surface still
 * under construction declares a stage; the same stage looks the same everywhere it appears.
 *
 * THIS MODULE IS THE ONE HOME. Everything the system needs lives in `maturity/`:
 *   - maturity.ts          — the model: the stages, and each stage's label + colour (this file).
 *   - maturity-badge.svelte — the labelled mark, where a badge fits (nav tabs, sidebar rows).
 *   - maturity-dot.svelte   — the colour dot, where a label won't fit (icon-only chrome).
 *   - soon-affordance.ts / .svelte — the "soon" stage applied to a single CONTROL rather than a
 *     surface: the control rendered for real, disabled, with the badge and the dependency. It is
 *     part of this module because a Soon control is the same vocabulary as a Soon surface, and
 *     letting call sites compose their own was how the two started to disagree.
 *
 * TO MARK A SURFACE: give its registry entry a `stage` (see MatterSection in matters/sections.ts
 * and Destination in navigation/destinations.ts for the field), then render <MaturityBadge> or
 * <MaturityDot> with it. Nothing else is wired — the components read this model.
 *
 * TO ADD A STAGE (e.g. a release candidate): add it to MaturityStage and give it one row in
 * MATURITY_PRESENTATION. Every consumer picks it up with no further change — the badge and dot
 * derive entirely from the presentation record, so the colour and label are decided in exactly
 * one place.
 *
 * TO RESTYLE A STAGE: change its row here. The badge variant and the dot colour move together.
 *
 * ONLY "soon" WEARS A MARK. The owner's ruling (2026-08-31, issued against the matter section
 * strip): a surface a member can actually open does not announce how finished it is. An "Alpha"
 * pill beside a working tab is a fact about the build, not about the matter, and once eight of
 * fourteen tabs carry one the navigation reads as a release plan instead of the sections of a
 * file — it also cost each tab about as much width as its own label, which is what pushed most
 * of the strip into an overflow menu. So `alpha` and `beta` present as null, exactly as `ready`
 * does, and the marks live on only where they carry a fact a reader must have: "soon" means
 * there is nothing behind this yet.
 *
 * The stages themselves are NOT collapsed. `hasSurface` still turns on them, the registries still
 * declare them, and they still decide whether a destination is a live link or a stub — the change
 * is that reaching a stage stopped being something the product says out loud. Giving `alpha` a
 * presentation again is a one-line change here if the firm ever wants the ladder visible.
 */
import type { BadgeVariant } from "@magna-carta/design-system/badge";

export type MaturityStage = "soon" | "alpha" | "beta" | "ready";

export interface MaturityPresentation {
  /** The badge text where there is room for a badge (nav tabs, sidebar rows). */
  label: string;
  /** The badge pill's colour register (design-system badge variant). */
  badgeVariant: BadgeVariant;
  /** The dot's colour for icon-only chrome — a CSS colour token reference. */
  dotColor: string;
}

export const MATURITY_PRESENTATION: Record<MaturityStage, MaturityPresentation | null> = {
  soon: { label: "Soon", badgeVariant: "neutral", dotColor: "var(--mc-text-muted)" },
  alpha: null,
  beta: null,
  ready: null,
};

/**
 * Whether a stage implies a surface a member can actually open. `soon` is the one stage that
 * means no surface exists yet; everything above it is reachable and states its own maturity
 * through the badge. The sidebar already depends on this distinction — Settings ships at
 * `alpha` and is a live link.
 *
 * Whether a stage is reachable is a fact about the stage, so it lives here beside the model
 * rather than being re-derived by each consumer.
 */
export function hasSurface(stage: MaturityStage): boolean {
  return stage !== "soon";
}
