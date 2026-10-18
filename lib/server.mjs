import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, renameSync, readFileSync, readdirSync, unlinkSync, fsyncSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KITE, KiteFacilitator, networkStatus } from './kite.mjs';
import { Workspace, compareRuns, fail } from './workspace.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function settings(env = process.env) {
  const mode = env.KITE_MODE || 'local';
  if (!['local', 'paid'].includes(mode)) throw new Error('KITE_MODE must be local or paid');
  const network = env.KITE_NETWORK || 'kite-testnet';
  if (!KITE[network]) throw new Error('Unsupported Kite network');
  const config = { mode, network, origin: env.PUBLIC_ORIGIN || 'http://127.0.0.1:3000', payTo: env.KITE_PAY_TO,
    asset: env.KITE_ASSET, amount: env.KITE_AMOUNT, tokenName: env.KITE_TOKEN_NAME, tokenVersion: env.KITE_TOKEN_VERSION,
    storageKey: env.KITE_STORAGE_KEY, dataDir: resolve(env.KITE_DATA_DIR || '.kite-data'),
    workspaceDir: resolve(env.WORKSPACE_DATA_DIR || '.workspace-data'), workspaceToken: env.WORKSPACE_ACCESS_TOKEN };
  if (config.workspaceToken && config.workspaceToken.length < 32) throw new Error('WORKSPACE_ACCESS_TOKEN needs at least 32 characters');
  if (mode === 'paid') {
    for (const field of ['payTo', 'asset']) if (!/^0x[\da-f]{40}$/i.test(config[field] || '') || /^0x0{40}$/i.test(config[field])) throw new Error(`Set nonzero ${field}`);
    if (!/^[1-9]\d{0,35}$/.test(config.amount || '')) throw new Error('KITE_AMOUNT must be a positive integer in asset base units');
    if (!config.tokenName || !config.tokenVersion) throw new Error('Set the verified EIP-712 token name and version');
    if (!/^[\da-f]{64}$/i.test(config.storageKey || '')) throw new Error('Set a private 32-byte hex KITE_STORAGE_KEY for encrypted task recovery');
    if (!/^https:\/\/[\w.-]+(?::\d+)?$/.test(config.origin)) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without path');
    if (env.KITE_LIVE_ACK !== 'I_HAVE_VERIFIED_ASSET_AND_FACILITATOR') throw new Error('Live facilitator and asset verification acknowledgement missing');
  }
  return config;
}

