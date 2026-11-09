import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerNotificationPreferencesRoutes } from "./notification-preferences.ts";
import { registerNotificationsRoutes } from "./notifications.ts";

// The member's notification feed and the preferences that shape it.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountNotifications(
  app: AppRouter,
  chokepoint: Chokepoint,
  _deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // The member's own notification feed: one page, the unread counts, and settling an item. Every
  // read is scoped to the session's user and filtered by matter visibility in SQL.
  registerNotificationsRoutes(domain, chokepoint);
  // What that feed is allowed to carry: the member's own per-category matrix under the firm's
  // in-app floor, and the firm's trust-compliance designation.
  registerNotificationPreferencesRoutes(domain, chokepoint);
  app.route("/", domain);
}
