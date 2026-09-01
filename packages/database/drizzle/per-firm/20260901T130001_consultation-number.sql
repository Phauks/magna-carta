-- The consultation's own number. A prospective matter carried no number at all: the screens said
-- "Consultation" where a number belongs, which is a category, not a name — nothing a person can
-- quote on an intake sheet, a conflicts check, or a bill for the consultation itself.
--
-- `matter.consultation_number` is drawn at creation from the firm's consultation sequence and frozen
-- there. It does NOT become the matter number: opening the matter draws the permanent
-- `matter_number` alongside it, so a document filed under the tentative number still resolves and
-- the two numbers never contend for one column. It is null on matters created straight to open (they
-- were never a consultation) and on prospectives created before this migration — an honest gap, not
-- a backfilled guess, because a number invented after the fact would be quoted as if it had always
-- been there. The partial UNIQUE index mirrors matter_number's: a tentative number is a name people
-- repeat, so two consultations must never wear one, while the matters that carry none stay
-- unconstrained.
--
-- `numbering_scheme.purpose` splits the one template table into the two sequences a firm actually
-- numbers — 'matter' and 'consultation' — with one active scheme per purpose. Every existing row
-- defaults to 'matter', which is what they all are. A firm that has configured no consultation
-- scheme renders from the built-in default instead, so a consultation is numbered from the first
-- one, not from whenever somebody reaches the settings screen.
--
-- The counter itself is not a new mechanism: consultation draws ride matter_number_counter and
-- matter_number_allocation under scope keys namespaced with a "consultation/" prefix. '/' is outside
-- the URL-safe set every rendered segment is folded into, so a matter scope key can never collide
-- with a consultation one, and the allocation primary key stays the backstop against a losing
-- concurrent draw for both.
ALTER TABLE `matter` ADD `consultation_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_consultation_number_unique_index` ON `matter` (`consultation_number`) WHERE "matter"."consultation_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `numbering_scheme` ADD `purpose` text DEFAULT 'matter' NOT NULL;
