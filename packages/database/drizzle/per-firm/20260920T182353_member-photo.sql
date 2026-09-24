CREATE TABLE `member_photo` (
	`member_user_id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_pixels` integer NOT NULL,
	`height_pixels` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "member_photo_size_check" CHECK("member_photo"."size_bytes" > 0),
	CONSTRAINT "member_photo_pixels_check" CHECK("member_photo"."width_pixels" > 0 AND "member_photo"."height_pixels" > 0)
);
