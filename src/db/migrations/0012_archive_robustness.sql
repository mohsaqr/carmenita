DROP INDEX `idx_questions_user_id`;--> statement-breakpoint
CREATE INDEX `idx_answers_question` ON `answers` (`question_id`);--> statement-breakpoint
CREATE INDEX `idx_quiz_questions_question` ON `quiz_questions` (`question_id`);--> statement-breakpoint
-- Hand-written below (drizzle-kit does not model triggers or data repairs).
-- Repair any drift: old code (before 0011's app-side writes) running on a
-- migrated DB does not maintain questions.set_archived.
UPDATE `questions` SET `set_archived` = COALESCE((SELECT `archived` FROM `question_sets` WHERE `question_sets`.`id` = `questions`.`set_id`), 0)
WHERE `set_archived` IS NOT COALESCE((SELECT `archived` FROM `question_sets` WHERE `question_sets`.`id` = `questions`.`set_id`), 0);--> statement-breakpoint
UPDATE `question_sets` SET `question_count` = (SELECT COUNT(*) FROM `questions` WHERE `questions`.`set_id` = `question_sets`.`id`)
WHERE `question_count` != (SELECT COUNT(*) FROM `questions` WHERE `questions`.`set_id` = `question_sets`.`id`);--> statement-breakpoint
-- From here the database owns questions.set_archived: any insert or update
-- that leaves it different from the set's flag is corrected, and archiving
-- or restoring a set updates its questions. App code never writes it.
CREATE TRIGGER `trg_questions_set_archived_insert` AFTER INSERT ON `questions`
WHEN NEW.`set_archived` IS NOT COALESCE((SELECT `archived` FROM `question_sets` WHERE `id` = NEW.`set_id`), 0)
BEGIN
  UPDATE `questions` SET `set_archived` = COALESCE((SELECT `archived` FROM `question_sets` WHERE `id` = NEW.`set_id`), 0) WHERE `rowid` = NEW.`rowid`;
END;--> statement-breakpoint
CREATE TRIGGER `trg_questions_set_archived_update` AFTER UPDATE OF `set_id`, `set_archived` ON `questions`
WHEN NEW.`set_archived` IS NOT COALESCE((SELECT `archived` FROM `question_sets` WHERE `id` = NEW.`set_id`), 0)
BEGIN
  UPDATE `questions` SET `set_archived` = COALESCE((SELECT `archived` FROM `question_sets` WHERE `id` = NEW.`set_id`), 0) WHERE `rowid` = NEW.`rowid`;
END;--> statement-breakpoint
CREATE TRIGGER `trg_question_sets_archived` AFTER UPDATE OF `archived` ON `question_sets`
WHEN OLD.`archived` IS NOT NEW.`archived`
BEGIN
  UPDATE `questions` SET `set_archived` = NEW.`archived` WHERE `set_id` = NEW.`id`;
END;
