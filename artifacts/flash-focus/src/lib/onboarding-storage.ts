const BRIEFING_SEEN_KEY = "flash-focus-briefing-seen";
let memoryBriefingSeen = false;

export function readBriefingSeen() {
  try {
    return localStorage.getItem(BRIEFING_SEEN_KEY) === "yes" || memoryBriefingSeen;
  } catch {
    return memoryBriefingSeen;
  }
}

export function writeBriefingSeen(seen: boolean) {
  memoryBriefingSeen = seen;
  try {
    if (seen) localStorage.setItem(BRIEFING_SEEN_KEY, "yes");
    else localStorage.removeItem(BRIEFING_SEEN_KEY);
  } catch {
    // Blocked storage: the in-memory flag keeps the session coherent.
  }
}
