/*
 * The sample vocabulary every loading fixture draws from.
 *
 * A LoadingRegion's fixture is real markup over representative words, and the words matter twice:
 * they set the width of every bone, and they must never be mistaken for a client's data. Inventing
 * them per surface gave forty files forty vocabularies — a Whitmore here, a Pemberton there — and
 * no proof that none of them is real. One list, plainly invented, of plausible length, is the
 * proof: a name in a fixture is one of these or the fixture is wrong.
 *
 * Everything here is fiction. The people, organizations and matters are made up; the dates and
 * amounts are shapes. Pick by index so a fixture is stable between renders (`samplePerson(0)` is
 * always the same person), never at random, so a screenshot of a loading state is reproducible.
 */

export interface SamplePerson {
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly phone: string;
}

export interface SampleOrganization {
  readonly name: string;
  readonly kind: string;
}

export interface SampleMatter {
  readonly title: string;
  readonly number: string;
  readonly client: string;
  readonly responsible: string;
}

export const SAMPLE_PEOPLE: readonly SamplePerson[] = [
  {
    name: "Eleanor Whitcombe",
    initials: "EW",
    email: "eleanor.whitcombe@example.com",
    phone: "(555) 010-4432",
  },
  {
    name: "Marcus Adeyemi",
    initials: "MA",
    email: "marcus.adeyemi@example.com",
    phone: "(555) 010-2781",
  },
  {
    name: "Rosa Delgado",
    initials: "RD",
    email: "rosa.delgado@example.com",
    phone: "(555) 010-9016",
  },
  {
    name: "Judith Pemberton",
    initials: "JP",
    email: "judith.pemberton@example.com",
    phone: "(555) 010-3350",
  },
  { name: "Naomi Ross", initials: "NR", email: "naomi.ross@example.com", phone: "(555) 010-6127" },
];

export const SAMPLE_ORGANIZATIONS: readonly SampleOrganization[] = [
  { name: "Cascade Ridge Homeowners Association", kind: "Association" },
  { name: "Meridian Holdings", kind: "Company" },
  { name: "Okafor Holdings", kind: "Company" },
  { name: "Delacroix Holdings", kind: "Company" },
];

export const SAMPLE_MATTERS: readonly SampleMatter[] = [
  {
    title: "Whitcombe v. Cascade Ridge Homeowners Association",
    number: "2026-00417",
    client: "Eleanor Whitcombe",
    responsible: "M. Adeyemi",
  },
  {
    title: "Estate of Harold Pemberton",
    number: "2026-00398",
    client: "Judith Pemberton",
    responsible: "R. Delgado",
  },
  {
    title: "Okafor lease renewal",
    number: "2025-01142",
    client: "Okafor Holdings",
    responsible: "N. Ross",
  },
  {
    title: "Ross v. Delacroix Holdings",
    number: "2026-00251",
    client: "Naomi Ross",
    responsible: "M. Adeyemi",
  },
];

/** Civil dates of the right length, already in the product's display shape. */
export const SAMPLE_DATES: readonly string[] = [
  "Mar 4, 2026",
  "Jan 22, 2026",
  "Nov 9, 2025",
  "Aug 30, 2026",
  "Jul 12, 2026",
];

/** The same civil dates in the wire shape a record carries, for a fixture that formats its own. */
export const SAMPLE_CIVIL_DATES: readonly string[] = [
  "2026-03-04",
  "2026-01-22",
  "2025-11-09",
  "2026-08-30",
  "2026-07-12",
];

/** Instants in the wire shape, for a fixture whose column renders a time of day. */
export const SAMPLE_INSTANTS: readonly string[] = [
  "2026-03-04T14:05:00.000Z",
  "2026-01-22T09:30:00.000Z",
  "2025-11-09T16:45:00.000Z",
  "2026-08-30T11:15:00.000Z",
  "2026-07-12T08:00:00.000Z",
];

/** Amounts of the right length, already in the product's display shape. */
export const SAMPLE_AMOUNTS: readonly string[] = [
  "$4,250.00",
  "$18,900.00",
  "$325.50",
  "$1,140.00",
];

/** A sentence's worth of words, for a paragraph, a note or a description. */
export const SAMPLE_SENTENCE =
  "Declaratory relief on the amended covenants and the special assessment levied on the lot.";

/** The nth sample, wrapping, so a fixture of any length reads from the same short list. */
function nth<T>(list: readonly T[], index: number): T {
  const item = list[((index % list.length) + list.length) % list.length];
  if (item === undefined) throw new Error("the sample list is empty");
  return item;
}

export function samplePerson(index: number): SamplePerson {
  return nth(SAMPLE_PEOPLE, index);
}
export function sampleOrganization(index: number): SampleOrganization {
  return nth(SAMPLE_ORGANIZATIONS, index);
}
export function sampleMatter(index: number): SampleMatter {
  return nth(SAMPLE_MATTERS, index);
}
export function sampleDate(index: number): string {
  return nth(SAMPLE_DATES, index);
}
export function sampleCivilDate(index: number): string {
  return nth(SAMPLE_CIVIL_DATES, index);
}
export function sampleInstant(index: number): string {
  return nth(SAMPLE_INSTANTS, index);
}
export function sampleAmount(index: number): string {
  return nth(SAMPLE_AMOUNTS, index);
}

/** `count` stable indices, for `{#each sampleIndices(3) as index (index)}`. */
export function sampleIndices(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}
