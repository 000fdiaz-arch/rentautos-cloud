CxC operational-state validation
===============================

Release requirement explicitly requested by the user: before deploying this CxC
redesign to production, set `ENFORCE_REQUIRED_NAVIGATION = true` and verify that
required management prevents advancement, including non-active state validation
and confirmed database persistence. Update the temporary navigation test to assert
the enabled gate. Keep the gate disabled only while the user reviews the design.

Migration: `supabase/migrations/20261118000200_receivables_operational_review.sql`.

Non-active units use the operational-state question before payment or GPS forms.
The validation navigation gate is temporarily disabled through
`ENFORCE_REQUIRED_NAVIGATION = false`, at the user's request during design review.
Previous/next and promise shortcuts remain available without validation; saving
still awaits the actual database confirmation. Drafts are
scoped by owner, collector, business day, unit and state.

The RPC checks receivables edit permission, owner, collector portfolio, current
effective state, and allowed destination states. It locks the fleet and related
client records and writes the state and audit receipt atomically. Client status
synchronization follows Autos semantics: libre/archivado archives associated
clients; other destination states update non-archived clients. Operational
correction does not terminate a provisional rental agreement.

The UI publishes success only after reading the saved receipt and refreshed
fleet. A failed write or confirmation read does not publish success. Reload
loads the receipts from the database; a different state, collector, business day
or fleet revision requires validation again.

Verification:

- `node tests/receivables-operational-review-ui.mjs`: renders the real ledger;
  validates form priority and navigation gating, and retains the active flow.
- `node tests/receivables-operational-review-live.mjs`: uses the configured real
  Supabase database with an isolated owner and a temporary operator with only CxC
  permissions. Checks both portfolios, same-state confirmation, corrections,
  direct reads, audit identity, denied requests, and read failure. Removes its
  own temporary records and users afterward.
- `node tests/receivables-workday-progress.cjs` and
  `node tests/receivables-followup-navigation.cjs`: regression checks for cursor,
  drafts, scheduled retry and follow-up return.
