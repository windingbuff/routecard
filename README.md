# Routecard

Deterministic multi-stop route planning from an explicit travel-time matrix. It respects service windows and capacity, replays the resulting route, and lists unserved stops.

This is a synthetic public evaluation project for testing developer indexing. It does not provide turn-by-turn navigation, live traffic, fleet control, dangerous-goods routing, claim Electric Capital acceptance, or contain delivery data. The account owner must review changes before any external submission.

## Run

```sh
npm test
npm start
```

Open `http://localhost:3000`. The matrix is intentionally supplied by the user; asymmetric travel times are preserved.
