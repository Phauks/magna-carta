// Every domain module's committed operation list, keyed by the manifest's domain name. The
// conformance suite mounts each module alone and holds it to its list; the union of the lists is
// what the whole document must carry. A domain in the manifest with no entry here, or an entry
// with no domain, fails there by name.
import { OPERATIONS as billing } from "../../src/http/routes/billing/operations.ts";
import { OPERATIONS as calendar } from "../../src/http/routes/calendar/operations.ts";
import { OPERATIONS as communications } from "../../src/http/routes/communications/operations.ts";
import { OPERATIONS as custody } from "../../src/http/routes/custody/operations.ts";
import { OPERATIONS as developer } from "../../src/http/routes/developer/operations.ts";
import { OPERATIONS as directory } from "../../src/http/routes/directory/operations.ts";
import { OPERATIONS as discovery } from "../../src/http/routes/discovery/operations.ts";
import { OPERATIONS as documents } from "../../src/http/routes/documents/operations.ts";
import { OPERATIONS as email } from "../../src/http/routes/email/operations.ts";
import { OPERATIONS as files } from "../../src/http/routes/files/operations.ts";
import { OPERATIONS as firm } from "../../src/http/routes/firm/operations.ts";
import { OPERATIONS as magnus } from "../../src/http/routes/magnus/operations.ts";
import { OPERATIONS as matters } from "../../src/http/routes/matters/operations.ts";
import { OPERATIONS as notesAndTasks } from "../../src/http/routes/notes-and-tasks/operations.ts";
import { OPERATIONS as notifications } from "../../src/http/routes/notifications/operations.ts";
import { OPERATIONS as platform } from "../../src/http/routes/platform/operations.ts";
import { OPERATIONS as recordTransfer } from "../../src/http/routes/record-transfer/operations.ts";
import { OPERATIONS as session } from "../../src/http/routes/session/operations.ts";
import { OPERATIONS as support } from "../../src/http/routes/support/operations.ts";
import { OPERATIONS as timekeeping } from "../../src/http/routes/timekeeping/operations.ts";
import { OPERATIONS as tools } from "../../src/http/routes/tools/operations.ts";
import { OPERATIONS as trust } from "../../src/http/routes/trust/operations.ts";

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
  ["record-transfer", recordTransfer],
]);
