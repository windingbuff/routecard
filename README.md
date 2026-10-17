# Routecard

Plan a delivery sequence that fits service windows and capacity.

Kite logistics agents can buy a verified planning report using their own travel-time matrix; the output is not live navigation.

This is an **AI-assisted evaluation project**, maintained under its owning test account. It is not evidence of nine independent human developers, real customers, payment acceptance, or Electric Capital registration.

## Run locally

Requires Node.js 20.11 or newer.

```sh
npm install
npm test
npm start
# Open http://127.0.0.1:3000
npm run check:kite
```

Local mode is free and never creates an on-chain payment receipt. Live network checks call the Kite RPC and verify its chain ID.

## What changed in 0.2.0

Feasible insertion uses cumulative capacity and full route replay. Matrix gaps are rejected, locked prefixes stay fixed and unserved stops are explicit.

## Kite integration

- A live Kite chain check at `GET /api/kite/network` (testnet by default).
- A service descriptor at `GET /kite-service.json`, including input shape, rules version and Kite network. This is our discovery format, not a claim of official registry certification.
- Immutable tasks at `POST /v1/jobs`, with content hash, task-specific nonce, expiry and a separate access token.
- An opt-in x402 **v2 exact/EVM** paid endpoint at `POST /v1/jobs/{id}/execute`, using `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`.
- Pieverse verify → this project's business processor → settle → deliver. Uncertain settlements withhold output and are never retried automatically.
- A private file ledger prevents reuse of a payment nonce across restarts. Do not share one ledger between replicas or enable multiple replicas.

The task-specific nonce extension requires an explicit signing client that preserves it. Stock Passport/client interoperability has **not** been demonstrated. No real authorization or settlement is performed by the test suite. See [Kite integration notes](docs/KITE-INTEGRATION.md).

## Scope and limits

No map routing, live traffic, actual GPS records or fleet control. The matrix is directed. No global optimum is claimed.

Local-mode inputs/results are in-memory only. Paid-mode tasks/results are encrypted on a private persistent volume and recoverable after restart with the original access token and storage key. API access expires at 30 minutes; encrypted source files are purged within the next 30 seconds. Minimal nonce/settlement records are retained. Pending settlement still requires operator reconciliation. Default binding is localhost. This release is an integration prototype, not completion of the full PRD.

## Verification

`npm test` runs business regressions and payment-state tests with a **fake facilitator**. Live chain and facilitator support probes are separate read-only checks. An HTTPS deployment, verified token contract/domain, funded operator wallet, real payment evidence and external review are still required before ecosystem submission.

Source references: [Kite seller guide](https://docs.gokite.ai/passport/seller), [Kite networks](https://docs.gokite.ai/kite-chain/1-getting-started/network-information), [live facilitator capabilities](https://facilitator.pieverse.io/v2/supported).
