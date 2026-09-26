import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Route, Switch, Router as WouterRouter, useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Eye,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  competitionApiConfigured,
  deleteSharedLeaderboardEntry,
  loadSharedLeaderboard,
  startSecureSession,
  submitSecureScore,
  type LeaderboardScope,
  type RoundAttemptPayload,
} from "./lib/competition-api";

type Screen = "home" | "countdown" | "practice" | "playing" | "results";
type SessionKind = "practice" | "game";
type RoundPhase = "waiting" | "active" | "resolving";
type Feedback = { id: number; text: string; kind: "good" | "bad" | "neutral" | "moment"; duration: number };
type SoundKind = "correct" | "incorrect" | "timeout" | "streak" | "highStreak" | "ruleInk" | "ruleWord" | "moment" | "end" | "click" | "start";
type Round = { word: ColorName; color: ColorName; options: ColorName[]; shifted: boolean; ruleChanged: boolean; promptAt: number; deadline: number };
type LeaderboardEntry = { name: string; score: number; avg: number; accuracy: number; bestStreak: number; moments: number; date: string };
type LeaderboardStatus = "loading" | "ready" | "offline" | "error";
type ColorName = "RED" | "BLUE" | "GREEN" | "YELLOW" | "ORANGE" | "PURPLE";
type RuleSequenceState = { queue: boolean[]; lastRule: boolean | null; consecutive: number };

const COLORS: Record<ColorName, { label: string; css: string }> = {
  RED: { label: "Red", css: "2 83% 62%" },
  BLUE: { label: "Blue", css: "207 88% 62%" },
  GREEN: { label: "Green", css: "145 62% 48%" },
  YELLOW: { label: "Yellow", css: "47 95% 58%" },
  ORANGE: { label: "Orange", css: "25 92% 57%" },
  PURPLE: { label: "Purple", css: "269 70% 64%" },
};
const COLOR_NAMES = Object.keys(COLORS) as ColorName[];
const BOARD_KEY = "flash-focus-top-ten";
const NAME_KEY = "flash-focus-player-name";
const SOUND_KEY = "flash-focus-sound";
const VOICE_ANNOUNCEMENTS_KEY = "flash-focus-voice-announcements";
const COACH_MODE_KEY = "flash-focus-coach-mode";
const APP_DISCLAIMER = "For learning and fun only. Scores do not measure intelligence or job performance.";
const APP_CONFIG = {
  competitionSlug: "flash-focus-2026",
  organizationName: "Al-Futtaim",
};
const FRIENDLY_FEEDBACK = [
  { text: "Classic Stroop trap!", voice: "Classic Stroop moment." },
  { text: "The word won that round.", voice: "The word fooled you." },
  { text: "That signal was sneaky.", voice: "That one gets everybody." },
  { text: "Quick reset — focus again.", voice: "Nice try, stay focused." },
  { text: "Nearly! The ink had the final say.", voice: "The ink had the final say." },
  { text: "A tiny detour. Back in focus.", voice: "Tiny detour. Back in focus." },
  { text: "The colors crossed their signals.", voice: "The colors crossed their signals." },
  { text: "That shift caught you — next one!", voice: "That shift caught you. Next one." },
  { text: "Your eyes and the word disagreed.", voice: "Your eyes and the word disagreed." },
  { text: "Reset. Refocus. Go again.", voice: "Reset. Refocus. Go again." },
  { text: "The letters were very convincing.", voice: "The letters were very convincing." },
  { text: "Your brain took the shortcut.", voice: "Your brain took the shortcut." },
  { text: "The color was hiding in plain sight.", voice: "The color was hiding in plain sight." },
  { text: "A cheeky little color mix-up.", voice: "A cheeky little color mix-up." },
  { text: "That was a sneaky word costume.", voice: "That was a sneaky word costume." },
];
const CORRECT_VOICE_FEEDBACK = [
  "Nice catch!",
  "Sharp eyes!",
  "You saw it.",
  "Clean decision.",
  "Right on target.",
];
const RULE_ANNOUNCEMENTS = {
  ink: ["Ink color.", "Choose the ink color.", "Focus on the color."],
  word: ["Read the word.", "Word color.", "Focus on the word."],
} as const;

function safeReadBoard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.name === "string" && isSafeParticipantName(entry.name) && typeof entry.score === "number")
      .map((entry) => ({
        name: String(entry.name).slice(0, 18),
        score: Math.max(0, Math.round(Number(entry.score) || 0)),
        avg: Math.max(0, Number(entry.avg) || 0),
        accuracy: Math.max(0, Math.min(100, Number(entry.accuracy) || 0)),
        bestStreak: Math.max(0, Math.round(Number(entry.bestStreak) || 0)),
        moments: Math.max(0, Math.round(Number(entry.moments) || 0)),
        date: typeof entry.date === "string" ? entry.date : new Date(0).toISOString(),
      }))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function safeWriteBoard(entries: LeaderboardEntry[]) {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(entries));
  } catch {
    // Private browsing and blocked storage are valid browser states.
  }
}

