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
