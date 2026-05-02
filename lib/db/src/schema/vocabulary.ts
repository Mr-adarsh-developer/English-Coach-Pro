import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { conversations } from "./conversations";

export const vocabularyEntries = pgTable("vocabulary_entries", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  type: text("type").notNull().default("word"),
  definition: text("definition").notNull(),
  exampleSentence: text("example_sentence"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertVocabularyEntrySchema = createInsertSchema(vocabularyEntries).omit({
  id: true,
  createdAt: true,
});

export type VocabularyEntry = typeof vocabularyEntries.$inferSelect;
export type InsertVocabularyEntry = z.infer<typeof insertVocabularyEntrySchema>;
