# Supabase Setup

RoyaltyOS uses Supabase for PostgreSQL, authentication and private contract storage.

## Hosted project

Create a new Supabase project, then from this repository:

```bash
npm install supabase --save-dev
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

The migrations create all domain tables, RLS, immutable-record guards, financial RPCs, the private `royaltyos-contracts` Storage bucket, rate limiting, transactional webhook/outbox functions, audit verification, ledger integrity and v1 reconciliation controls.

After push, verify:

```bash
npm run smoke:external
```

Expected checks:

- `app_versions` includes `1.0.2` (with the `1.0.0`/`1.0.1` records retained)
- contract bucket exists and is private
- PayPal OAuth works
- PayPal Invoicing API is readable
- OpenAI model is accessible

## Credentials

From Supabase project settings/API copy:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Never expose the service-role key in browser code. RoyaltyOS uses the anon key only for Supabase Auth calls and uses the service role from the server after its own authorization checks.

## Storage

Migration `202610030003_royaltyos_v040_ops.sql` creates:

```text
bucket: royaltyos-contracts
public: false
MIME: application/pdf
limit: 10 MiB
```

The browser does not get direct bucket policies. Contract upload bytes pass through the authenticated API, are validated/scanned, then are written using the backend service-role key. Original evidence is exposed only through a five-minute signed URL after authorization.

## Recommended migration discipline

All schema changes belong in `supabase/migrations`. Do not manually modify the hosted schema in the Dashboard after adopting migrations. Before deployment use `db push --dry-run`; in local development use `db reset` to prove the schema can be rebuilt from zero.
