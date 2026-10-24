/**
 * Re-exports the inferred Drizzle row types so the rest of the app has a
 * single source of truth. Non-DB types (ProviderConfig, SystemSettings)
 * live here too.
 */
export type {
  Document,
  NewDocument,
  Quiz,
  NewQuiz,
  Question,
  NewQuestion,
  QuizQuestion,
  NewQuizQuestion,
  Attempt,
  NewAttempt,
  Answer,
  NewAnswer,
  QuizSettings,
  QuestionType,
  Difficulty,
  BloomLevel,
  QuestionSource,
  VariationType,
} from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Provider / settings — mirrored from handai's shape.
// ─────────────────────────────────────────────────────────────────────────────
export type SupportedProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "together"
  | "azure"
  | "openrouter"
  | "ollama"
  | "lmstudio"
  | "custom";

export interface ProviderConfig {
  id: string;
  providerType: SupportedProvider;
  displayName: string;
  apiKey: string;
  baseUrl?: string;
  /** The model calls use when this provider is active (the picked one). */
  defaultModel: string;
  /** Models offered in the header picker. Absent = just `defaultModel`. */
  models?: string[];
  isEnabled: boolean;
}

export interface SystemSettings {
  temperature: number | null;
  maxTokens: number | null;
  autoRetry: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation job state (used by useGenerationJob hook)
// ─────────────────────────────────────────────────────────────────────────────
export type GenerationJobState =
  | { status: "idle" }
  | { status: "extracting"; filename: string }
  | { status: "generating"; filename: string; progress?: string }
  | { status: "success"; quizId: string }
  | { status: "error"; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// Quiz runner state (used by useQuizRunner hook)
// ─────────────────────────────────────────────────────────────────────────────
export interface RunnerAnswer {
  questionId: string;
  userAnswer: number | number[] | null;
  timeMs: number;
}

export type RunnerMode = "immediate" | "batch";
