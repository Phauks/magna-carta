CREATE TABLE `portal_membership` (
	`principal_id` text NOT NULL,
	`firm_id` text NOT NULL,
	`directory_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`principal_id`, `firm_id`),
	FOREIGN KEY (`principal_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "portal_membership_status_check" CHECK("portal_membership"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_membership_firm_entity_unique` ON `portal_membership` (`firm_id`,`directory_entity_id`);--> statement-breakpoint
ALTER TABLE `invitation` ADD `directory_entity_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `principal_kind` text DEFAULT 'account' NOT NULL;--> statement-breakpoint
-- contract: what the generated lines above cannot say, written by hand.
--
-- 1. Every account that already belongs to a firm is a firm member.
UPDATE `user` SET `principal_kind` = 'firmMember' WHERE `firm_id` IS NOT NULL;--> statement-breakpoint
-- 2. An account made by redeeming a client invitation was written with the inviting firm's id, the
--    same as a staff account, which places the client inside the firm on every surface that reads
--    firm_id. It becomes a portal client with no firm. It gets no portal membership here, because
--    those invitations named no Directory person and a membership must; the firm invites them again
--    when the portal is ready. Until then the account reaches nothing, which is the safe direction.
UPDATE `user` SET `principal_kind` = 'portalUser', `firm_id` = NULL
WHERE `id` IN (
	SELECT `redeemed_user_id` FROM `invitation`
	WHERE `kind` = 'clientOfFirm' AND `status` = 'redeemed' AND `redeemed_user_id` IS NOT NULL
);--> statement-breakpoint
-- 3. The kind and firm_id agree. SQLite cannot add a CHECK to a table that already holds rows, so
--    the rule is three triggers: a firm member has a firm, a portal client never has one, and a kind
--    other than `account` never changes. An `account` that gains a firm becomes a firm member in the
--    same statement (the two AFTER triggers), so the paths that attach a firm need not name the kind.
CREATE TRIGGER `user_principal_kind_shape_insert` BEFORE INSERT ON `user`
WHEN (NEW.`principal_kind` = 'portalUser' AND NEW.`firm_id` IS NOT NULL)
	OR (NEW.`principal_kind` = 'firmMember' AND NEW.`firm_id` IS NULL)
	OR NEW.`principal_kind` NOT IN ('account', 'firmMember', 'portalUser')
BEGIN
	SELECT RAISE(ABORT, 'user principal_kind does not match firm_id');
END;--> statement-breakpoint
CREATE TRIGGER `user_principal_kind_shape_update` BEFORE UPDATE OF `principal_kind`, `firm_id` ON `user`
WHEN (NEW.`principal_kind` = 'portalUser' AND NEW.`firm_id` IS NOT NULL)
	OR (NEW.`principal_kind` = 'firmMember' AND NEW.`firm_id` IS NULL)
	OR NEW.`principal_kind` NOT IN ('account', 'firmMember', 'portalUser')
	OR (OLD.`principal_kind` <> 'account' AND NEW.`principal_kind` IS NOT OLD.`principal_kind`)
BEGIN
	SELECT RAISE(ABORT, 'user principal_kind does not match firm_id, or has already been settled');
END;--> statement-breakpoint
CREATE TRIGGER `user_principal_kind_settle_insert` AFTER INSERT ON `user`
WHEN NEW.`principal_kind` = 'account' AND NEW.`firm_id` IS NOT NULL
BEGIN
	UPDATE `user` SET `principal_kind` = 'firmMember' WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `user_principal_kind_settle_update` AFTER UPDATE OF `firm_id` ON `user`
WHEN NEW.`principal_kind` = 'account' AND NEW.`firm_id` IS NOT NULL
BEGIN
	UPDATE `user` SET `principal_kind` = 'firmMember' WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
-- 4. A client invitation must name the Directory person it is for. Invitations issued before this
--    column existed keep their null and are refused at redemption instead.
CREATE TRIGGER `invitation_client_names_person` BEFORE INSERT ON `invitation`
WHEN NEW.`kind` = 'clientOfFirm' AND NEW.`directory_entity_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'a client invitation must name a Directory person');
END;
