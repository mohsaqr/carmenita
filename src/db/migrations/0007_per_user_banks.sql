ALTER TABLE `question_sets` ADD `received_from` text;--> statement-breakpoint
CREATE INDEX `idx_question_sets_user_id` ON `question_sets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_attempts_user_id` ON `attempts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_user_id` ON `documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_questions_user_id` ON `questions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_quizzes_user_id` ON `quizzes` (`user_id`);--> statement-breakpoint
-- Backfill: before per-user banks, all content was shared and ownerless.
-- Give every ownerless row to the FIRST account created, so an existing
-- single-user install keeps seeing everything it had. With no users yet
-- (fresh install from the public seed) nothing changes here, and
-- scripts/create-user.mjs hands ownerless rows to the first account.
UPDATE `question_sets` SET `user_id` = (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
UPDATE `questions` SET `user_id` = (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
UPDATE `quizzes` SET `user_id` = (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
UPDATE `attempts` SET `user_id` = (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
UPDATE `documents` SET `user_id` = (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) WHERE `user_id` IS NULL;
