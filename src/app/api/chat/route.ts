import { NextRequest, NextResponse } from "next/server";
import type { StoredChatMessage } from "@/db/schema";
import { callLLM, settingsFromProvider } from "@/lib/ai/llm";
import { requireUser } from "@/lib/auth";
import {
  appendToChat,
  buildChatSystemPrompt,
  createChat,
  getChat,
  getChatQuestion,
  replyMessage,
  toTurns,
} from "@/lib/chat";
import { noteLog, withLog } from "@/lib/request-log";
import { resolvePrompt } from "@/lib/settings-store";
import { ChatSendSchema } from "@/lib/validation";

// A reply must come back inside the Cloudflare tunnel's ~100 s window, so a
// slow model fails here with a clear message instead of the tunnel's 524.
const CHAT_TIMEOUT_MS = 90_000;

/**
 * POST /api/chat — send one message, get the model's reply.
 *
 * Body: { provider, message, chatId?, history?, questionId?, save?, hint?, temperature? }
 * - `chatId`: a saved chat; its stored messages are the history (any sent
 *   `history`/`questionId` is ignored) and both new messages are appended.
 * - otherwise a temporary chat: `history` is what the browser holds. With
 *   `save: true` the chat is stored and its new id returned.
 * - `questionId`: one of the user's bank questions to talk about.
 * - `hint`: the learner hasn't answered it yet; the tutor must not give it away.
 *
 * Returns { chatId: string | null, userMessage, reply } — `reply` carries the
 * model and the tokens (and price, when the provider states one) it used.
 */
async function handlePOST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ChatSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const { provider, message, chatId, save, hint, temperature } = parsed.data;

  let history: Pick<StoredChatMessage, "role" | "content">[];
  let questionId: string | null;
  if (chatId) {
    const chat = getChat(userId, chatId);
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    history = chat.messages;
    questionId = chat.questionId;
  } else {
    history = parsed.data.history ?? [];
    questionId = parsed.data.questionId ?? null;
  }
  const question = questionId ? getChatQuestion(userId, questionId) : null;
  if (questionId && !question && !chatId) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const system = buildChatSystemPrompt(question, {
    general: resolvePrompt(userId, "carmenita.chat.general"),
    question: resolvePrompt(userId, "carmenita.chat.question"),
  }, { hint });
  const userMessage: StoredChatMessage = { role: "user", content: message, createdAt: new Date().toISOString() };
  const model = provider.defaultModel;
  noteLog({ model: `${provider.providerType}/${model}`, turns: history.length + 1, question: question ? (hint ? "hint" : "yes") : undefined });

  let result;
  try {
    result = await callLLM(
      { ...settingsFromProvider(provider, { temperature: temperature ?? 0.7 }), timeoutMs: CHAT_TIMEOUT_MS },
      system,
      [...toTurns(history), { role: "user", content: message }],
      req.signal,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = /401|403|invalid api key|authentication/i.test(msg) ? 401 : 502;
    return NextResponse.json({ error: msg }, { status });
  }

  const reply = replyMessage(result.output, model, result.usage, new Date().toISOString());
  noteLog({ inputTokens: result.usage.inputTokens ?? undefined, outputTokens: result.usage.outputTokens ?? undefined });

  let savedId: string | null = null;
  if (chatId) {
    // The chat could have been deleted while the model was answering.
    if (!appendToChat(userId, chatId, [userMessage, reply])) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    savedId = chatId;
  } else if (save) {
    const at = userMessage.createdAt;
    const earlier = history.map((m) => ({ role: m.role, content: m.content, createdAt: at }));
    savedId = createChat(userId, { questionId: question?.id ?? null, messages: [...earlier, userMessage, reply] }).id;
  }

  return NextResponse.json({ chatId: savedId, userMessage, reply });
}

export const POST = withLog(handlePOST);
