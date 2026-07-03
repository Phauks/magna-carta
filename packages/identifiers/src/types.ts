import type { EntityType } from "./registry.ts";

// Branded handle strings. The brand is keyed by the entity literal over one symbol, so Identifier<"matter">
// and Identifier<"document"> are mutually non-assignable. Brands are compile-time only — erased at runtime,
// so they cost nothing on the wire. A branded id IS assignable to string (it flows into DB values and URLs);
// a raw string is NOT assignable to a branded id without going through validate.ts.
declare const identifierBrand: unique symbol;

export type Identifier<T extends EntityType> = string & { readonly [identifierBrand]: T };

// The brand for a given entity type — the return type of newIdentifier(type) and the narrowed type of a
// validated handle. Trivial here because the brand already keys off the entity literal.
export type BrandFor<T extends EntityType> = Identifier<T>;

// Any identifier, regardless of entity type — for code that handles handles polymorphically.
export type AnyIdentifier = Identifier<EntityType>;

// Named aliases — one per registry entry (golden rule 12: spelled out). Keep in sync with ENTITY_PREFIXES.
export type MatterId = Identifier<"matter">;
export type DocumentId = Identifier<"document">;
export type DirectoryId = Identifier<"directory">;
export type InvoiceId = Identifier<"invoice">;
export type EventId = Identifier<"event">;
export type PortalGrantId = Identifier<"portalGrant">;
export type LedgerEntryId = Identifier<"ledgerEntry">;
export type LedgerAccountId = Identifier<"ledgerAccount">;
export type LedgerLineId = Identifier<"ledgerLine">;
export type OutboxId = Identifier<"outbox">;
export type IdempotencyRecordId = Identifier<"idempotencyRecord">;
export type UserId = Identifier<"user">;
export type FirmId = Identifier<"firm">;
export type SessionId = Identifier<"session">;
export type AccountId = Identifier<"account">;
export type VerificationId = Identifier<"verification">;
export type TwoFactorId = Identifier<"twoFactor">;
export type RoleId = Identifier<"role">;
export type RolePermissionId = Identifier<"rolePermission">;
export type MemberRoleId = Identifier<"memberRole">;
export type GrantId = Identifier<"grant">;
export type AuthAuditId = Identifier<"authAudit">;
export type ErrorId = Identifier<"error">;
export type CorrelationId = Identifier<"correlation">;
export type IncidentId = Identifier<"incident">;
export type IntegrationConnectionId = Identifier<"integrationConnection">;
export type LocationId = Identifier<"location">;
export type LocationAddressId = Identifier<"locationAddress">;
export type MemberLocationId = Identifier<"memberLocation">;
export type MatterTypeId = Identifier<"matterType">;
export type DocumentTypeId = Identifier<"documentType">;
export type NumberingSchemeId = Identifier<"numberingScheme">;
export type FolderId = Identifier<"folder">;
export type FileId = Identifier<"file">;
export type FileVersionId = Identifier<"fileVersion">;
export type UploadSessionId = Identifier<"uploadSession">;
export type AuditLogId = Identifier<"auditLog">;
export type FirmSecretId = Identifier<"firmSecret">;
export type DirectoryPersonId = Identifier<"directoryPerson">;
export type DirectoryOrganizationId = Identifier<"directoryOrganization">;
export type DirectoryNameId = Identifier<"directoryName">;
export type DirectoryIdentifierId = Identifier<"directoryIdentifier">;
export type DirectoryEdgeId = Identifier<"directoryEdge">;
export type DirectoryCategoryId = Identifier<"directoryCategory">;
export type DirectoryEmailId = Identifier<"directoryEmail">;
export type DirectoryPhoneId = Identifier<"directoryPhone">;
export type DirectoryAddressId = Identifier<"directoryAddress">;
export type DirectoryPartyRoleId = Identifier<"directoryPartyRole">;
export type MatterPartyId = Identifier<"matterParty">;
export type EntityMergeId = Identifier<"entityMerge">;
export type ShipmentId = Identifier<"shipment">;
export type ShipmentLabelId = Identifier<"shipmentLabel">;
export type TrackingEventId = Identifier<"trackingEvent">;
export type CustomFieldId = Identifier<"customField">;
export type PicklistOptionId = Identifier<"picklistOption">;
export type CustomFieldValueId = Identifier<"customFieldValue">;
export type DocumentCheckoutId = Identifier<"documentCheckout">;
export type TimeEntryId = Identifier<"timeEntry">;
export type RateCardId = Identifier<"rateCard">;
export type RateId = Identifier<"rate">;
export type UtbmsCodeId = Identifier<"utbmsCode">;
export type NonBillableCategoryId = Identifier<"nonBillableCategory">;
export type NarrativeTemplateId = Identifier<"narrativeTemplate">;
export type ConversionJobId = Identifier<"conversionJob">;
export type CostEntryId = Identifier<"costEntry">;
export type PlatformStaffId = Identifier<"platformStaff">;
export type SupportGrantId = Identifier<"supportGrant">;
export type AiDetectionUsageId = Identifier<"aiDetectionUsage">;
export type RepairProvenanceId = Identifier<"repairProvenance">;
