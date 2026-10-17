import test from 'node:test'; import assert from 'node:assert/strict'; import { planRoute } from './core.mjs';
const stops = [{ id: '1', service: 10, demand: 1, window: [500, 620] }, { id: '2', service: 10, demand: 1, window: [540, 700] }];
const matrix = { 'depot>1': 10, 'depot>2': 15, '1>depot': 12, '2>depot': 18, '1>2': 20, '2>1': 25 };
test('all planned stops fit windows, service and cumulative capacity', () => { const r = planRoute(stops, matrix, 480, 1); assert.equal(r.replay.completed.length, 1); assert.equal(r.unserved.length, 1); assert.equal(r.replay.unserved.length, 0); });
test('locked prefix stays first and matrix is asymmetric', () => { const r = planRoute(stops, matrix, 480, 2, ['2']); assert.equal(r.order[0], '2'); assert.equal(r.replay.completed[1].arrival, r.replay.completed[0].finish + 25); });
test('missing matrix entry rejected', () => { const m = { ...matrix }; delete m['2>1']; assert.throws(() => planRoute(stops, m), /2>1/); });
test('capacity-infeasible locked prefix refused', () => assert.throws(() => planRoute(stops, matrix, 480, 1, ['1', '2']), /prefix/));
