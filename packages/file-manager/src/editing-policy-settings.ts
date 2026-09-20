// The firm's editing policy: whether every document opened in the browser editor records its
// changes. One setting, on by default, because the only per-person record of who wrote which words
// lives inside the document as tracked changes, and a firm that wants that history has to be
// recording before the first edit. A firm that files documents with opposing counsel may decide
// otherwise, which is why it is a setting and not a constant. The stored document keeps every mark;
// a copy that leaves the platform is produced with them accepted, so a member never sends redlines
// they did not mean to.
//
// Read on every WOPI CheckFileInfo (the host tells the editor to keep recording on and takes the
// control away) and on every launch (the screen framing the editor hides the marks once the
// document is showing, so the page a member types on looks the way it always did).
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";

export const recordChangesDefinition: FirmSettingDefinition<boolean> = {
  key: "editing.record_changes",
  schema: z.boolean(),
  defaultValue: true,
};

export function readRecordChanges(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, recordChangesDefinition);
}
