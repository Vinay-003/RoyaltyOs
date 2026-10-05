# RoyaltyOS — Master Plan (living document)

> How this file works: each feature is planned in full BEFORE any code is
> written. Discussion happens here first (append under Discussion Log);
> building happens once, at the end, when everything is agreed.
> Status legend: `PROPOSED` → `AGREED` → `BUILDING` → `DONE`.

## Agreed build order (proposed: A → C → B, awaiting confirmation)

---

## A. Settlement manual correction — status: PROPOSED

**Problem:** a human spots a wrong-but-valid settlement (all invariants pass, numbers
still wrong vs. the real deal). Today the only recourse is void + start over,
which loses the reviewer's intent. There must be a way to correct with full
traceability, such that a fake entry can never slip in.

**Scope rule (load-bearing): corrections only on `APPROVAL_REQUIRED`
settlements.** Money hasn't moved, so a correction is a re-proposal, never a
rewrite. Post-payout corrections are reversals — explicitly out of scope v1.

**Core model: correct = void + recalculate-with-overrides in one audited
action.** Frozen lines are never edited.

### Flow

1. FINANCE user clicks **Correct** on an `APPROVAL_REQUIRED` settlement →
   editable lines table prefilled from current lines (amount + payable per
   line) with a **live sum indicator that must equal distributable** (submit
   stays disabled otherwise) + mandatory reason (≥ 20 chars).
2. Submit creates a `settlement_corrections` row (`PENDING`) + audit
   `SETTLEMENT_CORRECTION_PROPOSED`. The original settlement is untouched.
3. A **different** FINANCE user reviews a side-by-side diff (old vs new,
   per-line deltas highlighted) → Apply or Reject.
4. Apply voids the old (reason-linked) and commits the new lines through the
   **existing commit RPC** — sum-check, ledger balance, beneficiary registry
   and recoupment guards all re-validate automatically. The new settlement
   returns to `APPROVAL_REQUIRED`; the normal approve flow continues.

### Fake-entry protection (the whole point)

1. FINANCE-only + step-up on propose AND apply.
2. Mandatory reason (≥ 20 chars, stored, shown in audit).
3. **Four-eyes**: proposer can never apply (enforced in the route, tested).
4. Full before/after diff in UI — no blind edits.
5. Original stays visible as VOIDED (nothing deleted, ever).
6. Fresh settlement hash + audit rows for propose/apply/reject.
7. Commit RPC re-validates everything (sum == distributable, beneficiary
   registry, ledger balance, no over-recoupment).
8. Attempted corrections of already-executed settlements are rejected
   (only `APPROVAL_REQUIRED` is correctable).

### Build checklist

- [ ] Migration `012`: `settlement_corrections` table
      (`id`, `workspace_id` FK cascade, `settlement_id` FK cascade,
      `proposed_lines` JSONB, `reason` text NOT NULL, `status`
      `PENDING/APPLIED/REJECTED`, `proposed_by`, `decided_by`,
      `decided_at`, `created_at`). RLS: service-role only (v101 pattern).
      No new RPCs — reuse void/commit/append-audit.
- [ ] Routes in `apps/api/routes/finance.ts`:
      `POST /api/v1/settlements/:id/corrections` (propose, FINANCE + step-up),
      `GET` list for a settlement (read roles),
      `POST /api/v1/corrections/:id/apply` (FINANCE + step-up + four-eyes),
      `POST /api/v1/corrections/:id/reject` (FINANCE + step-up).
- [ ] Frontend (`apps/web/public/js/pages/settlements.js`): Correct button
      (APPROVAL_REQUIRED only), editor form with live sum, diff view, audit
      display. Reuse busy/submitButton/toast/withStepUp/skeleton conventions.
- [ ] Tests: DB lifecycle (propose/apply/reject, four-eyes refusal,
      over-recoup still refused post-correction, original preserved as
      VOIDED); security (roles, step-up); manual checklist entries.
- [ ] Docs: CHANGELOG Unreleased, USER_FLOW correction section.

### Open questions

- [ ] Should corrections also be allowed on `APPROVED`-but-unexecuted
      settlements (void first, then correct), or strictly `APPROVAL_REQUIRED`?
      (Recommendation: strictly `APPROVAL_REQUIRED` for v1.)
- [ ] Minimum reason length OK at 20 chars?

---

## B. Contract-scoped recipients (optional assignments) — status: PROPOSED

**Problem:** recipients live at project level. With many people sharing jobs
(and names), there is no way to say "these payees belong to this contract";
email disambiguates display but not assignment.

**Model: directory + assignments, never a migration of existing data.**
Recipients stay project-level and everything keeps working untouched. New join
table `contract_recipients` (`contract_id` FK cascade, `beneficiary_id` FK
cascade, `label` nullable note, unique pair) records explicit assignments.

**Semantics:** a contract with **zero** assignments behaves exactly as today
(all ACTIVE project recipients in play). Once ≥ 1 assigned, activation
compiles candidate payee keys against the **assigned set**; unknown keys come
back `REVIEW_REQUIRED` with reason "payee not assigned to contract" — the
human assigns the recipient or rejects the rule. Payout-email resolution is
unchanged (still from the beneficiaries table).

