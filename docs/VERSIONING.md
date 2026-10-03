# Versioning and Change Discipline

RoyaltyOS uses semantic release versions for the implementation and immutable version numbers inside the financial domain.

## Application version

The single release number is kept in:

- `VERSION`
- `package.json`
- `.env.example` / `APP_VERSION`
- `CHANGELOG.md`
- `app_versions` migration record
- Render Blueprint

Current release: `1.0.1`.

## Domain versioning

Application release version is separate from financial records:

- Contract versions increment per immutable PDF upload.
- Active RuleSets increment per approved compiled interpretation.
- Every settlement stores the exact RuleSet hash and `algorithm_version`.
- Payout retry creates a new `payout_version`; it never overwrites successful payout history.

## Release process

1. Make code/schema change.
2. Add a timestamped forward-only migration if persistent state changes.
3. Update tests.
4. Run `npm run verify`.
5. Run local `npx supabase db reset` or remote-dev `db push --dry-run` + `db push`.
6. Run external smoke/E2E when providers are involved.
7. Update `VERSION`, package version and `CHANGELOG.md`.
8. Update the canonical architecture/project record when architecture, PayPal integration, AI provider/model, financial rule types, security boundary or scope materially changes.
9. Tag Git release only after checks pass.

Do not edit an old migration that has already been deployed. Add a new migration.
