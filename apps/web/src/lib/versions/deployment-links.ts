/*
 * WHERE A ROW GOES WHEN SOMEBODY CLICKS IT.
 *
 * Every row in the Build Information panel names something a person can open: a Cloudflare Worker
 * they would go and look at in the dashboard, and a commit they would go and read on GitHub. Until
 * now every one of those was text to be copied into another tab by hand — which is the step at which
 * somebody transposes a character of a commit hash and reads the wrong diff.
 *
 * THE DASHBOARD LINK NAMES NO ACCOUNT. Cloudflare's `?to=` form resolves `:account` against whoever
 * is signed in, so the link works for every member of the account and this build embeds no account
 * identifier to go stale or to leak. A reader not signed into Cloudflare lands on the login screen
 * and arrives where they were going, which is the correct behaviour for a link into somebody else's
 * console.
 *
 * NOTHING IS LINKED THAT CANNOT BE VERIFIED. A commit link needs a repository the build actually
 * established (BUILD_IDENTITY.sourceRepository, resolved at build time from the git remote) and a
 * commit that is a real stamp rather than the "dev"/"unknown" placeholder — a link built from a
 * placeholder is a 404 that reads as a broken deployment. Both accessors return null instead, and
 * the panel renders plain text.
 *
 * LINKS ARE A SIGNED-IN AFFORDANCE. The chip also rides the signed-out surfaces, where the build's
 * own commit is already inside the bundle the visitor downloaded and discloses nothing new — but
 * the repository path and the fleet's Worker names are internal furniture, and a sign-in screen is
 * not the place to publish them. The panel gates on scope; these functions stay pure.
 */
import { BUILD_IDENTITY } from "$lib/build-identity.ts";
import { isRealCommit } from "./version-overlay-model.ts";

/**
 * The Cloudflare dashboard page for one deployed Worker.
 *
 * `?to=/:account/...` is the account-agnostic deep-link form: Cloudflare substitutes the account
 * the reader is signed into. The Worker name is the row's own `service`, which the API reads off
 * the wrangler config that deploys it, so the link cannot drift from the thing it points at.
 */
export function workerDashboardUrl(workerName: string): string {
  return `https://dash.cloudflare.com/?to=/:account/workers/services/view/${encodeURIComponent(workerName)}/production`;
}

/**
 * The commit on GitHub, or null when this build cannot back the link up — no repository resolved at
 * build time, or a placeholder commit that names no real object.
 */
export function commitUrl(commit: string | null): string | null {
  const repository = BUILD_IDENTITY.sourceRepository;
  if (repository === null || !isRealCommit(commit)) return null;
  return `${repository}/commit/${encodeURIComponent(commit)}`;
}

/**
 * What changed between the build this tab is running and the one the deployment is serving now —
 * the question the update dot raises and nothing answered. Null unless both commits are real and
 * actually differ: a comparison of a commit against itself is an empty page, and a comparison
 * against a placeholder is a 404.
 */
export function commitComparisonUrl(from: string | null, to: string | null): string | null {
  const repository = BUILD_IDENTITY.sourceRepository;
  if (repository === null || !isRealCommit(from) || !isRealCommit(to) || from === to) return null;
  return `${repository}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;
}
