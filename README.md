# Relaycraft

Relaycraft currently supports authentication, mandatory sender onboarding, campaign creation, and CSV recipient import.

## Local setup

1. Create a Supabase project.
2. Run `supabase/migrations/202609220001_phase_one.sql` in the Supabase SQL editor or through the Supabase CLI.
3. Copy `.env.example` to `.env.local` and fill in the project values. Generate `SMTP_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. Add `http://localhost:3000/auth/callback` to the Supabase authentication redirect URLs.
5. Install dependencies with `npm install`, then run `npm run dev`.

## Phase 2 database migration

The campaign and recipient schema is in `supabase/migrations/202609230001_campaigns_and_recipients.sql`. From this repository root, with the Supabase project linked and Phase 1 recorded in migration history, apply pending migrations with:

`npx supabase db push`

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or `SMTP_ENCRYPTION_KEY` to browser code. Rotate both immediately if they are ever logged or committed.
