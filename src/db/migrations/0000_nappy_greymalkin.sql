CREATE TABLE `answers` (
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`user_answer` text,
	`is_correct` integer NOT NULL,
	`time_ms` integer NOT NULL,
	PRIMARY KEY(`attempt_id`, `question_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_answers_attempt_id` ON `answers` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`score` real,
	`user_id` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attempts_quiz_id` ON `attempts` (`quiz_id`);--> statement-breakpoint
CREATE INDEX `idx_attempts_completed_at` ON `attempts` (`completed_at`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`user_id` text
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`correct_answer` text NOT NULL,
	`explanation` text NOT NULL,
	`difficulty` text NOT NULL,
	`bloom_level` text NOT NULL,
	`topic` text NOT NULL,
	`source_passage` text NOT NULL,
	`source_type` text DEFAULT 'document' NOT NULL,
	`source_document_id` text,
	`source_label` text,
	`created_at` text NOT NULL,
	`user_id` text,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_questions_topic` ON `questions` (`topic`);--> statement-breakpoint
CREATE INDEX `idx_questions_difficulty` ON `questions` (`difficulty`);--> statement-breakpoint
CREATE INDEX `idx_questions_bloom_level` ON `questions` (`bloom_level`);--> statement-breakpoint
CREATE INDEX `idx_questions_source_type` ON `questions` (`source_type`);--> statement-breakpoint
CREATE INDEX `idx_questions_source_doc` ON `questions` (`source_document_id`);--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`quiz_id` text NOT NULL,
	`question_id` text NOT NULL,
	`idx` integer NOT NULL,
	PRIMARY KEY(`quiz_id`, `question_id`),
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_quiz_questions_quiz_idx` ON `quiz_questions` (`quiz_id`,`idx`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`title` text NOT NULL,
	`settings` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	`user_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_quizzes_document_id` ON `quizzes` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_quizzes_created_at` ON `quizzes` (`created_at`);