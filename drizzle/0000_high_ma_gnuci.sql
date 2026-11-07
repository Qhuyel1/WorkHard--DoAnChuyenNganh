CREATE TABLE `ledger` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`records` text NOT NULL
);
