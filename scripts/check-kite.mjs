import { networkStatus } from '../lib/kite.mjs';
console.log(JSON.stringify(await networkStatus(process.env.KITE_NETWORK || 'kite-testnet'), null, 2));

