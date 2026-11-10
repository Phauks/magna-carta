/*
 * The facts the About window states about this copy of Magna Carta, and the plain-text block its
 * Copy Version Details button puts on the clipboard. Kept apart from the window so the wording of
 * both is one function each, and testable without rendering anything.
 *
 * Every fact is something the application already knows without a request: the build stamp baked
 * in at build time ($lib/build-identity.ts), the session the (app) layout has already read, and the
 * browser's own user agent. A fact that is not known — a session read that did not answer — is left
 * out rather than shown as a placeholder, because a pasted block that says "Firm: unknown" reads as
 * a fault in the firm rather than in the read.
 */
import { formatInstantDate } from "@magna-carta/design-system/formatters";
import { describeDevice } from "$lib/account/active-sessions.ts";
import { describeBuildEnvironment } from "$lib/versions/version-overlay-model.ts";

export interface AboutFact {
  readonly term: string;
  readonly value: string;
}

export interface AboutFactsInput {
  readonly commit: string;
  /** When the commit was made, falling back to when it was built; an ISO 8601 instant. */
  readonly releasedAt: string;
  /** The build mode: "production", "development", or a named preview mode. */
  readonly mode: string;
  readonly memberName: string | null;
  readonly firmName: string | null;
  readonly userAgent: string | null;
}

/** The window's rows, in reading order. The version comes first because it is what gets asked for. */
export function aboutFacts(input: AboutFactsInput): AboutFact[] {
  const facts: AboutFact[] = [
    { term: "Version", value: input.commit },
    { term: "Released", value: formatInstantDate(input.releasedAt) },
  ];
  if (input.memberName !== null) facts.push({ term: "Signed in as", value: input.memberName });
  if (input.firmName !== null) facts.push({ term: "Firm", value: input.firmName });
  // Production carries no badge on the version chip, because there it is the assumption a reader
  // already holds; here the row is asked for by name, so it says so.
  facts.push({
    term: "Environment",
    value: describeBuildEnvironment(input.mode)?.label ?? "Production",
  });
  facts.push({ term: "Browser", value: describeDevice(input.userAgent) });
  return facts;
}

/** The clipboard block: a title line, then one "Term: value" line per fact. */
export function aboutDetailsText(facts: readonly AboutFact[]): string {
  return ["Magna Carta", ...facts.map((fact) => `${fact.term}: ${fact.value}`)].join("\n");
}
