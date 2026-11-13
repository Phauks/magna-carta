// The board's API, as the screens call it: same-origin `/api/...` on the board's own host, through
// the app's one transport (`requestJson`), so every failure reaches a screen as a whole record.
// The shapes are the ones `@magna-carta/community/contract` declares; the board's worker validates
// what it is sent against the same schemas.

import type {
  BoardCommentView,
  BoardPostView,
  BoardSummary,
} from "@magna-carta/community/board-service";
import type { ConfidentialityFinding } from "@magna-carta/community/confidentiality-detector";
import type {
  DeclineReason,
  FlagReason,
  HeldReason,
  ModerationState,
  PostKind,
  RequestStatus,
  SortOrder,
} from "@magna-carta/community/vocabulary";
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

export interface BoardProfile {
  readonly displayName: string | null;
  readonly suggestedDisplayName: string;
  readonly approved: boolean;
  readonly noticeDismissed: boolean;
  readonly isTeam: boolean;
}

export interface BoardSession {
  readonly signedIn: boolean;
  readonly canWrite: boolean;
  readonly boardState: "open" | "read-only" | "off";
  readonly signInUrl: string;
  readonly profile: BoardProfile | null;
}

export interface BoardListFilter {
  readonly kind: PostKind;
  readonly category: string | null;
  readonly statuses: readonly string[];
  readonly search: string;
  readonly sort: SortOrder;
  readonly limit: number;
  readonly offset: number;
}

export interface ContributionResult {
  readonly moderationState: ModerationState;
  readonly heldReason: HeldReason | null;
  readonly findings: readonly ConfidentialityFinding[];
}

const call = <T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown) =>
  requestJson<T>(fetch, path, { method, body });

export function readSession(): Promise<ApiOutcome<BoardSession>> {
  return call("/session");
}

export function signOut(): Promise<ApiOutcome<Record<string, never>>> {
  return call("/session/end", "POST");
}

export function readBoard(
  filter: BoardListFilter,
  signal?: AbortSignal,
): Promise<ApiOutcome<{ posts: BoardPostView[]; total: number }>> {
  const query = new URLSearchParams({
    kind: filter.kind,
    sort: filter.sort,
    limit: String(filter.limit),
    offset: String(filter.offset),
  });
  if (filter.category !== null) query.set("category", filter.category);
  if (filter.search.trim() !== "") query.set("search", filter.search.trim());
  for (const status of filter.statuses) query.append("status", status);
  return requestJson(fetch, `/api/board?${query.toString()}`, { signal });
}

export function readSummary(): Promise<ApiOutcome<BoardSummary>> {
  return call("/api/summary");
}

export function readPost(
  number: number,
): Promise<ApiOutcome<{ post: BoardPostView; comments: BoardCommentView[] }>> {
  return call(`/api/posts/${number}`);
}

export function saveDisplayName(displayName: string): Promise<ApiOutcome<{ displayName: string }>> {
  return call("/api/profile", "PUT", { displayName });
}

export function dismissNotice(): Promise<ApiOutcome<Record<string, never>>> {
  return call("/api/profile/notice-dismissed", "POST");
}

export function createPost(post: {
  kind: PostKind;
  category: string;
  title: string;
  body: string;
}): Promise<ApiOutcome<ContributionResult & { number: number }>> {
  return call("/api/posts", "POST", post);
}

export function castVote(
  number: number,
  cast: boolean,
): Promise<ApiOutcome<{ voteCount: number | null; viewerHasVoted: boolean }>> {
  return call(`/api/posts/${number}/vote`, cast ? "POST" : "DELETE");
}

export function addComment(
  number: number,
  body: string,
): Promise<ApiOutcome<ContributionResult & { id: string }>> {
  return call(`/api/posts/${number}/comments`, "POST", { body });
}

export function deletePost(number: number): Promise<ApiOutcome<Record<string, never>>> {
  return call(`/api/posts/${number}`, "DELETE");
}

export function deleteComment(id: string): Promise<ApiOutcome<Record<string, never>>> {
  return call(`/api/comments/${encodeURIComponent(id)}`, "DELETE");
}

export function report(
  number: number,
  reason: FlagReason,
  commentId?: string,
): Promise<ApiOutcome<{ hidden: boolean }>> {
  return call(`/api/posts/${number}/flag`, "POST", { reason, commentId });
}

export function setStatus(
  number: number,
  update: {
    status: RequestStatus;
    declineReason?: DeclineReason;
    declineNote?: string;
    duplicateOfNumber?: number;
    linkedChangelogAnchor?: string;
  },
): Promise<ApiOutcome<Record<string, never>>> {
  return call(`/api/posts/${number}/status`, "POST", update);
}

export function acceptAnswer(
  number: number,
  commentId: string | null,
): Promise<ApiOutcome<Record<string, never>>> {
  return call(`/api/posts/${number}/accept-answer`, "POST", { commentId });
}

export function moderate(
  number: number,
  decision: "publish" | "remove",
  commentId?: string,
): Promise<ApiOutcome<Record<string, never>>> {
  return call(`/api/posts/${number}/moderate`, "POST", { decision, commentId });
}
