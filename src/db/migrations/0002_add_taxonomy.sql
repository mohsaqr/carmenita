ALTER TABLE `questions` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `lesson` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_questions_subject` ON `questions` (`subject`);--> statement-breakpoint
CREATE INDEX `idx_questions_lesson` ON `questions` (`lesson`);