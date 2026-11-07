ALTER TABLE `shop_accounts` ADD `full_name` text;--> statement-breakpoint
ALTER TABLE `shop_accounts` ADD `address` text;--> statement-breakpoint
ALTER TABLE `shop_accounts` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `shop_accounts` ADD `approved` integer DEFAULT 1 NOT NULL;