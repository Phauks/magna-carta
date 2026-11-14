-- A MEETING HAS A NINE-DIGIT ADDRESS, AND A PERSONAL ROOM HAS ONE BY NAME.
--
-- `meeting.join_code` is the meeting's address and join code, nine digits (/meeting/482-917-305).
-- Existing meetings are given one here: three random digits and then the row's own number, so no two
-- existing rows can share a code whatever the random digits come out as.
--
-- `meeting_personal_room.address_name` is a room's address by name (/room/trevor): the owner's first
-- name in lower case, followed by a number where an earlier room already has that name. A first name
-- with anything but plain letters and digits in it falls back to the room's link code, which the
-- owner already has.
--
-- contract: nothing is dropped and nothing is rebuilt. Both are ADDED columns carrying their own
-- CHECK, because both tables are parents and a rebuild of a parent cannot commit in a durable object.
ALTER TABLE `meeting` ADD `join_code` text CHECK (`join_code` IS NULL OR (length(`join_code`) = 9 AND `join_code` NOT GLOB '*[^0-9]*'));--> statement-breakpoint
UPDATE `meeting` SET `join_code` = printf('%03d%06d', abs(random()) % 1000, rowid % 1000000) WHERE `join_code` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_join_code_unique_index` ON `meeting` (`join_code`) WHERE "meeting"."join_code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_personal_room` ADD `address_name` text CHECK (`address_name` IS NULL OR (length(`address_name`) BETWEEN 1 AND 40 AND `address_name` NOT GLOB '*[^a-z0-9-]*'));--> statement-breakpoint
UPDATE `meeting_personal_room` SET `address_name` = (
  SELECT CASE WHEN `named`.`position` = 1 THEN `named`.`base` ELSE `named`.`base` || '-' || `named`.`position` END
  FROM (
    SELECT `room`.`id` AS `id`, `first`.`base` AS `base`,
      row_number() OVER (PARTITION BY `first`.`base` ORDER BY `room`.`created_at`, `room`.`id`) AS `position`
    FROM `meeting_personal_room` AS `room`
    JOIN (
      SELECT `inner_room`.`id` AS `id`,
        CASE
          WHEN `word`.`value` = '' OR `word`.`value` GLOB '*[^a-z0-9]*' OR length(`word`.`value`) > 30
            THEN `inner_room`.`link_code`
          ELSE `word`.`value`
        END AS `base`
      FROM `meeting_personal_room` AS `inner_room`
      JOIN (
        SELECT `user_id`,
          lower(substr(trim(`display_name`), 1, instr(trim(`display_name`) || ' ', ' ') - 1)) AS `value`
        FROM `member`
      ) AS `word` ON `word`.`user_id` = `inner_room`.`owner_user_id`
    ) AS `first` ON `first`.`id` = `room`.`id`
  ) AS `named`
  WHERE `named`.`id` = `meeting_personal_room`.`id`
) WHERE `address_name` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_personal_room_address_name_unique_index` ON `meeting_personal_room` (`address_name`) WHERE "meeting_personal_room"."address_name" IS NOT NULL;
