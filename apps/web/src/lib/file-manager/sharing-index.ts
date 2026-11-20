import type { ShareRole, ShareSummary } from "./sharing-api.ts";

/*
 * WHO OUTSIDE THE FIRM SEES WHAT, derived once from the matter's share list.
 *
 * The shared mark on a row, the Shared With column, the Sharing tab in the right-hand pane and the
 * Sharing view all read this one index, so they can never disagree. The rule it encodes is the
 * server's (packages/sharing): a file is seen by the people it is shared with directly, plus the
 * people its folder is shared with (or, for a file in no folder, the people the matter's top level is
 * shared with). A folder is never seen through its parent: a folder inside a shared folder stays
 * private until it is shared itself.
 */

export const ROLE_LABELS: Readonly<Record<ShareRole, string>> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
};

export const ROLE_DESCRIPTIONS: Readonly<Record<ShareRole, string>> = {
  viewer: "Can open and read",
  commenter: "Can read and add comments",
  editor: "Can change files and add new ones",
};

const ROLE_ORDER: readonly ShareRole[] = ["viewer", "commenter", "editor"];

/*
 * The roles a member can pick. Commenter waits for comments on files: a role whose one ability
 * does nothing would promise the recipient something they cannot find. A share that already holds
 * it still shows it, so the menu never hides what is true.
 */
const OFFERED_ROLES: readonly ShareRole[] = ["viewer", "editor"];

/** The role menu's items for a share currently holding `current` (or none). */
export function roleItems(current: ShareRole | null): { value: ShareRole; label: string }[] {
  return ROLE_ORDER.filter((role) => OFFERED_ROLES.includes(role) || role === current).map(
    (role) => ({ value: role, label: ROLE_LABELS[role] }),
  );
}

/** One person who can see an item, and how. */
export interface SharedPerson {
  readonly entityId: string;
  readonly name: string;
  readonly initials: string;
  /** The strongest role among the shares that reach the item. */
  readonly role: ShareRole;
  /** The share on this exact item, when there is one: the one the Sharing tab can change. */
  readonly direct: ShareSummary | null;
  /** Shares that reach the item through its folder or the matter's top level. */
  readonly inherited: readonly ShareSummary[];
}

/** What the index needs to know about a row. */
export type SharingTarget =
  | { readonly kind: "file"; readonly fileId: string; readonly folderId: string | null }
  | { readonly kind: "folder"; readonly folderId: string }
  | { readonly kind: "matter" };

export function personName(share: Pick<ShareSummary, "recipientName">): string {
  const name = share.recipientName?.trim() ?? "";
  return name === "" ? "Unnamed person" : name;
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !/^(dr|mr|mrs|ms|mx|esq|jr|sr)$/iu.test(word));
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export interface SharingIndex {
  readonly shares: readonly ShareSummary[];
  /** Everyone who can see the target, strongest role first, then by name. */
  peopleWhoSee(target: SharingTarget): SharedPerson[];
  /** The shares on this exact target. */
  directOn(target: SharingTarget): ShareSummary[];
  /** Whether anyone outside the firm can see the target. */
  isShared(target: SharingTarget): boolean;
  /** Every person with any share on the matter, by name, with how many items each holds. */
  people(): { entityId: string; name: string; initials: string; itemCount: number }[];
  /** One person's shares on the matter. */
  sharesOf(entityId: string): ShareSummary[];
  /** How one person reaches the target: their share on it, and the share it comes through. */
  accessFor(entityId: string, target: SharingTarget): PersonAccess;
}

/** One person's access to one item. Both null means they cannot see it. */
export interface PersonAccess {
  readonly direct: ShareSummary | null;
  /** The folder's (or the matter's top level's) share that reaches the item, when one does. */
  readonly through: ShareSummary | null;
}

function targetIdOf(share: ShareSummary): string {
  return share.fileId ?? share.folderId ?? share.matterId;
}

export function createSharingIndex(shares: readonly ShareSummary[]): SharingIndex {
  const byTarget = new Map<string, ShareSummary[]>();
  const matterShares: ShareSummary[] = [];
  for (const share of shares) {
    if (share.scope === "matter") {
      matterShares.push(share);
      continue;
    }
    const key = `${share.scope}:${targetIdOf(share)}`;
    const list = byTarget.get(key) ?? [];
    list.push(share);
    byTarget.set(key, list);
  }

  const directOn = (target: SharingTarget): ShareSummary[] => {
    if (target.kind === "matter") return [...matterShares];
    if (target.kind === "folder") return [...(byTarget.get(`folder:${target.folderId}`) ?? [])];
    return [...(byTarget.get(`file:${target.fileId}`) ?? [])];
  };

  const inheritedFor = (target: SharingTarget): ShareSummary[] => {
    if (target.kind !== "file") return [];
    return target.folderId === null
      ? [...matterShares]
      : [...(byTarget.get(`folder:${target.folderId}`) ?? [])];
  };

  const peopleWhoSee = (target: SharingTarget): SharedPerson[] => {
    const people = new Map<string, { direct: ShareSummary | null; inherited: ShareSummary[] }>();
    for (const share of directOn(target)) {
      people.set(share.recipientEntityId, { direct: share, inherited: [] });
    }
    for (const share of inheritedFor(target)) {
      const entry = people.get(share.recipientEntityId) ?? { direct: null, inherited: [] };
      entry.inherited.push(share);
      people.set(share.recipientEntityId, entry);
    }
    return [...people.entries()]
      .map(([entityId, entry]) => {
        const all = [...(entry.direct === null ? [] : [entry.direct]), ...entry.inherited];
        // A share that no longer opens is listed (so it can be fixed) but gives no access.
        const live = all.filter((share) => share.dormant === null);
        const strongest = (live.length > 0 ? live : all).reduce((best, share) =>
          ROLE_ORDER.indexOf(share.role) > ROLE_ORDER.indexOf(best.role) ? share : best,
        );
        const name = personName(strongest);
        return {
          entityId,
          name,
          initials: initialsOf(name),
          role: strongest.role,
          direct: entry.direct,
          inherited: entry.inherited,
        };
      })
      .sort(
        (left, right) =>
          ROLE_ORDER.indexOf(right.role) - ROLE_ORDER.indexOf(left.role) ||
          left.name.localeCompare(right.name),
      );
  };

  return {
    shares,
    peopleWhoSee,
    directOn,
    isShared: (target) => peopleWhoSee(target).length > 0,
    people: () => {
      const counts = new Map<string, { name: string; itemCount: number }>();
      for (const share of shares) {
        const entry = counts.get(share.recipientEntityId) ?? {
          name: personName(share),
          itemCount: 0,
        };
        entry.itemCount += 1;
        counts.set(share.recipientEntityId, entry);
      }
      return [...counts.entries()]
        .map(([entityId, entry]) => ({ entityId, ...entry, initials: initialsOf(entry.name) }))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    sharesOf: (entityId) => shares.filter((share) => share.recipientEntityId === entityId),
    accessFor: (entityId, target) => ({
      direct: directOn(target).find((share) => share.recipientEntityId === entityId) ?? null,
      through: inheritedFor(target).find((share) => share.recipientEntityId === entityId) ?? null,
    }),
  };
}

/** The Shared With cell's words for a row: the names, so sort, filter and fit all read it. */
export function sharedWithText(people: readonly SharedPerson[]): string {
  return people.map((person) => person.name).join(", ");
}
