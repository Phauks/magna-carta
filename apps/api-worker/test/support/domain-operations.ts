// Every domain module's committed operation list, keyed by the manifest's domain name. The
// conformance suite mounts each module alone and holds it to its list; the union of the lists is
// what the whole document must carry. A domain in the manifest with no entry here, or an entry
// with no domain, fails there by name.
import { OPERATIONS as billing } from "../../src/routes/billing/operations.ts";
import { OPERATIONS as calendar } from "../../src/routes/calendar/operations.ts";
import { OPERATIONS as communications } from "../../src/routes/communications/operations.ts";
import { OPERATIONS as custody } from "../../src/routes/custody/operations.ts";
import { OPERATIONS as developer } from "../../src/routes/developer/operations.ts";
import { OPERATIONS as directory } from "../../src/routes/directory/operations.ts";
import { OPERATIONS as discovery } from "../../src/routes/discovery/operations.ts";
import { OPERATIONS as documents } from "../../src/routes/documents/operations.ts";
import { OPERATIONS as email } from "../../src/routes/email/operations.ts";
import { OPERATIONS as files } from "../../src/routes/files/operations.ts";
import { OPERATIONS as firm } from "../../src/routes/firm/operations.ts";
import { OPERATIONS as magnus } from "../../src/routes/magnus/operations.ts";
import { OPERATIONS as matters } from "../../src/routes/matters/operations.ts";
import { OPERATIONS as notesAndTasks } from "../../src/routes/notes-and-tasks/operations.ts";
import { OPERATIONS as notifications } from "../../src/routes/notifications/operations.ts";
import { OPERATIONS as platform } from "../../src/routes/platform/operations.ts";
import { OPERATIONS as session } from "../../src/routes/session/operations.ts";
import { OPERATIONS as support } from "../../src/routes/support/operations.ts";
import { OPERATIONS as timekeeping } from "../../src/routes/timekeeping/operations.ts";
import { OPERATIONS as tools } from "../../src/routes/tools/operations.ts";
import { OPERATIONS as trust } from "../../src/routes/trust/operations.ts";

export const DOMAIN_OPERATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["session", session],
  ["platform", platform],
  ["firm", firm],
  ["billing", billing],
  ["files", files],
  ["tools", tools],
  ["email", email],
  ["documents", documents],
  ["matters", matters],
  ["directory", directory],
  ["calendar", calendar],
  ["notes-and-tasks", notesAndTasks],
  ["communications", communications],
  ["custody", custody],
  ["magnus", magnus],
  ["discovery", discovery],
  ["timekeeping", timekeeping],
  ["trust", trust],
  ["notifications", notifications],
  ["support", support],
  ["developer", developer],
]);
