// The operations the notifications module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "notificationPreferences.get",
  "notificationPreferences.getTrustComplianceRecipients",
  "notificationPreferences.setTrustComplianceRecipients",
  "notificationPreferences.update",
  "notifications.dismiss",
  "notifications.list",
  "notifications.markAllRead",
  "notifications.markRead",
  "notifications.unreadCount",
];