export class Service {
  constructor(spec, config, facilitator = new KiteFacilitator(), clock = () => Date.now()) {
    this.spec = spec; this.config = config; this.facilitator = facilitator; this.clock = clock; this.jobs = new Map();
    if (config.mode === 'paid') {
      mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
      for (const name of readdirSync(config.dataDir).filter(n => /^job-[\da-f]{32}\.enc$/.test(n))) {
        const bytes = readFileSync(join(config.dataDir, name));
        const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.storageKey, 'hex'), bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const job = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        if (job.service !== spec.slug || job.ruleVersion !== spec.version) throw new Error('Task store belongs to a different service or rules version');
        if (this.clock() >= job.resultExpiresAt) unlinkSync(join(config.dataDir, name));
        else { job.running = false; this.jobs.set(job.id, job); }
      }
    }
  }
  sweep() {
    for (const [id, job] of this.jobs) if (this.clock() >= job.resultExpiresAt && !job.running) {
      this.jobs.delete(id);
      if (this.config.mode === 'paid') { try { unlinkSync(join(this.config.dataDir, `job-${id}.enc`)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    }
  }
  save(job) {
    if (this.config.mode !== 'paid') return;
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(this.config.storageKey, 'hex'), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify({ ...job, service: this.spec.slug, ruleVersion: this.spec.version, running: false })), cipher.final()]);
    const path = join(this.config.dataDir, `job-${job.id}.enc`), temp = `${path}.tmp`;
    const fd = openSync(temp, 'w', 0o600);
    try { writeFileSync(fd, Buffer.concat([iv, cipher.getAuthTag(), data])); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
  }
  create(input) {
    this.sweep();
    if (this.jobs.size >= 100) throw new Error('Task capacity reached');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Task input must be an object');
    const encodedSize = Buffer.byteLength(canonical(input));
    const used = [...this.jobs.values()].reduce((s, job) => s + (job.inputBytes || 0), 0);
    if (used + encodedSize > 32000000) throw new Error('Task input memory budget reached');
    this.spec.validate(input);
    const id = randomBytes(16).toString('hex'), access = randomBytes(32).toString('hex');
    const inputHash = hash(canonical(input));
    const nonce = `0x${hash(`${this.spec.slug}:${this.spec.version}:${id}:${inputHash}`)}`;
    const job = { id, accessHash: hash(access), input: structuredClone(input), inputBytes: encodedSize, inputHash, nonce, state: 'awaiting-payment',
      createdAt: this.clock(), expiresAt: this.clock() + 300000, resultExpiresAt: this.clock() + 1800000 };
    const c = this.config;
    job.resource = { url: `${c.origin}/v1/jobs/${id}/execute`, description: `${this.spec.title}: ${this.spec.purpose}`, mimeType: 'application/json' };
    job.terms = { scheme: 'exact', network: `eip155:${KITE[c.network].chainId}`, amount: c.amount || '0',
      payTo: c.payTo || null, maxTimeoutSeconds: 300, asset: c.asset || null,
      extra: { name: c.tokenName, version: c.tokenVersion, requiredNonce: nonce, inputHash, ruleVersion: this.spec.version } };
    this.jobs.set(id, job);
    this.save(job);
    return { id, accessToken: access, inputHash, ruleVersion: this.spec.version, expiresAt: new Date(job.expiresAt).toISOString(),
      resultExpiresAt: new Date(job.resultExpiresAt).toISOString(), mode: c.mode,
      paymentRequired: c.mode === 'paid' ? { x402Version: 2, resource: job.resource, accepts: [job.terms] } : null };
  }
  get(id, access) {
    const job = this.jobs.get(id);
    if (!job || typeof access !== 'string' || !timingSafeEqual(Buffer.from(job.accessHash), Buffer.from(hash(access)))) throw new Error('Task not found');
    if (this.clock() >= job.resultExpiresAt) { this.sweep(); throw new Error('Task expired'); }
    return job;
  }
  remove(id, access) {
    const job = this.get(id, access);
    if (job.running) throw new Error('Task still running');
    this.jobs.delete(id);
    if (this.config.mode === 'paid') unlinkSync(join(this.config.dataDir, `job-${id}.enc`));
    return { id, deleted: true, retained: 'minimal nonce and settlement metadata only' };
  }
  persist(job, state, transaction) {
    const name = join(this.config.dataDir, job.nonce.slice(2));
    const temp = `${name}.tmp`;
    // No source files, authorization, signature or output enters the ledger.
    writeFileSync(temp, JSON.stringify({ id: job.id, inputHash: job.inputHash, state, transaction, network: this.config.network }), { mode: 0o600 });
    renameSync(temp, `${name}.json`);
  }
  async execute(id, access, encoded) {
    const job = this.get(id, access);
    if (job.state === 'delivered') return { state: job.state, result: job.result, receipt: job.receipt };
    if (job.running || !['awaiting-payment'].includes(job.state)) throw new Error(`Task is ${job.state}; do not pay again`);
    if (this.clock() >= job.expiresAt) throw new Error('Quote expired');
    if (this.config.mode === 'local') {
      job.result = await this.spec.run(job.input); job.state = 'delivered';
      return { state: 'delivered', mode: 'local', result: job.result, receipt: null };
    }
    if (!encoded) return { state: job.state, paymentRequired: { x402Version: 2, resource: job.resource, accepts: [job.terms] } };
    if (encoded.length > 16000 || !/^[\w+/]+=*$/.test(encoded)) throw new Error('Invalid PAYMENT-SIGNATURE');
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString());
    const auth = payload.payload?.authorization;
    if (payload.x402Version !== 2 || canonical(payload.accepted) !== canonical(job.terms) || payload.resource?.url !== job.resource.url ||
      !auth || !/^0x[\da-f]{40}$/i.test(auth.from || '') || auth.to?.toLowerCase() !== this.config.payTo.toLowerCase() ||
      String(auth.value) !== this.config.amount || auth.nonce !== job.nonce ||
      !Number.isSafeInteger(Number(auth.validAfter)) || !Number.isSafeInteger(Number(auth.validBefore)) ||
      Number(auth.validAfter) > this.clock() / 1000 || Number(auth.validBefore) <= this.clock() / 1000 ||
      Number(auth.validBefore) > Math.floor(job.expiresAt / 1000) || !/^0x(?:[\da-f]{2})+$/i.test(payload.payload.signature || '')) throw new Error('Payment does not match this task quote');
    job.running = true;
    try {
      const verified = await this.facilitator.verify(payload, job.terms);
      if (verified.isValid !== true) throw new Error('Facilitator did not verify payment');
      const lockPath = join(this.config.dataDir, job.nonce.slice(2));
      // Cross-restart consumption guard. A claimed authorization is never retried.
      const fd = openSync(lockPath, 'wx', 0o600); fsyncSync(fd); closeSync(fd);
      job.state = 'processing'; this.persist(job, job.state); this.save(job);
      let result;
      try { result = await this.spec.run(job.input); }
      catch { job.state = 'business-failed'; this.persist(job, job.state); this.save(job); throw new Error('Business operation failed; settlement was not requested'); }
      job.result = result;
      job.state = 'settlement-pending'; this.persist(job, job.state); this.save(job);
      let settled;
      try { settled = await this.facilitator.settle(payload, job.terms); }
      catch { throw new Error('Settlement outcome unknown; do not pay again'); }
      if (settled.success !== true || settled.network !== job.terms.network || !/^0x[\da-f]{64}$/i.test(settled.transaction || '')) {
        throw new Error('Settlement response unconfirmed; do not pay again');
      }
      job.receipt = { transaction: settled.transaction, network: settled.network, chainId: KITE[this.config.network].chainId,
        explorerUrl: `${KITE[this.config.network].explorer}/tx/${settled.transaction}`, inputHash: job.inputHash, ruleVersion: this.spec.version };
      this.persist(job, 'delivered', settled.transaction);
      job.result = result; job.state = 'delivered';
      this.save(job);
      return { state: job.state, result, receipt: job.receipt };
    } finally { job.running = false; }
  }
}

function escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function page(spec) {
  return readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('{{TITLE}}', escape(spec.title));
}
export function buildServer(spec, config = settings(), facilitator) {
  const service = new Service(spec, config, facilitator);
  const workspace = spec.product ? new Workspace(spec, config, service) : null;
  const server = createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
        ...(data?.paymentRequired ? { 'payment-required': Buffer.from(JSON.stringify(data.paymentRequired)).toString('base64') } : {}),
        ...(data?.receipt ? { 'payment-response': Buffer.from(JSON.stringify({ success: true, ...data.receipt })).toString('base64') } : {}),
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/') return send(200, page(spec, config), 'text/html');
      if (req.method === 'GET' && ['/app.mjs', '/style.css'].includes(path)) return send(200, readFileSync(new URL(`../public${path}`, import.meta.url), 'utf8'), path.endsWith('.mjs') ? 'text/javascript' : 'text/css');
      if (workspace && req.method === 'GET' && path === '/api/workspace/bootstrap') return send(200, workspace.bootstrap(req));
      if (workspace && path.startsWith('/api/projects')) {
        workspace.authorize(req);
        const url = new URL(req.url, 'http://localhost');
        const route = /^\/api\/projects(?:\/([\da-f-]+))?(?:\/(runs|clone|backup|compare))?(?:\/([\da-f-]+))?(?:\/(review|approve|restore|collect|export))?$/.exec(path);
        if (!route) return send(404, { error: 'Not found' });
        const [, id, section, runId, action] = route;
        let body = {};
        if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Use application/json' });
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > (spec.maxBytes || 512000) + 16000) fail('Input too large', 413); chunks.push(chunk); }
          body = JSON.parse(Buffer.concat(chunks).toString());
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON object required');
        }
        if (!id && req.method === 'GET') return send(200, { projects: workspace.list() });
        if (!id && req.method === 'POST') return send(201, workspace.create(body));
        if (id && !section && req.method === 'GET') return send(200, workspace.detail(workspace.get(id)));
        if (id && !section && req.method === 'PATCH') return send(200, workspace.update(id, body));
        if (id && !section && req.method === 'DELETE') return send(200, workspace.remove(id, body));
        if (section === 'clone' && req.method === 'POST') return send(201, workspace.clone(id, body));
        if (section === 'compare' && req.method === 'GET') {
          const a = workspace.runRecord(id, url.searchParams.get('from')).run, b = workspace.runRecord(id, url.searchParams.get('to')).run;
          if (a.state !== 'complete' || b.state !== 'complete') fail('Only completed results can be compared', 409);
          return send(200, compareRuns(a, b));
        }
        if (section === 'backup' && req.method === 'GET') {
          const p = workspace.get(id); res.setHeader('content-disposition', `attachment; filename="${spec.slug}-${p.id.slice(0,8)}-inputs.json"`);
          return send(200, { schemaVersion: 1, service: spec.slug, name: p.name, description: p.description, data: p.data });
        }
        if (section === 'runs' && !runId && req.method === 'POST') return send(201, await workspace.run(id, body));
        if (section === 'runs' && runId && !action && req.method === 'GET') return send(200, workspace.runDetail(id, runId));
        if (section === 'runs' && runId && !action && req.method === 'DELETE') return send(200, workspace.removeRun(id, runId, body));
        if (section === 'runs' && runId && action === 'review' && req.method === 'POST') return send(200, workspace.review(id, runId, body));
        if (section === 'runs' && runId && action === 'approve' && req.method === 'POST') return send(200, workspace.approve(id, runId, body));
        if (section === 'runs' && runId && action === 'restore' && req.method === 'POST') return send(200, workspace.restore(id, runId, body));
        if (section === 'runs' && runId && action === 'collect' && req.method === 'POST') return send(200, workspace.collect(id, runId, body));
        if (section === 'runs' && runId && action === 'export' && req.method === 'GET') {
          const artifact = workspace.export(id, runId, url.searchParams.get('format'));
          res.setHeader('content-disposition', `attachment; filename="${artifact.filename}"`); return send(200, artifact.content, artifact.mime === 'application/json' ? 'text/plain' : artifact.mime);
        }
        return send(404, { error: 'Not found' });
      }
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'ok', service: spec.slug, mode: config.mode });
      if (req.method === 'GET' && path === '/api/kite/network') {
        try { return send(200, await networkStatus(config.network)); }
        catch (error) { return send(503, { error: error.message, network: config.network }); }
      }
      if (req.method === 'GET' && path === '/kite-service.json') return send(200, {
        descriptorVersion: 1, service: spec.slug, title: spec.title, purpose: spec.purpose,
        network: config.network, chainId: KITE[config.network].chainId, mode: config.mode,
        taskEndpoint: '/v1/jobs', executeEndpoint: '/v1/jobs/{id}/execute', inputSchema: spec.inputSchema,
        rulesVersion: spec.version, protocol: { name: 'x402', version: 2, scheme: 'exact', network: `eip155:${KITE[config.network].chainId}` },
        status: 'development; live payment acceptance not certified', provenance: 'AI-assisted evaluation project',
      });
      const match = /^\/v1\/jobs\/([a-f0-9]{32})(\/execute)?$/.exec(path);
      if (req.method === 'DELETE' && match && !match[2]) return send(200, service.remove(match[1], req.headers.authorization?.replace(/^Bearer /, '')));
      if (req.method === 'GET' && match && !match[2]) {
        const job = service.get(match[1], req.headers.authorization?.replace(/^Bearer /, ''));
        return send(200, { id: job.id, state: job.state, receipt: job.receipt || null, result: job.state === 'delivered' ? job.result : undefined });
      }
      if (req.method !== 'POST' || (path !== '/v1/jobs' && !match?.[2])) return send(404, { error: 'Not found' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Use application/json' });
      let chunks = [], size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > (spec.maxBytes || 512000)) { send(413, { error: 'Input too large' }); req.resume(); return; } chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (path === '/v1/jobs') return send(201, service.create(body));
      const result = await service.execute(match[1], req.headers.authorization?.replace(/^Bearer /, ''), req.headers['payment-signature']);
      return send(result.paymentRequired ? 402 : 200, result);
    } catch (error) { if (!res.headersSent) return send(error.status || 400, { error: error.message }); }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  const timer = setInterval(() => {
    service.sweep();
  }, 30000); timer.unref();
  server.on('close', () => { clearInterval(timer); workspace?.close(); });
  return server;
}
export function start(spec) {
  const port = Number(process.env.PORT || 3000);
  buildServer(spec).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`${spec.title}: http://127.0.0.1:${port}`));
}

