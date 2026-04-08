ALTER TABLE `quizzes` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `idx_quizzes_deleted_at` ON `quizzes` (`deleted_at`);