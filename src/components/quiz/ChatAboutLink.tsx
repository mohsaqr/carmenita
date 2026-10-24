import { Lightbulb, MessageCircle } from "lucide-react";

/**
 * Opens /chat with the question attached, in a new tab so a quiz or results
 * page in progress stays where it was. `hint`: the learner hasn't answered
 * yet, so the chat runs in hint mode (the tutor won't give the answer away).
 * Nothing in the static build, which has no server to run the chat.
 */
export function ChatAboutLink({ questionId, hint = false }: { questionId: string; hint?: boolean }) {
  if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1") return null;
  const Icon = hint ? Lightbulb : MessageCircle;
  return (
    <a
      href={`/chat?question=${encodeURIComponent(questionId)}${hint ? "&hint=1" : ""}`}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      <Icon className="h-3.5 w-3.5" />
      {hint ? "Ask for a hint" : "Chat about this question"}
    </a>
  );
}
