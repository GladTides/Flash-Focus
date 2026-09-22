import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COMPETITION_SLUG = "flash-focus-2026";
const MAX_NICKNAME_LENGTH = 18;
const COLORS = new Set(["RED", "BLUE", "GREEN", "YELLOW", "ORANGE", "PURPLE"]);
const ALLOWED_SCOPES = new Set(["top10", "top100", "myRank", "thisWeek", "allTime"]);
const recentActions = new Map<string, number[]>();

type RoundAttempt = {
  word: string;
  color: string;
  shifted: boolean;
  answer: string | null;
  timedOut: boolean;
  reactionMs: number | null;
  windowMs: number;
};

type LeaderboardRow = {
  user_id: string;
  nickname: string;
  best_score: number;
  best_streak: number;
  best_accuracy: number;
  best_average_reaction_ms: number;
  games_played: number;
  verified: boolean;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function errorResponse(message: string, status = 400) {
  return response({ error: message }, status);
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_ROLE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`);
  headers.set("Content-Type", "application/json");
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await result.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!result.ok) throw new Error(typeof body === "object" && body && "message" in body ? String(body.message) : "Database request failed");
  return body;
}

async function getUserId(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Authentication required");
  const result = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: authorization },
  });
  if (!result.ok) throw new Error("Authentication required");
  const user = await result.json();
  if (typeof user?.id !== "string") throw new Error("Authentication required");
  return user.id as string;
}

function checkRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (recentActions.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  recentActions.set(key, recent);
  return true;
}

function validateNickname(value: unknown) {
  if (typeof value !== "string") return null;
  const nickname = value.normalize("NFKC").trim();
  if (!nickname || nickname.length > MAX_NICKNAME_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/u.test(nickname)) return null;
  if (!/^[\p{L}\p{N} ._'’-]+$/u.test(nickname)) return null;
  if (/(https?:\/\/|www\.|@|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/iu.test(nickname)) return null;
  if (/(?:\+?\d[\d ()-]{6,}\d)/u.test(nickname)) return null;
  if (/\b(?:employee|emp|staff|worker|associate|id|eid)[-_ ]?\d{4,}\b/iu.test(nickname)) return null;
  if (/\b(?:fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/iu.test(nickname)) return null;
  return nickname;
}

async function getCompetition() {
  const rows = await supabaseFetch(`competitions?slug=eq.${encodeURIComponent(COMPETITION_SLUG)}&is_open=eq.true&select=id,slug,name&limit=1`) as Array<{ id: string; slug: string; name: string }>;
  return rows[0] ?? null;
}

function multiplier(streak: number) {
  if (streak >= 20) return 3;
  if (streak >= 15) return 2.5;
  if (streak >= 10) return 2;
  if (streak >= 5) return 1.5;
  return 1;
}

function isBetter(candidate: { score: number; streak: number; accuracy: number; average: number }, current: LeaderboardRow) {
  return candidate.score > current.best_score
    || (candidate.score === current.best_score && candidate.streak > current.best_streak)
    || (candidate.score === current.best_score && candidate.streak === current.best_streak && candidate.accuracy > Number(current.best_accuracy))
    || (candidate.score === current.best_score && candidate.streak === current.best_streak && candidate.accuracy === Number(current.best_accuracy) && candidate.average < current.best_average_reaction_ms);
}

function sortedRows(rows: LeaderboardRow[]) {
  return [...rows].sort((a, b) =>
    b.best_score - a.best_score
    || b.best_streak - a.best_streak
    || Number(b.best_accuracy) - Number(a.best_accuracy)
    || a.best_average_reaction_ms - b.best_average_reaction_ms
    || a.nickname.localeCompare(b.nickname),
  );
}

function publicEntry(row: LeaderboardRow, rank: number) {
  return { rank, nickname: row.nickname, score: row.best_score, bestStreak: row.best_streak };
}

async function startSession(userId: string, body: Record<string, unknown>) {
  const nickname = validateNickname(body.nickname);
  if (!nickname) return errorResponse("Use a nickname or first name only, up to 18 characters.", 422);
  const competition = await getCompetition();
  if (!competition) return errorResponse("This competition is currently closed.", 409);
  if (!checkRateLimit(`start:${userId}`, 10, 10 * 60_000)) return errorResponse("Too many sessions started. Please try again later.", 429);

  await supabaseFetch("participant_profiles?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, nickname, updated_at: new Date().toISOString() }),
  });
  const sessions = await supabaseFetch("game_sessions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userId, competition_id: competition.id }),
  }) as Array<{ id: string; started_at: string }>;
  const session = sessions[0];
  if (!session) return errorResponse("Could not start a secure game session.", 503);
  return response({ sessionId: session.id, serverStartedAt: session.started_at, competition: competition.slug });
}

function parseRounds(value: unknown): RoundAttempt[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 180) return null;
  const rounds: RoundAttempt[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const input = item as Record<string, unknown>;
    const word = typeof input.word === "string" ? input.word : "";
    const color = typeof input.color === "string" ? input.color : "";
    const shifted = input.shifted === true;
    const timedOut = input.timedOut === true;
    const answer = input.answer === null || typeof input.answer === "string" ? input.answer as string | null : null;
    const reactionMs = input.reactionMs === null || typeof input.reactionMs === "number" ? input.reactionMs as number | null : null;
    const windowMs = typeof input.windowMs === "number" ? input.windowMs : 0;
    if (!COLORS.has(word) || !COLORS.has(color) || !COLORS.has(answer ?? color)) return null;
    if (!Number.isFinite(windowMs) || windowMs < 1500 || windowMs > 3200) return null;
    if (!timedOut && (!Number.isFinite(reactionMs) || reactionMs === null || reactionMs < 0 || reactionMs > windowMs)) return null;
    rounds.push({ word, color, shifted, answer, timedOut, reactionMs, windowMs });
  }
  return rounds;
}

function calculateScore(rounds: RoundAttempt[]) {
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let correct = 0;
  let reactionTotal = 0;
  let suspicious = false;
  for (const round of rounds) {
    const expected = round.shifted ? round.word : round.color;
    const isCorrect = !round.timedOut && round.answer === expected;
    if (!isCorrect || round.reactionMs === null) {
      streak = 0;
      continue;
    }
    const speedBonus = Math.max(0, Math.min(15, Math.round(15 * (1 - round.reactionMs / round.windowMs))));
    const borderlessMoment = round.shifted && streak >= 5;
    score += Math.round((10 + speedBonus) * multiplier(streak)) + (borderlessMoment ? 50 : 0);
    correct += 1;
    reactionTotal += round.reactionMs;
    streak += 1;
    bestStreak = Math.max(bestStreak, streak);
    if (round.reactionMs < 35) suspicious = true;
  }
  const average = correct ? Math.round(reactionTotal / correct) : 0;
  return { score, bestStreak, correct, average, accuracy: Math.round((correct / rounds.length) * 100), suspicious };
}

async function submitScore(userId: string, body: Record<string, unknown>) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const rounds = parseRounds(body.rounds);
  const submittedScore = typeof body.score === "number" ? body.score : -1;
  if (!sessionId || !rounds || !Number.isInteger(submittedScore)) return errorResponse("Malformed score submission.", 422);
  if (!checkRateLimit(`submit:${userId}`, 5, 10 * 60_000)) return errorResponse("Too many score submissions. Please try again later.", 429);
  const sessions = await supabaseFetch(`game_sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,competition_id,started_at,status,submitted_at&limit=1`) as Array<{ id: string; competition_id: string; started_at: string; status: string; submitted_at: string | null }>;
  const session = sessions[0];
  if (!session || session.status !== "pending" || session.submitted_at) return errorResponse("This game session is invalid or was already submitted.", 409);
  const durationMs = Date.now() - new Date(session.started_at).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 45_000 || durationMs > 180_000) return errorResponse("This game session duration could not be verified.", 422);
  const result = calculateScore(rounds);
  if (result.score !== submittedScore) return errorResponse("The submitted score did not match the recorded answers.", 422);
  const exceptional = result.suspicious || rounds.length > 100 || durationMs < 52_000 || durationMs > 90_000 || result.score > 3_000;
  const verified = !exceptional;
  const now = new Date().toISOString();
  await supabaseFetch(`game_sessions?id=eq.${encodeURIComponent(session.id)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ submitted_at: now, duration_ms: durationMs, status: "submitted", score: result.score, best_streak: result.bestStreak, accuracy: result.accuracy, average_reaction_ms: result.average, verified }),
  });
  const existingRows = await supabaseFetch(`leaderboard_entries?user_id=eq.${encodeURIComponent(userId)}&competition_id=eq.${encodeURIComponent(session.competition_id)}&select=*`) as LeaderboardRow[];
  const existing = existingRows[0];
  const profileRows = await supabaseFetch(`participant_profiles?user_id=eq.${encodeURIComponent(userId)}&select=nickname&limit=1`) as Array<{ nickname: string }>;
  const nickname = profileRows[0]?.nickname ?? "Player";
  const candidate = { score: result.score, streak: result.bestStreak, accuracy: result.accuracy, average: result.average };
  if (!existing) {
    await supabaseFetch("leaderboard_entries", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: userId, competition_id: session.competition_id, nickname, best_score: result.score, best_streak: result.bestStreak, best_accuracy: result.accuracy, best_average_reaction_ms: result.average, games_played: 1, verified }),
    });
  } else {
    const update = isBetter(candidate, existing) ? { nickname, best_score: result.score, best_streak: result.bestStreak, best_accuracy: result.accuracy, best_average_reaction_ms: result.average, verified: existing.verified && verified } : { verified: existing.verified && verified };
    await supabaseFetch(`leaderboard_entries?user_id=eq.${encodeURIComponent(userId)}&competition_id=eq.${encodeURIComponent(session.competition_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...update, games_played: existing.games_played + 1, updated_at: now }),
    });
  }
  return response({ ok: true, score: result.score, verified });
}

async function leaderboard(userId: string, body: Record<string, unknown>) {
  const scope = typeof body.scope === "string" && ALLOWED_SCOPES.has(body.scope) ? body.scope : "top10";
  const competition = await getCompetition();
  if (!competition) return response({ entries: [], myRank: null, scope });
  const weekFilter = scope === "thisWeek" ? `&updated_at=gte.${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}` : "";
  const rows = await supabaseFetch(`leaderboard_entries?competition_id=eq.${encodeURIComponent(competition.id)}${weekFilter}&select=user_id,nickname,best_score,best_streak,best_accuracy,best_average_reaction_ms,verified&order=best_score.desc,best_streak.desc,best_accuracy.desc,best_average_reaction_ms.asc`) as LeaderboardRow[];
  const sorted = sortedRows(rows);
  const myRankIndex = sorted.findIndex((row) => row.user_id === userId);
  const limit = scope === "top100" || scope === "allTime" || scope === "thisWeek" ? 100 : 10;
  const entries = scope === "myRank" ? (myRankIndex >= 0 ? [publicEntry(sorted[myRankIndex], myRankIndex + 1)] : []) : sorted.slice(0, limit).map((row, index) => publicEntry(row, index + 1));
  return response({ entries, myRank: myRankIndex >= 0 ? myRankIndex + 1 : null, scope });
}

async function deleteEntry(userId: string) {
  const competition = await getCompetition();
  if (!competition) return response({ ok: true });
  await supabaseFetch(`leaderboard_entries?user_id=eq.${encodeURIComponent(userId)}&competition_id=eq.${encodeURIComponent(competition.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await supabaseFetch(`participant_profiles?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return response({ ok: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return response({ ok: true });
  if (request.method !== "POST") return errorResponse("Method not allowed.", 405);
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return errorResponse("Supabase function is not configured.", 503);
    const userId = await getUserId(request);
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "start-session": return await startSession(userId, body);
      case "submit-score": return await submitScore(userId, body);
      case "leaderboard": return await leaderboard(userId, body);
      case "delete-entry": return await deleteEntry(userId);
      default: return errorResponse("Unknown action.", 400);
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unexpected server error.", 500);
  }
});