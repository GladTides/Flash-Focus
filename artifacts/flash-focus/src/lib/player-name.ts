// Mirrors validateNickname() in supabase/functions/flash-focus/index.ts so the
// client never accepts a name the competition service will reject.
export const PLAYER_NAME_MAX = 18;

export type PlayerNameProblem = "empty" | "tooLong" | "characters" | "personal" | "blocked";

export const PLAYER_NAME_MESSAGES: Record<PlayerNameProblem, string> = {
  empty: "Enter a first name or nickname to continue.",
  tooLong: `Use ${PLAYER_NAME_MAX} characters or fewer.`,
  characters: "Use letters, numbers, spaces, periods, hyphens or apostrophes only.",
  personal: "Use a first name or nickname only, without emails, phone numbers or IDs.",
  blocked: "Choose a different nickname.",
};

export function normalizePlayerName(value: string) {
  return value.normalize("NFKC").trim();
}

export function playerNameProblem(value: string): PlayerNameProblem | null {
  const name = normalizePlayerName(value);
  if (!name) return "empty";
  if (name.length > PLAYER_NAME_MAX) return "tooLong";
  if (/[\u0000-\u001f\u007f]/u.test(name)) return "characters";
  if (!/^[\p{L}\p{N} ._'’-]+$/u.test(name)) return "characters";
  if (/(https?:\/\/|www\.|@|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/iu.test(name)) return "personal";
  if (/(?:\+?\d[\d ()-]{6,}\d)/u.test(name)) return "personal";
  if (/\b(?:employee|emp|staff|worker|associate|id|eid)[-_ ]?\d{4,}\b/iu.test(name)) return "personal";
  if (/\b(?:fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/iu.test(name)) return "blocked";
  return null;
}

export function isSafeParticipantName(value: string) {
  return playerNameProblem(value) === null;
}