function isSafeParticipantName(value: string) {
  const name = value.normalize("NFKC").trim();
  if (!name || name.length > 18 || /[\u0000-\u001f\u007f]/u.test(name)) return false;
  if (!/^[\p{L}\p{N} ._'’-]+$/u.test(name)) return false;
  if (/(https?:\/\/|www\.|@|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/iu.test(name)) return false;
  if (/(?:\+?\d[\d ()-]{6,}\d)/u.test(name)) return false;
  if (/\b(?:employee|emp|staff|worker|associate|id|eid)[-_ ]?\d{4,}\b/iu.test(name)) return false;
  return true;
}

function randomColor(exclude?: ColorName): ColorName {
  const choices = exclude ? COLOR_NAMES.filter((item) => item !== exclude) : COLOR_NAMES;
  return choices[Math.floor(Math.random() * choices.length)];
}

function currentMultiplier(streak: number) {
  if (streak >= 20) return 3;
  if (streak >= 15) return 2.5;
  if (streak >= 10) return 2;
  if (streak >= 5) return 1.5;
  return 1;
}

function currentTier(streak: number) {
  if (streak >= 20) return "UNSTOPPABLE";
  if (streak >= 15) return "BORDERLESS";
  if (streak >= 10) return "IN THE ZONE";
  if (streak >= 5) return "SHARP";
  return "FOCUSED";
}

function answerWindow(elapsed: number, score: number, streak: number) {
  void score;
  void streak;
  return Math.max(1700, 3000 - (Math.min(60, elapsed) / 60) * 1300);
}

function sequenceFits(previousRule: boolean | null, previousCount: number, sequence: boolean[]) {
  let last = previousRule;
  let count = previousCount;
  for (const rule of sequence) {
    if (rule === last) count += 1;
    else {
      last = rule;
      count = 1;
    }
    if (count > 4) return false;
  }
  return true;
}

function shuffledRuleBlock(previousRule: boolean | null, previousCount: number) {
  const template = [false, false, false, false, false, false, false, true, true, true];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = [...template].sort(() => Math.random() - 0.5);
    if (sequenceFits(previousRule, previousCount, candidate)) return candidate;
  }
  const fallback = [false, false, true, false, false, true, false, false, true, false];
  return sequenceFits(previousRule, previousCount, fallback) ? fallback : [true, false, false, true, false, false, true, false, false, false];
}

function nextRule(state: RuleSequenceState) {
  if (!state.queue.length) state.queue = shuffledRuleBlock(state.lastRule, state.consecutive);
  const shifted = state.queue.shift() ?? false;
  const ruleChanged = state.lastRule !== null && state.lastRule !== shifted;
  state.consecutive = state.lastRule === shifted ? state.consecutive + 1 : 1;
  state.lastRule = shifted;
  return { shifted, ruleChanged };
}

function randomRound(shifted: boolean, ruleChanged: boolean, elapsed = 0, score = 0, streak = 0): Round {
  const word = randomColor();
  const matchChance = Math.max(0.2, 0.35 - (Math.min(60, elapsed) / 60) * 0.15);
  const matches = Math.random() < matchChance;
  const color = matches ? word : randomColor(word);
  const optionCount = Math.min(6, 4 + Math.floor(Math.min(2, elapsed / 20)));
  const distractors = COLOR_NAMES.filter((item) => item !== (shifted ? word : color)).sort(() => Math.random() - 0.5);
  const correct = shifted ? word : color;
  const options = [correct, ...distractors.slice(0, optionCount - 1)].sort(() => Math.random() - 0.5);
  const promptAt = elapsed * 1000;
  return { word, color, options, shifted, ruleChanged, promptAt, deadline: promptAt + answerWindow(elapsed, score, streak) };
}

function formatAverage(value: number) {
  return value ? `${Math.round(value)} ms` : "—";
}

function Header({
  onHelp,
  soundOn,
  onSound,
  onFullscreen,
}: {
  onHelp: () => void;
  soundOn: boolean;
  onSound: () => void;
  onFullscreen: () => void;
}) {
  return (
    <header className="topbar" data-testid="header-game">
      <div className="brand" aria-label="Flash Focus">
        <span className="brand-mark" aria-hidden="true" />
        <span>flash focus</span>
      </div>
      <div className="top-actions">
        <button className="icon-button" onClick={onSound} aria-label={soundOn ? "Mute sound" : "Turn on sound"} data-testid="button-sound">
          {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </button>
        <button className="icon-button" onClick={onFullscreen} aria-label="Toggle fullscreen" data-testid="button-fullscreen">
          <Maximize2 size={17} />
        </button>
        <button className="quiet-button" onClick={onHelp} aria-label="Open help" data-testid="button-help">
          <CircleHelp size={16} />
          <span>How to play</span>
        </button>
      </div>
    </header>
  );
}

function Leaderboard({
  entries,
  compact = false,
  status = "ready",
  error,
  scope = "top10",
  onRetry,
  onScopeChange,
}: {
  entries: LeaderboardEntry[];
  compact?: boolean;
  status?: LeaderboardStatus;
  error?: string;
  scope?: LeaderboardScope;
  onRetry?: () => void;
  onScopeChange?: (scope: LeaderboardScope) => void;
}) {
  const scopes: Array<{ value: LeaderboardScope; label: string }> = [
    { value: "top10", label: "Top 10" },
    { value: "top100", label: "Top 100" },
    { value: "myRank", label: "My rank" },
    { value: "thisWeek", label: "This week" },
    { value: "allTime", label: "All time" },
  ];
  return (
    <section className={compact ? "leaderboard-preview" : "result-card"} aria-labelledby={compact ? "leaderboard-preview-title" : "leaderboard-title"}>
      <div className="leaderboard-preview-header">
        <div>
          <h2 id={compact ? "leaderboard-preview-title" : "leaderboard-title"}>BORDERLESS FOCUS LEADERBOARD</h2>
          <p className="micro-copy">Who has the sharpest focus at {APP_CONFIG.organizationName}?</p>
        </div>
        {!compact && <Trophy size={17} color="hsl(var(--accent))" />}
      </div>
      {!compact && onScopeChange && (
        <div className="leaderboard-tabs" role="tablist" aria-label="Leaderboard views">
          {scopes.map((item) => (
            <button
              key={item.value}
              className={scope === item.value ? "leaderboard-tab is-active" : "leaderboard-tab"}
              onClick={() => onScopeChange(item.value)}
              role="tab"
              aria-selected={scope === item.value}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {status === "loading" ? (
        <p className="micro-copy leaderboard-state" data-testid="leaderboard-loading">Loading the shared cabinet…</p>
      ) : status === "error" ? (
        <div className="leaderboard-state">
          <p className="micro-copy" data-testid="leaderboard-error">{error || "The shared cabinet is unavailable."}</p>
          {onRetry && <button className="quiet-button" type="button" onClick={onRetry}>Try again</button>}
        </div>
      ) : status === "offline" && !entries.length ? (
        <div className="leaderboard-state">
          <p className="micro-copy">The shared cabinet is offline. Scores will remain on this device until it reconnects.</p>
          {onRetry && <button className="quiet-button" type="button" onClick={onRetry}>Reconnect</button>}
        </div>
      ) : entries.length ? (
        compact ? (
          <ol>
            {entries.slice(0, 3).map((entry, index) => (
              <li key={`${entry.name}-${entry.date}-${index}`} data-testid={`leaderboard-preview-row-${index}`}>
                <span>{String(index + 1).padStart(2, "0")} &nbsp; {entry.name}</span><strong>{entry.score.toLocaleString()}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <table className="leaderboard-table" data-testid="leaderboard-table">
            <thead><tr><th scope="col">Rank / player</th><th scope="col">Score</th><th scope="col">Best streak</th></tr></thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.name}-${entry.date}-${index}`} data-testid={`leaderboard-row-${index}`}>
                  <td>{String(index + 1).padStart(2, "0")} &nbsp; {entry.name}</td>
                  <td>{entry.score.toLocaleString()}</td>
                  <td>{entry.bestStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <p className="micro-copy" data-testid="empty-leaderboard">{status === "offline" ? "No cached scores are available on this device." : "The cabinet is waiting for its first score."}</p>
      )}
      {status === "offline" && entries.length > 0 && <p className="micro-copy leaderboard-offline-note">Showing this device’s cached cabinet while the shared service reconnects.</p>}
    </section>
  );
}

function HelpModal({
  onClose,
  soundOn,
  voiceAnnouncementsOn,
  coachModeOn,
  onSound,
  onVoiceAnnouncements,
  onCoachMode,
}: {
  onClose: () => void;
  soundOn: boolean;
  voiceAnnouncementsOn: boolean;
  coachModeOn: boolean;
  onSound: () => void;
  onVoiceAnnouncements: () => void;
  onCoachMode: () => void;
}) {
  const settings = [
    { label: "Sound effects", detail: "Dings, cues and answer sounds", enabled: soundOn, onToggle: onSound },
    { label: "Voice announcements", detail: "Speaks only when the rule changes", enabled: voiceAnnouncementsOn, onToggle: onVoiceAnnouncements },
    { label: "Coach mode", detail: "Occasional spoken performance feedback", enabled: coachModeOn, onToggle: onCoachMode },
  ];
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" data-testid="dialog-help">
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
          <div>
            <span className="eyebrow">how to play</span>
            <h2 id="help-title">QUICK BRIEFING</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close help" data-testid="button-close-help"><X size={17} /></button>
        </div>
        <p className="briefing-lede">Stay sharp. The rule can change any round.</p>
        <p><strong>“Follow the rule cue: choose the INK COLOR or choose the WORD COLOR.”</strong></p>
        <ul className="help-list">
          <li><span className="keycap">1–6</span><span><strong>CHOOSE</strong><small>Click a color or press 1–6.</small></span></li>
          <li><span className="keycap">BLUE</span><span><strong>INK COLOR</strong><small>Choose the color used to display the word.</small></span></li>
          <li><span className="keycap">ORANGE</span><span><strong>WORD COLOR</strong><small>Choose the color named by the word itself.</small></span></li>
          <li><span className="keycap">SWITCH</span><span><strong>STAY READY</strong><small>Rules are mixed throughout the session and can change after any answer.</small></span></li>
          <li><span className="keycap">BONUS</span><span><strong>ADAPT</strong><small>Keep a streak of 5+ and correctly handle a WORD COLOR challenge to earn:</small><b>BORDERLESS MOMENT!</b><b>+50 BONUS</b></span></li>
          <li><span className="keycap">P</span><span><strong>PAUSE</strong><small>Pause or resume at any time.</small></span></li>
          <li><span className="keycap">60s</span><span><strong>GO!</strong><small>Score as many points as possible in one minute.</small></span></li>
        </ul>
        <section className="settings-panel" aria-labelledby="settings-title">
          <div>
            <span className="eyebrow">settings</span>
            <h3 id="settings-title">Audio &amp; guidance</h3>
          </div>
          <div className="settings-list">
            {settings.map((setting) => (
              <div className="setting-row" key={setting.label}>
                <span><strong>{setting.label}</strong><small>{setting.detail}</small></span>
                <button
                  className={setting.enabled ? "setting-toggle is-on" : "setting-toggle"}
                  type="button"
                  role="switch"
                  aria-checked={setting.enabled}
                  onClick={setting.onToggle}
                >
                  {setting.enabled ? "ON" : "OFF"}
                </button>
              </div>
            ))}
          </div>
        </section>
        <div className="modal-actions">
          <button className="primary-button" onClick={onClose} data-testid="button-got-it">GOT IT — LET’S GO <ArrowRight size={16} style={{ verticalAlign: "middle", marginLeft: 6 }} /></button>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({
  name,
  setName,
  onStart,
  onPractice,
  onHelp,
  onSound,
  onFullscreen,
  soundOn,
  leaderboard,
  leaderboardStatus,
  leaderboardError,
  onLeaderboardRetry,
  practiceNotice,
}: {
  name: string;
  setName: (value: string) => void;
  onStart: () => void;
  onPractice: () => void;
  onHelp: () => void;
  onSound: () => void;
  onFullscreen: () => void;
  soundOn: boolean;
  leaderboard: LeaderboardEntry[];
  leaderboardStatus: LeaderboardStatus;
  leaderboardError: string;
  onLeaderboardRetry: () => void;
  practiceNotice: boolean;
}) {
  return (
    <div className="screen-shell">
      <Header onHelp={onHelp} soundOn={soundOn} onSound={onSound} onFullscreen={onFullscreen} />
      <main className="landing-grid">
        <section className="hero-copy">
          <span className="eyebrow">Borderless Arcade / 01</span>
          <h1 className="display">FLASH <em>FOCUS</em></h1>
          <h2 className="hero-subtitle">A Borderless Thinking Challenge</h2>
          <p className="tagline">See clearly. Think quickly. Adapt instantly.</p>
          <p>Across Al-Futtaim, every day brings changing information, competing signals and fast decisions. Flash Focus puts your focus and adaptability to the test.</p>
          <div className="rule-line">Follow the rule cue: choose the INK COLOR or the WORD COLOR. Stay ready — it can switch after any round.</div>
          <p className="signal-line">Different signals. One clear decision.</p>
          <form className="name-form" onSubmit={(event) => { event.preventDefault(); onStart(); }}>
            <label htmlFor="player-name">Player name</label>
            <input id="player-name" className="name-input" maxLength={18} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" data-testid="input-player-name" />
            <button className="primary-button" type="submit" disabled={!isSafeParticipantName(name)} data-testid="button-start-game">START GAME <ArrowRight size={17} style={{ verticalAlign: "middle", marginLeft: 7 }} /></button>
          </form>
          <p className="name-note">Use a nickname or first name only.</p>
          <p className="page-disclaimer start-disclaimer">{APP_DISCLAIMER}</p>
          <div className="micro-copy">
            <button className="quiet-button" type="button" onClick={onPractice} disabled={!isSafeParticipantName(name)} data-testid="button-practice"><Eye size={15} /> 5-SECOND PRACTICE ROUND</button>
            <span className="skip-copy">Skip practice by selecting START GAME.</span>
            {practiceNotice && <span style={{ marginLeft: 12, color: "hsl(var(--secondary))" }} data-testid="text-practice-complete">Practice complete. You’re ready.</span>}
          </div>
          <section className="about-card" aria-labelledby="about-flash-focus-title">
            <span className="eyebrow">the thinking behind the game</span>
            <h2 id="about-flash-focus-title">ABOUT FLASH FOCUS</h2>
            <p>Flash Focus is inspired by the Stroop Effect, a classic psychology experiment demonstrating how automatic word reading competes with color recognition. The game challenges focus, selective attention, and reaction speed through fast-paced color matching challenges.</p>
          </section>
          <Leaderboard entries={leaderboard} compact status={leaderboardStatus} error={leaderboardError} onRetry={onLeaderboardRetry} />
        </section>
        <aside className="hero-stamp" aria-label="Flash Focus game preview">
          <div className="stamp-header"><span>signal / response</span><span className="stamp-live">live</span></div>
          <div className="signal-card">
            <span className="sample-word">BLUE</span>
          </div>
          <div className="stamp-footer">
            <span>Different signals. One clear decision.</span>
            <span className="color-dots" aria-hidden="true">
              {COLOR_NAMES.map((color) => <i key={color} style={{ background: `hsl(${COLORS[color].css})` }} />)}
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}

function GameScreen({
  round,
  score,
  streak,
  multiplier,
  tier,
  bestStreak,
  total,
  correct,
  remaining,
  duration,
  paused,
  onPause,
  onRestart,
  onAnswer,
  onHelp,
  onSound,
  onFullscreen,
  soundOn,
  feedback,
  lastAnswer,
  phase,
  resolvedCorrect,
  sessionKind,
}: {
  round: Round | null;
  score: number;
  streak: number;
  multiplier: number;
  tier: string;
  bestStreak: number;
  total: number;
  correct: number;
  remaining: number;
  duration: number;
  paused: boolean;
  onPause: () => void;
  onRestart: () => void;
  onAnswer: (color: ColorName) => void;
  onHelp: () => void;
  onSound: () => void;
  onFullscreen: () => void;
  soundOn: boolean;
  feedback: Feedback | null;
  lastAnswer: "good" | "bad" | null;
  phase: RoundPhase;
  resolvedCorrect: ColorName | null;
  sessionKind: SessionKind;
}) {
  const percentage = duration ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  return (
    <div className="screen-shell game-screen">
      <div className="game-topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><span>flash focus</span></div>
        <div className="game-stats">
          <div><span className="stat-label">Score</span><strong className="stat-value highlight" data-testid="text-score">{score.toLocaleString()}</strong></div>
          <div><span className="stat-label">Streak</span><strong className="stat-value" data-testid="text-streak">{streak}</strong></div>
          <div><span className="stat-label">{tier}</span><strong className="stat-value">{multiplier}×</strong></div>
          <div><span className="stat-label">Accuracy</span><strong className="stat-value" data-testid="text-accuracy">{accuracy}%</strong></div>
          <div className="timer-wrap"><span className="stat-label">Time remaining</span><strong className="stat-value" data-testid="text-time-remaining">{Math.ceil(remaining)}s</strong><div className="timer-track"><div className="timer-fill" style={{ transform: `scaleX(${percentage})` }} /></div></div>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={onPause} aria-label={paused ? "Resume game" : "Pause game"} data-testid="button-pause">{paused ? <Play size={17} /> : <Pause size={17} />}</button>
          <button className="icon-button" onClick={onRestart} aria-label="Restart game" data-testid="button-game-restart"><RotateCcw size={17} /></button>
          <button className="icon-button" onClick={onSound} aria-label={soundOn ? "Mute sound" : "Turn on sound"} data-testid="button-game-sound">{soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
          <button className="icon-button" onClick={onFullscreen} aria-label="Toggle fullscreen" data-testid="button-game-fullscreen"><Maximize2 size={17} /></button>
          <button className="icon-button" onClick={onHelp} aria-label="Open help" data-testid="button-game-help"><CircleHelp size={17} /></button>
        </div>
      </div>
      <main className="game-body">
        <section className="round-panel" aria-live="polite">
          <div className="round-meta">
            <span className="round-counter" data-testid="text-round-counter">{sessionKind === "practice" ? "practice / 05 seconds" : `round ${String(total + 1).padStart(2, "0")}`}</span>
            <span
              key={`${round?.promptAt ?? 0}-${round?.shifted ? "word" : "ink"}`}
              className={`rule-indicator ${round?.shifted ? "is-word" : "is-ink"} ${round?.ruleChanged ? "is-change" : ""}`}
              data-testid="badge-mode"
            >
              <i aria-hidden="true" />
              <strong>{round?.shifted ? "WORD COLOR" : "INK COLOR"}</strong>
              <span>{round?.shifted ? "Read the word" : "See the ink"}</span>
            </span>
          </div>
          <div className={`challenge-card ${lastAnswer === "good" ? "is-correct" : lastAnswer === "bad" ? "is-wrong" : ""}`} data-testid="challenge-card">
            {round && <span className="challenge-word" style={{ color: `hsl(${COLORS[round.color].css})` }} data-testid="text-challenge-word">{COLORS[round.word].label.toUpperCase()}</span>}
          </div>
          <p className="answer-copy">{round?.shifted ? "SELECT THE WORD COLOR" : "SELECT THE INK COLOR"}</p>
          <div className="answer-grid" role="group" aria-label="Color answers">
            {(round?.options ?? []).map((color, index) => (
              <button
                key={color}
                className={`answer-button ${phase === "resolving" && color === resolvedCorrect ? "is-correct-answer" : ""}`}
                style={{ "--answer-color": COLORS[color].css } as CSSProperties}
                onClick={() => onAnswer(color)}
                disabled={phase !== "active" || paused}
                data-testid={`button-answer-${color.toLowerCase()}`}
                aria-label={`Answer ${COLORS[color].label}`}
              >
                <span className="answer-swatch" aria-hidden="true" />{index + 1}. {COLORS[color].label}
              </button>
            ))}
          </div>
          <div className="streak-line" data-testid="text-best-streak">{streak > 1 ? `${streak} in a row · ${bestStreak} best` : bestStreak > 2 ? `${bestStreak} best streak` : "\u00a0"}</div>
          {sessionKind === "practice" && <p className="pause-note">Practice does not count toward your score.</p>}
        </section>
      </main>
      {feedback && (
        <div
          className={`toast-feedback is-${feedback.kind}`}
          key={feedback.id}
          style={{ "--feedback-duration": `${feedback.duration}ms` } as CSSProperties}
          data-testid="text-feedback"
        >
          {feedback.kind === "moment" && (
            <span className="moment-particles" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => <i key={index} style={{ "--particle-index": index } as CSSProperties} />)}
            </span>
          )}
          <span className="feedback-copy">
            {feedback.text.split("\n").map((line, index) => (
              <span className={line === "+50 BONUS" ? "bonus-line" : ""} key={`${feedback.id}-${index}`}>{line}</span>
            ))}
          </span>
        </div>
      )}
      {paused && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="paused-title" data-testid="dialog-paused">
          <div className="modal" style={{ textAlign: "center" }}>
            <span className="eyebrow">session paused</span>
            <h2 id="paused-title">Hold that thought.</h2>
            <p>{document.hidden ? "The cabinet paused because this tab is hidden." : "Your minute is safe. Come back when you’re ready."}</p>
            <div className="modal-actions" style={{ justifyContent: "center" }}>
              <button className="primary-button" onClick={onPause} data-testid="button-resume"><Play size={16} style={{ verticalAlign: "middle", marginRight: 7 }} /> Resume</button>
              <button className="secondary-button" onClick={onRestart} data-testid="button-restart"><RotateCcw size={16} style={{ verticalAlign: "middle", marginRight: 7 }} /> Restart</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsScreen({
  name,
  score,
  correct,
  incorrect,
  timeouts,
  total,
  average,
  bestStreak,
  completedShifts,
  moments,
  leaderboardPosition,
  leaderboard,
  leaderboardStatus,
  leaderboardError,
  leaderboardScope,
  onLeaderboardRetry,
  onLeaderboardScopeChange,
  onDeleteLeaderboardEntry,
  onRestart,
  onHome,
  onHelp,
  soundOn,
  onSound,
  onFullscreen,
}: {
  name: string;
  score: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  total: number;
  average: number;
  bestStreak: number;
  completedShifts: number;
  moments: number;
  leaderboardPosition: number | null;
  leaderboard: LeaderboardEntry[];
  leaderboardStatus: LeaderboardStatus;
  leaderboardError: string;
  leaderboardScope: LeaderboardScope;
  onLeaderboardRetry: () => void;
  onLeaderboardScopeChange: (scope: LeaderboardScope) => void;
  onDeleteLeaderboardEntry: () => void;
  onRestart: () => void;
  onHome: () => void;
  onHelp: () => void;
  soundOn: boolean;
  onSound: () => void;
  onFullscreen: () => void;
}) {
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const title =
    accuracy >= 90 && moments >= 2 && score >= 900 ? "BORDERLESS THINKER" :
    average > 0 && average < 650 && accuracy >= 75 ? "LIGHTNING FOCUS" :
    accuracy >= 92 ? "PRECISION MASTER" :
    moments >= 2 ? "ADAPTABILITY ACE" :
    bestStreak >= 15 ? "FOCUS MACHINE" :
    accuracy >= 80 ? "CLEAR THINKER" :
    accuracy >= 60 ? "STEADY FOCUS" : "FOCUS EXPLORER";
  return (
    <div className="screen-shell">
      <Header onHelp={onHelp} soundOn={soundOn} onSound={onSound} onFullscreen={onFullscreen} />
      <main className="results-layout">
        <section>
          <span className="eyebrow">session complete / {name}</span>
          <h1 className="display">{title}</h1>
          <p className="results-lede">One minute on the cabinet. No claims, no labels — just the read you made when the signals crossed.</p>
          <div className="score-hero"><span className="score-number" data-testid="text-final-score">{score.toLocaleString()}</span><span className="score-label">points<br />final score</span></div>
          <div className="results-actions">
            <button className="primary-button" onClick={onRestart} data-testid="button-play-again">Play again <RotateCcw size={16} style={{ verticalAlign: "middle", marginLeft: 7 }} /></button>
            <button className="secondary-button" onClick={onHome} data-testid="button-back-home"><ArrowLeft size={16} style={{ verticalAlign: "middle", marginRight: 7 }} /> Back to start</button>
          </div>
          <div className="result-explanation">
            <h2>WHY WAS THAT DIFFICULT?</h2>
            <p>Flash Focus is based on the Stroop effect, described in a famous 1935 psychology study. Reading a word can interfere with naming its ink color, creating a small competition for attention.</p>
            <p>Flash Focus turns that effect into a Borderless Thinking challenge: focus, adapt and make the right call when signals compete.</p>
          </div>
          <div className="public-note results-public-note">
            Leaderboard entries are public to anyone with the competition link. You can remove your nickname and entry from this competition.
            <br />
            <button className="quiet-button" type="button" onClick={onDeleteLeaderboardEntry}>Remove my leaderboard entry</button>
          </div>
        </section>
        <aside className="result-card">
          <h2>your readout</h2>
          <div className="result-grid">
            <div className="result-metric"><strong data-testid="text-result-accuracy">{accuracy}%</strong><span>accuracy</span></div>
            <div className="result-metric"><strong data-testid="text-result-average">{formatAverage(average)}</strong><span>average reaction</span></div>
            <div className="result-metric"><strong data-testid="text-result-correct">{correct}</strong><span>correct</span></div>
            <div className="result-metric"><strong>{incorrect}</strong><span>incorrect</span></div>
            <div className="result-metric"><strong>{timeouts}</strong><span>timeouts</span></div>
            <div className="result-metric"><strong data-testid="text-result-streak">{bestStreak}</strong><span>best streak</span></div>
            <div className="result-metric"><strong>{completedShifts}</strong><span>word rounds</span></div>
            <div className="result-metric"><strong>{moments}</strong><span>Borderless Moments</span></div>
            <div className="result-metric"><strong>{leaderboardPosition ? `#${leaderboardPosition}` : "—"}</strong><span>leaderboard position</span></div>
          </div>
          <Leaderboard
            entries={leaderboard}
            status={leaderboardStatus}
            error={leaderboardError}
            scope={leaderboardScope}
            onRetry={onLeaderboardRetry}
            onScopeChange={onLeaderboardScopeChange}
          />
        </aside>
        <p className="page-disclaimer results-disclaimer">{APP_DISCLAIMER}</p>
      </main>
    </div>
  );
}

function AppFooter() {
  return (
    <footer className="app-footer" aria-label="Application information">
      Flash Focus v1.0 | Developed by Mubashshir Ahmed
    </footer>
  );
}

function AppHome() {
  const [screen, setScreen] = useState<Screen>("home");
  const [sessionKind, setSessionKind] = useState<SessionKind>("game");
  const [name, setNameState] = useState("");
  const [countdown, setCountdown] = useState(3);
  const [remaining, setRemaining] = useState(60);
  const [round, setRound] = useState<Round | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [total, setTotal] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const [timeouts, setTimeouts] = useState(0);
  const [completedShifts, setCompletedShifts] = useState(0);
  const [moments, setMoments] = useState(0);
  const [reactionTimes, setReactionTimes] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<RoundPhase>("waiting");
  const [resolvedCorrect, setResolvedCorrect] = useState<ColorName | null>(null);
  const [lastAnswer, setLastAnswer] = useState<"good" | "bad" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [voiceAnnouncementsOn, setVoiceAnnouncementsOn] = useState(true);
  const [coachModeOn, setCoachModeOn] = useState(false);
  const [practiceNotice, setPracticeNotice] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState<LeaderboardStatus>("loading");
  const [leaderboardError, setLeaderboardError] = useState("");
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("top10");
  const [average, setAverage] = useState(0);
  const [leaderboardPosition, setLeaderboardPosition] = useState<number | null>(null);
  const activeElapsed = useRef(0);
  const lastTickAt = useRef(0);
  const ending = useRef(false);
  const answerLocked = useRef(false);
  const feedbackSequence = useRef(0);
  const lastFeedbackText = useRef("");
  const lastRuleAnnouncement = useRef("");
  const ruleSequence = useRef<RuleSequenceState>({ queue: [], lastRule: null, consecutive: 0 });
  const transitionTimer = useRef<number | null>(null);
  const secureSessionPromise = useRef<Promise<string | null> | null>(null);
  const roundAttempts = useRef<RoundAttemptPayload[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const audioMasterGain = useRef<GainNode | null>(null);
  const audioCompressor = useRef<DynamicsCompressorNode | null>(null);

  const setName = (value: string) => setNameState(value.slice(0, 18));

  const refreshLeaderboard = useCallback(async (scope: LeaderboardScope) => {
    setLeaderboardScope(scope);
    setLeaderboardStatus("loading");
    setLeaderboardError("");
    if (!competitionApiConfigured) {
      setLeaderboard(safeReadBoard());
      setLeaderboardStatus("offline");
      setLeaderboardError("The shared competition service is not configured.");
      return;
    }
    try {
      const result = await loadSharedLeaderboard(scope);
      setLeaderboard(result.entries.map((entry) => ({
        name: entry.nickname,
        score: entry.score,
        avg: 0,
        accuracy: 0,
        bestStreak: entry.bestStreak,
        moments: 0,
        date: String(entry.rank),
      })));
      setLeaderboardPosition(result.myRank);
      setLeaderboardStatus("ready");
    } catch (error) {
      setLeaderboard(safeReadBoard());
      setLeaderboardStatus("offline");
      setLeaderboardError(error instanceof Error ? error.message : "The shared cabinet is unavailable.");
    }
  }, []);

  useEffect(() => {
    try {
      setNameState((localStorage.getItem(NAME_KEY) || "").slice(0, 18));
      const storedSound = localStorage.getItem(SOUND_KEY);
      const storedCoach = localStorage.getItem(COACH_MODE_KEY);
      setSoundOn(storedSound === "on");
      setVoiceAnnouncementsOn(localStorage.getItem(VOICE_ANNOUNCEMENTS_KEY) !== "off");
      setCoachModeOn(storedCoach === null ? storedSound === "on" : storedCoach === "on");
    } catch { /* unavailable storage */ }
    setLeaderboard(safeReadBoard());
    void refreshLeaderboard("top10");
  }, [refreshLeaderboard]);

  useEffect(() => () => {
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    const locked = screen === "playing" || screen === "practice" || screen === "countdown";
    document.body.style.overflow = locked ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [screen]);

  const playTone = useCallback((kind: SoundKind) => {
    if (!soundOn) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      if (!audioContext.current) audioContext.current = new AudioContextCtor();
      const context = audioContext.current;
      if (context.state === "suspended") void context.resume();
      if (!audioMasterGain.current || !audioCompressor.current) {
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.14;
        const master = context.createGain();
        master.gain.value = 0.72;
        master.connect(compressor);
        compressor.connect(context.destination);
        audioMasterGain.current = master;
        audioCompressor.current = compressor;
      }
      const output = audioMasterGain.current;
      const now = context.currentTime;
      const scheduleTone = (
        startFrequency: number,
        endFrequency: number,
        duration: number,
        offset: number,
        type: OscillatorType,
        volume: number,
      ) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + offset;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(startFrequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration * 0.82);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.018, duration * 0.18));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain); gain.connect(output);
        oscillator.start(start); oscillator.stop(start + duration + 0.01);
      };
      const scheduleNoise = (duration: number, offset: number, volume: number) => {
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        const start = now + offset;
        source.buffer = buffer;
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(380, start);
        filter.frequency.exponentialRampToValueAtTime(1800, start + duration * 0.72);
        filter.Q.value = 0.8;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter); filter.connect(gain); gain.connect(output);
        source.start(start); source.stop(start + duration + 0.01);
      };

      switch (kind) {
        case "correct":
          scheduleTone(520, 780, 0.13, 0, "triangle", 0.24);
          break;
        case "incorrect":
          scheduleTone(180, 92, 0.16, 0, "triangle", 0.31);
          scheduleTone(112, 78, 0.12, 0.025, "sine", 0.14);
          break;
        case "timeout":
          scheduleTone(240, 92, 0.2, 0, "sine", 0.27);
          break;
        case "streak":
          scheduleTone(300, 720, 0.17, 0, "triangle", 0.25);
          break;
        case "highStreak":
          scheduleTone(540, 820, 0.11, 0, "triangle", 0.27);
          scheduleTone(620, 960, 0.11, 0.095, "triangle", 0.24);
          break;
        case "ruleInk":
          scheduleTone(620, 880, 0.12, 0, "triangle", 0.18);
          scheduleTone(820, 1040, 0.09, 0.08, "sine", 0.1);
          break;
        case "ruleWord":
          scheduleNoise(0.2, 0, 0.2);
          scheduleTone(420, 290, 0.14, 0.03, "sine", 0.09);
          break;
        case "moment":
          scheduleNoise(0.22, 0, 0.38);
          scheduleTone(560, 940, 0.14, 0.12, "triangle", 0.3);
          scheduleTone(1500, 1900, 0.055, 0.31, "sine", 0.16);
          scheduleTone(1900, 2100, 0.045, 0.39, "sine", 0.11);
          break;
        case "end":
          scheduleTone(115, 72, 0.24, 0, "sine", 0.3);
          scheduleTone(1500, 1200, 0.06, 0.16, "triangle", 0.14);
          break;
        case "click":
          scheduleTone(1450, 1000, 0.04, 0, "triangle", 0.12);
          break;
        case "start":
          scheduleTone(460, 520, 0.09, 0, "square", 0.18);
          break;
      }
    } catch { /* audio permission or browser support failure */ }
  }, [soundOn]);

  const speakFeedback = useCallback((text: string) => {
    if (!coachModeOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1.1;
      utterance.pitch = 1.04;
      utterance.volume = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis is optional and can be blocked by the browser.
    }
  }, [coachModeOn]);

  const announceRuleChange = useCallback((shifted: boolean) => {
    playTone(shifted ? "ruleWord" : "ruleInk");
    if (!voiceAnnouncementsOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const announcements = shifted ? RULE_ANNOUNCEMENTS.word : RULE_ANNOUNCEMENTS.ink;
      const choices = announcements.filter((message) => message !== lastRuleAnnouncement.current);
      const message = choices[Math.floor(Math.random() * choices.length)] ?? announcements[0];
      lastRuleAnnouncement.current = message;
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "en-US";
      utterance.rate = 1.28;
      utterance.pitch = shifted ? 0.98 : 1.04;
      utterance.volume = 0.78;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      // The visual rule indicator remains available when speech is unsupported.
    }
  }, [playTone, voiceAnnouncementsOn]);

  useEffect(() => {
    const playButtonClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!button || button.matches('[data-testid^="button-answer-"]')) return;
      playTone("click");
    };
    document.addEventListener("pointerdown", playButtonClick);
    return () => document.removeEventListener("pointerdown", playButtonClick);
  }, [playTone]);

  const toggleSound = () => {
    setSoundOn((value) => {
      const next = !value;
      if (audioMasterGain.current && audioContext.current) {
        audioMasterGain.current.gain.setValueAtTime(next ? 0.72 : 0, audioContext.current.currentTime);
      }
      try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* optional */ }
      return next;
    });
  };

  const toggleVoiceAnnouncements = () => {
    setVoiceAnnouncementsOn((value) => {
      const next = !value;
      if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      try { localStorage.setItem(VOICE_ANNOUNCEMENTS_KEY, next ? "on" : "off"); } catch { /* optional */ }
      return next;
    });
  };

  const toggleCoachMode = () => {
    setCoachModeOn((value) => {
      const next = !value;
      if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      try { localStorage.setItem(COACH_MODE_KEY, next ? "on" : "off"); } catch { /* optional */ }
      return next;
    });
  };

  const beginCountdown = (kind: SessionKind) => {
    const cleanName = name.trim().slice(0, 18);
    if (!isSafeParticipantName(cleanName)) return;
    setNameState(cleanName);
    setSessionKind(kind); setPracticeNotice(false); setPaused(false); ending.current = false;
    setCountdown(3); setScreen("countdown"); playTone("start");
    setScore(0); setStreak(0); setBestStreak(0); setTotal(0); setCorrect(0); setIncorrect(0); setTimeouts(0);
    setCompletedShifts(0); setMoments(0); setReactionTimes([]); setLeaderboardPosition(null);
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    setRemaining(kind === "practice" ? 5 : 60); setRound(null); setLastAnswer(null); setFeedback(null);
    setPhase("waiting"); setResolvedCorrect(null);
    activeElapsed.current = 0; answerLocked.current = false;
    ruleSequence.current = { queue: [], lastRule: null, consecutive: 0 };
    lastRuleAnnouncement.current = "";
    roundAttempts.current = [];
    secureSessionPromise.current = kind === "game" && competitionApiConfigured
      ? startSecureSession(cleanName).then((session) => session.sessionId).catch(() => null)
      : Promise.resolve(null);
    try { localStorage.setItem(NAME_KEY, cleanName); } catch { /* optional */ }
  };

  useEffect(() => {
    if (screen !== "countdown") return;
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          activeElapsed.current = 0;
          lastTickAt.current = performance.now();
          setRemaining(sessionKind === "practice" ? 5 : 60);
           const firstRule = nextRule(ruleSequence.current);
           setRound(randomRound(firstRule.shifted, firstRule.ruleChanged, 0, 0, 0));
          setPhase("active");
          setScreen(sessionKind === "practice" ? "practice" : "playing");
          return 0;
        }
        playTone("start");
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [screen, sessionKind, playTone]);

  const finishSession = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setFeedback(null); setPhase("waiting");
    if (sessionKind === "practice") {
      setScreen("home"); setPracticeNotice(true); setRound(null); return;
    }
    playTone("end");
    const avg = reactionTimes.length ? reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length : 0;
    setAverage(avg);
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    const entry: LeaderboardEntry = {
      name: name.trim(),
      score,
      avg,
      accuracy,
      bestStreak,
      moments,
      date: new Date().toISOString(),
    };
    const normalized = entry.name.toLocaleLowerCase();
    const withoutPlayer = leaderboard.filter((item) => item.name.trim().toLocaleLowerCase() !== normalized);
    const previous = leaderboard.find((item) => item.name.trim().toLocaleLowerCase() === normalized);
    const candidate = !previous || score > previous.score ? entry : previous;
    const updated = [...withoutPlayer, candidate]
      .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || b.bestStreak - a.bestStreak || b.moments - a.moments || a.date.localeCompare(b.date))
      .slice(0, 10);
    const position = updated.findIndex((item) => item.name.trim().toLocaleLowerCase() === normalized);
    setLeaderboardPosition(position >= 0 ? position + 1 : null);
    setLeaderboard(updated);
    safeWriteBoard(updated);
    setScreen("results");
    setRound(null);
    const attempts = roundAttempts.current.slice();
    const pendingSession = secureSessionPromise.current;
    if (pendingSession && competitionApiConfigured) {
      void pendingSession.then(async (sessionId) => {
        if (!sessionId) return;
        try {
          await submitSecureScore({ sessionId, score, rounds: attempts });
          await refreshLeaderboard("top10");
        } catch (error) {
          setLeaderboardStatus("offline");
          setLeaderboardError(error instanceof Error ? error.message : "The score could not be shared.");
        }
      });
    }
  }, [bestStreak, correct, leaderboard, moments, name, playTone, reactionTimes, refreshLeaderboard, score, sessionKind, total]);

  const showNextRound = useCallback(() => {
    answerLocked.current = false;
    setFeedback(null);
    setResolvedCorrect(null);
    setLastAnswer(null);
    const next = nextRule(ruleSequence.current);
    setRound(randomRound(next.shifted, next.ruleChanged, activeElapsed.current, score, streak));
    setPhase("active");
    if (next.ruleChanged) announceRuleChange(next.shifted);
  }, [announceRuleChange, score, streak]);

  const pickFriendlyFeedback = useCallback(() => {
    const choices = FRIENDLY_FEEDBACK.filter((message) => message.text !== lastFeedbackText.current);
    const message = choices[Math.floor(Math.random() * choices.length)] ?? FRIENDLY_FEEDBACK[0];
    lastFeedbackText.current = message.text;
    return message;
  }, []);

  const resolveAndAdvance = useCallback((text: string, kind: Feedback["kind"], duration: number) => {
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    feedbackSequence.current += 1;
    setPhase("resolving");
    setFeedback({ id: feedbackSequence.current, text, kind, duration });
    transitionTimer.current = window.setTimeout(() => {
      transitionTimer.current = null;
      setFeedback(null);
      showNextRound();
    }, duration);
  }, [showNextRound]);

  const handleTimeout = useCallback(() => {
    if (!round || answerLocked.current || paused || phase !== "active") return;
    answerLocked.current = true;
    setLastAnswer(null);
    setResolvedCorrect(round.shifted ? round.word : round.color);
    if (sessionKind === "game") {
      roundAttempts.current.push({
        word: round.word,
        color: round.color,
        shifted: round.shifted,
        answer: null,
        timedOut: true,
        reactionMs: null,
        windowMs: round.deadline - round.promptAt,
      });
    }
    if (sessionKind === "practice") {
      playTone("timeout");
      const ruleReminder = round.shifted ? "read the word" : "choose the ink color";
      speakFeedback(`Time's up. ${ruleReminder}.`);
      resolveAndAdvance(`Time’s up — ${ruleReminder}.`, "neutral", 650);
      return;
    }
    setTotal((value) => value + 1);
    setTimeouts((value) => value + 1);
    setStreak(0);
    if (round.shifted) setCompletedShifts((value) => value + 1);
    playTone("timeout");
    const message = pickFriendlyFeedback();
    speakFeedback(message.voice);
    resolveAndAdvance(message.text, "neutral", 650);
  }, [paused, phase, pickFriendlyFeedback, playTone, resolveAndAdvance, round, sessionKind, speakFeedback]);

  useEffect(() => {
    if (screen !== "playing" && screen !== "practice") return;
    const duration = sessionKind === "practice" ? 5 : 60;
    lastTickAt.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - lastTickAt.current) / 1000;
      lastTickAt.current = now;
      if (paused) return;
      activeElapsed.current = Math.min(duration, activeElapsed.current + delta);
      const elapsed = activeElapsed.current;
      const next = Math.max(0, duration - elapsed);
      setRemaining(next);
      if (phase === "active" && round && elapsed * 1000 >= round.deadline) handleTimeout();
      if (elapsed >= duration) finishSession();
    }, 80);
    return () => window.clearInterval(timer);
  }, [finishSession, handleTimeout, paused, phase, round, screen, sessionKind]);

  useEffect(() => {
    if (screen !== "playing" && screen !== "practice") return;
    const pauseIfAway = () => setPaused(true);
    const onVisibility = () => { if (document.hidden) pauseIfAway(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", pauseIfAway);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("blur", pauseIfAway); };
  }, [screen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']") || event.repeat) return;
      if (showHelp) { if (event.key === "Escape") setShowHelp(false); return; }
      if ((screen === "playing" || screen === "practice") && !paused) {
        if (event.key.toLowerCase() === "p") { setPaused(true); return; }
        if (event.key.toLowerCase() === "r") {
          if (window.confirm("Restart this run? Your current score will be lost.")) beginCountdown(sessionKind);
          return;
        }
        const index = Number(event.key) - 1;
        if (index >= 0 && round?.options[index]) handleAnswer(round.options[index]);
      } else if ((screen === "playing" || screen === "practice") && paused && event.key.toLowerCase() === "p") {
        setPaused(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleAnswer = (answer: ColorName) => {
    if (!round || paused || phase !== "active" || (screen !== "playing" && screen !== "practice")) return;
    if (answerLocked.current) return;
    answerLocked.current = true;
    const reaction = Math.max(0, activeElapsed.current * 1000 - round.promptAt);
    const expected = round.shifted ? round.word : round.color;
    const isCorrect = answer === expected;
    if (sessionKind === "game") {
      roundAttempts.current.push({
        word: round.word,
        color: round.color,
        shifted: round.shifted,
        answer,
        timedOut: false,
        reactionMs: reaction,
        windowMs: round.deadline - round.promptAt,
      });
    }
    setResolvedCorrect(expected);
    setLastAnswer(isCorrect ? "good" : "bad");
    if (sessionKind === "practice") {
      playTone(isCorrect ? "correct" : "incorrect");
      if (isCorrect) {
        if (Math.random() < 0.35) speakFeedback(CORRECT_VOICE_FEEDBACK[Math.floor(Math.random() * CORRECT_VOICE_FEEDBACK.length)]);
        resolveAndAdvance(`${Math.round(reaction)} ms · correct`, "good", 280);
      } else {
        const message = pickFriendlyFeedback();
        speakFeedback(message.voice);
        resolveAndAdvance(message.text, "bad", 650);
      }
      return;
    }
    setTotal((value) => value + 1); setReactionTimes((values) => [...values, reaction]);
    if (isCorrect) {
      const nextStreak = streak + 1;
      const windowLength = Math.max(1, round.deadline - round.promptAt);
      const speedBonus = Math.max(0, Math.min(15, Math.round(15 * (1 - reaction / windowLength))));
      const multiplier = currentMultiplier(streak);
      const borderlessMoment = round.shifted && streak >= 5;
      const earned = Math.round((10 + speedBonus) * multiplier) + (borderlessMoment ? 50 : 0);
      setScore((value) => value + earned); setCorrect((value) => value + 1); setStreak(nextStreak); setBestStreak((value) => Math.max(value, nextStreak));
      if (round.shifted) setCompletedShifts((value) => value + 1);
      if (borderlessMoment) setMoments((value) => value + 1);
      const reachedNewTier = currentMultiplier(nextStreak) > currentMultiplier(streak);
      playTone(borderlessMoment ? "moment" : reachedNewTier ? "streak" : nextStreak >= 15 ? "highStreak" : "correct");
      if (borderlessMoment) speakFeedback("Borderless moment! You handled the word rule.");
      else if (Math.random() < 0.2) speakFeedback(CORRECT_VOICE_FEEDBACK[Math.floor(Math.random() * CORRECT_VOICE_FEEDBACK.length)]);
      resolveAndAdvance(
        borderlessMoment ? "BORDERLESS MOMENT!\nYou handled the word rule.\n+50 BONUS" : `+${earned} · ${Math.round(reaction)} ms`,
        borderlessMoment ? "moment" : "good",
        borderlessMoment ? 850 : 280,
      );
    } else {
      setIncorrect((value) => value + 1);
      if (round.shifted) setCompletedShifts((value) => value + 1);
      setStreak(0);
      playTone("incorrect");
      const message = pickFriendlyFeedback();
      speakFeedback(message.voice);
      resolveAndAdvance(message.text, "bad", 650);
    }
  };

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } catch { /* fullscreen can be blocked by an embedding browser */ }
  };

  const restart = () => {
    if (screen === "playing" || screen === "practice") {
      if (!window.confirm("Restart this run? Your current score will be lost.")) return;
    }
    beginCountdown(sessionKind);
  };
  const home = () => {
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setScreen("home"); setPaused(false); setRound(null); setFeedback(null); setPhase("waiting");
  };

  const changeLeaderboardScope = (scope: LeaderboardScope) => {
    void refreshLeaderboard(scope);
  };

  const deleteLeaderboardEntry = () => {
    if (!window.confirm("Remove your nickname and leaderboard entry from this competition?")) return;
    if (!competitionApiConfigured) {
      const remainingEntries = leaderboard.filter((entry) => entry.name.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase());
      setLeaderboard(remainingEntries);
      safeWriteBoard(remainingEntries);
      setLeaderboardPosition(null);
      return;
    }
    void deleteSharedLeaderboardEntry()
      .then(() => {
        setLeaderboardPosition(null);
        setLeaderboard([]);
        safeWriteBoard([]);
        return refreshLeaderboard("top10");
      })
      .catch((error) => {
        setLeaderboardStatus("error");
        setLeaderboardError(error instanceof Error ? error.message : "The leaderboard entry could not be removed.");
      });
  };

  return (
    <>
      {screen === "home" && <HomeScreen name={name} setName={setName} onStart={() => beginCountdown("game")} onPractice={() => beginCountdown("practice")} onHelp={() => setShowHelp(true)} onSound={toggleSound} onFullscreen={toggleFullscreen} soundOn={soundOn} leaderboard={leaderboard} leaderboardStatus={leaderboardStatus} leaderboardError={leaderboardError} onLeaderboardRetry={() => void refreshLeaderboard(leaderboardScope)} practiceNotice={practiceNotice} />}
      {screen === "countdown" && <div className="countdown" data-testid="countdown-screen"><div><span className="eyebrow" style={{ display: "block", textAlign: "center", marginBottom: 18 }}>{sessionKind === "practice" ? "practice round" : "your minute starts now"}</span><div className="countdown-number" key={countdown} data-testid="text-countdown">{countdown || "GO"}</div></div></div>}
      {(screen === "playing" || screen === "practice") && <GameScreen round={round} score={score} streak={streak} multiplier={currentMultiplier(streak)} tier={currentTier(streak)} bestStreak={bestStreak} total={total} correct={correct} remaining={remaining} duration={sessionKind === "practice" ? 5 : 60} paused={paused} onPause={() => setPaused((value) => !value)} onRestart={restart} onAnswer={handleAnswer} onHelp={() => setShowHelp(true)} onSound={toggleSound} onFullscreen={toggleFullscreen} soundOn={soundOn} feedback={feedback} lastAnswer={lastAnswer} phase={phase} resolvedCorrect={resolvedCorrect} sessionKind={sessionKind} />}
      {screen === "results" && <ResultsScreen name={name.trim()} score={score} correct={correct} incorrect={incorrect} timeouts={timeouts} total={total} average={average} bestStreak={bestStreak} completedShifts={completedShifts} moments={moments} leaderboardPosition={leaderboardPosition} leaderboard={leaderboard} leaderboardStatus={leaderboardStatus} leaderboardError={leaderboardError} leaderboardScope={leaderboardScope} onLeaderboardRetry={() => void refreshLeaderboard(leaderboardScope)} onLeaderboardScopeChange={changeLeaderboardScope} onDeleteLeaderboardEntry={deleteLeaderboardEntry} onRestart={() => beginCountdown("game")} onHome={home} onHelp={() => setShowHelp(true)} soundOn={soundOn} onSound={toggleSound} onFullscreen={toggleFullscreen} />}
      {showHelp && (
        <HelpModal
          onClose={() => setShowHelp(false)}
          soundOn={soundOn}
          voiceAnnouncementsOn={voiceAnnouncementsOn}
          coachModeOn={coachModeOn}
          onSound={toggleSound}
          onVoiceAnnouncements={toggleVoiceAnnouncements}
          onCoachMode={toggleCoachMode}
        />
      )}
      <AppFooter />
    </>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AppHome} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <div className="arcade-app"><Router /></div>
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;