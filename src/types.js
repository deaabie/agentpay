/**
 * AgentPay Core Types & Schemas
 * 
 * Strict Zero-Log Discipline:
 * - Spend ledger records ONLY: timestamp, type, resource, units, cost, rail, reasoning, status.
 * - NEVER record request bodies, file contents, or raw payloads.
 */

export const SessionStatus = {
  IDLE: 'idle',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  MONITORING: 'monitoring',
  PAUSED_QUOTA_EXHAUSTED: 'paused_quota_exhausted',
  DELIBERATING: 'deliberating',
  AWAITING_PURCHASE: 'awaiting_purchase',
  FROZEN_BY_KILLSWITCH: 'frozen_by_killswitch',
  COMPLETED: 'completed',
  ERROR: 'error'
};

export const LedgerType = {
  SYSTEM: 'system',
  USAGE: 'usage',
  DECISION: 'decision',
  TRANSACTION: 'transaction'
};

export const ResourceType = {
  RPC: 'rpc',
  READ: 'read',
  FILE: 'file'
};

export const DEFAULT_MCP_SERVERS = [
  {
    name: 'skuuy-mcp',
    url: 'https://mcp.skuuy.com/mcp',
    transport: 'streamable-http',
    role: 'hands' // Core merchant for API quota operations
  },
  {
    name: 'ondocs',
    url: 'https://ondocs.vercel.app/api/mcp',
    transport: 'streamable-http',
    role: 'reference' // Third-party generic proof
  }
];

export const INITIAL_DEMO_QUOTA = {
  rpc: { total: 100, remaining: 100, consumed: 0 },
  read: { total: 20, remaining: 20, consumed: 0 },
  file: { total: 5, remaining: 5, consumed: 0 }
};

/**
 * Live Canonical Pricing Catalogue Allowlist
 * Verified from PayPal sandbox Orders v2 rails & x402 on-chain specs.
 * Code guardrail strictly checks against this allowlist.
 */
export const CATALOGUE_ALLOWLIST = [
  { item: 'read-100', resource: 'read', calls: 100, priceUsd: 1.00, rail: 'paypal' },
  { item: 'read-500', resource: 'read', calls: 500, priceUsd: 4.50, rail: 'paypal' },
  { item: 'rpc-1000', resource: 'rpc', calls: 1000, priceUsd: 2.00, rail: 'paypal' },
  { item: 'rpc-5000', resource: 'rpc', calls: 5000, priceUsd: 8.00, rail: 'paypal' },
  { item: 'file-25', resource: 'file', calls: 25, priceUsd: 1.00, rail: 'paypal' },
  { item: 'file-100', resource: 'file', calls: 100, priceUsd: 3.00, rail: 'paypal' },
  { item: 'x402-rpc-micro', resource: 'rpc', calls: 1, priceUsd: 0.001, rail: 'x402' }
];
