export function insist(condition, message) {
  if (!condition) throw new Error(message);
}
export function list(value, name, max = 500) {
  insist(Array.isArray(value) && value.length <= max, `${name}: expected array, at most ${max} items`);
  return value;
}
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  insist(Number.isSafeInteger(value) && value >= min && value <= max, `${name}: expected integer ${min}..${max}`);
  return value;
}
export function text(value, name, max = 10000) {
  insist(typeof value === 'string' && value.length > 0 && value.length <= max, `${name}: expected non-empty string, at most ${max} characters`);
  return value;
}
export function unique(items, name = 'id') {
  const seen = new Set();
  for (const item of items) {
    text(item[name], name, 120);
    insist(!seen.has(item[name]), `Duplicate ${name}: ${item[name]}`);
    seen.add(item[name]);
  }
}
export function offsetInstant(value) {
  insist(typeof value === 'string' && /T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'Timestamp needs an explicit UTC offset');
  const ms = Date.parse(value);
  insist(Number.isFinite(ms), 'Invalid timestamp');
  return ms;
}

