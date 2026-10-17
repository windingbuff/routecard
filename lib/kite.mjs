export const KITE = Object.freeze({
  'kite-testnet': { chainId: 2368, rpc: 'https://rpc-testnet.gokite.ai/', explorer: 'https://testnet.kitescan.ai' },
  kite: { chainId: 2366, rpc: 'https://rpc.gokite.ai/', explorer: 'https://kitescan.ai' },
});
export async function networkStatus(network = 'kite-testnet', fetcher = fetch) {
  const config = KITE[network];
  if (!config) throw new Error('Only Kite networks are supported');
  const rpc = async (method) => {
    const response = await fetcher(config.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error || typeof body.result !== 'string' || !/^0x[\da-f]+$/i.test(body.result)) throw new Error('Invalid RPC response');
    return body.result;
  };
  const [chain, block] = await Promise.all([rpc('eth_chainId'), rpc('eth_blockNumber')]);
  if (Number(BigInt(chain)) !== config.chainId) throw new Error('RPC chain ID mismatch');
  return { network, chainId: config.chainId, blockNumber: BigInt(block).toString(), checkedAt: new Date().toISOString(), explorer: config.explorer };
}

// The live /v2/verify endpoint expects these envelopes, not the abbreviated
// authorization/signature/network example on the seller guide.
export class KiteFacilitator {
  constructor(fetcher = fetch) { this.fetcher = fetcher; }
  async call(operation, paymentPayload, paymentRequirements) {
    const response = await this.fetcher(`https://facilitator.pieverse.io/v2/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Facilitator ${operation} HTTP ${response.status}`);
    return response.json();
  }
  verify(payload, terms) { return this.call('verify', payload, terms); }
  settle(payload, terms) { return this.call('settle', payload, terms); }
}

