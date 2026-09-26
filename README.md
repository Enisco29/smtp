# Relaycraft

Relaycraft supports authentication, sender onboarding, campaign creation, CSV recipient import, and AI-generated email drafts. Approved emails can be sent individually through Gmail, with persisted delivery monitoring.

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

## Phase 3 database migration and AI setup

The draft and provider-key schema is in `supabase/migrations/202609240001_ai_email_drafts.sql`. From this repository root, with the Supabase project linked and earlier migrations applied, run:

`npx supabase db push`

Set `AI_KEY_ENCRYPTION_KEY` to a **new** 32-byte base64 key (`openssl rand -base64 32`). Keep it stable after saving provider keys; losing or changing it makes existing keys unreadable. Set `OPENAI_MODEL_ID`, `GROQ_MODEL_ID`, `CLAUDE_MODEL_ID`, and `GEMINI_MODEL_ID` to models that support structured JSON output. Users save their provider API keys in Settings and choose one active provider; do not put user keys in environment variables.

Drafts are generated in small browser-driven batches. Closing the page stops new batches; clicking Generate Drafts later resumes pending work and retries failed recipients. Existing successful drafts are not regenerated. Provider calls may incur charges on the user's API account. Replacing a recipient CSV deletes drafts for the previous recipients.

Never prefix `AI_KEY_ENCRYPTION_KEY` or model IDs with `NEXT_PUBLIC_`. Never commit secrets. If an encryption key or service-role key is exposed, rotate it; provider API keys may need to be re-entered.

## Groq provider migration

Apply `supabase/migrations/202609250001_replace_grok_with_groq.sql` with:

`npx supabase db push`

Set `GROQ_MODEL_ID=openai/gpt-oss-20b` on the server (or another model supporting [Groq strict structured outputs](https://console.groq.com/docs/structured-outputs)). Remove the obsolete `GROK_MODEL_ID` variable. Users save a Groq API key in Settings and select Groq as their active provider; no server `GROQ_API_KEY` is required.

This migration permanently deletes saved xAI/Grok keys and clears active Grok selections. It preserves other providers' keys and all generated drafts. Existing xAI keys cannot be reused for Groq; users must enter a new Groq key. Apply the migration before deploying the updated app.


## Phase 4 draft review migration

Draft editing, AI regeneration/refinement, approval, exclusion, restoration, and revision-safe concurrency are added by `supabase/migrations/202609250002_phase4_draft_review.sql`. Apply it after the Groq migration with:

`npx supabase db push`

Phase 4 adds no environment variables. It continues to use `AI_KEY_ENCRYPTION_KEY` and the existing provider model-ID variables. The application never sends provider keys to the browser, and Phase 5 adds Gmail delivery separately.

## Phase 5 SMTP sending

Apply `supabase/migrations/202609250003_smtp_sending.sql` from the linked repository with:

`npx supabase db push`

Optional server-only variables are `SMTP_DAILY_SEND_LIMIT=100` (1–500 attempts per rolling 24 hours), `SMTP_SEND_DELAY_MS=2000` (1,000–10,000 milliseconds), and `SMTP_SEND_BATCH_SIZE=10` (1–10). Existing SMTP encryption and service-role variables remain required. Database claims enforce the configured quota, pacing, and a single in-flight email per account across campaigns. Gmail may impose additional restrictions, including sending performed outside Relaycraft; these local limits cannot measure that usage.

Sending requires explicit confirmation. The campaign sender name and address are frozen on first confirmation; reconnecting accepts only a new App Password for that same address. Account Settings changes do not change a started campaign. Only approved content is sent, as plain text. Sending proceeds while the page is open; saved progress survives closing it, and remaining work can be resumed after confirmation. Every attempt has a 22-second deadline, and new claims stop when insufficient time remains in the 60-second route.

Definitive temporary failures can be explicitly retried once per confirmed retry run. Authentication failures require reconnecting first. Interrupted transmission or an expired claim is marked uncertain and cannot be retried. Finish Campaign closes remaining work without sending or deleting it. All content in delivery states is read-only.

`npm test` includes an isolated PostgreSQL runtime that applies the migrations and validates ownership, claims, quota, retry, and finish transitions. Nodemailer is mocked; tests send no real email. Apply the migration before deploying the updated app.
