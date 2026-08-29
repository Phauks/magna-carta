/*
 * Build identity — version tracing for error reports and the developer console. The values are
 * baked in at build time by vite define (vite.config.ts), so a pasted error report pins the
 * exact build that produced it: the commit is the version until release versioning exists
 * (package versions are all 0.0.0 pre-launch), and the mode separates dev-server noise from a
 * deployed build.
 */
export const BUILD_IDENTITY = {
  commit: __MC_BUILD_COMMIT__,
  // The commit's own (committer) timestamp; null when git could not answer at build time.
  committedAt: __MC_BUILD_COMMIT_TIME__,
  builtAt: __MC_BUILD_TIME__,
  mode: import.meta.env.MODE,
} as const;

/** One line for trace blocks: "a1b2c3d (development, built 2026-07-02T21:14:03.000Z)". */
export function buildIdentityLine(): string {
  return `${BUILD_IDENTITY.commit} (${BUILD_IDENTITY.mode}, built ${BUILD_IDENTITY.builtAt})`;
}