### Build checklist

- [ ] Migration `013`: `contract_recipients` + RLS service-role only.
- [ ] `activateContractRuleset` (in `apps/api/services.ts`): accept an
      optional assigned-keys set; default = today's project-wide set
      (zero behavior change when unused).
- [ ] UI: Recipients page gets per-person contract assignment; Contracts
      page gets an "Assigned payees" checkbox section.
- [ ] Tests: DB (assign/unassign, cascade both directions, compile scoping,
      empty-means-all); manual checklist.
- [ ] Docs: CHANGELOG, USER_FLOW.

### Open questions

- [ ] Should assignment also gate payout execution (payee removed mid-flow),
      or only activation-time compilation? (Recommendation: activation only;
      execution freezes destinations at approval — changing that breaks the
      freeze guarantee.)

---

## C. UI refinement, contract upload rebuild — status: PROPOSED

**Direction (taste-skill + frontend-design): brand preserved.** Cream paper,
ink navy, Georgia serif, amber accents stay exactly as-is. Diagnosis:
typography/color are strong; **layout and feedback** are weakest, specifically
the upload card. Impeccable pre-check to clear during build: missing
focus-visible states, no `prefers-reduced-motion` guard on
shimmer/spin/drawer, file input with no selected-file feedback, drag-drop
absent, error-by-toast-only.

**Contract upload redesign (concrete):**

- Real dropzone: drag-over highlight + click-to-browse (keyboard-accessible
  via label + hidden input; keep existing `#pdf` / `#uploadPdf` /
  `#analyzePdf` IDs so handlers survive).
- Selected-file chip: name, size KB/MB, remove button.
- Live requirement checklist: PDF type ✓, ≤ 10 MB ✓, private-storage note.
- Staged button progress: Validating → Storing (extends existing busy
  spinner, no new machinery).
- Version list restyled as a **timeline**: status badges, active highlight,
  hash snippet.
- Post-upload auto-scroll to analysis; inline red error notice (toast stays
  as backup).

**Global pass in the same commit:** `:focus-visible` rings app-wide,
`prefers-reduced-motion` disabling shimmer/spin/drawer-slide, tabular
numerals for money columns. No new CSS variables, no palette changes, mobile
drawer behavior unchanged.

**Verification:** 390px real-browser re-check (established drawer pattern),
full suite (`npm run verify` + `test:db` + `test:security`), server-spa
unaffected (no route changes).

### Open questions

- [ ] Any page besides Contracts upload that feels broken enough to include?
      (Default: upload only; anything else gets its own plan entry.)

---

## Cross-cutting notes

- Migrations continue the `012`, `013` numbering; every file wrapped in
  `begin;`/`commit;`, idempotent (re-apply test enforces it); no version bump
  (precedent 008–011); `SECURITY DEFINER` uses
  `SET search_path = public, extensions`.
- Money-path rule: nothing reaches payout without human approval +
  compiler validation; every state change leaves an audit row.
- Frontend conventions hold: busy/submitButton/toast/withStepUp, skeleton
  first paint, exact if-chain router style (server-spa test asserts it).

## Discussion Log

- 2026-10-05: plans A/B/C drafted from live testing (payout SUCCESS proven
  US→US; $20k-advance and self-gating model errors caught by gates).
  Awaiting: build order confirmation (proposed A → C → B), A's open
  questions, any new topics before the single build at the end.
- 2026-10-05: landing page decisions confirmed — public `/` + app at `/app`,
  lightweight canvas (no CDN/Three.js runtime), preserve cream/ink/amber brand,
  CTAs to app login + demo fixtures. See Section D.

---

## D. Public landing page (`/`) + app at (`/app`) — status: DONE

**Decisions (user-confirmed):** public `/` + `/app`; lightweight motion;
preserve brand; CTAs to app login + demo.

**Files:** new `apps/web/public/landing.html`, `landing.css`, `landing.js`
(vanilla, no deps — CSP `script-src 'self'` blocks CDNs); `apps/api/server.ts`
route split (`/` → landing, `/app*` + legacy app paths → `index.html`);
`js/router.js` + `js/nav.js` + `js/utils.js` + `js/pages/login.js` migrate
canonical overview from `/` to `/app`; `tests/integration/server-spa.test.ts`
updated (`/` asserts landing, `/app*` asserts SPA shell).

**Design:** editorial ledger — Georgia serif + Inter, cream/ink/amber tokens
reused, `clamp()` fluid type, 1200px container (16:10 safe), bento guarantees,
sticky 4-step scroll rail, canvas ledger line (DPR ≤1.5, paused offscreen),
`IntersectionObserver` reveals, counters, drawer nav ≤800px,
`prefers-reduced-motion` + `:focus-visible` throughout.

**Verify:** `npm run verify`, Playwright/static screenshots at
390×844 / 768×1024 / 1440×900 / 2560×1600, keyboard-only pass.
