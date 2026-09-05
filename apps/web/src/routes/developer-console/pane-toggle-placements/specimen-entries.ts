import type { StatusKey } from "@magna-carta/design-system/status-register";

/*
 * The rows every pane-toggle specimen shares. Deterministic — no clock, no randomness — so the
 * five specimens differ only in where the toggle sits, and a screenshot pass is never chasing data.
 *
 * Short on purpose: enough rows that the table scrolls inside its own region, few enough that a
 * placement's cost in height is the obvious difference between two specimens.
 */

export interface SpecimenEntry {
  id: string;
  workDate: string;
  timekeeper: string;
  title: string;
  hours: number;
  amount: number;
  /** A key into the product's one status register, never a word of this fixture's own. */
  status: StatusKey;
}

export const SPECIMEN_ENTRIES: readonly SpecimenEntry[] = [
  {
    id: "t01",
    workDate: "2026-08-14",
    timekeeper: "Rosalind Chase",
    title: "Draft motion to compel production",
    hours: 2.5,
    amount: 1125,
    status: "submitted",
  },
  {
    id: "t02",
    workDate: "2026-08-13",
    timekeeper: "Edmund Voss",
    title: "Analyze Hale document production",
    hours: 2.2,
    amount: 660,
    status: "submitted",
  },
  {
    id: "t03",
    workDate: "2026-08-12",
    timekeeper: "Rosalind Chase",
    title: "Hearing preparation: motion to compel",
    hours: 3.1,
    amount: 1395,
    status: "draft",
  },
  {
    id: "t04",
    workDate: "2026-08-12",
    timekeeper: "Marian Holt",
    title: "Update privilege log",
    hours: 1.4,
    amount: 245,
    status: "billed",
  },
  {
    id: "t05",
    workDate: "2026-08-10",
    timekeeper: "Marian Holt",
    title: "Index exhibits for motion hearing",
    hours: 2.7,
    amount: 472.5,
    status: "submitted",
  },
  {
    id: "t06",
    workDate: "2026-08-07",
    timekeeper: "Edmund Voss",
    title: "Research spoliation sanctions standard",
    hours: 2.1,
    amount: 630,
    status: "draft",
  },
  {
    id: "t07",
    workDate: "2026-08-05",
    timekeeper: "Marian Holt",
    title: "Summarize Pemberton deposition transcript",
    hours: 3.4,
    amount: 595,
    status: "billed",
  },
  {
    id: "t08",
    workDate: "2026-08-03",
    timekeeper: "Rosalind Chase",
    title: "Review discovery responses from Hale",
    hours: 1.2,
    amount: 540,
    status: "approved",
  },
  {
    id: "t09",
    workDate: "2026-08-03",
    timekeeper: "Edmund Voss",
    title: "Client call: deposition preparation",
    hours: 0.5,
    amount: 150,
    status: "approved",
  },
  {
    id: "t10",
    workDate: "2026-08-01",
    timekeeper: "Rosalind Chase",
    title: "Case strategy conference",
    hours: 1,
    amount: 450,
    status: "billed",
  },
];
