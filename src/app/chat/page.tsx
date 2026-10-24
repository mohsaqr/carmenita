"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, MessageSquarePlus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/components/ModelPicker";
import { NoProviderWarning } from "@/components/NoProviderWarning";
import { chatTotals, formatUsage } from "@/lib/chat-format";
import { cn } from "@/lib/utils";
import { chatProvider, useAppStore } from "@/lib/store";
import type { StoredChatMessage } from "@/db/schema";

interface ChatSummary {
  id: string;
  title: string;
  questionId: string | null;
  messageCount: number;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

interface AttachedQuestion {
  id: string;
  question: string;
  topic: string;
  options: string[];
  correctAnswer: number | number[];
}

/** "Today 14:05", "Yesterday", or "12 Oct" — when a saved chat was last used. */
function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

async function errorText(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Request failed (${res.status})`;
}

/**
 * /chat — talk to the model picked in the dropdown. `?question=<id>` opens
 * a chat about that bank question; `?id=<chatId>` opens a saved chat.
 * "Save this chat" off = temporary: nothing is stored, the chat is gone
 * when you leave. The chat's token use (and price, when the provider
 * reports one) is totalled under the message box.
 */
function ChatPage() {
  const router = useRouter();
  const params = useSearchParams();
  // The chat's own model: Dynasite by default, independent of the header's pick.
  const providers = useAppStore((s) => s.providers);
  const chatModel = useAppStore((s) => s.chatModel);
  const activeProviderId = useAppStore((s) => s.activeProviderId);
  const selectChatModel = useAppStore((s) => s.selectChatModel);
  const provider = chatProvider(providers, chatModel, activeProviderId);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [question, setQuestion] = useState<AttachedQuestion | null>(null);
  const [save, setSave] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/chats");
    if (!res.ok) return toast.error(await errorText(res));
    setChats(((await res.json()) as { chats: ChatSummary[] }).chats);
  }, []);

  const loadQuestion = useCallback(async (id: string | null) => {
    if (!id) return setQuestion(null);
    const res = await fetch(`/api/bank/questions/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setQuestion(null);
      return toast.error(await errorText(res));
    }
    setQuestion(((await res.json()) as { question: AttachedQuestion }).question);
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  // The URL says what to open: a saved chat, a new chat about a question, or a blank chat.
  const openId = params.get("id");
  const questionParam = params.get("question");
  // Opened from a question not yet answered: the tutor gives hints only.
  // Kept in the URL so it survives the switch to ?id= when the chat is saved.
  const hint = params.get("hint") === "1";
  const chatUrl = (id: string) => `/chat?id=${id}${hint ? "&hint=1" : ""}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (openId) {
        const res = await fetch(`/api/chats/${encodeURIComponent(openId)}`);
        if (cancelled) return;
        if (!res.ok) {
          toast.error(await errorText(res));
          return router.replace("/chat");
        }
        const { chat } = (await res.json()) as { chat: { id: string; messages: StoredChatMessage[]; questionId: string | null } };
        if (cancelled) return;
        setChatId(chat.id);
        setMessages(chat.messages);
        setSave(true);
        await loadQuestion(chat.questionId);
      } else {
        setChatId(null);
        setMessages([]);
        await loadQuestion(questionParam);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId, questionParam, loadQuestion, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    if (!provider) return toast.error("Choose a model first.");
    const optimistic: StoredChatMessage = { role: "user", content: text, createdAt: new Date().toISOString() };
    const before = messages;
    setMessages([...before, optimistic]);
    setDraft("");
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          message: text,
          hint: hint && question !== null,
          ...(chatId
            ? { chatId }
            : {
                history: before.map((m) => ({ role: m.role, content: m.content })),
                questionId: question?.id,
                save,
              }),
        }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = (await res.json()) as { chatId: string | null; userMessage: StoredChatMessage; reply: StoredChatMessage };
      setMessages([...before, data.userMessage, data.reply]);
      if (data.chatId) {
        if (!chatId) {
          setChatId(data.chatId);
          router.replace(chatUrl(data.chatId));
        }
        void loadChats();
      }
    } catch (err) {
      // Put the message back in the box so nothing typed is lost.
      setMessages(before);
      setDraft(text);
      toast.error(err instanceof Error ? err.message : "The model did not answer");
    } finally {
      setSending(false);
    }
  }

  // Turning saving on for a temporary chat stores it as it stands.
  async function changeSave(next: boolean) {
    setSave(next);
    if (!next || chatId || messages.length === 0) return;
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, questionId: question?.id ?? null }),
    });
    if (!res.ok) {
      setSave(false);
      return toast.error(await errorText(res));
    }
    const { chat } = (await res.json()) as { chat: { id: string } };
    setChatId(chat.id);
    router.replace(chatUrl(chat.id));
    void loadChats();
    toast.success("Chat saved");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    setConfirmDelete(null);
    if (!res.ok) return toast.error(await errorText(res));
    if (id === chatId) router.replace("/chat");
    void loadChats();
  }

  function newChat() {
    setChatId(null);
    setMessages([]);
    setDraft("");
    if (openId || questionParam) router.push("/chat");
    else setQuestion(null);
  }

  // Nothing to total until the model has answered once.
  const used = messages.some((m) => m.role === "assistant") ? formatUsage(chatTotals(messages)) : "";

  return (
    <div className="mx-auto flex h-[calc(100dvh-6.5rem)] max-w-6xl gap-4">
      {/* Saved chats */}
      <aside className="hidden w-64 shrink-0 flex-col gap-2 md:flex">
        <Button onClick={newChat} variant="outline" className="justify-start">
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {chats.length === 0 && (
            <p className="px-2 pt-2 text-xs text-muted-foreground">Saved chats appear here.</p>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                c.id === chatId && "bg-accent font-medium",
              )}
            >
              <Link href={`/chat?id=${c.id}`} className="min-w-0 flex-1">
                <span className="block truncate">{c.title}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {c.questionId ? "Question · " : ""}
                  {when(c.updatedAt)}
                </span>
              </Link>
              {confirmDelete === c.id ? (
                <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => remove(c.id)}>
                  Delete
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  title="Delete chat"
                  onClick={() => setConfirmDelete(c.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
          <Button onClick={newChat} variant="outline" size="sm" className="md:hidden">
            <MessageSquarePlus className="h-4 w-4" /> New
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="save-chat"
                checked={save || chatId !== null}
                disabled={chatId !== null}
                onCheckedChange={changeSave}
              />
              <Label
                htmlFor="save-chat"
                className="text-sm"
                title={chatId ? "This chat is saved. Delete it from the list to remove it." : undefined}
              >
                {save || chatId ? "Saved" : "Temporary"}
              </Label>
            </div>
            <ModelPicker
              selection={provider ? { providerId: provider.id, model: provider.defaultModel } : null}
              onSelect={selectChatModel}
              label="Model used for chat"
            />
          </div>
        </div>

        {!provider && <NoProviderWarning />}

        {question && (
          <Card className="py-3">
            <CardContent className="flex items-start gap-2 px-4 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {hint ? "Hints for this question" : "About this question"} · {question.topic}
                </p>
                <p>{question.question}</p>
                <ol className="mt-2 space-y-0.5">
                  {question.options.map((opt, i) => {
                    // In hint mode the card must not give the answer away either.
                    const correct =
                      !hint &&
                      (Array.isArray(question.correctAnswer) ? question.correctAnswer.includes(i) : question.correctAnswer === i);
                    return (
                      <li key={i} className={cn("flex gap-2", correct && "font-medium text-green-700 dark:text-green-400")}>
                        <span className="font-mono text-xs text-muted-foreground mt-0.5">{String.fromCharCode(65 + i)}.</span>
                        <span className="flex-1">{opt}</span>
                        {correct && <Check className="h-4 w-4 shrink-0" aria-label="correct" />}
                      </li>
                    );
                  })}
                </ol>
                {hint && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Hint mode: the tutor won&apos;t tell you the answer. Submit your answer in the quiz first, then ask freely.
                  </p>
                )}
              </div>
              {!chatId && messages.length === 0 && (
                <Button size="icon-sm" variant="ghost" title="Chat without the question" onClick={() => router.push("/chat")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border p-4">
          {messages.length === 0 && !sending && (
            <p className="text-sm text-muted-foreground">
              {question
                ? hint
                  ? "Stuck? Ask for a hint, or for the idea behind the question."
                  : "Ask anything about this question: why the answer is right, why the others are wrong, or for a similar one to try."
                : "Ask anything. Pick the model in the dropdown above."}
              {!save && " Temporary: this chat is not stored."}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={`${m.createdAt}-${i}`} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message (Enter to send, Shift+Enter for a new line)"
            rows={2}
            className="min-h-[2.75rem] resize-none"
            aria-label="Message"
          />
          <Button type="submit" disabled={!draft.trim() || sending || !provider} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <p className="-mt-1 text-xs text-muted-foreground">
          {used ? `This chat so far: ${used}` : "This chat's token use appears here once the model has answered."}
        </p>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
