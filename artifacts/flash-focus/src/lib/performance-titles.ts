export type PerformanceTitleId =
  | "speed-demon"
  | "precision-master"
  | "adaptability-ace"
  | "streak-champion"
  | "focus-specialist"
  | "elite-performer";

export type PerformanceTitle = {
  id: PerformanceTitleId;
  icon: string;
  label: string;
  description: string;
};

export type PerformanceTitleInput = {
  score: number;
  correct: number;
  total: number;
  averageReactionMs: number;
  bestStreak: number;
  wordColorSwitchAttempts: number;
  wordColorSwitchCorrect: number;
  isTopTen: boolean;
};

export function getPerformanceTitles(input: PerformanceTitleInput): PerformanceTitle[] {
  const accuracy = input.total > 0 ? (input.correct / input.total) * 100 : 0;
  const streakShare = input.correct > 0 ? input.bestStreak / input.correct : 0;
  const switchAccuracy = input.wordColorSwitchAttempts > 0
    ? input.wordColorSwitchCorrect / input.wordColorSwitchAttempts
    : 0;
  const titles: PerformanceTitle[] = [];

  if (input.total >= 5 && input.averageReactionMs > 0 && input.averageReactionMs <= 650) {
    titles.push({
      id: "speed-demon",
      icon: "⚡",
      label: "Speed Demon",
      description: "Your reactions were exceptionally quick. You responded faster than most players.",
    });
  }

  if (input.total >= 10 && accuracy >= 92) {
    titles.push({
      id: "precision-master",
      icon: "🎯",
      label: "Precision Master",
      description: "You maintained excellent accuracy throughout the challenge.",
    });
  }

  if (input.wordColorSwitchAttempts >= 3 && switchAccuracy >= 0.8) {
    titles.push({
      id: "adaptability-ace",
      icon: "🔄",
      label: "Adaptability Ace",
      description: "You adapted quickly whenever the rules changed and stayed focused.",
    });
  }

  if (input.correct >= 10 && input.bestStreak >= 10 && streakShare >= 0.5) {
    titles.push({
      id: "streak-champion",
      icon: "🔥",
      label: "Streak Champion",
      description: "You built and maintained an impressive streak under pressure.",
    });
  }

  if (input.total >= 12 && accuracy >= 80 && input.averageReactionMs > 0 && input.averageReactionMs <= 1000 && input.bestStreak >= 5 && streakShare >= 0.3) {
    titles.push({
      id: "focus-specialist",
      icon: "🧠",
      label: "Focus Specialist",
      description: "You balanced speed, accuracy, and consistency extremely well.",
    });
  }

  const exceptionalOverall =
    input.total >= 12 &&
    input.score >= 900 &&
    accuracy >= 90 &&
    input.averageReactionMs > 0 &&
    input.averageReactionMs <= 800 &&
    input.bestStreak >= 10;
  if (input.isTopTen || exceptionalOverall) {
    titles.push({
      id: "elite-performer",
      icon: "🏆",
      label: "Elite Performer",
      description: input.isTopTen
        ? "Outstanding all-round performance. You’ve joined the top performers in Flash Focus."
        : "Outstanding all-round performance across accuracy, speed, and consistency.",
    });
  }

  return titles;
}