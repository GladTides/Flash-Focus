# Flash Focus: onboarding and clarity review

Scope: landing page, name entry, Quick Briefing, practice flow, pause/help interplay, leaderboard states and footer. Game scoring, timing, round payload, rule sequencing, sounds, settings persistence, APIs, Supabase config and backend are **unchanged**.

## Files
- `src/App.tsx`: incremental edits (Header, Leaderboard, HelpModal, HomeScreen, pause dialog, AppHome flow state).
- `src/components/game-dialog.tsx` (new): portal modal with focus trap, Escape, focus restore, `inert` on `#root`.
- `src/lib/player-name.ts` (new): client copy of the backend `validateNickname` rules (18 max, same regex) with a specific reason for each rejection.
- `src/lib/leaderboard-rank.ts` (new): keeps the server rank and flags equal-score ties.
- `src/lib/onboarding-storage.ts` (new): "briefing seen" flag in localStorage, with an in-memory fallback.
- `src/index.css`: tokens, new classes, footer no longer fixed, 44px targets, responsive fixes.
- `scripts/onboarding-checks.ts` (new): `node --experimental-strip-types scripts/onboarding-checks.ts`.

## Verified mechanics (source of truth: App.tsx and the edge function)
- Full game lasts 60s. Practice lasts 5s. Both start with a 3-second countdown.
- Answer keys 1–6 match the numbered buttons (4–6 options are shown).
- Bonus: streak of 5 or more before a correct WORD COLOR answer gives +50.
- P pauses and resumes. R restarts after a confirmation.
- Practice never calls `startSecureSession` or `submitSecureScore`, and never writes to the local board.
- The server ranks by `best_score desc, best_streak desc, best_accuracy desc, avg_reaction asc`. The server's `rank` is now shown as-is and no longer replaced by the row index. The `myRank` scope keeps its absolute rank.
- There is **no automatic sync**. If a submission fails, that score is kept on this device only. The copy now says this.

## Before / after copy
| Location | Before | After |
|---|---|---|
| Hero | "A Borderless Thinking Challenge" / "See clearly. Think quickly. Adapt instantly." / long Al-Futtaim paragraph | Tagline "Different signals. One clear decision." plus "Follow the active rule, filter competing signals, and adapt when the rule changes." plus facts: 60s challenge · 1–6 keys or tap · Rules switch |
| Rule line | "Follow the rule cue: choose the INK COLOR or the WORD COLOR. Stay ready — it can switch after any round." + duplicate tagline | "Follow the rule cue. Choose the INK COLOR or the WORD COLOR. **The active rule can change after any round.**" |
| Placeholder | "Enter your name" | "First name or nickname" |
| Helper | "Use a nickname or first name only." | "Use a first name or nickname only. Up to 18 characters." |
| Invalid name | Start button silently disabled | Adjacent error with focus moved to the field: "Enter a first name or nickname to continue." / "Use 18 characters or fewer." / "Use letters, numbers, spaces, periods, hyphens or apostrophes only." / "Use a first name or nickname only, without emails, phone numbers or IDs." / "Choose a different nickname." |
| Practice | "5-SECOND PRACTICE ROUND" + "Skip practice by selecting START GAME." | Block: "NEW TO FLASH FOCUS?" / "Try a 5-second practice round before starting. It is not scored." / "PRACTICE ROUND · 5 SECONDS" |
| Practice done | inline "Practice complete. You’re ready." | Dialog "Warm-up done." with **Start full challenge** (primary) and Practice again |
| About | "...classic psychology experiment demonstrating how automatic word reading competes..." | "...a classic demonstration of how competing information can affect attention and response selection... It is for fun, not a measure of ability." |
| Briefing lede | "Stay sharp. The rule can change any round." | "Stay sharp. The active rule can change after any round." plus INK COLOR / WORD COLOR comparison chips |
| Briefing CTA | "GOT IT — LET’S GO" (only closed) | Depends on how the briefing was opened: "Got it · Let’s go" (starts the 60s challenge), "Start practice round", "Got it · Close" (help only). Each has a result line underneath. |
| Pause | "Your minute is safe..." | "The clock is stopped. Resume when you’re ready, or press P." |
| Leaderboard offline | "Showing this device’s cached cabinet while the shared service reconnects." / "Scores will remain on this device until it reconnects." | "The shared leaderboard is unavailable. Showing scores saved on this device only. These are not added to the shared leaderboard later." |
| Leaderboard errors | raw `error.message` from the service | Fixed friendly strings only |
| Results rank | "leaderboard position" (row index) | "your rank" (server rank; "(this device)" when offline) |
| Footer | "Flash Focus v1.0 \| Developed by Mubashshir Ahmed" (fixed bar) | "Flash Focus v1.0 · Developed by Mubashshir Ahmed" (static, hidden during play) |

## Flows
- **First time:** name → Start Game → full Quick Briefing (settings, "Skip this briefing next time" checked by default) → "Got it · Let’s go" → countdown.
- **Returning:** Start Game → countdown. How to play is still in the header.
- **Practice:** no name needed → minimal briefing → 5s → completion dialog. Start full challenge checks the name, focuses the field if it is invalid, and shows the full briefing if it hasn't been seen.
- **Help during play:** pauses first. Closing it leaves the game paused and the pause dialog appears. Game keys are blocked while any dialog is open.
- **Duplicate launch guard:** repeat launches are ignored while in countdown or within 800ms.

