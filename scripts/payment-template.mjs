// Reads a task quote from stdin and prepares EIP-712 data. Does not sign or pay.
import { readFileSync } from 'node:fs';
const quote = JSON.parse(readFileSync(0, 'utf8'));
const terms = quote.paymentRequired?.accepts?.[0];
const from = process.env.PAYER_ADDRESS;
if (!/^0x[\da-f]{40}$/i.test(from || '') || !terms || terms.scheme !== 'exact' || !['eip155:2368', 'eip155:2366'].includes(terms.network)) throw new Error('Set PAYER_ADDRESS and supply a Kite task quote');
const authorization = { from, to: terms.payTo, value: terms.amount, validAfter: '0', validBefore: String(Math.floor(Date.parse(quote.expiresAt) / 1000)), nonce: terms.extra.requiredNonce };
const typedData = {
  domain: { name: terms.extra.name, version: terms.extra.version, chainId: Number(terms.network.split(':')[1]), verifyingContract: terms.asset },
  primaryType: 'TransferWithAuthorization',
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }],
  }, message: authorization,
};
console.log(JSON.stringify({ warning: 'Signing this authorization permits the quoted token transfer. This script does not sign or send it.', typedData,
  payloadTemplate: { x402Version: 2, resource: quote.paymentRequired.resource, accepted: terms, payload: { signature: '<wallet-signature>', authorization } } }, null, 2));

