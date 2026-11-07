import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const ledger = sqliteTable("ledger", {
  id: integer("id").primaryKey(), version: integer("version").notNull(), records: text("records").notNull()
});

export const ledgerParts = sqliteTable("ledger_parts", {
  part: integer("part").primaryKey(),
  content: text("content").notNull(),
});

export const shopAccounts = sqliteTable("shop_accounts",{
  username:text("username").primaryKey(), role:text("role").notNull(),
  employeeKey:text("employee_key"),
  fullName:text("full_name"), address:text("address"), phone:text("phone"),
  approved:integer("approved").notNull().default(1),
  ownerSlot:integer("owner_slot").unique(), salt:text("salt").notNull(), verifier:text("verifier").notNull()
});
export const shopSessions = sqliteTable("shop_sessions",{
  digest:text("digest").primaryKey(), username:text("username").notNull(), expires:integer("expires").notNull()
});
export const loginAttempts = sqliteTable("login_attempts",{
  bucket:text("bucket").primaryKey(), attempts:integer("attempts").notNull(), until:integer("until").notNull()
});
