import { insist, list, integer, unique } from './lib/validation.mjs';
function validateInput(stops, matrix, startTime, capacity) {
  list(stops, 'stops', 20); unique(stops); integer(startTime, 'start minute'); integer(capacity, 'capacity', 1);
  insist(!stops.some(s => s.id === 'depot'), 'depot is a reserved identifier');
  for (const s of stops) { integer(s.service, 'service', 0, 1440); integer(s.demand, 'demand', 0); insist(s.window?.length === 2, 'A time window needs two bounds'); integer(s.window[0], 'window start'); integer(s.window[1], 'window end', s.window[0]); }
  for (const from of ['depot', ...stops.map(s => s.id)]) for (const to of ['depot', ...stops.map(s => s.id)]) if (from !== to) integer(matrix?.[`${from}>${to}`], `${from}>${to}`, 0, 100000);
}
export function replayRoute(order, stops, matrix, startTime = 480, capacity = 100) {
  validateInput(stops, matrix, startTime, capacity);
  insist(new Set(order).size === order.length, 'Repeated stop');
  let time = startTime, load = 0, previous = 'depot'; const completed = [], unserved = [];
  for (const id of order) {
    const s = stops.find(s => s.id === id); insist(s, 'Unknown route stop');
    const arrival = time + matrix[`${previous}>${id}`], start = Math.max(arrival, s.window[0]), finish = start + s.service;
    if (finish > s.window[1] || load + s.demand > capacity) { unserved.push({ id, reason: finish > s.window[1] ? 'time-window' : 'capacity' }); continue; }
    completed.push({ id, arrival, start, finish, wait: start - arrival }); load += s.demand; time = finish; previous = id;
  }
  return { completed, unserved, endTime: time, load, returnTime: previous === 'depot' ? time : time + matrix[`${previous}>depot`] };
}
export function planRoute(stops, matrix, startTime = 480, capacity = 100, lockedPrefix = []) {
  validateInput(stops, matrix, startTime, capacity); list(lockedPrefix, 'lockedPrefix', 20);
  let order = [...lockedPrefix], fixed = replayRoute(order, stops, matrix, startTime, capacity);
  insist(fixed.unserved.length === 0, 'Locked prefix is infeasible');
  const remaining = new Set(stops.map(s => s.id)); order.forEach(id => remaining.delete(id));
  while (remaining.size) {
    let best;
    for (const id of [...remaining].sort()) for (let position = lockedPrefix.length; position <= order.length; position++) {
      const candidate = [...order.slice(0, position), id, ...order.slice(position)];
      const replay = replayRoute(candidate, stops, matrix, startTime, capacity);
      if (replay.unserved.length) continue;
      if (!best || replay.returnTime < best.replay.returnTime) best = { order: candidate, replay, id };
    }
    if (!best) break;
    order = best.order; remaining.delete(best.id);
  }
  const replay = replayRoute(order, stops, matrix, startTime, capacity);
  return { order, replay, lockedPrefix, unserved: [...remaining].map(id => ({ id, reason: stops.find(s => s.id === id).demand > capacity ? 'capacity' : 'no-feasible-insertion' })), optimal: false };
}
export function run(x) { return planRoute(x.stops, x.matrix, x.start, x.capacity, x.lockedPrefix); }
export function validate(x) { run(x); }
