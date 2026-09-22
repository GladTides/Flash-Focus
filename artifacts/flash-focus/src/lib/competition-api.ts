export type LeaderboardScope = "top10" | "top100" | "myRank" | "thisWeek" | "allTime";

export type PublicLeaderboardEntry = {
  rank: number;
  nickname: string;
  score: number;
  bestStreak: number;
};

export type RoundAttemptPayload = {
  word: string;
  color: string;
  shifted: boolean;
  answer: string | null;
  timedOut: boolean;
  reactionMs: number | null;
  windowMs: number;
};

export type LeaderboardResponse = {
  entries: PublicLeaderboardEntry[];
  myRank: number | null;
  scope: LeaderboardScope;
};

export type SecureSession = {
  sessionId: string;
  serverStartedAt: string;
  competition: string;
};

type StoredAnonymousSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const ANONYMOUS_SESSION_KEY = "flash-focus-anonymous-session";

export const competitionApiConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

function readStoredSession(): StoredAnonymousSession | null {
  try {
    const raw = localStorage.getItem(ANONYMOUS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAnonymousSession>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || typeof parsed.expiresAt !== "number") return null;
    return parsed as StoredAnonymousSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredAnonymousSession) {
  try {
    localStorage.setItem(ANONYMOUS_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Offline/private browsing fallback is handled by the caller.
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(ANONYMOUS_SESSION_KEY);
  } catch {
    // Storage may be blocked.
  }
}

async function parseResponse<T>(result: Response): Promise<T> {
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    const message = typeof body?.error === "string" ? body.error : typeof body?.msg === "string" ? body.msg : "The competition service is unavailable.";
    throw new Error(message);
  }
  return body as T;
}

async function createAnonymousSession(): Promise<StoredAnonymousSession> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("The competition service is not configured.");
  const result = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await parseResponse<{ access_token?: string; refresh_token?: string; expires_in?: number }>(result);
  if (!body.access_token || !body.refresh_token) throw new Error("Anonymous participation could not be started.");
  const session = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  writeStoredSession(session);
  return session;
}

async function refreshAnonymousSession(session: StoredAnonymousSession): Promise<StoredAnonymousSession> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("The competition service is not configured.");
  const result = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  const body = await parseResponse<{ access_token?: string; refresh_token?: string; expires_in?: number }>(result);
  if (!body.access_token || !body.refresh_token) throw new Error("Anonymous participation could not be restored.");
  const refreshed = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  writeStoredSession(refreshed);
  return refreshed;
}

async function getAnonymousSession(forceRefresh = false) {
  const stored = readStoredSession();
  if (!forceRefresh && stored && stored.expiresAt > Date.now() + 30_000) return stored;
  if (stored?.refreshToken) {
    try {
      return await refreshAnonymousSession(stored);
    } catch {
      clearStoredSession();
    }
  }
  return createAnonymousSession();
}

async function callCompetition<T>(action: string, body: Record<string, unknown>, retry = true): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("The competition service is not configured.");
  const session = await getAnonymousSession();
  const result = await fetch(`${SUPABASE_URL}/functions/v1/flash-focus`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
  });
  if (result.status === 401 && retry) {
    clearStoredSession();
    return callCompetition<T>(action, body, false);
  }
  return parseResponse<T>(result);
}

export function startSecureSession(nickname: string) {
  return callCompetition<SecureSession>("start-session", { nickname });
}

export function submitSecureScore(payload: {
  sessionId: string;
  score: number;
  rounds: RoundAttemptPayload[];
}) {
  return callCompetition<{ ok: boolean; score: number; verified: boolean }>("submit-score", payload);
}

export function loadSharedLeaderboard(scope: LeaderboardScope = "top10") {
  return callCompetition<LeaderboardResponse>("leaderboard", { scope });
}

export function deleteSharedLeaderboardEntry() {
  return callCompetition<{ ok: boolean }>("delete-entry", {});
}