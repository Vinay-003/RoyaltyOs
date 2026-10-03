# Local Setup

## 1. Prerequisites

Install Node.js 22+ and a Docker-compatible runtime. For the full local database/Auth/Storage stack, install the Supabase CLI as a project dependency:

```bash
npm install
npm install supabase --save-dev
```

If this repository does not yet have `supabase/config.toml`, run:

```bash
npx supabase init
```

Do not overwrite the checked-in `supabase/migrations` directory.

## 2. Start Supabase locally

```bash
npx supabase start
npx supabase db reset
```

`db reset` destroys the local development database and then applies every checked-in migration from scratch. Do not run a destructive reset against a production project.

After `supabase start`, copy the local API URL, anon key and service-role key into `.env`.

## 3. Environment

```bash
cp .env.example .env
```

At minimum set:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID
OPENAI_API_KEY
```

For local development, `MALWARE_SCAN_MODE=disabled` is allowed. The application fails closed for contract uploads when `NODE_ENV=production` and ClamAV is not enabled.

## 4. Start RoyaltyOS

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run dev:worker
```

Open `http://localhost:3000`.

## 5. Local provider limitations

PayPal webhooks require a publicly reachable HTTPS URL. To test the real payment lifecycle, deploy the app or expose the local API through a trusted HTTPS tunnel, then register `/api/v1/webhooks/paypal` with the PayPal Sandbox app.

## 6. Clean verification

```bash
npm run verify
```

This runs TypeScript typechecking, migration static checks, all unit/integration/security/financial/AI-red-team tests, and the production TypeScript build.
