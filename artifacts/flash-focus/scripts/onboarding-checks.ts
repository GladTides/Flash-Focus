// Run: node --experimental-strip-types scripts/onboarding-checks.ts
import assert from "node:assert/strict";
import { PLAYER_NAME_MAX, playerNameProblem } from "../src/lib/player-name.ts";
import { withDisplayRanks } from "../src/lib/leaderboard-rank.ts";
import { readBriefingSeen, writeBriefingSeen } from "../src/lib/onboarding-storage.ts";

assert.equal(PLAYER_NAME_MAX, 18, "must match backend MAX_NICKNAME_LENGTH");
assert.equal(playerNameProblem(""), "empty");
assert.equal(playerNameProblem("   "), "empty");
assert.equal(playerNameProblem("Maya"), null);
assert.equal(playerNameProblem("  Maya  "), null, "trimmed");
assert.equal(playerNameProblem("a".repeat(18)), null);
assert.equal(playerNameProblem("a".repeat(19)), "tooLong", "overlong is reported, not truncated");
assert.equal(playerNameProblem("سارة"), null, "Arabic");
assert.equal(playerNameProblem("李明"), null, "CJK");
assert.equal(playerNameProblem("Zoë O’Neil"), null);
assert.equal(playerNameProblem("<script>"), "characters");
assert.equal(playerNameProblem("me@example.com"), "characters");
assert.equal(playerNameProblem("emp 12345"), "personal");
assert.equal(playerNameProblem("050 123 4567"), "personal");

const server = withDisplayRanks([{ score: 900, rank: 1 }, { score: 900, rank: 2 }, { score: 700, rank: 3 }]);
assert.deepEqual(server.map((r) => r.displayRank), [1, 2, 3], "server rank preserved");
assert.deepEqual(server.map((r) => r.tied), [true, true, false]);
const myRank = withDisplayRanks([{ score: 400, rank: 57 }]);
assert.equal(myRank[0].displayRank, 57, "My rank scope keeps absolute rank");
assert.deepEqual(withDisplayRanks([{ score: 5 }, { score: 3 }]).map((r) => r.displayRank), [1, 2]);

// No localStorage in node: memory fallback must still work.
assert.equal(readBriefingSeen(), false);
writeBriefingSeen(true);
assert.equal(readBriefingSeen(), true);
writeBriefingSeen(false);
assert.equal(readBriefingSeen(), false);

console.log("onboarding checks passed");
