CREATE TABLE `login_attempts` (
	`bucket` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop_accounts` (
	`username` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`owner_slot` integer,
	`salt` text NOT NULL,
	`verifier` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_accounts_owner_slot_unique` ON `shop_accounts` (`owner_slot`);--> statement-breakpoint
CREATE TABLE `shop_sessions` (
	`digest` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`expires` integer NOT NULL
);
