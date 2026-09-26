ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The first account (the existing owner) becomes the admin, so the
-- current install can manage accounts without touching the server.
UPDATE `users` SET `is_admin` = 1 WHERE `id` = (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1);