## Acceptance checklist — final review
**Pass** means checked through source, automated checks or browser evidence as appropriate. **Partial** identifies limits; it is not a compliance claim.

| Area | Acceptance criteria | Result |
|---|---|---|
| Visual | Preserve identity; consistent tokens/spacing; balanced desktop; clear mobile; secondary preview | Pass — source and desktop/mobile screenshots |
| Brand | Consistent primary tagline; non-corporate tone; factual/non-diagnostic Stroop explanation; terminology | Pass — copy review |
| Usability | Obvious primary action; secondary practice; practice purpose; no developer-style helper text | Pass — copy and visual review |
| Usability | Understandable name errors; first-time and returning flows | Pass — browser empty/overlong/Arabic input, confirm and same-origin reload |
| Onboarding | Distinguishable INK/WORD; switching explained; accurate controls, bonus, pause and duration | Pass — source comparison and browser pause/resume |
| Onboarding | Unambiguous briefing result; practice completion next step | Pass — browser start, practice replay and full-challenge handoff |
| Leaderboard | Rank/player/score presentation; long names and ties | Partial — implemented, rank/tie unit checks pass; populated-state visual browser checks not performed |
| Leaderboard | Loading, empty, offline, cached and error states | Partial — all implemented; offline empty state observed; reconnection/populated states unverified |
| Leaderboard | No technical backend copy; practice cannot pollute scores | Pass — source review and practice checks; no scored game submitted |
| Accessibility | Keyboard use; visible focus; modal management | Pass for tested onboarding — trap, wrap, Escape, focus restoration and pause/resume |
| Accessibility | Named controls; programmatic switch state | Pass — source and browser checks |
| Accessibility | Text/control contrast meets WCAG 2.2 AA | Partial — sampled browser ratios approximately 6.97–16.88; exhaustive text/non-text audit outstanding |
| Accessibility | Reduced-motion support | Pass — emulated reduce; modal/overlay computed durations 0.000001s |
| Accessibility | Appropriate status announcements | Partial — alert/status semantics implemented; native screen-reader audit not performed |
| Accessibility | Usable at 200% zoom | Partial — CSS zoom stress test only, not native browser zoom certification |
| Responsive | No 320px horizontal scroll; no clipped hero; mobile modal; usable CTAs | Pass in tested Chromium viewports, including 320px; targets standardized to 44px |
| Responsive | Readable populated leaderboard | Pending — no populated-state browser fixture used |
| Responsive | Desktop without excessive dead space | Pass — preview moved up, hierarchy tightened, screenshot reviewed |
| Technical | No console errors | Partial — no final-pass JS exceptions; external HTTP 500 resource error remains |
| Technical | No broken game functions | Partial — start, pause/resume and practice verified; unchanged scoring path not submitted end-to-end |
| Technical | No duplicate submissions/launches | Partial — launch guard and single countdown verified; live score-submission path untested |
| Technical | Timer/listener cleanup; offline fallback; no internal details/secrets exposed; no dependencies added | Pass — source/build review and offline browser state |
| Final | Proofread copy; mechanics match instructions; coherent product; validated not asserted | Pass with the explicit limits above |

### Browser verification
- Chromium: 320, 375, 390, 768, 1024, 1280 and 1440px landing reflow.
- Empty and 24-character nickname errors retain input and focus the field; Arabic nickname accepted.
- Keyboard switches, dialog Tab/Shift+Tab wrapping, Escape and trigger-focus restoration.
- First-time confirmation starts one countdown; stored briefing preference survives same-origin reload and skips the next briefing. Cancelling a briefing intentionally does not mark it seen.
- Help pauses gameplay; closing opens the paused state; P resumes.
- Practice with no name, completion, replay, and handoff to named full challenge.
- Reduced-motion media emulation.
- No real scored session completed or submitted. Shared service errors remain visible only as friendly offline UI.

## Regression checks
`scripts/onboarding-checks.ts` covers: name rules including the 18-character limit, no truncation, and Arabic/CJK names; server rank preservation and tie flags; the briefing-seen memory fallback. Typecheck passes.

## Limitations
- No WCAG compliance claim is made. Exhaustive contrast, native screen-reader and true 200% browser zoom checks still need a manual audit. Safari, Firefox, Edge and physical mobile browsers were not tested.
- Names that need combining marks after NFKC (for example some Devanagari or Thai vowel signs) are rejected, because the backend regex has no `\p{M}`. The client matches the backend on purpose. Widening this needs a backend change.
- Shared auth was previously blocked externally. This pass observed an HTTP 500 and offline UI; it did not establish the precise failing endpoint or verify a live score submission.
- The preview card is still static. Motion was left out deliberately to keep the focus on clarity.
- Restart still uses `window.confirm`.
- Leaderboard view buttons were raised to the same 44px target as the other controls.
