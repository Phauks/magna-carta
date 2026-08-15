-- The reporting surface's capabilities.
--
-- The five `reports:` keys are seeded to Owner/Admin and to nothing else. That is deliberately
-- narrower than the trust and billing reads a firm already grants more widely: an aggregate spanning
-- every matter and client is a different exposure from a per-matter read, and a member who may read
-- one client's trust balance is not thereby a member who may read every client's ledger in one
-- document. A firm that wants its bookkeeper to run reconciliation packs reaches for a direct grant,
-- which leaves a record; widening a seed later is a conversation nobody has to have, while narrowing
-- one is a conversation with every firm that had got used to the wider default.
--
-- `reports:productivity` is seeded on the same row as the rest and is still its own key, because a
-- report about PEOPLE is a different grant from a report about money: a firm must be able to hand a
-- bookkeeper the financial reports without also handing them a supervision surface over every lawyer.
--
-- `reports:produce` gates turning a report into a filed firm record. The tables that record a
-- production land with the code that writes them rather than ahead of it: an append-only table
-- nothing inserts into is schema a later slice has to work around rather than a seam it can use.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsTrustComplianc', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:trustCompliance');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsFinancialOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:financial');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsProductivityOw', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:productivity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsOperationalOwn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:operational');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsProduceOwnerAd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:produce');
