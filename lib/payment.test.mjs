import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service, settings, buildServer, canonical } from './server.mjs';
import { networkStatus, KiteFacilitator } from './kite.mjs';
const from = '0x' + '1'.repeat(40), payTo = '0x' + '2'.repeat(40), asset = '0x' + '3'.repeat(40), transaction = '0x' + '4'.repeat(64);
function setup(t, overrides = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'kite-test-')); t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const config = { mode: 'paid', network: 'kite-testnet', origin: 'https://service.example', payTo, asset, amount: '10000', tokenName: 'Test Asset', tokenVersion: '1', storageKey: 'a'.repeat(64), dataDir };
  const events = [], facilitator = {
    verify: async () => { events.push('verify'); return { isValid: true }; },
    settle: async () => { events.push('settle'); return { success: true, network: 'eip155:2368', transaction }; }, ...overrides,
  };
  const spec = { slug: 'test', title: 'Test', purpose: 'test', version: '0.2.0', inputSchema: {}, colors: ['white', 'black', 'blue'], sample: { value: 1 },
    validate: x => { assert.equal(typeof x.value, 'number'); }, run: async x => { events.push('business'); return { result: x.value * 2 }; } };
  const service = new Service(spec, config, facilitator), task = service.create({ value: 1 });
  const authorization = { from, to: payTo, value: '10000', nonce: service.jobs.get(task.id).nonce, validAfter: '0', validBefore: String(Math.floor(Date.parse(task.expiresAt) / 1000)) };
  const body = structuredClone({ x402Version: 2, resource: service.jobs.get(task.id).resource, accepted: service.jobs.get(task.id).terms, payload: { signature: '0x' + '1'.repeat(130), authorization } });
  const encode = () => Buffer.from(JSON.stringify(body)).toString('base64');
  return { service, task, body, encode, events, spec, config, facilitator };
}
test('canonical input hashes are insensitive to object key ordering', () => assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 })));
test('unconfigured local mode is free; paid mode fails closed', () => {
  assert.equal(settings({}).mode, 'local');
  assert.throws(() => settings({ KITE_MODE: 'paid' }), /payTo/);
  assert.throws(() => settings({ KITE_NETWORK: 'base' }), /network/);
});
test('unpaid tasks return v2 terms and do not execute business', async t => {
  const x = setup(t); const result = await x.service.execute(x.task.id, x.task.accessToken);
  assert.equal(result.paymentRequired.x402Version, 2); assert.equal(result.paymentRequired.accepts[0].network, 'eip155:2368'); assert.deepEqual(x.events, []);
});
test('task input is immutable and another bearer cannot read it', t => {
  const x = setup(t); assert.throws(() => x.service.get(x.task.id, 'wrong'), /not found/);
  const input = { value: 4 }; const task = x.service.create(input); input.value = 9;
  assert.equal(x.service.get(task.id, task.accessToken).input.value, 4);
});
test('verify -> business -> settle -> deliver and repeat is idempotent', async t => {
  const x = setup(t), result = await x.service.execute(x.task.id, x.task.accessToken, x.encode());
  assert.deepEqual(x.events, ['verify', 'business', 'settle']); assert.equal(result.result.result, 2); assert.equal(result.receipt.chainId, 2368);
  await x.service.execute(x.task.id, x.task.accessToken, x.encode()); assert.equal(x.events.length, 3);
});
for (const [name, mutate] of [
  ['payee', b => { b.payload.authorization.to = from; }], ['amount', b => { b.payload.authorization.value = '1'; }],
  ['network', b => { b.accepted.network = 'eip155:2366'; }], ['nonce', b => { b.payload.authorization.nonce = '0x' + '0'.repeat(64); }],
  ['resource', b => { b.resource.url = 'https://other.example'; }], ['expired authorization', b => { b.payload.authorization.validBefore = '1'; }],
]) test(`reject mismatched ${name} before facilitator calls`, async t => { const x = setup(t); mutate(x.body); await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode())); assert.deepEqual(x.events, []); });
test('failed verification never runs business or settlement', async t => {
  const x = setup(t, { verify: async () => ({ isValid: false }) }); await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode()), /verify/); assert.deepEqual(x.events, []);
});
test('business failure never calls settlement', async t => {
  const x = setup(t); x.spec.run = async () => { throw new Error('failure'); };
  await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode()), /settlement was not requested/); assert.deepEqual(x.events, ['verify']);
});
test('settlement timeout withholds result and blocks retry', async t => {
  const x = setup(t, { settle: async () => { throw new Error('timeout'); } });
  await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode()), /unknown/);
  assert.equal(x.service.get(x.task.id, x.task.accessToken).state, 'settlement-pending');
  await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode()), /do not pay again/);
});
test('unconfirmed or wrong-chain settlement cannot deliver', async t => {
  const x = setup(t, { settle: async () => ({ success: true, transaction, network: 'eip155:8453' }) });
  await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode()), /unconfirmed/);
  assert.equal(x.service.get(x.task.id, x.task.accessToken).state, 'settlement-pending');
});
test('delivered result survives restart; source and access token are not plaintext on disk', async t => {
  const x = setup(t); await x.service.execute(x.task.id, x.task.accessToken, x.encode());
  const restarted = new Service(x.spec, x.config, x.facilitator);
  const result = await restarted.execute(x.task.id, x.task.accessToken, x.encode()); assert.equal(result.result.result, 2); assert.equal(x.events.length, 3);
  const disk = readdirSync(x.config.dataDir).map(n => readFileSync(join(x.config.dataDir, n)).toString()).join('');
  assert.ok(!disk.includes('"input":')); assert.ok(!disk.includes(x.task.accessToken)); assert.ok(!disk.includes('"signature":'));
});
test('expiry purges encrypted input/results but retains minimal settlement state', async t => {
  const x = setup(t); await x.service.execute(x.task.id, x.task.accessToken, x.encode());
  x.service.clock = () => Date.now() + 31 * 60000; x.service.sweep();
  assert.equal(x.service.jobs.size, 0); assert.ok(!readdirSync(x.config.dataDir).some(n => n.endsWith('.enc')));
  assert.ok(readdirSync(x.config.dataDir).some(n => n.endsWith('.json')));
});
test('manual deletion needs the task token and destroys recoverable input/results', async t => {
  const x = setup(t); await x.service.execute(x.task.id, x.task.accessToken, x.encode());
  assert.throws(() => x.service.remove(x.task.id, 'wrong'));
  x.service.remove(x.task.id, x.task.accessToken);
  assert.throws(() => x.service.get(x.task.id, x.task.accessToken));
  assert.ok(!readdirSync(x.config.dataDir).some(n => n.endsWith('.enc')));
});
test('concurrent execution cannot charge twice', async t => {
  let release; const wait = new Promise(r => { release = r; });
  const x = setup(t, { verify: async () => { await wait; return { isValid: true }; } });
  const first = x.service.execute(x.task.id, x.task.accessToken, x.encode());
  await assert.rejects(x.service.execute(x.task.id, x.task.accessToken, x.encode())); release(); await first;
});
test('network status verifies RPC chain identity', async () => {
  const fetcher = async (_url, options) => ({ ok: true, json: async () => ({ result: JSON.parse(options.body).method === 'eth_chainId' ? '0x940' : '0x10' }) });
  assert.equal((await networkStatus('kite-testnet', fetcher)).chainId, 2368);
  await assert.rejects(networkStatus('kite', fetcher), /mismatch/);
});
test('facilitator uses actual v2 request envelope without leaking source input', async () => {
  let request; const f = new KiteFacilitator(async (url, options) => { request = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ isValid: false }) }; });
  await f.verify({ x402Version: 2 }, { scheme: 'exact' }); assert.equal(request.body.x402Version, 2); assert.deepEqual(request.body.paymentRequirements, { scheme: 'exact' });
});
test('HTTP paid endpoint emits PAYMENT-REQUIRED; unknown paths fail', async t => {
  const x = setup(t); const server = buildServer(x.spec, x.config, x.facilitator);
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const task = await (await fetch(origin + '/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":1}' })).json();
  const response = await fetch(`${origin}/v1/jobs/${task.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${task.accessToken}` }, body: '{}' });
  assert.equal(response.status, 402); assert.equal(JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64')).x402Version, 2);
  assert.equal((await fetch(origin + '/missing')).status, 404);
  assert.equal((await fetch(origin + '/kite-service.json')).status, 200);
});

