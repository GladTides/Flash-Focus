---
name: Flash Focus ranking authority
description: Shared leaderboard ranks and tie-break decisions are authoritative on the hosted competition function.
---

The hosted Flash Focus competition function identifies a participant by Supabase user ID within a competition, retains the best performance, and orders scores by score, best streak, accuracy, then average reaction time. Its `myRank` response is the canonical shared rank.

**Why:** The hosted function is not part of the workspace source, and the app also has a local offline board. Computing a shared rank from local entries can show an incorrect placement.

**How to apply:** In results UI, use `myRank` only after a successful leaderboard response. Keep local or offline rank explicitly labeled as device-only.