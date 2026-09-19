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

type Screen = "home" | "countdown" | "practice" | "playing" | "results";
type SessionKind = "practice" | "game";
type Feedback = { text: string; kind: "good" | "bad" | "neutral" };
type Round = { word: ColorName; color: ColorName; options: ColorName[]; shifted: boolean; promptAt: number; deadline: number };
type LeaderboardEntry = { name: string; score: number; avg: number; accuracy: number; bestStreak: number; moments: number; date: string };
type ColorName = "RED" | "BLUE" | "GREEN" | "YELLOW" | "ORANGE" | "PURPLE";

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

function safeReadBoard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.name === "string" && typeof entry.score === "number")
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
  return Math.max(700, 1700 - Math.min(500, elapsed * 4 + score / 30 + streak * 7));
}

function randomRound(shifted: boolean, elapsed = 0, score = 0, streak = 0): Round {
  const word = randomColor();
  const matches = Math.random() < 0.3;
  const color = matches ? word : randomColor(word);
  const optionCount = Math.min(6, 4 + Math.floor(Math.min(2, elapsed / 20)));
  const distractors = COLOR_NAMES.filter((item) => item !== (shifted ? word : color)).sort(() => Math.random() - 0.5);
  const correct = shifted ? word : color;
  const options = [correct, ...distractors.slice(0, optionCount - 1)].sort(() => Math.random() - 0.5);
  const promptAt = Date.now();
  return { word, color, options, shifted, promptAt, deadline: promptAt + answerWindow(elapsed, score, streak) };
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

function Leaderboard({ entries, compact = false }: { entries: LeaderboardEntry[]; compact?: boolean }) {
  return (
    <section className={compact ? "leaderboard-preview" : "result-card"} aria-labelledby={compact ? "leaderboard-preview-title" : "leaderboard-title"}>
      <div className="leaderboard-preview-header">
        <h2 id={compact ? "leaderboard-preview-title" : "leaderboard-title"}>Top 10 / Borderless Arcade</h2>
        {!compact && <Trophy size={17} color="hsl(var(--accent))" />}
      </div>
      {entries.length ? (
        compact ? (
          <ol>
            {entries.slice(0, 3).map((entry, index) => (
              <li key={`${entry.name}-${entry.date}-${index}`} data-testid={`leaderboard-preview-row-${index}`}>
                <span>{index + 1}. {entry.name}</span><strong>{entry.score.toLocaleString()}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <table className="leaderboard-table" data-testid="leaderboard-table">
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.name}-${entry.date}-${index}`} data-testid={`leaderboard-row-${index}`}>
                  <td>{String(index + 1).padStart(2, "0")} &nbsp; {entry.name}</td>
                  <td>{entry.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <p className="micro-copy" data-testid="empty-leaderboard">The cabinet is waiting for its first score.</p>
      )}
    </section>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" data-testid="dialog-help">
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
          <div>
            <span className="eyebrow">quick briefing</span>
            <h2 id="help-title">Cut through the noise.</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close help" data-testid="button-close-help"><X size={17} /></button>
        </div>
        <p>Signals compete. Your job is simple: respond to the color in the ink, not the word it spells.</p>
        <ul className="help-list">
          <li><span className="keycap">1—6</span><span>Choose a color with your keyboard, or tap a color button.</span></li>
          <li><span className="keycap">P</span><span>Pause or resume at any time. The cabinet also pauses if you leave the tab.</span></li>
          <li><span className="keycap">SHIFT</span><span>Every 15 seconds, one round asks you to follow the word instead.</span></li>
          <li><span className="keycap">60s</span><span>The real session is one focused minute. Practice is separate and never scored.</span></li>
        </ul>
        <div className="modal-actions">
          <button className="primary-button" onClick={onClose} data-testid="button-got-it">Got it <ArrowRight size={16} style={{ verticalAlign: "middle", marginLeft: 6 }} /></button>
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
  practiceNotice: boolean;
}) {
  return (
    <div className="screen-shell">
      <Header onHelp={onHelp} soundOn={soundOn} onSound={onSound} onFullscreen={onFullscreen} />
      <main className="landing-grid">
        <section className="hero-copy">
          <span className="eyebrow">Borderless Arcade / 01</span>
          <h1 className="display">Make the<br /><em>clear</em> call.</h1>
          <p>A fast focus challenge for the moments when signals compete. One minute. Six colors. No room for the word to get in the way.</p>
          <div className="rule-line">Tap the COLOR you see — not the word you read.</div>
          <form className="name-form" onSubmit={(event) => { event.preventDefault(); onStart(); }}>
            <label htmlFor="player-name" className="sr-only">Your name</label>
            <input id="player-name" className="name-input" maxLength={24} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" data-testid="input-player-name" />
            <button className="primary-button" type="submit" disabled={!name.trim()} data-testid="button-start-game">Start the minute <ArrowRight size={17} style={{ verticalAlign: "middle", marginLeft: 7 }} /></button>
          </form>
          <div className="micro-copy">
            <button className="quiet-button" type="button" onClick={onPractice} data-testid="button-practice"><Eye size={15} /> Try a 5-second practice</button>
            {practiceNotice && <span style={{ marginLeft: 12, color: "hsl(var(--secondary))" }} data-testid="text-practice-complete">Practice complete. You’re ready.</span>}
          </div>
          <div className="leaderboard-preview">
            <div className="leaderboard-preview-header">
              <h2>Top 10 / Borderless Arcade</h2>
              <span className="eyebrow">local cabinet</span>
            </div>
            {leaderboard.length ? (
              <ol>
                {leaderboard.slice(0, 3).map((entry, index) => (
                  <li key={`${entry.name}-${entry.date}-${index}`} data-testid={`home-leaderboard-row-${index}`}><span>{String(index + 1).padStart(2, "0")} &nbsp; {entry.name}</span><strong>{entry.score.toLocaleString()}</strong></li>
                ))}
              </ol>
            ) : <p className="micro-copy">The cabinet is waiting for its first score.</p>}
          </div>
        </section>
        <aside className="hero-stamp" aria-label="Flash Focus game preview">
          <div className="stamp-header"><span>signal / response</span><span className="stamp-live">live</span></div>
          <div className="signal-card">
            <span className="sample-word">MINT</span>
          </div>
          <div className="stamp-footer">
            <span>read the color, not the word</span>
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
  banner,
  feedback,
  lastAnswer,
  sessionKind,
}: {
  round: Round | null;
  score: number;
  streak: number;
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
  banner: boolean;
  feedback: Feedback | null;
  lastAnswer: "good" | "bad" | null;
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
          <div><span className="stat-label">Streak</span><strong className="stat-value" data-testid="text-streak">{streak}×</strong></div>
          <div><span className="stat-label">Accuracy</span><strong className="stat-value" data-testid="text-accuracy">{accuracy}%</strong></div>
          <div className="timer-wrap"><span className="stat-label">Time remaining</span><strong className="stat-value" data-testid="text-time-remaining">{Math.ceil(remaining)}s</strong><div className="timer-track"><div className="timer-fill" style={{ transform: `scaleX(${percentage})` }} /></div></div>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={onPause} aria-label={paused ? "Resume game" : "Pause game"} data-testid="button-pause">{paused ? <Play size={17} /> : <Pause size={17} />}</button>
          <button className="icon-button" onClick={onSound} aria-label={soundOn ? "Mute sound" : "Turn on sound"} data-testid="button-game-sound">{soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
          <button className="icon-button" onClick={onFullscreen} aria-label="Toggle fullscreen" data-testid="button-game-fullscreen"><Maximize2 size={17} /></button>
          <button className="icon-button" onClick={onHelp} aria-label="Open help" data-testid="button-game-help"><CircleHelp size={17} /></button>
        </div>
      </div>
      <main className="game-body">
        <section className="round-panel" aria-live="polite">
          <div className="round-meta">
            <span className="round-counter" data-testid="text-round-counter">{sessionKind === "practice" ? "practice / 05 seconds" : `round ${String(total + 1).padStart(2, "0")}`}</span>
            {round?.shifted && <span className="shift-pill" data-testid="badge-shift">shifted round</span>}
          </div>
          <div className={`challenge-card ${lastAnswer === "good" ? "is-correct" : lastAnswer === "bad" ? "is-wrong" : ""}`} data-testid="challenge-card">
            {round && <span className="challenge-word" style={{ color: `hsl(${COLORS[round.color].css})` }} data-testid="text-challenge-word">{COLORS[round.word].label.toUpperCase()}</span>}
          </div>
          <p className="answer-copy">{round?.shifted ? "SHIFT: tap the word you see." : "Tap the color you see."}</p>
          <div className="answer-grid" role="group" aria-label="Color answers">
            {COLOR_NAMES.map((color, index) => (
              <button key={color} className="answer-button" style={{ "--answer-color": COLORS[color].css } as CSSProperties} onClick={() => onAnswer(color)} data-testid={`button-answer-${color.toLowerCase()}`} aria-label={`Answer ${COLORS[color].label}`}>
                <span className="answer-swatch" aria-hidden="true" />{index + 1}. {COLORS[color].label}
              </button>
            ))}
          </div>
          <div className="streak-line" data-testid="text-best-streak">{streak > 1 ? `${streak} in a row · ${bestStreak} best` : bestStreak > 2 ? `${bestStreak} best streak` : "\u00a0"}</div>
          {sessionKind === "practice" && <p className="pause-note">Practice does not count toward your score.</p>}
        </section>
      </main>
      {banner && <div className="shift-banner" data-testid="banner-shift"><strong>Borderless Shift</strong><span>For the next round, follow the word instead.</span></div>}
      {feedback && <div className="toast-feedback" key={`${feedback.text}-${Date.now()}`} data-testid="text-feedback">{feedback.text}</div>}
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
  total,
  average,
  bestStreak,
  leaderboard,
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
  total: number;
  average: number;
  bestStreak: number;
  leaderboard: LeaderboardEntry[];
  onRestart: () => void;
  onHome: () => void;
  onHelp: () => void;
  soundOn: boolean;
  onSound: () => void;
  onFullscreen: () => void;
}) {
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const title = score >= 5000 ? "Signal sharp." : score >= 2800 ? "Good read." : "First signal.";
  return (
    <div className="screen-shell">
      <Header onHelp={onHelp} soundOn={soundOn} onSound={onSound} onFullscreen={onFullscreen} />
      <main className="results-layout">
        <section>
          <span className="eyebrow">session complete / {name}</span>
          <h1 className="display">{title}<br /><em>Stay curious.</em></h1>
          <p className="results-lede">One minute on the cabinet. No claims, no labels — just the read you made when the signals crossed.</p>
          <div className="score-hero"><span className="score-number" data-testid="text-final-score">{score.toLocaleString()}</span><span className="score-label">points<br />final score</span></div>
          <div className="results-actions">
            <button className="primary-button" onClick={onRestart} data-testid="button-play-again">Play again <RotateCcw size={16} style={{ verticalAlign: "middle", marginLeft: 7 }} /></button>
            <button className="secondary-button" onClick={onHome} data-testid="button-back-home"><ArrowLeft size={16} style={{ verticalAlign: "middle", marginRight: 7 }} /> Back to start</button>
          </div>
        </section>
        <aside className="result-card">
          <h2>your readout</h2>
          <div className="result-grid">
            <div className="result-metric"><strong data-testid="text-result-accuracy">{accuracy}%</strong><span>accuracy</span></div>
            <div className="result-metric"><strong data-testid="text-result-average">{formatAverage(average)}</strong><span>average reaction</span></div>
            <div className="result-metric"><strong data-testid="text-result-correct">{correct}/{total}</strong><span>correct calls</span></div>
            <div className="result-metric"><strong data-testid="text-result-streak">{bestStreak}×</strong><span>best streak</span></div>
          </div>
          <Leaderboard entries={leaderboard} />
        </aside>
      </main>
    </div>
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
  const [reactionTimes, setReactionTimes] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<"good" | "bad" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [practiceNotice, setPracticeNotice] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [average, setAverage] = useState(0);
  const sessionStartedAt = useRef(0);
  const shiftPending = useRef(false);
  const lastShiftMark = useRef(0);
  const ending = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);

  const setName = (value: string) => setNameState(value.replace(/[^\p{L}\p{N} ._'’-]/gu, "").slice(0, 24));

  useEffect(() => {
    try {
      setNameState(localStorage.getItem(NAME_KEY) || "");
    } catch { /* unavailable storage */ }
    setLeaderboard(safeReadBoard());
  }, []);

  useEffect(() => {
    const locked = screen === "playing" || screen === "practice" || screen === "countdown";
    document.body.style.overflow = locked ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [screen]);

  const playTone = useCallback((kind: "good" | "bad" | "start" | "shift") => {
    if (!soundOn) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      if (!audioContext.current) audioContext.current = new AudioContextCtor();
      const context = audioContext.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "bad" ? "square" : "sine";
      oscillator.frequency.value = kind === "good" ? 640 : kind === "shift" ? 310 : kind === "start" ? 460 : 150;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(kind === "bad" ? 0.025 : 0.045, context.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (kind === "shift" ? 0.24 : 0.13));
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + (kind === "shift" ? 0.25 : 0.14));
    } catch { /* audio permission or browser support failure */ }
  }, [soundOn]);

  const beginCountdown = (kind: SessionKind) => {
    setSessionKind(kind); setPracticeNotice(false); setPaused(false); ending.current = false;
    setCountdown(3); setScreen("countdown"); playTone("start");
    setScore(0); setStreak(0); setBestStreak(0); setTotal(0); setCorrect(0); setReactionTimes([]);
    setRemaining(kind === "practice" ? 5 : 60); setRound(null); setLastAnswer(null); setFeedback(null);
    shiftPending.current = false; lastShiftMark.current = 0;
    try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 24)); } catch { /* optional */ }
  };

  useEffect(() => {
    if (screen !== "countdown") return;
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          sessionStartedAt.current = Date.now();
          setRemaining(sessionKind === "practice" ? 5 : 60);
          setRound(randomRound(false));
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
    if (sessionKind === "practice") {
      setScreen("home"); setPracticeNotice(true); setRound(null); return;
    }
    const avg = reactionTimes.length ? reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length : 0;
    setAverage(avg);
    const entry: LeaderboardEntry = { name: name.trim() || "Guest", score, avg, date: new Date().toISOString() };
    const updated = [...leaderboard, entry].sort((a, b) => b.score - a.score || a.avg - b.avg).slice(0, 10);
    setLeaderboard(updated); safeWriteBoard(updated); setScreen("results"); setRound(null);
  }, [leaderboard, name, reactionTimes, score, sessionKind]);

  useEffect(() => {
    if (screen !== "playing" && screen !== "practice") return;
    if (paused) return;
    const duration = sessionKind === "practice" ? 5 : 60;
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - sessionStartedAt.current) / 1000;
      const next = Math.max(0, duration - elapsed);
      setRemaining(next);
      if (sessionKind === "game") {
        const mark = Math.floor(elapsed / 15) * 15;
        if (mark >= 15 && mark <= 45 && mark > lastShiftMark.current) {
          lastShiftMark.current = mark; shiftPending.current = true; setBanner(true); playTone("shift");
          window.setTimeout(() => setBanner(false), 2000);
        }
      }
      if (elapsed >= duration) finishSession();
    }, 80);
    return () => window.clearInterval(timer);
  }, [finishSession, paused, playTone, screen, sessionKind]);

  useEffect(() => {
    if (screen !== "playing" && screen !== "practice") return;
    const pauseIfAway = () => {
      if (!paused) setPaused(true);
    };
    const onVisibility = () => { if (document.hidden) pauseIfAway(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", pauseIfAway);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("blur", pauseIfAway); };
  }, [paused, screen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (showHelp) { if (event.key === "Escape") setShowHelp(false); return; }
      if ((screen === "playing" || screen === "practice") && !paused) {
        if (event.key.toLowerCase() === "p") { setPaused(true); return; }
        const index = Number(event.key) - 1;
        if (index >= 0 && index < COLOR_NAMES.length) handleAnswer(COLOR_NAMES[index]);
      } else if ((screen === "playing" || screen === "practice") && paused && event.key.toLowerCase() === "p") {
        setPaused(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleAnswer = (answer: ColorName) => {
    if (!round || paused || (screen !== "playing" && screen !== "practice")) return;
    const reaction = Math.max(0, Date.now() - round.promptAt);
    const expected = round.shifted ? round.word : round.color;
    const isCorrect = answer === expected;
    setLastAnswer(isCorrect ? "good" : "bad");
    window.setTimeout(() => setLastAnswer(null), 180);
    if (sessionKind === "practice") {
      setFeedback({ text: isCorrect ? `${Math.round(reaction)} ms · correct` : "Not quite — follow the ink.", kind: isCorrect ? "good" : "bad" });
      playTone(isCorrect ? "good" : "bad");
      setRound(randomRound(false));
      return;
    }
    setTotal((value) => value + 1); setReactionTimes((values) => [...values, reaction]);
    if (isCorrect) {
      const nextStreak = streak + 1;
      const speedBonus = Math.max(0, Math.round(180 - reaction * 0.42));
      const multiplier = 1 + Math.min(nextStreak - 1, 10) * 0.1;
      const shiftBonus = round.shifted ? 250 : 0;
      const earned = Math.round((100 + speedBonus) * multiplier) + shiftBonus;
      setScore((value) => value + earned); setCorrect((value) => value + 1); setStreak(nextStreak); setBestStreak((value) => Math.max(value, nextStreak));
      setFeedback({ text: round.shifted ? `Borderless Moment  +${earned}` : `+${earned}  ·  ${Math.round(reaction)} ms`, kind: "good" });
      playTone("good");
    } else {
      setStreak(0); setFeedback({ text: "Missed signal  ·  streak reset", kind: "bad" }); playTone("bad");
    }
    setRound(randomRound(shiftPending.current));
    shiftPending.current = false;
  };

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } catch { /* fullscreen can be blocked by an embedding browser */ }
  };

  const restart = () => beginCountdown(sessionKind);
  const home = () => { setScreen("home"); setPaused(false); setRound(null); setFeedback(null); };

  return (
    <>
      {screen === "home" && <HomeScreen name={name} setName={setName} onStart={() => beginCountdown("game")} onPractice={() => beginCountdown("practice")} onHelp={() => setShowHelp(true)} onSound={() => setSoundOn((value) => !value)} onFullscreen={toggleFullscreen} soundOn={soundOn} leaderboard={leaderboard} practiceNotice={practiceNotice} />}
      {screen === "countdown" && <div className="countdown" data-testid="countdown-screen"><div><span className="eyebrow" style={{ display: "block", textAlign: "center", marginBottom: 18 }}>{sessionKind === "practice" ? "practice round" : "your minute starts now"}</span><div className="countdown-number" key={countdown} data-testid="text-countdown">{countdown || "GO"}</div></div></div>}
      {(screen === "playing" || screen === "practice") && <GameScreen round={round} score={score} streak={streak} bestStreak={bestStreak} total={total} correct={correct} remaining={remaining} duration={sessionKind === "practice" ? 5 : 60} paused={paused} onPause={() => setPaused((value) => !value)} onRestart={restart} onAnswer={handleAnswer} onHelp={() => setShowHelp(true)} onSound={() => setSoundOn((value) => !value)} onFullscreen={toggleFullscreen} soundOn={soundOn} banner={banner} feedback={feedback} lastAnswer={lastAnswer} sessionKind={sessionKind} />}
      {screen === "results" && <ResultsScreen name={name.trim() || "Guest"} score={score} correct={correct} total={total} average={average} bestStreak={bestStreak} leaderboard={leaderboard} onRestart={() => beginCountdown("game")} onHome={home} onHelp={() => setShowHelp(true)} soundOn={soundOn} onSound={() => setSoundOn((value) => !value)} onFullscreen={toggleFullscreen} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
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