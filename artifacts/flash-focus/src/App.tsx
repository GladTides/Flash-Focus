import { type CSSProperties, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
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
import { GameDialog } from "@/components/game-dialog";
import { PLAYER_NAME_MAX, PLAYER_NAME_MESSAGES, isSafeParticipantName, normalizePlayerName, playerNameProblem } from "./lib/player-name";
import { withDisplayRanks } from "./lib/leaderboard-rank";
import { readBriefingSeen, writeBriefingSeen } from "./lib/onboarding-storage";
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
type LeaderboardEntry = { rank?: number; name: string; score: number; avg: number; accuracy: number; bestStreak: number; moments: number; date: string };
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
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>flash focus</span>
      </div>
      <div className="top-actions">
        <button className="icon-button" type="button" onClick={onSound} aria-label={soundOn ? "Mute sound" : "Turn on sound"} aria-pressed={soundOn} data-testid="button-sound">
          {soundOn ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
        </button>
        <button className="icon-button" type="button" onClick={onFullscreen} aria-label="Toggle fullscreen" data-testid="button-fullscreen">
          <Maximize2 size={17} aria-hidden="true" />
        </button>
        <button className="quiet-button help-trigger" type="button" onClick={onHelp} aria-haspopup="dialog" data-testid="button-help">
          <CircleHelp size={16} aria-hidden="true" />
          <span>How to play</span>
        </button>
      </div>
    </header>
  );
}

const LEADERBOARD_COPY = {
  loading: "Loading leaderboard",
  error: "The leaderboard couldn’t load right now.",
  offlineEmpty: "The shared leaderboard is unavailable, and no scores are saved on this device yet.",
  offlineCached: "The shared leaderboard is unavailable. Showing scores saved on this device only. These are not added to the shared leaderboard later.",
  empty: "No scores yet. The first run sets the bar.",
  submitFailed: "Your score couldn’t be shared. It is saved on this device only.",
  sessionUnavailable: "The shared leaderboard is unavailable for this run. Your score is saved on this device only.",
  removeFailed: "Your entry couldn’t be removed right now. Please try again.",
} as const;

