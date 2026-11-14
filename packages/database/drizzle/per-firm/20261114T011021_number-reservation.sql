CREATE TABLE `number_reservation` (
	`purpose` text NOT NULL,
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`token` text,
	`holder_user_id` text,
	`reserved_at` text NOT NULL,
	`expires_at` text,
	PRIMARY KEY(`purpose`, `scope_key`, `drawn_value`),
	CONSTRAINT "number_reservation_held_together_check" CHECK(("number_reservation"."token" IS NULL) = ("number_reservation"."holder_user_id" IS NULL) AND ("number_reservation"."token" IS NULL) = ("number_reservation"."expires_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `number_reservation_token_unique_index` ON `number_reservation` (`token`);