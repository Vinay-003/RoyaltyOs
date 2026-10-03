# Render Deployment

`render.yaml` provisions three services in the Singapore region:

1. `royaltyos-api` - public Node web/API service
2. `royaltyos-worker` - background outbox/reconciliation worker
3. `royaltyos-clamav` - private ClamAV service for production contract uploads

Supabase remains the managed PostgreSQL/Auth/Storage provider.

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
