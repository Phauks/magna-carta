// The published ABA UTBMS task / activity / expense families, carried as data. Firms enable or disable
// these rows but never invent a code — the standard set is the contract a LEDES export validates
// against, so it is fixed here and seeded at provisioning. A representative, extensible subset of the
// litigation (L), counselling (A) and expense (E) sets; new published codes are added here and nowhere
// else. code_set partitions the three families; code is the published ABA code (e.g. L120, A101, E101).
export interface UtbmsSeedCode {
  readonly codeSet: "task" | "activity" | "expense";
  readonly code: string;
  readonly label: string;
  readonly practiceArea: string | null;
}

export const utbmsSeedData: readonly UtbmsSeedCode[] = [
  // Litigation task codes (L-set).
  {
    codeSet: "task",
    code: "L110",
    label: "Fact Investigation/Development",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L120", label: "Analysis/Strategy", practiceArea: "litigation" },
  { codeSet: "task", code: "L130", label: "Experts/Consultants", practiceArea: "litigation" },
  { codeSet: "task", code: "L140", label: "Document/File Management", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L160",
    label: "Settlement/Non-Binding ADR",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L210", label: "Pleadings", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L230",
    label: "Court Mandated Conferences",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L240", label: "Dispositive Motions", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L250",
    label: "Other Written Motions and Submissions",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L310", label: "Written Discovery", practiceArea: "litigation" },
  { codeSet: "task", code: "L330", label: "Depositions", practiceArea: "litigation" },
  { codeSet: "task", code: "L390", label: "Other Discovery", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L440",
    label: "Other Trial Preparation and Support",
    practiceArea: "litigation",
  },
  {
    codeSet: "task",
    code: "L450",
    label: "Trial and Hearing Attendance",
    practiceArea: "litigation",
  },
  // Activity codes (A-set), practice-area-independent.
  { codeSet: "activity", code: "A101", label: "Plan and prepare for", practiceArea: null },
  { codeSet: "activity", code: "A102", label: "Research", practiceArea: null },
  { codeSet: "activity", code: "A103", label: "Draft/revise", practiceArea: null },
  { codeSet: "activity", code: "A104", label: "Review/analyze", practiceArea: null },
  { codeSet: "activity", code: "A105", label: "Communicate (in firm)", practiceArea: null },
  { codeSet: "activity", code: "A106", label: "Communicate (with client)", practiceArea: null },
  {
    codeSet: "activity",
    code: "A107",
    label: "Communicate (other outside counsel)",
    practiceArea: null,
  },
  { codeSet: "activity", code: "A108", label: "Communicate (other external)", practiceArea: null },
  { codeSet: "activity", code: "A109", label: "Appear for/attend", practiceArea: null },
  { codeSet: "activity", code: "A110", label: "Manage data/files", practiceArea: null },
  { codeSet: "activity", code: "A111", label: "Other", practiceArea: null },
  // Expense codes (E-set) — owned here, consumed by the costs slice.
  { codeSet: "expense", code: "E101", label: "Copying", practiceArea: null },
  { codeSet: "expense", code: "E102", label: "Outside printing", practiceArea: null },
  { codeSet: "expense", code: "E106", label: "Online research", practiceArea: null },
  { codeSet: "expense", code: "E107", label: "Delivery services/messengers", practiceArea: null },
  { codeSet: "expense", code: "E108", label: "Postage", practiceArea: null },
  { codeSet: "expense", code: "E110", label: "Out-of-town travel", practiceArea: null },
  { codeSet: "expense", code: "E111", label: "Meals", practiceArea: null },
  { codeSet: "expense", code: "E112", label: "Court fees", practiceArea: null },
  { codeSet: "expense", code: "E115", label: "Deposition transcripts", practiceArea: null },
  { codeSet: "expense", code: "E118", label: "Litigation support vendors", practiceArea: null },
];
