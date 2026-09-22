# Relaycraft

Phase 1 of an AI-assisted personalized email sender: Supabase authentication, mandatory sender onboarding, secure Gmail App Password verification, a protected dashboard, and sender settings.

## Local setup

1. Create a Supabase project.
2. Run `supabase/migrations/202609220001_phase_one.sql` in the Supabase SQL editor or through the Supabase CLI.
3. Copy `.env.example` to `.env.local` and fill in the project values. Generate `SMTP_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. Add `http://localhost:3000/auth/callback` to the Supabase authentication redirect URLs.
5. Install dependencies with `npm install`, then run `npm run dev`.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or `SMTP_ENCRYPTION_KEY` to browser code. Rotate both immediately if they are ever logged or committed.