function Leaderboard({
  entries,
  compact = false,
  status = "ready",
  error,
  scope = "top10",
  onRetry,
  onScopeChange,
  highlightName,
}: {
  entries: LeaderboardEntry[];
  compact?: boolean;
  status?: LeaderboardStatus;
  error?: string;
  scope?: LeaderboardScope;
  onRetry?: () => void;
  onScopeChange?: (scope: LeaderboardScope) => void;
  highlightName?: string;
}) {
  const scopes: Array<{ value: LeaderboardScope; label: string }> = [
    { value: "top10", label: "Top 10" },
    { value: "top100", label: "Top 100" },
    { value: "myRank", label: "My rank" },
    { value: "thisWeek", label: "This week" },
    { value: "allTime", label: "All time" },
  ];
  const rows = withDisplayRanks(compact ? entries.slice(0, 3) : entries);
  const titleId = compact ? "leaderboard-preview-title" : "leaderboard-title";
  const highlight = highlightName?.trim().toLocaleLowerCase();
  return (
    <section className={compact ? "leaderboard-preview" : "leaderboard-full"} aria-labelledby={titleId}>
      <div className="leaderboard-preview-header">
        <div>
          <h2 id={titleId}>Borderless Focus Leaderboard</h2>
          <p className="micro-copy">Who has the sharpest focus at {APP_CONFIG.organizationName}?</p>
        </div>
        {!compact && <Trophy size={17} color="hsl(var(--accent))" aria-hidden="true" />}
      </div>
      {!compact && onScopeChange && (
        <div className="leaderboard-tabs" role="group" aria-label="Leaderboard view">
          {scopes.map((item) => (
            <button
              key={item.value}
              className={scope === item.value ? "leaderboard-tab is-active" : "leaderboard-tab"}
              onClick={() => onScopeChange(item.value)}
              aria-pressed={scope === item.value}
              type="button"
              data-testid={`button-leaderboard-scope-${item.value}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite" className="leaderboard-live">
        {status === "loading" ? (
          <div className="leaderboard-skeleton" data-testid="leaderboard-loading">
            <span className="sr-only">{LEADERBOARD_COPY.loading}</span>
            {[0, 1, 2].map((item) => <i key={item} aria-hidden="true" />)}
          </div>
        ) : status === "error" ? (
          <div className="leaderboard-state">
            <p className="micro-copy" data-testid="leaderboard-error">{error || LEADERBOARD_COPY.error}</p>
            {onRetry && <button className="quiet-button" type="button" onClick={onRetry} data-testid="button-leaderboard-retry">Try again</button>}
          </div>
        ) : status === "offline" && !rows.length ? (
          <div className="leaderboard-state">
            <p className="micro-copy" data-testid="leaderboard-offline">{error || LEADERBOARD_COPY.offlineEmpty}</p>
            {onRetry && <button className="quiet-button" type="button" onClick={onRetry} data-testid="button-leaderboard-retry">Try again</button>}
          </div>
        ) : !rows.length ? (
          <p className="micro-copy leaderboard-state" data-testid="empty-leaderboard">{LEADERBOARD_COPY.empty}</p>
        ) : null}
      </div>
      {status !== "loading" && status !== "error" && rows.length > 0 && (
        <table className={compact ? "leaderboard-table is-compact" : "leaderboard-table"} data-testid={compact ? "leaderboard-preview-table" : "leaderboard-table"}>
          <caption className="sr-only">{status === "offline" ? "Scores saved on this device" : "Shared leaderboard"}</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Score</th>
              {!compact && <th scope="col">Best streak</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, index) => {
              const isPlayer = Boolean(highlight) && entry.name.trim().toLocaleLowerCase() === highlight;
              return (
                <tr
                  key={`${entry.name}-${entry.date}-${index}`}
                  className={[entry.displayRank === 1 ? "is-leader" : "", isPlayer ? "is-player" : ""].join(" ").trim() || undefined}
                  data-testid={compact ? `leaderboard-preview-row-${index}` : `leaderboard-row-${index}`}
                >
                  <td className="rank-cell">
                    {String(entry.displayRank).padStart(2, "0")}
                    {entry.tied && <span className="tie-mark" title="Same score as another player">tie<span className="sr-only">d score</span></span>}
                  </td>
                  <td className="player-cell"><span className="player-name">{entry.name}</span>{isPlayer && <span className="sr-only"> (you)</span>}</td>
                  <td className="score-cell">{entry.score.toLocaleString()}</td>
                  {!compact && <td className="score-cell">{entry.bestStreak}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {status === "offline" && rows.length > 0 && (
        <div className="leaderboard-offline-note">
          <p className="micro-copy" data-testid="leaderboard-offline-note">{LEADERBOARD_COPY.offlineCached}</p>
          {onRetry && <button className="quiet-button" type="button" onClick={onRetry} data-testid="button-leaderboard-reconnect">Try again</button>}
        </div>
      )}
      {!compact && rows.some((entry) => entry.tied) && status === "ready" && (
        <p className="micro-copy leaderboard-tie-note">Equal scores are ordered by best streak, then accuracy, then reaction time.</p>
      )}
    </section>
  );
}

type BriefingMode = "help" | "game" | "practice";

function SettingSwitch({ id, label, detail, enabled, onToggle }: { id: string; label: string; detail: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="setting-row">
      <span>
        <label htmlFor={id} id={`${id}-label`}><strong>{label}</strong></label>
        <small id={`${id}-detail`}>{detail}</small>
      </span>
      <button
        id={id}
        className={enabled ? "setting-toggle is-on" : "setting-toggle"}
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-detail`}
        onClick={onToggle}
        data-testid={`switch-${id}`}
      >
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        <span className="switch-state" aria-hidden="true">{enabled ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

function HelpModal({
  mode,
  inGame,
  onClose,
  onConfirm,
  soundOn,
  voiceAnnouncementsOn,
  coachModeOn,
  onSound,
  onVoiceAnnouncements,
  onCoachMode,
}: {
  mode: BriefingMode;
  inGame: boolean;
  onClose: () => void;
  onConfirm: (skipNextTime: boolean) => void;
  soundOn: boolean;
  voiceAnnouncementsOn: boolean;
  coachModeOn: boolean;
  onSound: () => void;
  onVoiceAnnouncements: () => void;
  onCoachMode: () => void;
}) {
  const [skipNextTime, setSkipNextTime] = useState(true);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirmLabel = mode === "practice" ? "Start practice round" : mode === "game" ? "Got it · Let’s go" : "Got it · Close";
  const confirmResult =
    mode === "practice" ? "Starts a 5-second practice round. It does not count toward the leaderboard." :
    mode === "game" ? "Starts your 60-second challenge after a 3-second countdown." :
    inGame ? "Closes the briefing. Your game stays paused until you resume." :
    "Closes the briefing. Nothing starts until you select Start Game.";
  return (
    <GameDialog labelledBy="help-title" describedBy="help-lede" onEscape={onClose} initialFocusRef={mode === "help" ? undefined : confirmRef} testId="dialog-help">
      <div className="modal-head">
        <div>
          <span className="eyebrow">{mode === "practice" ? "practice round" : "how to play"}</span>
          <h2 id="help-title">{mode === "practice" ? "5-second warm-up" : "Quick briefing"}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={mode === "help" ? "Close briefing" : "Cancel and close briefing"} data-testid="button-close-help"><X size={17} aria-hidden="true" /></button>
      </div>
      <p className="briefing-lede" id="help-lede">Stay sharp. The active rule can change after any round.</p>
      <div className="rule-compare" role="list" aria-label="The two rules">
        <div className="rule-chip is-ink" role="listitem">
          <strong>INK COLOR</strong>
          <span>Choose the color you see.</span>
        </div>
        <div className="rule-chip is-word" role="listitem">
          <strong>WORD COLOR</strong>
          <span>Choose the color the word names.</span>
        </div>
      </div>
      {mode === "practice" ? (
        <p className="practice-brief">Click a color or press its number key. Practice lasts 5 seconds and is never scored or saved.</p>
      ) : (
        <ul className="help-list">
          <li><span className="keycap">1–6</span><span><strong>Choose</strong><small>Click a color or press its number, 1–6.</small></span></li>
          <li><span className="keycap">Switch</span><span><strong>Stay ready</strong><small>The active rule can change after any round.</small></span></li>
          <li><span className="keycap">+50</span><span><strong>Bonus</strong><small>Build a streak of 5 or more, then answer a WORD COLOR round correctly to earn a Borderless Moment.</small></span></li>
          <li><span className="keycap">P</span><span><strong>Pause</strong><small>Press P to pause or resume.</small></span></li>
          <li><span className="keycap">60s</span><span><strong>Go</strong><small>Score as many points as possible in 60 seconds.</small></span></li>
        </ul>
      )}
      {mode !== "practice" && (
        <section className="settings-panel" aria-labelledby="settings-title">
          <span className="eyebrow">settings</span>
          <h3 id="settings-title">Audio &amp; guidance</h3>
          <div className="settings-list">
            <SettingSwitch id="setting-sound" label="Sound effects" detail="Answer sounds and rule-change cues" enabled={soundOn} onToggle={onSound} />
            <SettingSwitch id="setting-voice" label="Voice announcements" detail="Speaks only when the rule changes; the on-screen cue always shows" enabled={voiceAnnouncementsOn} onToggle={onVoiceAnnouncements} />
            <SettingSwitch id="setting-coach" label="Coach mode" detail="Occasional spoken feedback on your answers" enabled={coachModeOn} onToggle={onCoachMode} />
          </div>
          <p className="settings-note">Saved on this device when your browser allows it. Speech depends on browser support.</p>
        </section>
      )}
      <div className="modal-actions modal-actions-stacked">
        {mode === "game" && (
          <label className="skip-check">
            <input type="checkbox" checked={skipNextTime} onChange={(event) => setSkipNextTime(event.target.checked)} data-testid="checkbox-skip-briefing" />
            <span>Skip this briefing next time. It stays under How to play.</span>
          </label>
        )}
        <button ref={confirmRef} className="primary-button" type="button" onClick={() => onConfirm(skipNextTime)} aria-describedby="help-cta-result" data-testid="button-got-it">
          {confirmLabel} <ArrowRight size={16} aria-hidden="true" className="button-icon-end" />
        </button>
        <p className="cta-result" id="help-cta-result">{confirmResult}</p>
      </div>
    </GameDialog>
  );
}

function PracticeCompleteModal({ onStartGame, onPracticeAgain, onClose }: { onStartGame: () => void; onPracticeAgain: () => void; onClose: () => void }) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  return (
    <GameDialog labelledBy="practice-done-title" describedBy="practice-done-copy" onEscape={onClose} initialFocusRef={primaryRef} testId="dialog-practice-complete">
      <div className="modal-head">
        <div>
          <span className="eyebrow">practice round complete</span>
          <h2 id="practice-done-title" data-testid="text-practice-complete">Warm-up done.</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close and return to start" data-testid="button-close-practice"><X size={17} aria-hidden="true" /></button>
      </div>
      <p id="practice-done-copy">That was the feel of it. The full challenge runs for 60 seconds, speeds up as you go, and counts toward the leaderboard.</p>
      <div className="modal-actions">
        <button ref={primaryRef} className="primary-button" type="button" onClick={onStartGame} data-testid="button-start-full-challenge">Start full challenge <ArrowRight size={16} aria-hidden="true" className="button-icon-end" /></button>
        <button className="secondary-button" type="button" onClick={onPracticeAgain} data-testid="button-practice-again"><RotateCcw size={16} aria-hidden="true" className="button-icon-start" /> Practice again</button>
      </div>
    </GameDialog>
  );
}

function HomeScreen({
  name,
  setName,
  nameError,
  nameInputRef,
  onNameBlur,
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
}: {
  name: string;
  setName: (value: string) => void;
  nameError: string | null;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onNameBlur: () => void;
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
}) {
  const count = normalizePlayerName(name).length;
  return (
    <div className="screen-shell">
      <Header onHelp={onHelp} soundOn={soundOn} onSound={onSound} onFullscreen={onFullscreen} />
      <main className="landing-grid">
        <section className="hero-copy" aria-labelledby="hero-title">
          <span className="eyebrow">Borderless Arcade / 01</span>
          <h1 className="display" id="hero-title">FLASH <em>FOCUS</em></h1>
          <p className="tagline">Different signals. One clear decision.</p>
          <p className="hero-support">Follow the active rule, filter competing signals, and adapt when the rule changes.</p>
          <ul className="fact-row" aria-label="Challenge facts">
            <li><b>60s</b> challenge</li>
            <li><b>1–6</b> keys or tap</li>
            <li><b>Rules</b> switch</li>
          </ul>
          <p className="rule-line">
            Follow the rule cue. Choose the <span className="rule-word is-ink">INK COLOR</span> or the <span className="rule-word is-word">WORD COLOR</span>. <strong className="rule-alert">The active rule can change after any round.</strong>
          </p>
          <form className="name-form" noValidate onSubmit={(event) => { event.preventDefault(); onStart(); }}>
            <div className="name-label-row">
              <label htmlFor="player-name">Player name</label>
              <span className={count > PLAYER_NAME_MAX ? "name-count is-over" : "name-count"} aria-hidden="true">{count}/{PLAYER_NAME_MAX}</span>
            </div>
            <div className="name-controls">
              <input
                ref={nameInputRef}
                id="player-name"
                className="name-input"
                autoComplete="nickname"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={onNameBlur}
                placeholder="First name or nickname"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "player-name-error player-name-help" : "player-name-help"}
                data-testid="input-player-name"
              />
              <button className="primary-button" type="submit" data-testid="button-start-game">START GAME <ArrowRight size={17} aria-hidden="true" className="button-icon-end" /></button>
            </div>
            <p className="field-error" id="player-name-error" role="alert" data-testid="text-name-error">{nameError ?? ""}</p>
            <p className="name-note" id="player-name-help">Use a first name or nickname only. Up to {PLAYER_NAME_MAX} characters.</p>
          </form>
          <p className="page-disclaimer start-disclaimer">{APP_DISCLAIMER}</p>
          <section className="practice-block" aria-labelledby="practice-title">
            <div>
              <h2 id="practice-title">New to Flash Focus?</h2>
              <p>Try a 5-second practice round before starting. It is not scored.</p>
            </div>
            <button className="secondary-button practice-button" type="button" onClick={onPractice} data-testid="button-practice"><Eye size={16} aria-hidden="true" /> Practice round · 5 seconds</button>
          </section>
          <section className="about-card" aria-labelledby="about-flash-focus-title">
            <span className="eyebrow">the thinking behind the game</span>
            <h2 id="about-flash-focus-title">About Flash Focus</h2>
            <p>Flash Focus is inspired by the Stroop Effect, a classic demonstration of how competing information can affect attention and response selection. The game turns that idea into a fast-paced color-matching challenge. It is for fun, not a measure of ability.</p>
          </section>
          <Leaderboard entries={leaderboard} compact status={leaderboardStatus} error={leaderboardError} onRetry={onLeaderboardRetry} />
        </section>
        <aside className="hero-stamp" aria-label="Game preview: the word BLUE shown in red ink">
          <div className="stamp-header"><span>signal / response</span><span className="stamp-live">live</span></div>
          <div className="signal-card">
            <span className="sample-word" aria-hidden="true">BLUE</span>
          </div>
          <div className="stamp-footer">
            <span className="stamp-caption"><b className="is-ink">INK</b> red <span aria-hidden="true">/</span> <b className="is-word">WORD</b> blue</span>
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
  dialogOpen,
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
  dialogOpen: boolean;
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
          <button className="icon-button" onClick={onHelp} aria-label="How to play (pauses the game)" aria-haspopup="dialog" data-testid="button-game-help"><CircleHelp size={17} /></button>
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
      {paused && !dialogOpen && (
        <GameDialog labelledBy="paused-title" describedBy="paused-copy" onEscape={onPause} className="modal modal-center" testId="dialog-paused">
          <span className="eyebrow">game paused</span>
          <h2 id="paused-title">Hold that thought.</h2>
          <p id="paused-copy">{document.hidden ? "The game paused because this tab was hidden." : "The clock is stopped. Resume when you’re ready, or press P."}</p>
          <div className="modal-actions modal-actions-center">
            <button className="primary-button" type="button" onClick={onPause} data-testid="button-resume"><Play size={16} aria-hidden="true" className="button-icon-start" /> Resume</button>
            <button className="secondary-button" type="button" onClick={onRestart} data-testid="button-restart"><RotateCcw size={16} aria-hidden="true" className="button-icon-start" /> Restart</button>
          </div>
        </GameDialog>
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
          <p className="results-lede">Sixty seconds, done. No labels, no verdicts. Just how you read the signals when they crossed.</p>
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
            <button className="quiet-button" type="button" onClick={onDeleteLeaderboardEntry} data-testid="button-remove-entry">Remove my leaderboard entry</button>
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
            <div className="result-metric"><strong data-testid="text-result-rank">{leaderboardPosition ? `#${leaderboardPosition}` : "—"}</strong><span>your rank{leaderboardStatus === "offline" ? " (this device)" : ""}</span></div>
          </div>
          <Leaderboard
            entries={leaderboard}
            status={leaderboardStatus}
            error={leaderboardError}
            scope={leaderboardScope}
            onRetry={onLeaderboardRetry}
            onScopeChange={onLeaderboardScopeChange}
            highlightName={name}
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
      Flash Focus v1.0 · Developed by Mubashshir Ahmed
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
  const [modal, setModal] = useState<null | "help" | "game-briefing" | "practice-briefing" | "practice-complete">(null);
  const [nameAttempted, setNameAttempted] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastLaunchAt = useRef(0);
  const [soundOn, setSoundOn] = useState(false);
  const [voiceAnnouncementsOn, setVoiceAnnouncementsOn] = useState(true);
  const [coachModeOn, setCoachModeOn] = useState(false);
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

  // No silent truncation: overlong input stays visible and gets an adjacent error.
  const setName = (value: string) => setNameState(value);
  const nameProblem = playerNameProblem(name);
  const nameError = nameProblem && (nameAttempted || nameProblem === "tooLong" || (name.trim() !== "" && nameProblem !== "empty")) ? PLAYER_NAME_MESSAGES[nameProblem] : null;
  const focusNameField = () => { window.setTimeout(() => nameInputRef.current?.focus(), 0); };

  const refreshLeaderboard = useCallback(async (scope: LeaderboardScope) => {
    setLeaderboardScope(scope);
    setLeaderboardStatus("loading");
    setLeaderboardError("");
    if (!competitionApiConfigured) {
      setLeaderboard(safeReadBoard());
      setLeaderboardStatus("offline");
      setLeaderboardError("");
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
        rank: entry.rank,
      })));
      setLeaderboardPosition(result.myRank);
      setLeaderboardStatus("ready");
    } catch {
      // Raw service errors are never shown to players.
      setLeaderboard(safeReadBoard());
      setLeaderboardStatus("offline");
      setLeaderboardError("");
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
    // Guard against double clicks / repeated Enter launching two sessions.
    const now = Date.now();
    if (screen === "countdown" || now - lastLaunchAt.current < 800) return;
    const cleanName = name.trim();
    if (kind === "game" && !isSafeParticipantName(cleanName)) return;
    lastLaunchAt.current = now;
    if (kind === "game") setNameState(cleanName);
    setModal(null);
    setSessionKind(kind); setPaused(false); ending.current = false;
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
    if (kind === "game") { try { localStorage.setItem(NAME_KEY, cleanName); } catch { /* optional */ } }
  };

  const requestGame = () => {
    setNameAttempted(true);
    if (playerNameProblem(name)) { setModal(null); focusNameField(); return; }
    if (readBriefingSeen()) beginCountdown("game");
    else setModal("game-briefing");
  };

  const requestPractice = () => setModal("practice-briefing");

  const openHelp = () => {
    if (screen === "playing" || screen === "practice") setPaused(true);
    setModal("help");
  };

  const confirmBriefing = (skipNextTime: boolean) => {
    if (modal === "game-briefing") {
      writeBriefingSeen(skipNextTime);
      beginCountdown("game");
    } else if (modal === "practice-briefing") {
      beginCountdown("practice");
    } else {
      setModal(null);
    }
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
      setScreen("home"); setRound(null); setModal("practice-complete"); return;
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
    const ranked = withDisplayRanks(updated);
    const mine = ranked.find((item) => item.name.trim().toLocaleLowerCase() === normalized);
    setLeaderboardPosition(mine ? mine.displayRank : null);
    setLeaderboard(updated);
    safeWriteBoard(updated);
    setScreen("results");
    setRound(null);
    const attempts = roundAttempts.current.slice();
    const pendingSession = secureSessionPromise.current;
    if (pendingSession && competitionApiConfigured) {
      void pendingSession.then(async (sessionId) => {
        if (!sessionId) {
          setLeaderboardStatus("offline");
          setLeaderboardError(LEADERBOARD_COPY.sessionUnavailable);
          return;
        }
        try {
          await submitSecureScore({ sessionId, score, rounds: attempts });
        } catch {
          setLeaderboardStatus("offline");
          setLeaderboardError(LEADERBOARD_COPY.submitFailed);
          return;
        }
        await refreshLeaderboard("top10");
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
      // Dialogs own Escape/Tab; no game keys fire behind the briefing.
      if (modal) return;
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
    setScreen("home"); setPaused(false); setRound(null); setFeedback(null); setPhase("waiting"); setModal(null);
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
      .catch(() => {
        setLeaderboardStatus("error");
        setLeaderboardError(LEADERBOARD_COPY.removeFailed);
      });
  };

  return (
    <>
      {screen === "home" && <HomeScreen name={name} setName={setName} nameError={nameError} nameInputRef={nameInputRef} onNameBlur={() => { if (name.trim()) setNameAttempted(true); }} onStart={requestGame} onPractice={requestPractice} onHelp={openHelp} onSound={toggleSound} onFullscreen={toggleFullscreen} soundOn={soundOn} leaderboard={leaderboard} leaderboardStatus={leaderboardStatus} leaderboardError={leaderboardError} onLeaderboardRetry={() => void refreshLeaderboard(leaderboardScope)} />}
      {screen === "countdown" && <div className="countdown" data-testid="countdown-screen"><div><span className="eyebrow" style={{ display: "block", textAlign: "center", marginBottom: 18 }}>{sessionKind === "practice" ? "practice round" : "your minute starts now"}</span><div className="countdown-number" key={countdown} data-testid="text-countdown">{countdown || "GO"}</div></div></div>}
      {(screen === "playing" || screen === "practice") && <GameScreen round={round} score={score} streak={streak} multiplier={currentMultiplier(streak)} tier={currentTier(streak)} bestStreak={bestStreak} total={total} correct={correct} remaining={remaining} duration={sessionKind === "practice" ? 5 : 60} paused={paused} onPause={() => setPaused((value) => !value)} onRestart={restart} onAnswer={handleAnswer} onHelp={openHelp} onSound={toggleSound} onFullscreen={toggleFullscreen} soundOn={soundOn} feedback={feedback} lastAnswer={lastAnswer} phase={phase} resolvedCorrect={resolvedCorrect} sessionKind={sessionKind} dialogOpen={modal !== null} />}
      {screen === "results" && <ResultsScreen name={name.trim()} score={score} correct={correct} incorrect={incorrect} timeouts={timeouts} total={total} average={average} bestStreak={bestStreak} completedShifts={completedShifts} moments={moments} leaderboardPosition={leaderboardPosition} leaderboard={leaderboard} leaderboardStatus={leaderboardStatus} leaderboardError={leaderboardError} leaderboardScope={leaderboardScope} onLeaderboardRetry={() => void refreshLeaderboard(leaderboardScope)} onLeaderboardScopeChange={changeLeaderboardScope} onDeleteLeaderboardEntry={deleteLeaderboardEntry} onRestart={() => beginCountdown("game")} onHome={home} onHelp={openHelp} soundOn={soundOn} onSound={toggleSound} onFullscreen={toggleFullscreen} />}
      {(modal === "help" || modal === "game-briefing" || modal === "practice-briefing") && (
        <HelpModal
          key={modal}
          mode={modal === "game-briefing" ? "game" : modal === "practice-briefing" ? "practice" : "help"}
          inGame={screen === "playing" || screen === "practice"}
          onConfirm={confirmBriefing}
          onClose={() => setModal(null)}
          soundOn={soundOn}
          voiceAnnouncementsOn={voiceAnnouncementsOn}
          coachModeOn={coachModeOn}
          onSound={toggleSound}
          onVoiceAnnouncements={toggleVoiceAnnouncements}
          onCoachMode={toggleCoachMode}
        />
      )}
      {modal === "practice-complete" && (
        <PracticeCompleteModal
          onStartGame={requestGame}
          onPracticeAgain={() => { lastLaunchAt.current = 0; beginCountdown("practice"); }}
          onClose={() => setModal(null)}
        />
      )}
      {screen !== "playing" && screen !== "practice" && screen !== "countdown" && <AppFooter />}
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