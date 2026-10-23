import type { Difficulty } from "@/types";

/**
 * What a generated quiz is for, and how its items are written. Both are
 * quiz settings (QuizSettings.purpose / .style), chosen on the Create page;
 * each adds its own block to the generation prompt (`purposeStyleBlock` in
 * prompts.ts) after the template, so a user's custom prompt keeps working.
 */
export type QuestionPurpose = "formative" | "training" | "exam";
export type QuestionStyle = "standard" | "board";

export const QUESTION_PURPOSES: QuestionPurpose[] = ["formative", "training", "exam"];
export const QUESTION_STYLES: QuestionStyle[] = ["standard", "board"];

export const DEFAULT_PURPOSE: QuestionPurpose = "training";
export const DEFAULT_STYLE: QuestionStyle = "standard";

export const PURPOSE_LABELS: Record<QuestionPurpose, { name: string; description: string }> = {
  formative: { name: "Formative check", description: "Find gaps while learning; explanations teach each wrong option" },
  training: { name: "Training", description: "Practice to build skill; a mix of short questions and scenarios" },
  exam: { name: "Exam", description: "High stakes; single best answer, mostly scenarios" },
};

export const STYLE_LABELS: Record<QuestionStyle, { name: string; description: string }> = {
  standard: { name: "Standard", description: "Any subject" },
  board: { name: "Board exam (USMLE / NBME)", description: "NBME single-best-answer items: clinical or basic-science stems" },
};

/** The difficulty mix a purpose starts from; the user can still change it. */
export const PURPOSE_DIFFICULTY: Record<QuestionPurpose, Record<Difficulty, number>> = {
  formative: { easy: 0.5, medium: 0.4, hard: 0.1 },
  training: { easy: 0.3, medium: 0.5, hard: 0.2 },
  exam: { easy: 0.1, medium: 0.5, hard: 0.4 },
};
