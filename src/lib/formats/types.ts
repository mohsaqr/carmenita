import type {
  QuestionType,
  Difficulty,
  BloomLevel,
} from "@/db/schema";

/**
 * Intermediate shape used by format parsers and serializers. This is
 * the same set of fields as a DB Question row minus the DB-assigned
 * columns (`id`, `createdAt`, `userId`, `sourceDocumentId`, etc.).
 *
 * Every parser normalizes input into this shape; every serializer
 * reads this shape. Keeping it decoupled from the DB schema lets us
 * test formats without spinning up a database.
 */
export interface PortableQuestion {
  type: QuestionType;
  question: string;
  options: string[];
  correctAnswer: number | number[];
  explanation: string;
  difficulty: Difficulty;
  bloomLevel: BloomLevel;
  // Taxonomy — subject and lesson are optional, topic is required.
  subject: string | null;
  lesson: string | null;
  topic: string;
  tags: string[];
  sourcePassage: string;
}

/** Default values used when a format does not carry this metadata. */
export const DEFAULT_METADATA = {
  explanation: "",
  difficulty: "medium" as Difficulty,
  bloomLevel: "understand" as BloomLevel,
  subject: null as string | null,
  lesson: null as string | null,
  topic: "imported",
  tags: [] as string[],
  sourcePassage: "",
};
