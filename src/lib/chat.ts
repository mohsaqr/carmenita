import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { chats, questions, type Chat, type StoredChatMessage } from "@/db/schema";
import type { ChatTurn, LLMUsage } from "@/lib/ai/llm";
import { describeCorrectAnswer, letter } from "@/lib/llm-enhance";
import { renderPrompt } from "@/lib/prompts";
import { chatTotals, type ChatTotals } from "@/lib/chat-format";

export { chatTotals };

/**
 * The chatbot on /chat: plain conversation with the model picked in the
 * header, optionally about one bank question. A chat is either temporary
 * (lives only in the browser, never stored) or saved (one `chats` row,
 * messages in a JSON column). Every read and write is scoped to its owner;
 * a foreign id behaves like a missing one.
 */

export type ChatQuestion = Pick<
  typeof questions.$inferSelect,
  "id" | "question" | "options" | "correctAnswer" | "explanation" | "topic"
>;

/**
 * Appended in hint mode: the learner opened the chat from a question they
 * haven't answered yet. Fixed, not a user-editable prompt, so an edited
 * question prompt can't drop it.
 */
export const HINT_RULE = `HINT MODE: The learner has NOT answered this question yet. Do NOT reveal the correct answer, do not say which option is right or wrong, and do not eliminate options for them. Give hints, explain the underlying concepts, and ask guiding questions so they can work it out themselves. If they ask for the answer outright, tell them to submit their answer first and come back.`;

/** The system prompt for a chat: the question template filled in, or the general one. */
export function buildChatSystemPrompt(
  question: ChatQuestion | null,
  templates: { general: string; question: string },
  options: { hint?: boolean } = {},
): string {
  if (!question) return templates.general;
  const filled = renderPrompt(templates.question, {
    question: question.question,
    optionsList: question.options.map((opt, i) => `${letter(i)}. ${opt}`).join("\n"),
    correctAnswer: describeCorrectAnswer(question.options, question.correctAnswer),
    explanation: question.explanation || "(none)",
    topic: question.topic,
  });
  return options.hint ? `${filled}\n\n${HINT_RULE}` : filled;
}

/** A saved chat's title: its first message, cut at a word near 60 characters. */
export function chatTitle(firstMessage: string): string {
  const text = firstMessage.replace(/\s+/g, " ").trim();
  if (text.length <= 60) return text || "New chat";
  const cut = text.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The turns sent to the model: role and text only. */
export function toTurns(messages: Pick<StoredChatMessage, "role" | "content">[]): ChatTurn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** An assistant reply as stored, with what the provider said it used. */
export function replyMessage(content: string, model: string, usage: LLMUsage, createdAt: string): StoredChatMessage {
  return {
    role: "assistant",
    content,
    createdAt,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────

export function getChatQuestion(userId: string, questionId: string): ChatQuestion | null {
  return (
    db
      .select({
        id: questions.id,
        question: questions.question,
        options: questions.options,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        topic: questions.topic,
      })
      .from(questions)
      .where(and(eq(questions.id, questionId), eq(questions.userId, userId)))
      .get() ?? null
  );
}

export function getChat(userId: string, chatId: string): Chat | null {
  return db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId))).get() ?? null;
}

export interface ChatSummary extends ChatTotals {
  id: string;
  title: string;
  questionId: string | null;
  messageCount: number;
  updatedAt: string;
}

/** The user's saved chats, most recently active first. */
export function listChats(userId: string): ChatSummary[] {
  return db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt), desc(chats.id))
    .all()
    .map((c) => ({
      id: c.id,
      title: c.title,
      questionId: c.questionId,
      messageCount: c.messages.length,
      updatedAt: c.updatedAt,
      ...chatTotals(c.messages),
    }));
}

export function createChat(
  userId: string,
  input: { title?: string; questionId: string | null; messages: StoredChatMessage[] },
): Chat {
  const now = new Date().toISOString();
  const firstUser = input.messages.find((m) => m.role === "user")?.content ?? "";
  const row: Chat = {
    id: randomUUID(),
    userId,
    title: input.title?.trim() || chatTitle(firstUser),
    questionId: input.questionId,
    messages: input.messages,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(chats).values(row).run();
  return row;
}

export function appendToChat(userId: string, chatId: string, added: StoredChatMessage[]): Chat | null {
  const chat = getChat(userId, chatId);
  if (!chat) return null;
  const next = { messages: [...chat.messages, ...added], updatedAt: new Date().toISOString() };
  db.update(chats).set(next).where(and(eq(chats.id, chatId), eq(chats.userId, userId))).run();
  return { ...chat, ...next };
}

export function renameChat(userId: string, chatId: string, title: string): Chat | null {
  const chat = getChat(userId, chatId);
  if (!chat) return null;
  db.update(chats).set({ title }).where(and(eq(chats.id, chatId), eq(chats.userId, userId))).run();
  return { ...chat, title };
}

export function deleteChat(userId: string, chatId: string): boolean {
  return db.delete(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId))).run().changes > 0;
}
