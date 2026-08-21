/*
 * The adapters between the merge-field catalog contract and the design system's structural shapes.
 *
 * This file is the whole cost of the boundary the design system keeps: its components take their
 * own option and row types rather than importing domain packages, so the mapping happens once, here,
 * where the app already knows both sides. When the live catalog provider replaces the mock, nothing
 * in this file changes — it maps contract types, not a transport.
 */
import {
  mergeFieldGroupLabel,
  MERGE_FIELD_VALUE_TYPE_LABELS,
  type DetectedFieldConversion,
  type MergeFieldCatalog,
  type MergeFieldEntry,
} from "@magna-carta/merge-field-catalog-contract/types";
import {
  findCatalogEntry,
  groupCatalogEntries,
} from "@magna-carta/merge-field-catalog-contract/catalog-grouping";
import type { MergeFieldPickerOption } from "@magna-carta/design-system/merge-field-picker";
import type { MergeFieldChipStatus } from "@magna-carta/design-system/merge-field-chip";
import type { MergeFieldReviewItem } from "@magna-carta/design-system/merge-field-review-list";
import type { AssemblyFieldDisposition } from "./assembly-input-model.ts";

/** How a field's availability reads as a chip status. */
export function chipStatusForAvailability(
  disposition: AssemblyFieldDisposition,
): MergeFieldChipStatus {
  switch (disposition) {
    case "automatic":
      return "automatic";
    case "manual":
    case "conditional":
      return "manual";
    case "unrecognized":
      return "invalid";
    default:
      return "unavailable";
  }
}

function pickerOption(entry: MergeFieldEntry): MergeFieldPickerOption {
  return {
    key: entry.key,
    label: entry.label,
    group: entry.group,
    groupLabel: mergeFieldGroupLabel(entry.group),
    valueTypeLabel: MERGE_FIELD_VALUE_TYPE_LABELS[entry.valueType],
    description: entry.description,
    status: chipStatusForAvailability(entry.availability),
  };
}

/**
 * The catalog as picker options, grouped in the canonical source order. Grouping happens HERE, not
 * in the picker, because the order the sources should be offered in is a product decision — the
 * picker deliberately preserves whatever order it is handed.
 */
export function catalogPickerOptions(
  catalog: MergeFieldCatalog,
): readonly MergeFieldPickerOption[] {
  return groupCatalogEntries(catalog.entries).flatMap((section) =>
    section.entries.map((entry) => pickerOption(entry)),
  );
}

/**
 * A detected placeholder as a review row. `confirmed` is supplied by the caller, which holds the
 * confirmation state — this function never decides that a proposal has been accepted.
 */
export function reviewItem(
  conversion: DetectedFieldConversion,
  catalog: MergeFieldCatalog,
  confirmed: boolean,
): MergeFieldReviewItem {
  const proposed =
    conversion.proposedKey === null ? null : findCatalogEntry(catalog, conversion.proposedKey);
  return {
    id: conversion.id,
    sourceText: conversion.sourceText,
    sourceLocation: conversion.sourceLocation,
    proposedLabel: proposed?.label ?? null,
    ...(proposed
      ? { proposedValueTypeLabel: MERGE_FIELD_VALUE_TYPE_LABELS[proposed.valueType] }
      : {}),
    confidence: conversion.confidence,
    note: conversion.note,
    confirmed,
  };
}

/** Every detected placeholder as review rows, given the set of ids a person has confirmed. */
export function reviewItems(
  conversions: readonly DetectedFieldConversion[],
  catalog: MergeFieldCatalog,
  confirmedIds: ReadonlySet<string>,
): readonly MergeFieldReviewItem[] {
  return conversions.map((conversion) =>
    reviewItem(conversion, catalog, confirmedIds.has(conversion.id)),
  );
}
