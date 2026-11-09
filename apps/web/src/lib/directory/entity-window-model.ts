/*
 * What the entity window says about a record before any section is read — the words in its
 * header — kept as pure functions so they can be asserted without a browser and so the window and
 * the screen that hosts it never assemble them two ways.
 *
 * THE WINDOW IS THE ONE SURFACE A DIRECTORY RECORD OPENS IN. It opens over whatever the reader was
 * doing — the directory's own list, a matter's parties, a conflicts hit — and closing it lands
 * them back exactly there. Every host therefore describes the record the same way, and the only
 * thing a host adds is what it alone knows: a matter knows the roles this person holds on it, the
 * directory knows nothing of the kind. That addition is the `EntityStanding` a host hands over,
 * and it is the only thing the window's right-hand pane holds: with nothing to hand over, there
 * is no pane.
 */
import { formatDate } from "@magna-carta/design-system/formatters";
import type { RecordSubject } from "@magna-carta/design-system/record-reference";
import type { DirectoryEntityDetail } from "./directory-api.ts";
import {
  directoryEntityName,
  entityKindLabel,
  organizationLegalNameAside,
  pronounShortForm,
} from "./entity-presentation.ts";

/** One line of a definition list: a label and what stands against it. */
export interface StandingLine {
  readonly label: string;
  readonly value: string;
}

/**
 * What the host knows about the record that the directory does not — a matter's own view of a
 * party: which roles, in what capacity. The heading names the host ("On Pemberton v. Hale").
 */
export interface EntityStanding {
  readonly heading: string;
  readonly lines: readonly StandingLine[];
}

/** The window's heading while the record is still being read, or could not be. */
export const UNREAD_RECORD_HEADING = "Directory Record";

/**
 * The line beneath the name: what the record is, then the facts a reader recognises it by and wants
 * before reading anything else — a person's stated pronouns and life dates, an organization's legal
 * name where it differs.
 *
 * THE HEADER CARRIES THE RECORD'S OWN FACTS. They used to stand in a pane on the right, which put a
 * column beside every record to hold two or three short lines; in the header they are read with the
 * name, and the right-hand pane is left for what only a host knows (a matter's roles for a party).
 *
 * A directory record carries no number anybody quotes — it is found by name, which the heading has
 * already given — so the reference names only which side of the directory it is on. The separator
 * is not joined here: the design system owns it, which is what stops this line and the panels that
 * act on the record drifting apart. Only facts the record actually holds are listed.
 */
export function entityWindowSubtitle(entity: DirectoryEntityDetail): RecordSubject {
  const facts: string[] = [];
  if (entity.kind === "person") {
    const person = entity.person;
    if (person.pronouns !== null) facts.push(pronounShortForm(person.pronouns));
    if (person.dateOfBirth !== null) facts.push(`Born ${formatDate(person.dateOfBirth)}`);
    if (person.dateOfDeath !== null) facts.push(`Died ${formatDate(person.dateOfDeath)}`);
    else if (person.deceased) facts.push("Deceased");
  } else {
    const aside = organizationLegalNameAside(entity.organization);
    if (aside !== null) facts.push(aside);
  }
  return { reference: { kind: entityKindLabel(entity.kind), number: null }, facts };
}

/** The name the window's heading shows, in the one wording every surface uses for the record. */
export function entityWindowHeading(entity: DirectoryEntityDetail | null): string {
  return entity === null ? UNREAD_RECORD_HEADING : directoryEntityName(entity);
}
