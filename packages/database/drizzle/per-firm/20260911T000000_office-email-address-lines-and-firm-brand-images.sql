-- AN OFFICE GETS AN EMAIL ADDRESS, ITS ADDRESSES GET THE INTERNATIONAL FIELD SET, AND THE FIRM GETS
-- ITS OWN MARKS.
--
-- `location.email` is the one way to write to an office. An office's telephone belongs to each of its
-- addresses (a mailing address can carry a different line from the street one); mail reaches the
-- office, so it is one column on the office.
--
-- `location_address` gains the four lines the international address field set has that the original
-- four columns did not — a second street line, a district, a sorting code, and the country that
-- decides which of them a form shows. The product's one address form is shaped by the country, and an
-- office's address is entered through that form like every other address in the product, so the
-- columns it writes have to exist. All nullable: an address recorded before the column stands as it
-- was.
--
-- `firm_brand_image` is the firm's own marks, firm-wide where the letterhead logo on `location` is
-- per office. Content-addressed — the primary key is the SHA-256 of the bytes — so uploading the same
-- mark twice is the same row. Exactly one `primary` at a time, enforced in @magna-carta/locations'
-- write path rather than by a partial index, which the schema snapshot cannot record.
ALTER TABLE `location` ADD `email` text;--> statement-breakpoint
ALTER TABLE `location_address` ADD `street_two` text;--> statement-breakpoint
ALTER TABLE `location_address` ADD `dependent_locality` text;--> statement-breakpoint
ALTER TABLE `location_address` ADD `sorting_code` text;--> statement-breakpoint
ALTER TABLE `location_address` ADD `country` text;--> statement-breakpoint
CREATE TABLE `firm_brand_image` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`label` text,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_pixels` integer NOT NULL,
	`height_pixels` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "firm_brand_image_role_check" CHECK("firm_brand_image"."role" IN ('primary', 'additional')),
	CONSTRAINT "firm_brand_image_size_check" CHECK("firm_brand_image"."size_bytes" > 0),
	CONSTRAINT "firm_brand_image_pixels_check" CHECK("firm_brand_image"."width_pixels" > 0 AND "firm_brand_image"."height_pixels" > 0)
);
