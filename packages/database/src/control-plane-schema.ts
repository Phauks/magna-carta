import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { FirmId } from "@magna-carta/identifiers/types";

// CONTROL-PLANE LINEAGE. The firm registry: one row per tenant firm, in the single control-plane D1.
// This file is the source of truth drizzle-kit generates control-plane migrations from — schema changes
// happen HERE, never by hand-editing SQL (ADR-0065).
export const firm = sqliteTable("firm", {
  // The firm_ handle is both primary key and public id (ADR-0062).
  id: text("id").primaryKey().$type<FirmId>(),
  name: text("name").notNull(),
  // The Cloudflare D1 database backing this firm (the database UUID from the Cloudflare API).
  databaseIdentifier: text("database_identifier").notNull().unique(),
  // Mirror of the firm database's latest applied migration tag (fleet-wide visibility, ADR-0065).
  // Null = the firm database has not been provisioned yet. Tags order lexicographically (NNNN_ prefix).
  perFirmSchemaVersion: text("per_firm_schema_version"),
  // ISO-8601 UTC instant (ADR-0055).
  createdAt: text("created_at").notNull(),
});
