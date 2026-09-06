/*
 * What the entity window says about a record before any pane is opened — the words in its header
 * and the facts in its context pane — kept as pure functions so they can be asserted without a
 * browser and so the window and the screen that hosts it never assemble them two ways.
 *
 * THE WINDOW IS THE ONE SURFACE A DIRECTORY RECORD OPENS IN. It opens over whatever the reader was
 * doing — the directory's own list, a matter's parties, a conflicts hit — and closing it lands
 * them back exactly there. Every host therefore describes the record the same way, and the only
 * thing a host adds is what it alone knows: a matter knows the roles this person holds on it, the
 * directory knows nothing of the kind. That addition is the `EntityStanding` a host hands over,
 * and it is rendered above the record's own facts rather than mixed into them.
 */
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
 * The line beneath the name: what the record is, then what a reader recognises it by beyond the
 * name — a person's stated pronouns, an organization's legal name where it differs. Joined by the
 * same separator the masthead used, so the window reads as the record did.
 */
export function entityWindowSubtitle(entity: DirectoryEntityDetail): string {
  const parts: string[] = [entityKindLabel(entity.kind)];
  if (entity.kind === "person") {
    if (entity.person.pronouns !== null) parts.push(pronounShortForm(entity.person.pronouns));
  } else {
    const aside = organizationLegalNameAside(entity.organization);
    if (aside !== null) parts.push(aside);
  }
  return parts.join(" · ");
}

/**
 * The record's own standing facts for the context pane: what a reader wants to know before
 * opening any section. Only facts the record actually holds are listed — a blank is not drawn as
 * a label with nothing against it.
 */
export function entityWindowFacts(entity: DirectoryEntityDetail): readonly StandingLine[] {
  const lines: StandingLine[] = [{ label: "Kind", value: entityKindLabel(entity.kind) }];
  if (entity.kind === "person") {
    const person = entity.person;
    if (person.pronouns !== null) {
      lines.push({ label: "Pronouns", value: pronounShortForm(person.pronouns) });
    }
    if (person.dateOfBirth !== null) lines.push({ label: "Born", value: person.dateOfBirth });
    if (person.dateOfDeath !== null) lines.push({ label: "Died", value: person.dateOfDeath });
    else if (person.deceased) lines.push({ label: "Died", value: "Date not recorded" });
  } else {
    const aside = organizationLegalNameAside(entity.organization);
    if (aside !== null) lines.push({ label: "Legal name", value: aside });
  }
  return lines;
}

/** The name the window's heading shows, in the one wording every surface uses for the record. */
export function entityWindowHeading(entity: DirectoryEntityDetail | null): string {
  return entity === null ? UNREAD_RECORD_HEADING : directoryEntityName(entity);
}
