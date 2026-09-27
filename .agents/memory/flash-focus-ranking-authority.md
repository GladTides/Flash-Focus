---
name: Flash Focus ranking authority
description: Shared leaderboard ranks and tie-break decisions are authoritative on the hosted competition function.
---

For Flash Focus, secure sessions remain tied to anonymous Supabase user IDs, but leaderboard identity is the normalized nickname within a competition. Matching nicknames intentionally merge, even across accounts.

**Why:** The user chose a clean competition leaderboard with one visible position per normalized nickname, accepting that identical names merge across accounts. The hosted query must keep the winning performance and existing score, streak, accuracy, reaction-time tie-break order.

**How to apply:** Keep auth and session validation account-based, but resolve leaderboard rank and removal by normalized nickname. Use the hosted `myRank` response for shared rank; keep local/offline ranks labeled as device-only.