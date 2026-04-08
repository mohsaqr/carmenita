ALTER TABLE `questions` ADD `parent_question_id` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `variation_type` text;--> statement-breakpoint
CREATE INDEX `idx_questions_parent` ON `questions` (`parent_question_id`);