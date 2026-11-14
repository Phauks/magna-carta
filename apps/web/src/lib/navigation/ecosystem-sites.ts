/*
 * The ecosystem-site registry — the one home for Magna Carta's associated websites (the status
 * page, the community board, the public magna-carta.com site, API documentation, the public
 * changelog). These
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
 *
 * A site the application also has a copy of still opens the public site, never the copy: there is
 * one changelog, on the community board, and the menu, the palette and the About window all lead
 * to it.
 */
import type { Component } from "svelte";
import Activity from "@lucide/svelte/icons/activity";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Globe from "@lucide/svelte/icons/globe";
import BookOpen from "@lucide/svelte/icons/book-open";
import CodeXml from "@lucide/svelte/icons/code-xml";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { aboutWindow } from "$lib/about/about-window.svelte.ts";

export interface EcosystemSite {
  readonly id: string;
  /** User-facing label (sentence case, the vocabulary users recognize). */
  readonly label: string;
  /** One-line purpose — surfaced when live entries reach the command palette. */
  readonly description?: string;
  /** Absolute URL once the site is live; null until wired (renders disabled, marked "Soon"). */
  readonly href: string | null;
  /**
   * An in-application window that stands in for this site while `href` is null, opened by calling
   * it. Absent for a site the application has no window for.
   */
  readonly opensWindow?: () => void;
  readonly icon: Component;
}

export const ECOSYSTEM_SITES: readonly EcosystemSite[] = [
  {
    id: "status",
    label: "Status",
    description: "Live service health and incident history",
    // The first ecosystem site to light up: the status worker's page at the owner's
    // status.magnacarta.esq custom domain (goes live with the same push wave that deploys the
    // status worker and attaches the domain).
    href: "https://status.magnacarta.esq",
    icon: Activity,
  },
  {
    id: "forums",
    label: "Forums",
    description: "Community discussion and answers",
    // The community board: feature requests, questions, known issues and the roadmap. Its own
    // Sign In button brings a member back through the app's one-minute sign-in link.
    href: "https://community.magnacarta.esq",
    icon: MessagesSquare,
  },
  {
    id: "about",
    label: "About Magna Carta",
    description: "The public magna-carta.com site",
    // The public site is not deployed yet; the About window states this copy's version and links
    // to the changelog, help and the legal pages in the meantime.
    href: null,
    opensWindow: () => aboutWindow.open(),
    icon: Globe,
  },
  {
    id: "documentation",
    label: "Documentation",
    description: "Product guides and how-to help for using Magna Carta",
    href: null,
    icon: BookOpen,
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
    // The public changelog lives on the community board.
    href: "https://community.magnacarta.esq/changelog",
    icon: ScrollText,
  },
  {
    id: "trust-center",
    label: "Trust Center",
    description: "Security, compliance, and data-handling commitments",
    href: null,
    icon: ShieldCheck,
  },
];
