import assert from 'node:assert/strict';
import { planRoute, replayRoute } from './app.mjs';
const stops = [{ id: '1', service: 10, demand: 1, window: [500, 620] }, { id: '2', service: 10, demand: 1, window: [540, 700] }, { id: '3', service: 10, demand: 1, window: [480, 490] }];
const matrix = { 'depot>1': 10, 'depot>2': 15, 'depot>3': 5, '1>2': 20, '2>1': 20, '1>3': 30, '2>3': 25, '3>1': 30, '3>2': 25 };
const result = planRoute(stops, matrix, 480);
assert.ok(result.replay.completed.every(item => item.finish <= stops.find(stop => stop.id === item.id).window[1]));
const constrained = replayRoute(['1', '2'], stops, matrix, 480, 1);
assert.equal(constrained.completed.length, 1);
console.log('routecard: ok');
