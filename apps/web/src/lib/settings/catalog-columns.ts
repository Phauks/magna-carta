/*
 * The column models behind the five settings tables — the event-type catalog, the rooms and
 * resources catalog, the member roster, and the two notification matrices — declared for the
 * platform's one table (DataTable.Grid) so a register in Settings is not a lesser table than a
 * register anywhere else: it sorts, filters from its headers, offers its column roster, resizes,
 * and counts itself in the footer, because the grid supplies all of that from what is declared
 * here. Pure, so each model is unit-tested and there is one place to change what a column IS.
 *
 * TWO DECISIONS EVERY MODEL SHARES:
 *
 *   - The NAME anchors the row. A catalog is read by what a thing is called; the name always leads
 *     and is never hidden.
 *   - A column over a vocabulary the firm or the platform DECLARES hands the grid that vocabulary
 *     (`filterValues`), so a set filter offers every value whether or not a row on screen carries
 *     it. A catalog with nothing retired today can still retire something, and a filter that
 *     dropped "Retired" would tell the reader it cannot.
 *
 * THE ACTIONS COLUMN IS PART OF THE MODEL, present only for a member who may act. It is declared
 * pinned to the trailing edge, so the verbs stay in reach while the columns scroll, and it carries
 * no value: nothing sorts or filters on a button.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import {
  EVENT_TYPE_CATEGORIES,
  eventTypeCategoryLabel,
  FIRM_RESOURCE_KINDS,
  resourceKindLabel,
  type EventType,
  type FirmResource,
} from "$lib/calendar/calendar-api.ts";
import type { FirmMemberSummary } from "$lib/members/members-api.ts";
import {
  EMAIL_CADENCE_OPTIONS,
  notificationCategoryLabel,
} from "$lib/notifications/category-vocabulary.ts";
import type { FirmCategoryPolicy } from "$lib/notifications/firm-policy-api.ts";
import type { ResolvedCategoryPreference } from "$lib/notifications/preferences-api.ts";

/** The one id every actions column carries, so a cell snippet can recognise it. */
export const CATALOG_ACTIONS_COLUMN_ID = "actions";

export function actionsColumn<TRow>(): GridColumn<TRow> {
  return {
    id: CATALOG_ACTIONS_COLUMN_ID,
    label: "Actions",
    type: "text",
    filter: "none",
    align: "end",
    pinnedEnd: true,
    value: () => null,
    text: () => "",
  };
}

// ---- event types --------------------------------------------------------------------------------

export const EVENT_TYPE_ORIGIN_LABELS = { platform: "Platform", firm: "This firm" } as const;
export const EVENT_TYPE_STANDING_LABELS = { active: "Offered", retired: "Retired" } as const;

export function eventTypeOriginLabel(type: Pick<EventType, "origin">): string {
  return EVENT_TYPE_ORIGIN_LABELS[type.origin];
}

export function eventTypeStandingLabel(type: Pick<EventType, "active">): string {
  return type.active ? EVENT_TYPE_STANDING_LABELS.active : EVENT_TYPE_STANDING_LABELS.retired;
}

export function eventTypeColumns(canEdit: boolean): GridColumn<EventType>[] {
  return [
    { id: "name", label: "Name", anchored: true, value: (type) => type.name },
    { id: "code", label: "Code", value: (type) => type.code },
    {
      id: "category",
      label: "Category",
      filter: "set",
      value: (type) => eventTypeCategoryLabel(type.category),
      filterValues: EVENT_TYPE_CATEGORIES.map(eventTypeCategoryLabel),
    },
    {
      id: "origin",
      label: "Origin",
      filter: "set",
      value: eventTypeOriginLabel,
      filterValues: [EVENT_TYPE_ORIGIN_LABELS.platform, EVENT_TYPE_ORIGIN_LABELS.firm],
    },
    {
      id: "standing",
      label: "Standing",
      filter: "set",
      value: eventTypeStandingLabel,
      filterValues: [EVENT_TYPE_STANDING_LABELS.active, EVENT_TYPE_STANDING_LABELS.retired],
    },
    ...(canEdit ? [actionsColumn<EventType>()] : []),
  ];
}

// ---- rooms and resources ------------------------------------------------------------------------

export const RESOURCE_STANDING_LABELS = { active: "Bookable", retired: "Retired" } as const;

export function resourceStandingLabel(resource: Pick<FirmResource, "active">): string {
  return resource.active ? RESOURCE_STANDING_LABELS.active : RESOURCE_STANDING_LABELS.retired;
}

/** The office a resource belongs to, by name; "" where it belongs to none or the office is unknown. */
export function resourceOfficeName(
  resource: Pick<FirmResource, "locationId">,
  locationNames: ReadonlyMap<string, string>,
): string {
  if (resource.locationId === null) return "";
  return locationNames.get(resource.locationId) ?? "";
}

