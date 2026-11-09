CREATE TABLE `directory_entity_photo` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_pixels` integer NOT NULL,
	`height_pixels` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "directory_entity_photo_size_check" CHECK("directory_entity_photo"."size_bytes" > 0),
	CONSTRAINT "directory_entity_photo_pixels_check" CHECK("directory_entity_photo"."width_pixels" > 0 AND "directory_entity_photo"."height_pixels" > 0)
);
