import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentSession } from '../src/session-do.js';
import { AgentLoop } from '../src/agent-loop.js';
import { MCPClient } from '../src/mcp-client.js';
import { SessionStatus, LedgerType, DEFAULT_MCP_SERVERS } from '../src/types.js';

// In-memory mock storage for testing AgentSession DO outside Wrangler
class MockStorage {
  constructor() {
    this.data = new Map();
  }
  async get(key) {
    const val = this.data.get(key);
    return val ? JSON.parse(JSON.stringify(val)) : null;
  }
  async put(key, val) {
    this.data.set(key, JSON.parse(JSON.stringify(val)));
  }
  async delete(key) {
    this.data.delete(key);
  }
}

function createMockDO() {
  const mockState = {
    storage: new MockStorage()
  };
  return new AgentSession(mockState, {});
}

test('1. Generic Config-Driven MCP Client: initializes skuuy-mcp and ondocs live', async () => {
  const client = new MCPClient(DEFAULT_MCP_SERVERS);
  const statuses = await client.initializeAll();

  assert.equal(statuses.length, 2, 'Must configure exactly 2 MCP servers');
  
  const skuuyServer = statuses.find(s => s.name === 'skuuy-mcp');
  assert.ok(skuuyServer, 'skuuy-mcp must be present');
  assert.equal(skuuyServer.status, 'connected');
  assert.ok(skuuyServer.toolsCount >= 16, 'skuuy-mcp should expose at least 16 tools');

  const ondocsServer = statuses.find(s => s.name === 'ondocs');
  assert.ok(ondocsServer, 'ondocs must be present');
  assert.equal(ondocsServer.status, 'connected');
  assert.ok(ondocsServer.toolsCount >= 3, 'ondocs should expose at least 3 tools');
});

test('2. Live MCP Execution: calls skuuy_rpc on Base and search on ondocs', async () => {
  const client = new MCPClient(DEFAULT_MCP_SERVERS);
  await client.initializeAll();

  // Test live RPC tool call
  const rpcRes = await client.callTool('skuuy_rpc', {
    chain: 'base',
    method: 'eth_blockNumber',
    params: []
  });
  assert.ok(rpcRes.success, 'skuuy_rpc call must succeed');
  assert.equal(rpcRes.serverName, 'skuuy-mcp');
  const rpcText = rpcRes.result?.content?.[0]?.text;
  assert.ok(rpcText && rpcText.includes('0x'), 'RPC should return valid hex block number');

  // Test live ondocs search call
  const docsRes = await client.callTool('search', { query: 'getting started' });
  assert.ok(docsRes.success, 'ondocs search call must succeed');
  assert.equal(docsRes.serverName, 'ondocs');
});

test('3. AgentSession DO: manages lifecycle, atomic quota, and state machine', async () => {
  const sessionDO = createMockDO();

  // Init session
  const initRes = await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_sess_01',
      budgetCapUsd: 5.00,
      quota: {
        rpc: { total: 10, remaining: 10 }
      }
    })
  }));
  const initData = await initRes.json();
  assert.ok(initData.success);
  assert.equal(initData.session.quota.rpc.remaining, 10);
  assert.equal(initData.session.budgetCapUsd, 5.00);

  // Deduct 3 units
  const deductRes = await sessionDO.fetch(new Request('https://do/deduct-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'rpc', units: 3 })
  }));
  const deductData = await deductRes.json();
  assert.ok(deductData.success);
  assert.equal(deductData.remaining, 7);
  assert.equal(deductData.consumed, 3);
});

test('4. Clean Pause on Quota Exhaustion: stops at 0 without purchasing', async () => {
  const sessionDO = createMockDO();

  // Initialize with exactly 2 units
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_sess_exhaust',
      quota: {
        rpc: { total: 2, remaining: 2 }
      }
    })
  }));

  // Step 1: consume 1 unit
  const step1 = await sessionDO.fetch(new Request('https://do/deduct-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'rpc', units: 1 })
  }));
  const data1 = await step1.json();
  assert.equal(data1.remaining, 1);
  assert.notEqual(data1.status, SessionStatus.PAUSED_QUOTA_EXHAUSTED);

  // Step 2: consume 1 unit (reaches 0)
  const step2 = await sessionDO.fetch(new Request('https://do/deduct-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'rpc', units: 1 })
  }));
  const data2 = await step2.json();
  assert.equal(data2.remaining, 0);
  assert.equal(data2.status, SessionStatus.PAUSED_QUOTA_EXHAUSTED);

  // Step 3: consume when exhausted -> must reject with 402 QUOTA_EXHAUSTED
  const step3 = await sessionDO.fetch(new Request('https://do/deduct-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'rpc', units: 1 })
  }));
  assert.equal(step3.status, 402);
  const data3 = await step3.json();
  assert.equal(data3.error, 'QUOTA_EXHAUSTED');
});

test('5. Owner-Only Kill Switch: freezes execution immediately', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test_freeze' })
  }));

  // Freeze session
  const freezeRes = await sessionDO.fetch(new Request('https://do/freeze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ freeze: true })
  }));
  const freezeData = await freezeRes.json();
  assert.equal(freezeData.isFrozen, true);
  assert.equal(freezeData.status, SessionStatus.FROZEN_BY_KILLSWITCH);

  // Attempting quota deduction must fail with 403 SESSION_FROZEN
  const deductRes = await sessionDO.fetch(new Request('https://do/deduct-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'rpc', units: 1 })
  }));
  assert.equal(deductRes.status, 403);
  const deductData = await deductRes.json();
  assert.equal(deductData.error, 'SESSION_FROZEN');
});

test('6. Zero-Log Discipline: spend ledger stores only lean metadata', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test_zerolog' })
  }));

  await sessionDO.fetch(new Request('https://do/add-ledger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: LedgerType.USAGE,
      resource: 'rpc',
      units: 1,
      costUsd: 0.00,
      rail: 'free_tier',
      reasoning: 'Called eth_blockNumber on Base',
      forbiddenPayload: 'secret_user_data_that_must_not_be_logged'
    })
  }));

  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();
  const lastEntry = state.ledger[state.ledger.length - 1];

  assert.ok(lastEntry.id);
  assert.equal(lastEntry.type, LedgerType.USAGE);
  assert.equal(lastEntry.resource, 'rpc');
  assert.equal(lastEntry.forbiddenPayload, undefined, 'Raw payloads must never be stored in ledger');
});

test('7. AgentLoop v1 Integration: runs real task steps, consumes quota, pauses on exhaustion', async () => {
  const sessionDO = createMockDO();
  
  // Set demo quota to 3 units for fast test verification
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_loop_run',
      quota: {
        rpc: { total: 3, remaining: 3 }
      }
    })
  }));

  // Create loop with session DO
  const loop = new AgentLoop(sessionDO, DEFAULT_MCP_SERVERS);
  const runResult = await loop.runUntilPause(10);

  assert.ok(runResult.completedSteps > 0, 'Should complete steps');
  assert.equal(runResult.finalStatus, SessionStatus.PAUSED_QUOTA_EXHAUSTED, 'Must pause upon exhaustion');
  assert.equal(runResult.quotaRemaining.rpc.remaining, 0, 'Quota remaining must be exactly 0');
});
