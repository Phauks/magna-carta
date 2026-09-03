/*
 * What the parties tab is handed: the people already linked to a record, and the vocabulary of roles
 * one may be linked in.
 *
 * TWO IDENTITIES PER ROW, AND THE SPLIT IS THE POINT. A party is an ASSOCIATION — a record and a
 * directory entity, joined, in a role — so it carries its own identity separately from the entity's.
 * That is what lets ending the association leave the person exactly where they are in the directory,
 * and it is what lets the same person be linked to one record twice in two roles, which is the
 * ordinary case on a matter: an administrator who is also a beneficiary is two rows that end on their
 * own.
 *
 * The tab is DOMAIN-BLIND. It is the same tab on a matter, a custodian packet or a calendar event, so
 * nothing here names one: a record hands over its parties, its role vocabulary and its verbs, and this
 * presents them.
 */
import type { Instant } from "../../formatters/instant.ts";
import type { EntityKind } from "../entity-identity/types.ts";
import type { PickableEntity } from "../entity-picker/types.ts";

/** One person or organization linked to a record. */
export interface RecordParty {
  /**
   * Stable identity for the ASSOCIATION — the render key, and what an act on this row names. Not the
   * entity's identity: the same entity may be linked to a record in more than one role, and each of
   * those is its own association that ends on its own.
   */
  identifier: string;
  /**
   * Which directory entity this points at. It is what lets the tab say "already on this record as
   * Client" when the same person is offered again, and what a caller opens.
   */
  entityIdentifier: string;
  /** The entity's name, as the directory names it. */
  name: string;
  /** Which side of the directory, or null where the directory no longer resolves the record. */
  kind: EntityKind | null;
  /** Where the entity's record lives. Given, the name is a link to it; a link is what it acts like. */
  href?: string;
  /** The role, as stored. Compared, never printed: `roleLabel` is what a reader sees. */
  role?: string;
  /** The role as a reader sees it. Left out where the association carries no role. */
  roleLabel?: string;
  /**
   * The capacity the entity acts in on this record — "Administrator", "Trustee". A fact about the
   * link the caller recorded; nothing here infers one from the role.
   */
  capacity?: string;
  /** When the link was made. Rendered as an absolute instant in the reader's own local time. */
  linkedAt?: Instant;
  /** Who made it: the person's name, never "You" and never an account identifier. */
  linkedBy?: string;
}

/** One role the caller offers when a party is added. `value` is what is stored; `label` is read. */
export interface PartyRole {
  value: string;
  label: string;
}

/** What the tab hands back when a party is added: who, in what role, in what capacity. */
export interface PartyLink {
  entity: PickableEntity;
  /** The chosen role's stored value, or null where the caller offered no roles. */
  role: string | null;
  /** Free text the reader entered, or null where they entered none. Never inferred. */
  capacity: string | null;
}