export function resourceColumns(
  canEdit: boolean,
  locationNames: ReadonlyMap<string, string>,
): GridColumn<FirmResource>[] {
  return [
    { id: "name", label: "Name", anchored: true, value: (resource) => resource.name },
    {
      id: "kind",
      label: "Kind",
      filter: "set",
      value: (resource) => resourceKindLabel(resource.kind),
      filterValues: FIRM_RESOURCE_KINDS.map(resourceKindLabel),
    },
    {
      id: "office",
      label: "Office",
      filter: "set",
      value: (resource) => resourceOfficeName(resource, locationNames),
      // The firm's whole office list, so an office with nothing bookable in it can still be asked
      // for; an office named by no row carries a count of zero.
      filterValues: [...new Set(locationNames.values())].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    },
    { id: "seats", label: "Seats", type: "number", value: (resource) => resource.capacity },
    {
      id: "standing",
      label: "Standing",
      filter: "set",
      value: resourceStandingLabel,
      filterValues: [RESOURCE_STANDING_LABELS.active, RESOURCE_STANDING_LABELS.retired],
    },
    ...(canEdit ? [actionsColumn<FirmResource>()] : []),
  ];
}

// ---- the member roster --------------------------------------------------------------------------

/** A member's standing as the status register words it — never a tone chosen here. */
export function memberStandingKey(
  member: Pick<FirmMemberSummary, "status">,
): "member-has-access" | "member-no-access" {
  return member.status === "active" ? "member-has-access" : "member-no-access";
}

/** The word under which a member with no role at all is listed and filtered. */
export const NO_ROLE_LABEL = "No role";

export function memberRolesText(member: Pick<FirmMemberSummary, "roleNames">): string {
  return member.roleNames.length === 0 ? NO_ROLE_LABEL : member.roleNames.join(", ");
}

export function memberColumns(canEdit: boolean): GridColumn<FirmMemberSummary>[] {
  return [
    { id: "name", label: "Name", anchored: true, value: (member) => member.displayName },
    { id: "roles", label: "Roles", value: memberRolesText },
    {
      id: "standing",
      label: "Standing",
      filter: "set",
      value: (member) => statusEntry(memberStandingKey(member)).label,
      filterValues: [statusEntry("member-has-access").label, statusEntry("member-no-access").label],
    },
    ...(canEdit ? [actionsColumn<FirmMemberSummary>()] : []),
  ];
}

// ---- the two notification matrices --------------------------------------------------------------

/** What the member's in-app column reads, in the words the switch and its lock use. */
export const IN_APP_PREFERENCE_LABELS = { on: "On", off: "Off", locked: "Always on" } as const;

export function inAppPreferenceLabel(
  row: Pick<ResolvedCategoryPreference, "inApp" | "inAppLockedBy">,
): string {
  if (row.inAppLockedBy !== null) return IN_APP_PREFERENCE_LABELS.locked;
  return row.inApp === "on" ? IN_APP_PREFERENCE_LABELS.on : IN_APP_PREFERENCE_LABELS.off;
}

export function emailCadenceLabel(cadence: string | null): string {
  return EMAIL_CADENCE_OPTIONS.find((option) => option.value === cadence)?.label ?? "";
}

export function notificationPreferenceColumns(): GridColumn<ResolvedCategoryPreference>[] {
  return [
    {
      id: "category",
      label: "Category",
      anchored: true,
      value: (row) => notificationCategoryLabel(row.category),
    },
    {
      id: "inApp",
      label: "In app",
      filter: "set",
      value: inAppPreferenceLabel,
      filterValues: [
        IN_APP_PREFERENCE_LABELS.on,
        IN_APP_PREFERENCE_LABELS.off,
        IN_APP_PREFERENCE_LABELS.locked,
      ],
    },
    {
      id: "email",
      label: "Email",
      filter: "set",
      value: (row) => emailCadenceLabel(row.email),
      filterValues: EMAIL_CADENCE_OPTIONS.map((option) => option.label),
    },
  ];
}

/**
 * The firm's in-app lever, said as what it DOES. "Off" is worded as the default it is rather than
 * as a prohibition, because a member may still raise it. The empty choice — the firm leaving it to
 * its members — is a real value, so it carries a value of its own rather than an empty string.
 */
export const POLICY_MEMBERS_CHOOSE = "members-choose";
export const IN_APP_POLICY_OPTIONS = [
  { value: POLICY_MEMBERS_CHOOSE, label: "Members choose" },
  { value: "on", label: "Everyone hears this" },
  { value: "off", label: "Off unless a member turns it on" },
] as const;

/** Every one of these is a default a member's own choice overrides — never a ceiling. */
export const EMAIL_POLICY_OPTIONS = [
  { value: POLICY_MEMBERS_CHOOSE, label: "Members choose" },
  { value: "off", label: "No email by default" },
  { value: "daily", label: "Daily summary by default" },
  { value: "weekly", label: "Weekly summary by default" },
] as const;

export function inAppPolicyLabel(row: Pick<FirmCategoryPolicy, "inApp">): string {
  const value = row.inApp ?? POLICY_MEMBERS_CHOOSE;
  return IN_APP_POLICY_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

export function emailPolicyLabel(row: Pick<FirmCategoryPolicy, "email">): string {
  const value = row.email ?? POLICY_MEMBERS_CHOOSE;
  return EMAIL_POLICY_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

export function notificationPolicyColumns(): GridColumn<FirmCategoryPolicy>[] {
  return [
    {
      id: "category",
      label: "Category",
      anchored: true,
      value: (row) => notificationCategoryLabel(row.category),
    },
    {
      id: "inApp",
      label: "In app",
      filter: "set",
      value: inAppPolicyLabel,
      filterValues: IN_APP_POLICY_OPTIONS.map((option) => option.label),
    },
    {
      id: "email",
      label: "Email",
      filter: "set",
      value: emailPolicyLabel,
      filterValues: EMAIL_POLICY_OPTIONS.map((option) => option.label),
    },
  ];
}
