# Automatic creator rewards

Every approved submission attempts its eligible creator reward using a confidential
application identity. The reviewer's application-admin status and personal bearer do
not authorize the payment. Manual payout APIs retain their human-admin and self-payment
checks for operational recovery.

The service requires `HARBOR_CARD_REWARDS_CLIENT_ID` and
`HARBOR_CARD_REWARDS_CLIENT_SECRET` Worker secrets. Provision a separate Harbor client
with the explicit application-only `campaign.payout` scope; the existing
`rewards.report` client is insufficient. Its data tenant must own the source agent
configuration and its billing tenant must own the campaign pool. Provisioning instructions
are in the Provider's `docs/campaign-service-payout.md`. Never put the client secret in
source, command output, task reports, or a browser.

Deploy the tested Provider support and database migration before enabling the Worker
client. Configure both Worker secrets through the approved secret-management path,
then deploy the exact reviewed Worker source through CI. An unset or unavailable
service credential leaves approval intact and records an unavailable automatic attempt.

`stamp` and managed publication `recovery` write their completion path in the same D1
transaction as approval. The subsequent automatic attempt records a durable start and
outcome. A start with no outcome identifies an interrupted attempt; the payment record
and Provider receipt remain the authority on whether credits were actually granted.
Historical approvals predating these records cannot be reconstructed from counters.

The dedicated `*/5 * * * *` schedule processes at most ten outstanding cards. It includes
eligible approvals without a payment row and existing pending, insufficient-pool or
failed grants. Each retry uses the original persisted amount, recipient and Provider
idempotency key. Attempts back off from one minute to one hour; the five-minute schedule
sets the minimum effective polling interval. A failed card does not stop the batch.
The queue orders least-recently-attempted cards first so persistent failures do not
starve other eligible cards. Cancelled grants can become eligible for a new payment
through the same existing eligibility rules.

After deployment, read D1 payment rows and matching Provider receipts using read-only
queries. Verify one paid grant per work, matching amount/recipient, a Provider receipt,
and the request/paid audit chain. Store private identifiers only in the private incident
evidence directory. A metric delta alone cannot prove an individual payment.

`/metrics` exposes these low-cardinality signals:

- `hearthroom_card_reward_auto_total{operation="approval|retry",outcome="paid|pending|unavailable"}`
- `hearthroom_card_reward_due_cards`: eligible or in-flight unpaid cards.
- `hearthroom_card_reward_due_overdue_cards`: those outstanding at least one hour.

Harbor's Prometheus scrapes the public metrics endpoint and routes unresolved overdue
grants through Alertmanager to the duty channel. Verify the overdue alert fires and
resolves with `hearthroom_card_reward_due_overdue_cards > 0`, and verify scrape health
with `up{job="hearthroom"}`. No identity, token, prompt or content belongs in a metric
label or application log. A blocked transfer or review correction remains blocked;
diagnose the persisted guard instead of bypassing it or creating a new payout key.
