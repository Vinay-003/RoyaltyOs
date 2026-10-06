# Render Deployment

## Database migrations (automatic)

Set `DATABASE_URL` (Supabase dashboard → Project Settings → Database → connection
string, `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`)
as a Render env var. On every boot the API and worker each run pending
`supabase/migrations/*.sql` files in order under an advisory lock, tracked in
`royaltyos_schema_migrations`; already-applied files are skipped. A failed
migration refuses to boot with the filename in the logs. No manual SQL Editor
runs are needed after this is set (existing dashboard-migrated databases simply
re-run their idempotent files once, then record them).

`render.yaml` is the **free-tier** blueprint: one Node web service in the Singapore
region running the API plus the outbox worker in one process group
(`npm run start:free`, see `scripts/start-free.mjs`). The paid three-service
layout (API + worker + private ClamAV) is kept in `render.paid.yaml`.

Supabase remains the managed PostgreSQL/Auth/Storage provider.

## Free-tier notes and limits

- Free web services **sleep after ~15 minutes without traffic** and cold-start in
  ~30-60s. Inbound PayPal webhooks wake the service; the worker then drains the
  outbox. For Sandbox acceptance this is fine; do not run production money here.
- `NODE_ENV=staging` (not `production`): production fail-closes contract uploads
  without ClamAV, so the free blueprint runs staging with
  `MALWARE_SCAN_MODE=disabled`. Uploads are PDF-validated but not virus-scanned.
- No private ClamAV service and no separate worker exist on free. Before handling
  real money, deploy `render.paid.yaml` instead and complete a security review.

## Before deploying

1. Push this repository to GitHub.
2. Create/migrate the Supabase project first.
3. Create the PayPal Sandbox webhook after the Render URL exists.
4. Create a Render Blueprint from `render.yaml`.
5. Fill every `sync: false` variable in the Render dashboard. Do not put secrets in Git.

Required values include:

```text
APP_BASE_URL=https://YOUR_API.onrender.com
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
OPENAI_API_KEY=...
CORS_ORIGINS=https://YOUR_API.onrender.com
```

Both API and worker require the same provider/database secrets. The API is the only public service. The worker polls Supabase's transactional outbox. ClamAV is private-network only.

## Triggering a deploy

`render.yaml` sets `autoDeploy: false`, so pushing to GitHub does not redeploy
the API. Copy the service deploy hook (Render Dashboard → the API service →
Deploy → Deploy hook) into your local gitignored `.env` as `RENDER_DEPLOY_HOOK`
and trigger it with:

```bash
curl "$RENDER_DEPLOY_HOOK"
```

The response returns the deploy id; the service keeps serving the previous
instance until the new one is healthy, then swaps (typically under a minute).

## First deployment sequence

1. Deploy the Blueprint with PayPal webhook ID temporarily set to a placeholder only if Render requires the field to start.
2. Confirm `GET /api/version` and `GET /api/health`.
3. In PayPal Developer Dashboard, add `https://YOUR_API.onrender.com/api/v1/webhooks/paypal` to the Sandbox REST app.
4. Copy the generated Webhook ID into both relevant Render service environment groups/settings.
5. Restart/redeploy API and worker.
6. Run `npm run smoke:external` locally against the same provider credentials.
7. Execute the full scenario in `PAYPAL_SANDBOX_E2E.md`.

## ClamAV

The application intentionally refuses production contract uploads when malware scanning is not configured. `render.yaml` therefore connects the API and worker configuration to a private `clamav/clamav:stable` service at TCP 3310. If you intentionally remove the private service, contract upload in `NODE_ENV=production` will fail closed.

## Database migrations

Do not run migrations from both the API and worker start commands. Apply them once using Supabase CLI before deployment:

```bash
npx supabase db push --dry-run
npx supabase db push
```
