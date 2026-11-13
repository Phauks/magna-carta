import type { BoardRefusal } from "@magna-carta/community/board-service";

// Every answer this worker gives carries these. The board is public to read and kept out of search
// engines permanently: a lawyer's display name beside a request about a disputed fee must never
// become a search result. And no page here passes its address on to another site.
export const BOARD_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export function withBoardHeaders(response: Response): Response {
  const answer = new Response(response.body, response);
  for (const [name, value] of Object.entries(BOARD_HEADERS)) answer.headers.set(name, value);
  return answer;
}

const REFUSAL_STATUS: Record<BoardRefusal, number> = {
  "profile-required": 409,
  "post-not-found": 404,
  "comment-not-found": 404,
  "not-the-author": 403,
  "not-votable": 409,
  "not-team": 403,
  "invalid-category": 422,
  "invalid-status": 422,
  "decline-reason-required": 422,
  "duplicate-target-required": 422,
  "not-a-question": 409,
};

// The sentence a person reads when the board refuses. Plain words, never the code.
const REFUSAL_DETAIL: Record<BoardRefusal, string> = {
  "profile-required": "Choose a display name before you post.",
  "post-not-found": "That post is not on the board.",
  "comment-not-found": "That comment is not on the board.",
  "not-the-author": "Only the person who wrote it can delete it.",
  "not-votable": "Only a published request takes votes.",
  "not-team": "Only the Magna Carta team can do that.",
  "invalid-category": "Choose a topic from the list.",
  "invalid-status": "That status does not apply here.",
  "decline-reason-required": "Say why the request is declined.",
  "duplicate-target-required": "Name the post this one duplicates.",
  "not-a-question": "Only a question has an accepted answer.",
};

export type BoardProblemCode =
  | BoardRefusal
  | "invalid-request"
  | "sign-in-required"
  | "membership-required"
  | "cross-site-request"
  | "board-read-only"
  | "board-off"
  | "sign-in-not-configured"
  | "internal-error";

const OTHER_PROBLEMS: Record<
  Exclude<BoardProblemCode, BoardRefusal>,
  { status: number; detail: string }
> = {
  "invalid-request": { status: 400, detail: "The request was not in the form the board expects." },
  "sign-in-required": { status: 401, detail: "Sign in to Magna Carta to take part." },
  "membership-required": {
    status: 403,
    detail: "Only people at a firm that uses Magna Carta can post, vote or comment.",
  },
  "cross-site-request": { status: 403, detail: "The request did not come from the board itself." },
  "board-read-only": {
    status: 503,
    detail: "The board is read-only for now. Nothing can be posted, voted on or changed.",
  },
  "board-off": { status: 503, detail: "The board is closed for now." },
  "sign-in-not-configured": { status: 503, detail: "Signing in to the board is not set up yet." },
  "internal-error": { status: 500, detail: "The board could not finish that." },
};

// A problem document (RFC 9457), the same shape the app's own API answers with, so the screens read
// both with one model.
export function problem(code: BoardProblemCode, errorId?: string): Response {
  const known = code in REFUSAL_STATUS;
  const status = known
    ? REFUSAL_STATUS[code as BoardRefusal]
    : OTHER_PROBLEMS[code as Exclude<BoardProblemCode, BoardRefusal>].status;
  const detail = known
    ? REFUSAL_DETAIL[code as BoardRefusal]
    : OTHER_PROBLEMS[code as Exclude<BoardProblemCode, BoardRefusal>].detail;
  return Response.json(
    {
      type: `https://community.magnacarta.esq/problems/${code}`,
      title: code,
      status,
      detail,
      ...(errorId === undefined ? {} : { errorId }),
    },
    {
      status,
      headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
    },
  );
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
