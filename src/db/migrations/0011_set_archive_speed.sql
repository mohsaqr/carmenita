ALTER TABLE `question_sets` ADD `question_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `set_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_questions_user_live` ON `questions` (`user_id`,`set_archived`,`created_at`);--> statement-breakpoint
-- Hand-written below (drizzle-kit does not model data backfills or triggers).
UPDATE `questions` SET `set_archived` = 1 WHERE `set_id` IN (SELECT `id` FROM `question_sets` WHERE `archived` = 1);--> statement-breakpoint
UPDATE `question_sets` SET `question_count` = (SELECT COUNT(*) FROM `questions` WHERE `questions`.`set_id` = `question_sets`.`id`);--> statement-breakpoint
-- question_sets.question_count follows every insert, delete (including the
-- ON DELETE CASCADE from deleting a set) and move of a question.
CREATE TRIGGER `trg_questions_count_insert` AFTER INSERT ON `questions` WHEN NEW.`set_id` IS NOT NULL
BEGIN
  UPDATE `question_sets` SET `question_count` = `question_count` + 1 WHERE `id` = NEW.`set_id`;
END;--> statement-breakpoint
CREATE TRIGGER `trg_questions_count_delete` AFTER DELETE ON `questions` WHEN OLD.`set_id` IS NOT NULL
BEGIN
  UPDATE `question_sets` SET `question_count` = `question_count` - 1 WHERE `id` = OLD.`set_id`;
END;--> statement-breakpoint
CREATE TRIGGER `trg_questions_count_move` AFTER UPDATE OF `set_id` ON `questions` WHEN OLD.`set_id` IS NOT NEW.`set_id`
BEGIN
  UPDATE `question_sets` SET `question_count` = `question_count` - 1 WHERE `id` = OLD.`set_id`;
  UPDATE `question_sets` SET `question_count` = `question_count` + 1 WHERE `id` = NEW.`set_id`;
END;
