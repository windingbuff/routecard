# Kite integration: implemented, tested and still pending

This release makes the business processor callable by a paying Kite agent. No wallet is created, no key is requested, and no payment is made by installation or startup. The owning accounts are test accounts; these repositories are AI-assisted projects, not nine independent developer identities.

## Protocol evidence

The Kite seller guide describes an x402 v1 `gokite-aa` example. Read-only/invalid-authorization probes of the recommended Pieverse service on this work session showed a different live contract:

- `GET /v2/supported` lists `x402Version: 2`, `scheme: exact`, `network: eip155:2368` and `eip155:2366`.
- `/v2/verify` validates `paymentPayload` and `paymentRequirements` envelopes, requires version 2, and requires a resource object, an accepted requirements object and string authorization fields.

This code follows that actual v2 shape. It does not forward the abbreviated v1 authorization/signature/network example. See the [Kite guide](https://docs.gokite.ai/passport/seller), [network definitions](https://docs.gokite.ai/kite-chain/1-getting-started/network-information) and [facilitator capabilities](https://facilitator.pieverse.io/v2/supported). The guide and live endpoint may evolve independently; recheck before deployment.

## Paid task sequence

1. `POST /v1/jobs` with the business input. Validation runs before a quote. The task captures immutable input and the rule version, plus an input SHA-256, five-minute quote expiry and a random retrieval token.
2. The returned terms specify `exact`, a Kite CAIP-2 network, explicit token contract, integer amount in token base units and recipient. Missing paid configuration prevents startup. No asset address or decimal precision is guessed.
3. `POST /v1/jobs/{id}/execute` without a signature returns HTTP 402 plus the base64 `PAYMENT-REQUIRED` header and terms in JSON.
4. The paying operator reviews terms and signs the EIP-3009 `TransferWithAuthorization`. This service's explicit nonce extension binds authorization to the immutable task. Stock client compatibility is not assumed.
5. Send base64 JSON payment payload in `PAYMENT-SIGNATURE`, plus `Authorization: Bearer <task-access-token>`. The service checks requirements, recipient, amount, nonce, expiry and resource before the facilitator verifies the signature. Source input is never sent to the facilitator.
6. Business output is prepared and encrypted. Only then is settlement requested. A confirmed success response on the correct network releases output with a transaction reference in `PAYMENT-RESPONSE`.
7. Repeat requests return the same settled result without another settlement call. Concurrent execution, expired quotes and reused task nonces are blocked. A timeout or malformed settlement response stays `settlement-pending` and never triggers an automatic payment retry.

`node scripts/payment-template.mjs < quote.json` with `PAYER_ADDRESS` set produces typed data and the unsigned payload template. It does **not** collect private keys, sign anything or send funds. Base64-encode the completed payload with your own approved wallet tooling. Confirm that the token supports the EIP-3009 domain and method used by the facilitator. Asset support and a real successful signature remain operator checks, not assertions made by this repository.

## Configuration and recovery

Use `.env.example` as a shell configuration reference. Node 20 does not automatically load it. Set `KITE_MODE=paid`, `PUBLIC_ORIGIN` (HTTPS origin without path), `KITE_PAY_TO`, `KITE_ASSET`, `KITE_AMOUNT`, `KITE_TOKEN_NAME`, `KITE_TOKEN_VERSION`, `KITE_STORAGE_KEY` (32 random bytes encoded as 64 hex characters) and a private persistent `KITE_DATA_DIR`. An explicit `KITE_LIVE_ACK=I_HAVE_VERIFIED_ASSET_AND_FACILITATOR` is required. It is an operator acknowledgement, not a payment compatibility test.

Paid tasks and results are encrypted using AES-256-GCM. The storage key must be stable across restarts and must not enter Git. Task retrieval requires a separate random token whose hash is stored; payment authorization and signatures are never persisted. Minimal nonce-consumption/settlement records omit source content and are retained to prevent reuse. The task store is limited to one service/rules version and one instance; do not deploy replicas against it.

Task APIs deny access after the 30-minute result deadline. The in-process sweep deletes expired encrypted task files within the following 30 seconds; startup also deletes expired task files. Preserve the data directory and encryption key for restart recovery. Loss of either can prevent result recovery and must stop paid operation.

If settlement is pending, an operator must reconcile the original attempt using facilitator/on-chain evidence. This release has **no automatic reconciliation or refund endpoint**. Restart preserves pending state and withholds results. A crash between a successful external settlement and recording it locally also requires manual reconciliation. Do not delete the ledger and charge again.

## Verification boundaries

- Business regressions run on constructed, reproducible fixtures.
- The payment suite injects a fake facilitator to verify 402 responses, quote matching, ordering, failed business execution, timeout handling, concurrent execution, restart retrieval, encryption and expiry. It does not prove token acceptance, signature validity or a real transfer.
- A live RPC check verifies Kite chain identity and reads a block number. It does not send a transaction.
- No public HTTPS deployment, genuine wallet-funded call, payment receipt, Passport compatibility acceptance, official service-registry approval or Electric Capital acceptance is claimed.

Before a submission that requires those items, deploy an appropriately restricted single instance, verify an allowed asset/domain, perform an operator-approved testnet call, save the genuine transaction and business result reference, and check current submission rules. Production hosting also requires operational rate limits, isolation for image decoding, durable storage monitoring and a reconciliation process.

