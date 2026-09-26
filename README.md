# Flash Focus

Flash Focus is a browser-based attention and reaction game inspired by the classic Stroop Effect.

## Live Demo

https://flash-focus-pi.vercel.app

## Objective

Follow each round’s rule cue: choose the INK COLOR or choose the WORD COLOR.

The challenge tests:

- Selective Attention
- Processing Speed
- Cognitive Flexibility
- Reaction Time

## Features

- 60-second timed gameplay
- Dynamic difficulty adjustment
- Speed bonus scoring
- Streak multipliers
- Dynamic 70/30 task switching with no more than four identical rules in a row
- Animated INK COLOR and WORD COLOR indicators
- Independent rule announcements, coach feedback, and sound-effect controls
- Shared Supabase leaderboard across browsers and devices
- Anonymous participant sessions with server-validated score submissions
- Top 10, Top 100, My Rank, This Week, and All Time views
- Offline/local cached cabinet when the shared service is unavailable
- Performance badges
- Educational psychology component

## Educational Background

Flash Focus is based on the Stroop Effect, a famous psychology experiment first published in 1935.

The Stroop Effect demonstrates how automatic word reading competes with color identification, creating cognitive interference that challenges attention and processing speed.

## Technology Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase Anonymous Auth, PostgreSQL, RLS, and Edge Functions
- Vercel-compatible Vite deployment

## Shared competition setup

The browser uses the Supabase publishable key only. Private service credentials stay inside the Edge Function. Do not put a Supabase service-role key in a `VITE_` variable.

1. In the Supabase dashboard, open **Authentication → Providers** for the Flash Focus project and enable **Anonymous Sign-Ins**. The hosted Auth setting cannot be enabled by a SQL migration.
2. Configure these public build variables in local/Vercel environments:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Apply `supabase/migrations/20260922000000_flash_focus_competition.sql`.
4. Deploy `supabase/functions/flash-focus/index.ts` as the `flash-focus` Edge Function with JWT verification enabled.
5. Confirm the Edge Function has its standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` runtime secrets. Never copy the service-role key into the client or repository.

The Edge Function creates a server-recognized session, validates nickname safety, rate-limits session and submission actions, recalculates score from the round event stream, and upserts only a participant’s best result. Public reads return only rank, nickname, score, and best streak. RLS is enabled on all competition tables; the function is the only data path.

## Privacy and operating limits

- Only an anonymous Supabase user ID, a nickname, a score summary, and verification metadata are stored. The app does not collect email, employee number, legal name, phone number, or job data.
- Nicknames and scores are public to anyone with the competition link. Participants can remove their nickname and leaderboard entry from the results screen.
- Anonymous identity is browser/device scoped. Clearing browser storage or switching devices creates a new participant; this is intentional and is not account recovery.
- The score validator checks the submitted answers, timing windows, score formula, session duration, and basic rate limits. Browser games cannot provide perfect anti-cheat guarantees; exceptional submissions are accepted only as unverified and should be reviewed.
- The current organizer workflow is manual: review the stored session/leaderboard records in Supabase, remove entries through the participant control or an authorized operational process, and communicate any competition decision separately. No production approval or official Al-Futtaim sponsorship is implied.
- If Supabase is unavailable or anonymous sign-ins are not enabled, the UI shows an offline state and keeps a temporary local cabinet rather than claiming that a score was shared.

## Disclaimer

For learning and fun only. Scores do not measure intelligence or job performance.

## Author

Mubashshir Ahmed

## Version

1.0
