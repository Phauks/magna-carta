import type {
  DirectoryPersonId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  ShareId,
  UserId,
} from "@magna-carta/identifiers/types";

// What a share can point at. `matter` is the matter's top level: the files that sit in no folder.
// A folder share covers the files directly inside it, including files added later, and never the
// folders inside it: each of those is shared on its own, so making a folder never widens what anybody
// outside the firm can see.
export const SHARE_SCOPES = ["matter", "folder", "file"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

// The three roles, named the way Google Docs names them, weakest first. The order is load-bearing:
// where two shares reach one file, the person gets the stronger role, which is the later index.
export const SHARE_ROLES = ["viewer", "commenter", "editor"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

// How strongly the person proves who they are before the share opens: a one-time emailed link, an
// emailed code, or an emailed code plus a second step.
export const SHARE_SIGN_INS = ["link", "emailCode", "twoStep"] as const;
export type ShareSignIn = (typeof SHARE_SIGN_INS)[number];

// What a person outside the firm asks to do with a file. `download` is separate from the role:
// "read it on screen, keep no copy" is a real instruction for a draft or a privileged exhibit.
export const SHARE_CAPABILITIES = ["view", "download", "comment", "edit"] as const;
export type ShareCapability = (typeof SHARE_CAPABILITIES)[number];

export function roleRank(role: ShareRole): number {
  return SHARE_ROLES.indexOf(role);
}

export function roleAllows(
  role: ShareRole,
  capability: Exclude<ShareCapability, "download">,
): boolean {
  if (capability === "view") return true;
  if (capability === "comment") return role === "commenter" || role === "editor";
  return role === "editor";
}

/** One thing to share, as the staff screen names it. */
export type ShareTarget =
  | { readonly scope: "matter" }
  | { readonly scope: "folder"; readonly folderId: FolderId }
  | {
      readonly scope: "file";
      readonly fileId: FileId;
      readonly fileVersionId?: FileVersionId | null;
    };

/** A share as the staff screens read it. */
export interface ShareRecord {
  readonly id: ShareId;
  readonly matterId: MatterId;
  readonly scope: ShareScope;
  readonly folderId: FolderId | null;
  readonly fileId: FileId | null;
  readonly fileVersionId: FileVersionId | null;
  readonly recipientEntityId: DirectoryPersonId;
  // The Directory's display name for the person, read at the time of the read, never stored here.
  readonly recipientName: string | null;
  readonly role: ShareRole;
  readonly allowDownload: boolean;
  readonly signIn: ShareSignIn;
  readonly endsOn: string | null;
  readonly sharedByUserId: UserId;
  readonly createdAt: string;
  readonly updatedAt: string;
  // True when the share is still recorded as active but no longer opens: its end date has passed or
  // the member who made it can no longer share. Staff see it so they can share it again themselves.
  readonly dormant: "ended" | "needsNewSharer" | null;
}
