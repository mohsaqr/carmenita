/** Minimal set shape needed to group sets for display. */
export interface GroupableSet {
  folder: string | null;
  questionCount: number;
}

export interface SetGroup<T extends GroupableSet> {
  /** null = sets filed in no folder. */
  folder: string | null;
  sets: T[];
  questionCount: number;
}

/**
 * Group sets by folder, keeping the order in which each folder first
 * appears (the sets API already sorts by folder, then creation time).
 * Used by the bank's Sets panel for both live and archived sets.
 */
export function groupSetsByFolder<T extends GroupableSet>(sets: T[]): SetGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  sets.forEach((s) => groups.set(s.folder, [...(groups.get(s.folder) ?? []), s]));
  return [...groups.entries()].map(([folder, members]) => ({
    folder,
    sets: members,
    questionCount: members.reduce((n, s) => n + s.questionCount, 0),
  }));
}
