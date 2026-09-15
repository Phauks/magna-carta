/*
 * The (app) session guard. Every signed-in surface that carries the destination rail renders inside
 * this group, so the gate sits at its layout — but the gate ITSELF lives in
 * $lib/navigation/session-guard.ts, because the document group behind its own chrome enforces the
 * same one and two copies is how one of them drifts.
 */
import { guardSignedInSurface } from "$lib/navigation/session-guard.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = ({ url }) => guardSignedInSurface(url);
