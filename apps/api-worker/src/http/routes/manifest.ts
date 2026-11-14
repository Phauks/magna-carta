import type { DomainModule } from "./domain-app.ts";
import { mountSession } from "./session/index.ts";
import { mountPlatform } from "./platform/index.ts";
import { mountFirm } from "./firm/index.ts";
import { mountBilling } from "./billing/index.ts";
import { mountFiles } from "./files/index.ts";
import { mountTools } from "./tools/index.ts";
import { mountEmail } from "./email/index.ts";
import { mountDocuments } from "./documents/index.ts";
import { mountMatters } from "./matters/index.ts";
import { mountDirectory } from "./directory/index.ts";
import { mountCalendar } from "./calendar/index.ts";
import { mountNotesAndTasks } from "./notes-and-tasks/index.ts";
import { mountCommunications } from "./communications/index.ts";
import { mountCustody } from "./custody/index.ts";
import { mountMagnus } from "./magnus/index.ts";
import { mountDiscovery } from "./discovery/index.ts";
import { mountTimekeeping } from "./timekeeping/index.ts";
import { mountTrust } from "./trust/index.ts";
import { mountNotifications } from "./notifications/index.ts";
import { mountSupport } from "./support/index.ts";
import { mountDeveloper } from "./developer/index.ts";
import { mountRecordTransfer } from "./record-transfer/index.ts";

// The manifest: every domain module this Worker serves, in the order they mount. app.ts iterates it
// and nothing else registers a chokepoint route, so adding a surface is one directory here and one
// line below. The order is the order Hono matches in across domains; test/route-table.test.ts proves
// no domain's pattern claims another's literal path, whatever this order is.
export const DOMAIN_MODULES: readonly DomainModule[] = [
  { domain: "session", mount: mountSession },
  { domain: "platform", mount: mountPlatform },
  { domain: "firm", mount: mountFirm },
  { domain: "billing", mount: mountBilling },
  { domain: "files", mount: mountFiles },
  { domain: "tools", mount: mountTools },
  { domain: "email", mount: mountEmail },
  { domain: "documents", mount: mountDocuments },
  { domain: "matters", mount: mountMatters },
  { domain: "directory", mount: mountDirectory },
  { domain: "calendar", mount: mountCalendar },
  { domain: "notes-and-tasks", mount: mountNotesAndTasks },
  { domain: "communications", mount: mountCommunications },
  { domain: "custody", mount: mountCustody },
  { domain: "magnus", mount: mountMagnus },
  { domain: "discovery", mount: mountDiscovery },
  { domain: "timekeeping", mount: mountTimekeeping },
  { domain: "trust", mount: mountTrust },
  { domain: "notifications", mount: mountNotifications },
  { domain: "support", mount: mountSupport },
  { domain: "developer", mount: mountDeveloper },
  { domain: "record-transfer", mount: mountRecordTransfer },
];
