/*
 * The build identity a deployed Worker knows about itself: the git commit it was built from, when
 * that commit was made, and when the build ran. The values are baked in at build time (the deploy
 * build step regenerates build-identity-values.generated.ts from git; see
 * scripts/generate-build-identity.mjs), so every Worker in one deploy reports the same commit and
 * a version read can say exactly what is running where. A build with no git identity — local dev,
 * tests — reports the honest "dev" placeholder instead of a fabricated version.
 */
import { GENERATED_BUILD_IDENTITY } from "./build-identity-values.generated.ts";

export interface BuildIdentity {
  /** Short git commit hash of the checkout the artifact was built from, or "dev". */
  readonly commit: string;
  /** ISO 8601 author-independent committer time of that commit; null on a dev build. */
  readonly commitTime: string | null;
  /** ISO 8601 time the build ran; null on a dev build. */
  readonly buildTime: string | null;
}

export const BUILD_IDENTITY: BuildIdentity = GENERATED_BUILD_IDENTITY;

/** True when the identity is the development placeholder rather than a real build stamp. */
export function isDevelopmentBuildIdentity(identity: BuildIdentity): boolean {
  return identity.commit === "dev";
}
