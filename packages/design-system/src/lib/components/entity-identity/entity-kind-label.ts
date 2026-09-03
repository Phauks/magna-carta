/*
 * What each side of the directory is called, as a reader sees it. One table, so a screen reader hears
 * the same word beside a mark that a column header prints.
 */
import type { EntityKind } from "./types.ts";

const KIND_LABEL: Readonly<Record<EntityKind, string>> = {
  person: "Person",
  organization: "Organization",
};

export function entityKindLabel(kind: EntityKind): string {
  return KIND_LABEL[kind];
}
