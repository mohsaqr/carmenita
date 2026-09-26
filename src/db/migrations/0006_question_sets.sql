CREATE TABLE `question_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`folder` text,
	`created_at` text NOT NULL,
	`user_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_question_sets_folder` ON `question_sets` (`folder`);--> statement-breakpoint
ALTER TABLE `questions` ADD `set_id` text REFERENCES question_sets(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `idx_questions_set_id` ON `questions` (`set_id`);--> statement-breakpoint
-- Backfill: every earlier import becomes a named set (its source label,
-- or "Untitled import" when none was given), with no folder.
INSERT INTO `question_sets` (`id`, `name`, `folder`, `created_at`, `user_id`)
SELECT lower(hex(randomblob(16))), COALESCE(`source_label`, 'Untitled import'), NULL, MIN(`created_at`), NULL
FROM `questions`
WHERE `source_type` IN ('gift-import', 'aiken-import', 'markdown-import')
GROUP BY COALESCE(`source_label`, 'Untitled import');--> statement-breakpoint
UPDATE `questions`
SET `set_id` = (
  SELECT s.`id` FROM `question_sets` s
  WHERE s.`name` = COALESCE(`questions`.`source_label`, 'Untitled import')
)
WHERE `source_type` IN ('gift-import', 'aiken-import', 'markdown-import');
