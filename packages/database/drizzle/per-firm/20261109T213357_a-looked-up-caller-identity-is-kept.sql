-- A LOOKED-UP CALLER IDENTITY IS KEPT.
--
-- What the telephone network's caller-name database said about a number, the one time a member paid
-- to ask. One row per number, keyed by the same two parts directory_phone indexes, so the same
-- number typed again reads the answer back for nothing. A new leaf table: nothing references it, and
-- it holds nothing until a firm provisions the lookup and somebody presses for one.
CREATE TABLE `caller_identity` (
	`country_calling_code` text NOT NULL,
	`national_number` text NOT NULL,
	`caller_name` text,
	`line_type` text,
	`carrier_name` text,
	`source` text NOT NULL,
	`looked_up_by_user_id` text NOT NULL,
	`looked_up_at` text NOT NULL,
	PRIMARY KEY(`country_calling_code`, `national_number`),
	CONSTRAINT "caller_identity_number_digits_check" CHECK(length("caller_identity"."country_calling_code") > 0 AND "caller_identity"."country_calling_code" NOT GLOB '*[^0-9]*' AND length("caller_identity"."national_number") > 0 AND "caller_identity"."national_number" NOT GLOB '*[^0-9]*')
);
