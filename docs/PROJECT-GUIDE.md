# Project workspace guide

The browser application manages a complete single-operator project: brief, structured inputs, analysis runs, reviews, exports and history. A new project starts with editable example inputs; no analysis, payment or approval is fabricated automatically.

## Everyday workflow

1. Create a named project and describe the deliverable in its brief.
2. Edit the business forms. Import CSV/SRT text or photo files where supported. The JSON editor is optional.
3. Save the draft and run an analysis. Each run captures its own input, content hash, rules version and result. Changing the draft cannot alter earlier results.
4. Inspect the business tables and visual preview. Download draft artifacts when useful. Fix blocking problems in the inputs and run a new revision.
5. Review each item. A flag needs a note. Blocking issues cannot be waived; every nonblocking item needs an explicit acceptance before release.
6. Release the current reviewed run and download its deliverables. Released filenames become draft filenames if the current project input changes. A past review remains in its historical audit record.
7. Duplicate a scenario to try different inputs. It receives a new identity and no copied approval. History supports result comparison, input restoration and run removal.

Local review records are operator workflow records, not independent signatures, external certification or a multiuser approval system.

## Persistence and access

`WORKSPACE_DATA_DIR` defaults to `.workspace-data`. Each service has its own subdirectory containing AES-256-GCM encrypted project files, a private `storage.key` and a process lock. Keep this directory out of Git. Preserve both encrypted files and key in an access-controlled backup. Losing the key prevents recovery; startup refuses to replace a missing key when encrypted projects remain.

Project inputs, source photos, run snapshots and review notes are **retained until explicitly removed**. This differs from the payment-task store's 30-minute source retention. Removing a run removes its saved snapshot; its source may still be present in the current draft or other retained runs. Removing a project removes its encrypted project file. Minimal payment settlement records live in the separate payment store and are not deleted with projects.

The app supports one process and one operator per data directory. A second process refuses to open an active workspace. Defaults: at most 50 projects, 10 retained runs per project, 64 MB per project, and 256 MB total serialized project data. Export or remove older material when these limits are reached. Runs with an interrupted local computation are labeled interrupted after restart; no payment is automatically retried.

For local development, bind to `127.0.0.1`. A short-lived management key is provided only to requests with a loopback peer and loopback Host. Every management API request needs that key, and cross-origin management requests are rejected.

For remote management, or management in paid mode, set `WORKSPACE_ACCESS_TOKEN` to a private random value of at least 32 characters and use HTTPS. Enter it in the workspace access dialog; the browser keeps it only in page memory. This is one operator credential, without per-person roles, sessions or account recovery. It is distinct from a task access token and from wallet payment authorization.

## Kite payment behavior

Local analysis is free and produces no transaction receipt. Paid-mode project runs create an immutable x402 quote without running the business computation. The paying operator must explicitly sign with compatible wallet tooling and submit the authorization to the linked `/v1/jobs/{id}/execute` endpoint. The workspace can then collect only a delivered result whose input hash matches its saved snapshot.

The task access token is returned only to the creating caller and is not saved in project history. Preserve it in your client if you need to resume collection. Do not create another charge when settlement status is uncertain. A pending settlement requires operator reconciliation. See `KITE-INTEGRATION.md` for protocol details, storage recovery and unverified Passport interoperability.

## Backup and exports

“Export inputs” saves the current **saved** project input, brief and service identifier. It does not include unsaved edits, all history, reviews or payment tokens. Import creates a new draft project for the same service; it cannot import approval or payment claims. For complete recovery, back up the private workspace directory while the app is stopped.

Each completed run also exposes business deliverables and a JSON audit bundle containing result, input hash, rule version, review decisions and any genuine payment receipt. The audit bundle does not contain full source input or private payment authorization. CSV files neutralize spreadsheet-formula prefixes; use the exact JSON representation when preserving literal field values matters.

## Management API

All paths below require `X-Workspace-Key`. Mutation bodies use JSON, and edits require the latest numeric `revision`; stale edits return 409 without overwriting saved work.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/projects` | List summaries / create a draft |
| GET / PATCH / DELETE | `/api/projects/{id}` | Read / save or archive / remove |
| POST | `/api/projects/{id}/clone` | Create an independent scenario |
| GET | `/api/projects/{id}/backup` | Download saved inputs |
| GET | `/api/projects/{id}/compare?from={runId}&to={runId}` | Compare up to 200 changed result fields |
| POST | `/api/projects/{id}/runs` | Analyze locally or prepare a paid quote |
| GET / DELETE | `/api/projects/{id}/runs/{runId}` | Read immutable output / remove old run |
| POST | `/api/projects/{id}/runs/{runId}/review` | Save an accept/flag decision and note |
| POST | `/api/projects/{id}/runs/{runId}/approve` | Release current fully reviewed output |
| POST | `/api/projects/{id}/runs/{runId}/restore` | Restore historical inputs as a new draft |
| POST | `/api/projects/{id}/runs/{runId}/collect` | Collect an already delivered paid result |
| GET | `/api/projects/{id}/runs/{runId}/export?format={id}` | Download a business artifact |

Public health, static UI, service descriptor and Kite network checks are separate from private project management. The application is not a hosted multitenant service. Public hosting still needs an operator's deployment, monitoring, rate controls and recovery procedures.
