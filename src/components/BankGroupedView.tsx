"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Question } from "@/types";
import { QuestionRow } from "@/components/QuestionRow";

/**
 * Grouped accordion view for the question bank. Organizes the already-
 * filtered question list as a three-level tree:
 *
 *   Subject → Lesson → Topic → [questions]
 *
 * Each group header shows a count badge plus two actions:
 *   - "Select all": adds every id in that group to the bank's selection
 *   - "Take N": starts a quick quiz from those ids (calls onTakeQuiz)
 *
 * Questions with null subject/lesson fall into "(no subject)" / "(no lesson)"
 * buckets so nothing is hidden. Topic is required at the schema level so
 * there's no fallback bucket for it.
 *
 * The parent owns expand/collapse state via a Set<string> of group keys
 * so it survives re-renders when the question list updates (e.g. after a
 * bulk re-tag). Group keys are of the form:
 *   subject|lesson            (lesson level)
 *   subject|lesson|topic      (topic level)
 *
 * Row rendering delegates to QuestionRow so the look matches the flat
 * view one-for-one.
 */

const NO_SUBJECT = "(no subject)";
const NO_LESSON = "(no lesson)";

export interface BankGroupedViewProps {
  questions: Question[];
  selected: Set<string>;
  /**
   * Toggle a single question id in the parent's selection set.
   */
  onToggleSelected: (id: string) => void;
  /**
   * Add every id in the array to the parent's selection (used by the
   * per-group "Select all" button). The parent is free to de-duplicate.
   */
  onSelectMany: (ids: string[]) => void;
  /**
   * Start a quick quiz from the given ids. The titleHint is a human-
   * readable path like "biology / plant physiology / photosynthesis".
   */
  onTakeQuiz: (ids: string[], titleHint: string) => Promise<void>;
  /**
   * Set of currently-expanded group keys. Parent state so it persists
   * across re-renders.
   */
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  /**
   * Per-question expand state for the inline answer/explanation preview
   * inside QuestionRow. Owned by parent so it matches the flat view.
   */
  expandedQuestionId: string | null;
  onToggleQuestion: (id: string) => void;
  onDeleteQuestion: (id: string) => void;
  onGenerateVariations: (q: Question) => void;
  /**
   * Lookup map for "N variations" badge on parent questions.
   */
  variationChildCount: Map<string, number>;
  /**
   * Lookup map so child variation rows can show "variation of: …".
   */
  byId: Map<string, Question>;
}

/** Internal tree shape built by the grouping memo. */
interface TopicGroup {
  topic: string;
  key: string;
  questions: Question[];
}

interface LessonGroup {
  lesson: string;
  key: string;
  topics: TopicGroup[];
  totalCount: number;
}

interface SubjectGroup {
  subject: string;
  key: string;
  lessons: LessonGroup[];
  totalCount: number;
}

