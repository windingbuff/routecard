import { fileURLToPath } from 'node:url';
import { start } from './lib/server.mjs';
import { run, validate } from './core.mjs';
export * from './core.mjs';
export const spec = { ...{
  "slug": "routecard",
  "repo": "routecard",
  "owner": "windingbuff",
  "title": "Routecard",
  "purpose": "Plan a delivery sequence that fits service windows and capacity",
  "workflow": "Kite logistics agents can buy a verified planning report using their own travel-time matrix; the output is not live navigation.",
  "colors": [
    "#f1f5e9",
    "#173d39",
    "#176c59"
  ],
  "required": [
    "stops",
    "matrix"
  ],
  "sample": {
    "stops": [
      {
        "id": "1",
        "service": 10,
        "demand": 1,
        "window": [
          500,
          620
        ]
      },
      {
        "id": "2",
        "service": 10,
        "demand": 1,
        "window": [
          540,
          700
        ]
      }
    ],
    "matrix": {
      "depot>1": 10,
      "depot>2": 15,
      "1>depot": 12,
      "2>depot": 18,
      "1>2": 20,
      "2>1": 25
    },
    "start": 480,
    "capacity": 2,
    "lockedPrefix": []
  },
  "changed": "Feasible insertion uses cumulative capacity and full route replay. Matrix gaps are rejected, locked prefixes stay fixed and unserved stops are explicit.",
  "limits": "No map routing, live traffic, actual GPS records or fleet control. The matrix is directed. No global optimum is claimed.",
  "version": "0.2.0",
  "inputSchema": {
    "type": "object",
    "required": [
      "stops",
      "matrix"
    ],
    "properties": {
      "stops": {
        "type": "array"
      },
      "matrix": {
        "type": "object"
      },
      "start": {
        "type": "integer"
      },
      "capacity": {
        "type": "integer"
      },
      "lockedPrefix": {
        "type": "array"
      }
    }
  }
}, run, validate };
if (process.argv[1] === fileURLToPath(import.meta.url)) start(spec);

