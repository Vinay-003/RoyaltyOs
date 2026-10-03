# RoyaltyOS 1.0.2 — release report

Generated: 2026-10-03T14:12:23.376Z

## Revision

- Version file: `1.0.2`
- Git commit: `3459d38` on branch `main`
- Working tree: 22 uncommitted path(s)

## Migrations

| Migration | Transaction-wrapped | Functions |
| --- | --- | --- |
| `202610030001_royaltyos_v020.sql` | yes | 16 |
| `202610030002_royaltyos_v030_hardening.sql` | yes | 3 |
| `202610030003_royaltyos_v040_ops.sql` | yes | 1 |
| `202610030004_royaltyos_v050_transactions.sql` | yes | 2 |
| `202610030005_royaltyos_v100_release.sql` | yes | 1 |
| `202610030006_royaltyos_v101_hardening.sql` | yes | 3 |
| `202610030007_royaltyos_v102_supabase_compat.sql` | yes | 0 |

## Recorded verification output

| Report | Passed | Failed |
| --- | --- | --- |
| `SHA256SUMS-1.0.1.txt` | 0 | 0 |

## Not verified in this report

Live provider acceptance (Supabase, OpenAI, PayPal, PayPal MCP, Render) requires
operator credentials and a public HTTPS webhook URL. It is never claimed here
unless the corresponding run is recorded above.
