export type RankableEntry = { score: number; rank?: number };

/**
 * Keeps the server-provided rank when present (the service orders ties by
 * best streak, accuracy and reaction time). Local rows fall back to their
 * sorted position. `tied` flags rows that share a score with a neighbour.
 */
export function withDisplayRanks<T extends RankableEntry>(entries: T[]): Array<T & { displayRank: number; tied: boolean }> {
  return entries.map((entry, index) => ({
    ...entry,
    displayRank: typeof entry.rank === "number" && entry.rank > 0 ? entry.rank : index + 1,
    tied: entries.some((other, otherIndex) => otherIndex !== index && other.score === entry.score),
  }));
}
