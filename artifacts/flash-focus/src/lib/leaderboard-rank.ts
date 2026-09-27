export type RankableEntry = { score: number; rank?: number };
export type RankAchievement = {
  icon: string;
  label: string;
  tier: "first" | "top-ten" | "top-fifty" | "top-hundred" | "climbing";
};

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

export function getRankAchievement(rank: number | null | undefined): RankAchievement | null {
  if (typeof rank !== "number" || !Number.isSafeInteger(rank) || rank < 1) return null;
  if (rank === 1) return { icon: "🥇", label: "Top 1% Performance", tier: "first" };
  if (rank <= 10) return { icon: "🏆", label: "Top 10 Performance", tier: "top-ten" };
  if (rank <= 50) return { icon: "⭐", label: "Top 50 Performance", tier: "top-fifty" };
  if (rank <= 100) return { icon: "✅", label: "Top 100 Performance", tier: "top-hundred" };
  return { icon: "🎯", label: "Keep climbing the leaderboard", tier: "climbing" };
}
