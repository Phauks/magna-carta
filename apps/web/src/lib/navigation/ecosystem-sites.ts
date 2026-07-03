/*
 * The ecosystem-site registry — the one home for Magna Carta's associated websites (the status
 * page, forums, the public magna-carta.com site, API documentation, the public changelog). These
 * are SIDE sites, deliberately outside the destination registry (destinations.ts): they leave the
 * app, so they live behind the profile menu (src/lib/components/profile-menu.svelte), never in
 * the sidebar.
 *
 * `href` is the light-up switch: null means the site is not wired yet — the profile menu renders
 * the entry disabled with a "Soon" badge, so a dead link is impossible. When a site goes live,
 * set its href here in the same commit; the menu lights it up as a real external link. Live
 * entries should then ALSO surface in the command palette as a provider group
 * (src/lib/components/command-palette.svelte) — extend the palette from THIS registry when the
 * first site ships; never hand-list a site there.
 */
import type { Component } from "svelte";
import Activity from "@lucide/svelte/icons/activity";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Globe from "@lucide/svelte/icons/globe";
import CodeXml from "@lucide/svelte/icons/code-xml";
import ScrollText from "@lucide/svelte/icons/scroll-text";

export interface EcosystemSite {
  readonly id: string;
  /** User-facing label (sentence case, the vocabulary users recognize). */
  readonly label: string;
  /** One-line purpose — surfaced when live entries reach the command palette. */
  readonly description?: string;
  /** Absolute URL once the site is live; null until wired (renders disabled, marked "Soon"). */
  readonly href: string | null;
  readonly icon: Component;
}

export const ECOSYSTEM_SITES: readonly EcosystemSite[] = [
  {
    id: "status",
    label: "Status",
    description: "Live service health and incident history",
    href: null,
    icon: Activity,
  },
  {
    id: "forums",
    label: "Forums",
    description: "Community discussion and answers",
    href: null,
    icon: MessagesSquare,
  },
  {
    id: "about",
    label: "About Magna Carta",
    description: "The public magna-carta.com site",
    href: null,
    icon: Globe,
  },
  {
    id: "api-documentation",
    label: "API documentation",
    description: "Reference for the public API",
    href: null,
    icon: CodeXml,
  },
  {
    id: "changelog",
    label: "Changelog",
    description: "What shipped, release by release",
    href: null,
    icon: ScrollText,
  },
];
