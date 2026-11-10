import { z } from "zod";
import { identifierField } from "@magna-carta/identifiers/field";
import { FOLDER_NAME_MAX_LENGTH } from "./shelf.ts";

// The assistant's contract: what its API returns for a conversation and a turn, and what the shelf
// (a member's folders and pins) accepts and returns, as plain zod. Each component is named with zod's
// own metadata (`.meta({ id })`), which the contract emitter reads as the component's name, so the
// route module in apps/api-worker declares routes over these without restating a field. Path and
// query parameters stay with the routes: they are addressing, not domain shape
// (docs/conventions/api.md, _Where a contract shape lives_).

// One conversation as a list or a read returns it. `folderId` and `pinnedAt` are the READER's shelf,
// never the author's: where a member keeps a conversation decides nothing about who may read it.
export const ConversationSummary = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    createdBy: z.string(),
    matterId: z.string().nullable(),
    state: z.enum(["active", "archived", "deleted"]),
    createdAt: z.string(),
    updatedAt: z.string(),
    // The reader's folder; null is General.
    folderId: z.string().nullable(),
    // When the reader pinned it; null when they have not.
    pinnedAt: z.string().nullable(),
  })
  .meta({ id: "MagnusConversation" });

export const TurnDetail = z
  .object({
    id: z.string(),
    sequence: z.number(),
    speaker: z.enum(["member", "magnus"]),
    content: z.string().nullable(),
    status: z.enum(["pending", "complete", "failed", "refused"]),
    failureLabel: z
      .enum(["model-unavailable", "not-eligible", "ceiling-reached", "too-large", "cancelled"])
      .nullable(),
    modelId: z.string().nullable(),
    snapshotId: z.string().nullable(),
    // True when earlier messages did not fit the request window, so this answer was built on part of
    // the conversation.
    contextTruncated: z.boolean(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .meta({ id: "MagnusTurn" });

export const TurnProgress = z
  .object({
    turnId: z.string(),
    status: z.enum(["pending", "complete", "failed", "refused", "unknown"]),
    content: z.string().optional(),
    failureLabel: z
      .enum(["model-unavailable", "not-eligible", "ceiling-reached", "too-large", "cancelled"])
      .optional(),
    truncatedContext: z.boolean().optional(),
  })
  .meta({ id: "MagnusTurnProgress" });

// A member's own folder. General is not one: it is where a conversation in no folder sits.
export const Folder = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "MagnusFolder" });

export const FolderList = z.object({ data: z.array(Folder) }).meta({ id: "MagnusFolderList" });

export const FolderNameRequest = z
  .object({ name: z.string().trim().min(1).max(FOLDER_NAME_MAX_LENGTH) })
  .meta({ id: "MagnusFolderNameRequest" });

// Where the reader keeps one conversation, both halves at once so a move and a pin are never half
// applied. A null folder is General.
export const ShelfRequest = z
  .object({
    folderId: identifierField("magnusFolder").nullable(),
    pinned: z.boolean(),
  })
  .meta({ id: "MagnusShelfRequest" });

export const ShelfResponse = z
  .object({
    conversationId: z.string(),
    folderId: z.string().nullable(),
    pinnedAt: z.string().nullable(),
  })
  .meta({ id: "MagnusShelf" });
