import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type {
  DirectoryPersonId,
  FileId,
  FolderId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";

// A migrated in-memory per-firm database with one matter laid out the way a litigation matter is:
// a Discovery folder with a Requests folder inside it, a Pleadings folder, and one file at the top.

export const ATTORNEY = "user_shareAttorney00" as UserId;
export const BILLING = "user_shareBilling000" as UserId;
export const MATTER = "matter_shareTest00000000000000000" as MatterId;
export const OTHER_MATTER = "matter_shareOther0000000000000000" as MatterId;
export const HOLDING_MATTER = "matter_shareHolding00000000000000" as MatterId;
export const CLIENT = "directoryPerson_shareClient000000000" as DirectoryPersonId;
export const EXPERT = "directoryPerson_shareExpert000000000" as DirectoryPersonId;
export const COLLEAGUE_PERSON = "directoryPerson_shareColleague00000" as DirectoryPersonId;

export const DISCOVERY = "folder_shareDiscovery00000" as FolderId;
export const REQUESTS = "folder_shareRequests000000" as FolderId;
export const PLEADINGS = "folder_sharePleadings00000" as FolderId;

export const today = "2026-11-20";
export const now = "2026-11-20T20:00:00.000Z";
export const clock = { now: () => now };
export const visibility = visibleMatterPredicate();
export const context = { today, now, visibility };
export const options = { clock, actorUserId: ATTORNEY, visibility };

const ATTORNEY_ROLE = "role_gEyJ_YqL1_RI_yDqSa28Y";
const BILLING_ROLE = "role_hwwC1D98d8Lazc_asL6vO";

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => now });
}

type Raw = ReturnType<typeof migratedDatabase>["raw"];

export function seedFirm(raw: Raw): void {
  const at = "2026-08-01T00:00:00.000Z";
  for (const [userId, name, role, index] of [
    [ATTORNEY, "Avery Attorney", ATTORNEY_ROLE, 1],
    [BILLING, "Billing Clerk", BILLING_ROLE, 2],
  ] as const) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${userId}', '${name}', 'active', '${at}')`,
    );
    raw.exec(
      `INSERT INTO member_role (id, member_user_id, role_id) VALUES ('memberRole_shareTest0000000${index}', '${userId}', '${role}')`,
    );
  }
  const matterColumns =
    "id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at";
  for (const [id, title, key] of [
    [MATTER, "Alvarez v. Pine Ridge HOA", "NULL"],
    [OTHER_MATTER, "Brown estate", "NULL"],
    [HOLDING_MATTER, "Custody holdings", "'custody-holding'"],
  ] as const) {
    raw.exec(
      `INSERT INTO matter (${matterColumns}) VALUES ('${id}', '${title}', 'open', '${ATTORNEY}', ${key}, '${at}', '${at}', '${at}')`,
    );
  }
  for (const [id, given, family, memberId] of [
    [CLIENT, "Maria", "Alvarez", "NULL"],
    [EXPERT, "Emily", "Marsh", "NULL"],
    [COLLEAGUE_PERSON, "Avery", "Attorney", `'${ATTORNEY}'`],
  ] as const) {
    raw.exec(
      `INSERT INTO directory_person (id, name_given, name_family, member_id, status, created_at, updated_at) VALUES ('${id}', '${given}', '${family}', ${memberId}, 'active', '${at}', '${at}')`,
    );
  }
  for (const [id, name, parent] of [
    [DISCOVERY, "Discovery", "NULL"],
    [REQUESTS, "Requests for Production", `'${DISCOVERY}'`],
    [PLEADINGS, "Pleadings", "NULL"],
  ] as const) {
    raw.exec(
      `INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES ('${id}', '${MATTER}', ${parent}, '${name}', '${at}', '${at}')`,
    );
  }
}

export function seedFile(
  raw: Raw,
  name: string,
  folderId: FolderId | null,
  matterId = MATTER,
): FileId {
  const fileId = `file_${name
    .replace(/[^a-zA-Z0-9]/gu, "")
    .padEnd(21, "0")
    .slice(0, 21)}` as FileId;
  raw.exec(
    `INSERT INTO file (id, matter_id, folder_id, name, edit_state, created_at, updated_at) VALUES ('${fileId}', '${matterId}', ${folderId === null ? "NULL" : `'${folderId}'`}, '${name}', 'idle', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  );
  return fileId;
}
