/*
 * Hand-written declaration for commit-identity.mjs, which stays plain JavaScript because build
 * scripts run before anything is compiled. Keep the two in step.
 */
export function resolveCommitIdentity(): {
  commit: string | null;
  commitTime: string | null;
};