export function BankGroupedView({
  questions,
  selected,
  onToggleSelected,
  onSelectMany,
  onTakeQuiz,
  expandedGroups,
  onToggleGroup,
  expandedQuestionId,
  onToggleQuestion,
  onDeleteQuestion,
  onGenerateVariations,
  variationChildCount,
  byId,
}: BankGroupedViewProps) {
  // Build the three-level tree once per questions change. Using plain
  // Maps keeps insertion order stable across renders (so the UI doesn't
  // jump around when the list gets re-filtered).
  const tree = useMemo<SubjectGroup[]>(() => {
    const subjectMap = new Map<string, Map<string, Map<string, Question[]>>>();

    for (const q of questions) {
      const subject = q.subject ?? NO_SUBJECT;
      const lesson = q.lesson ?? NO_LESSON;
      const topic = q.topic;

      let lessonMap = subjectMap.get(subject);
      if (!lessonMap) {
        lessonMap = new Map();
        subjectMap.set(subject, lessonMap);
      }
      let topicMap = lessonMap.get(lesson);
      if (!topicMap) {
        topicMap = new Map();
        lessonMap.set(lesson, topicMap);
      }
      let bucket = topicMap.get(topic);
      if (!bucket) {
        bucket = [];
        topicMap.set(topic, bucket);
      }
      bucket.push(q);
    }

    const subjects: SubjectGroup[] = [];
    for (const [subject, lessonMap] of subjectMap) {
      const lessons: LessonGroup[] = [];
      let subjectTotal = 0;
      for (const [lesson, topicMap] of lessonMap) {
        const topics: TopicGroup[] = [];
        let lessonTotal = 0;
        for (const [topic, qs] of topicMap) {
          if (qs.length === 0) continue; // defensive: skip empty groups
          topics.push({
            topic,
            key: `${subject}|${lesson}|${topic}`,
            questions: qs,
          });
          lessonTotal += qs.length;
        }
        if (topics.length === 0) continue;
        lessons.push({
          lesson,
          key: `${subject}|${lesson}`,
          topics,
          totalCount: lessonTotal,
        });
        subjectTotal += lessonTotal;
      }
      if (lessons.length === 0) continue;
      subjects.push({
        subject,
        key: subject,
        lessons,
        totalCount: subjectTotal,
      });
    }

    return subjects;
  }, [questions]);

  if (tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No questions to group.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tree.map((subj) => {
        const subjectOpen = expandedGroups.has(subj.key);
        const subjectIds = collectSubjectIds(subj);
        return (
          <div key={subj.key} className="rounded-md border">
            <GroupHeader
              level="subject"
              open={subjectOpen}
              label={subj.subject}
              count={subj.totalCount}
              onToggle={() => onToggleGroup(subj.key)}
              onSelectAll={() => onSelectMany(subjectIds)}
              onTakeQuiz={() => onTakeQuiz(subjectIds, subj.subject)}
            />
            {subjectOpen && (
              <div className="border-t">
                {subj.lessons.map((lsn) => {
                  const lessonOpen = expandedGroups.has(lsn.key);
                  const lessonIds = collectLessonIds(lsn);
                  const lessonHint = `${subj.subject} / ${lsn.lesson}`;
                  return (
                    <div key={lsn.key} className="border-b last:border-b-0">
                      <GroupHeader
                        level="lesson"
                        open={lessonOpen}
                        label={lsn.lesson}
                        count={lsn.totalCount}
                        onToggle={() => onToggleGroup(lsn.key)}
                        onSelectAll={() => onSelectMany(lessonIds)}
                        onTakeQuiz={() => onTakeQuiz(lessonIds, lessonHint)}
                      />
                      {lessonOpen && (
                        <div className="bg-muted/20">
                          {lsn.topics.map((tp) => {
                            const topicOpen = expandedGroups.has(tp.key);
                            const topicIds = tp.questions.map((q) => q.id);
                            const topicHint = `${subj.subject} / ${lsn.lesson} / ${tp.topic}`;
                            return (
                              <div
                                key={tp.key}
                                className="border-t first:border-t-0"
                              >
                                <GroupHeader
                                  level="topic"
                                  open={topicOpen}
                                  label={tp.topic}
                                  count={tp.questions.length}
                                  onToggle={() => onToggleGroup(tp.key)}
                                  onSelectAll={() => onSelectMany(topicIds)}
                                  onTakeQuiz={() =>
                                    onTakeQuiz(topicIds, topicHint)
                                  }
                                />
                                {topicOpen && (
                                  <div className="divide-y bg-background px-4">
                                    {tp.questions.map((q) => (
                                      <QuestionRow
                                        key={q.id}
                                        question={q}
                                        selected={selected.has(q.id)}
                                        expanded={expandedQuestionId === q.id}
                                        variationCount={
                                          variationChildCount.get(q.id) ?? 0
                                        }
                                        parent={
                                          q.parentQuestionId
                                            ? byId.get(q.parentQuestionId) ??
                                              null
                                            : null
                                        }
                                        // Callbacks are passed directly (NOT
                                        // wrapped in inline arrows) so React.memo
                                        // on QuestionRow can bail out on rows
                                        // whose state hasn't changed. The bank
                                        // page stabilizes these with useCallback.
                                        onSelect={onToggleSelected}
                                        onToggleExpand={onToggleQuestion}
                                        onDelete={onDeleteQuestion}
                                        onGenerateVariations={onGenerateVariations}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Flatten every question id beneath a subject group. */
function collectSubjectIds(subj: SubjectGroup): string[] {
  const ids: string[] = [];
  for (const lsn of subj.lessons) {
    for (const tp of lsn.topics) {
      for (const q of tp.questions) ids.push(q.id);
    }
  }
  return ids;
}

/** Flatten every question id beneath a lesson group. */
function collectLessonIds(lsn: LessonGroup): string[] {
  const ids: string[] = [];
  for (const tp of lsn.topics) {
    for (const q of tp.questions) ids.push(q.id);
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group header — shared between subject / lesson / topic rows
// ─────────────────────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  level: "subject" | "lesson" | "topic";
  open: boolean;
  label: string;
  count: number;
  onToggle: () => void;
  onSelectAll: () => void;
  onTakeQuiz: () => void;
}

function GroupHeader({
  level,
  open,
  label,
  count,
  onToggle,
  onSelectAll,
  onTakeQuiz,
}: GroupHeaderProps) {
  const labelClass =
    level === "subject"
      ? "font-bold text-base"
      : level === "lesson"
        ? "font-semibold text-sm"
        : "font-normal text-sm";
  const padding =
    level === "subject"
      ? "px-3 py-2.5"
      : level === "lesson"
        ? "pl-8 pr-3 py-2"
        : "pl-14 pr-3 py-1.5";
  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap hover:bg-muted/40 transition-colors",
        padding,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", labelClass)}>{label}</span>
        <Badge variant="secondary" className="text-xs">
          {count} question{count === 1 ? "" : "s"}
        </Badge>
      </button>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onSelectAll();
        }}
      >
        Select all
      </Button>
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          void onTakeQuiz();
        }}
      >
        <Play className="h-4 w-4" />
        Take {Math.min(count, 50)}
      </Button>
    </div>
  );
}
