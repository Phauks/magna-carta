import type {
  BoardCommentView,
  BoardPostView,
  BoardSummary,
} from "@magna-carta/community/board-service";

// An invented board for the review surface. Every name here is made up, and nothing in it is a
// client, a matter or a firm, which is the point of the board.

function request(
  number: number,
  title: string,
  body: string,
  fields: Partial<BoardPostView>,
): BoardPostView {
  return {
    number,
    kind: "request",
    category: "trust-and-reconciliation",
    status: "new",
    title,
    body,
    authorDisplayName: "Member",
    isOwnPost: false,
    moderationState: "published",
    heldReason: null,
    duplicateOfNumber: null,
    declineReason: null,
    declineNote: null,
    voteCount: null,
    firmVoteCount: null,
    commentCount: 0,
    viewerHasVoted: false,
    linkedChangelogAnchor: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    statusChangedAt: null,
    ...fields,
  };
}

export const GALLERY_POSTS: readonly BoardPostView[] = [
  request(
    1042,
    "Split one invoice across two trust accounts",
    "When a retainer was deposited in two parts into different trust accounts, paying one invoice from both needs two manual entries today.\n\nIt would help to choose more than one trust account when applying a payment, with the amount from each, and have the invoice show one payment with two sources.",
    {
      createdAt: "2026-10-21T15:12:00.000Z",
      status: "planned",
      voteCount: 214,
      firmVoteCount: 96,
      commentCount: 31,
      authorDisplayName: "Dana R.",
      viewerHasVoted: true,
    },
  ),
  request(
    988,
    "Court rules calendar for Nevada district courts",
    "Docketing deadlines for the Eighth Judicial District would save us re-checking every rule by hand.",
    {
      createdAt: "2026-09-08T17:40:00.000Z",
      category: "calendar-and-docketing",
      status: "building-now",
      voteCount: 187,
      firmVoteCount: 102,
      commentCount: 24,
      authorDisplayName: "M. Okafor",
    },
  ),
  request(
    1101,
    "Bulk-edit custom fields from the matter list",
    "Select twenty matters, set the same field once. Right now each matter has to be opened.",
    {
      createdAt: "2026-11-05T14:03:00.000Z",
      category: "matters-and-organisation",
      status: "future",
      voteCount: 96,
      firmVoteCount: 51,
      commentCount: 12,
      authorDisplayName: "Priya",
    },
  ),
  request(
    1077,
    "Merge field for the responsible attorney's bar number",
    "Pleading templates need the bar number of whoever signs, not the originating attorney.",
    {
      createdAt: "2026-10-09T19:25:00.000Z",
      category: "templates-and-automation",
      status: "beta",
      voteCount: 71,
      firmVoteCount: 40,
      commentCount: 9,
      authorDisplayName: "J. Castellanos",
    },
  ),
  request(
    902,
    "Show unbilled time on the matter header",
    "A small number beside the matter name so we notice unbilled work before month end.",
    {
      createdAt: "2026-07-14T16:50:00.000Z",
      category: "time-and-costs",
      status: "completed",
      voteCount: 48,
      firmVoteCount: 30,
      commentCount: 6,
      authorDisplayName: "Sam W.",
    },
  ),
  request(
    1140,
    "Keyboard shortcut to start a timer on the open matter",
    "A single key to start and stop time on whatever matter is on screen.",
    {
      createdAt: "2026-11-10T09:30:00.000Z",
      category: "time-and-costs",
      status: "new",
      voteCount: null,
      firmVoteCount: null,
      commentCount: 1,
      authorDisplayName: "Dana R.",
      isOwnPost: true,
      moderationState: "held",
      heldReason: "first-post",
    },
  ),
];

export const GALLERY_SUMMARY: BoardSummary = {
  requestsByArea: {
    "trust-and-reconciliation": 38,
    "billing-and-invoicing": 61,
    "time-and-costs": 44,
    "matters-and-organisation": 29,
    "directory-and-conflicts": 17,
    "documents-and-file-manager": 52,
    "templates-and-automation": 40,
    discovery: 11,
    custodian: 6,
    "calendar-and-docketing": 33,
    "client-portal": 21,
    reports: 24,
    "integrations-and-api": 19,
    "mobile-and-desktop": 14,
    search: 9,
    accessibility: 7,
    "onboarding-and-migration": 12,
  },
  questionsByArea: { "trust-and-reconciliation": 12, "billing-and-invoicing": 20 },
  roadmap: { future: 142, planned: 14, "building-now": 6, beta: 3, completed: 58 },
};

function comment(id: string, fields: Partial<BoardCommentView>): BoardCommentView {
  return {
    id: id as BoardCommentView["id"],
    body: "",
    authorDisplayName: "Member",
    isOwnComment: false,
    isTeamResponse: false,
    isAcceptedAnswer: false,
    moderationState: "published",
    createdAt: "2026-11-02T12:00:00.000Z",
    ...fields,
  };
}

export const GALLERY_COMMENTS: readonly BoardCommentView[] = [
  comment("communityComment_team", {
    createdAt: "2026-11-02T16:00:00.000Z",
    authorDisplayName: "Trevor",
    isTeamResponse: true,
    body: "We are taking this on with the trust-payment work. Each source account keeps its own ledger line, so a three-way reconciliation still balances per account.",
  }),
  comment("communityComment_priya", {
    createdAt: "2026-11-06T13:20:00.000Z",
    authorDisplayName: "Priya",
    body: "Same need here. Would the receipt to the client list both accounts, or just the total?",
  }),
  comment("communityComment_own", {
    createdAt: "2026-11-08T10:45:00.000Z",
    authorDisplayName: "J. Castellanos",
    isOwnComment: true,
    body: "Ideally both, with the account names but not the numbers.",
  }),
];
