import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSession } from '../src/session-do.js';
import { AgentLoop } from '../src/agent-loop.js';
import { MCPClient } from '../src/mcp-client.js';
import { Brain } from '../src/brain.js';
import { SPARK_MODEL } from '../src/meta-adapter.js';
import { SessionStatus, LedgerType, DEFAULT_MCP_SERVERS } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

test('8. ondocs ONCE-ONLY Rule (§8): proof runs once at setup and never cycles in task loop', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_ondocs_once',
      quota: { rpc: { total: 5, remaining: 5 } }
    })
  }));

  const loop = new AgentLoop(sessionDO, DEFAULT_MCP_SERVERS);
  await loop.runUntilPause(5);

  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();

  // Filter ledger entries for ondocs
  const ondocsEntries = state.ledger.filter(entry => 
    entry.reasoning && entry.reasoning.includes('ondocs')
  );

  // Must be called exactly ONCE (proof shot), never in cycling steps
  assert.equal(ondocsEntries.length, 1, 'ondocs must be called exactly once for proof, never cycling');
  assert.equal(ondocsEntries[0].units, 0, 'ondocs proof call must not deduct quota');
  assert.equal(ondocsEntries[0].type, LedgerType.SYSTEM, 'ondocs proof entry must be system type');

  // Verify all usage entries are strictly RPC
  const usageEntries = state.ledger.filter(entry => entry.type === LedgerType.USAGE);
  for (const usage of usageEntries) {
    assert.equal(usage.resource, 'rpc', 'All loop task steps must be pure RPC operations');
  }
});

test('9. Quota Safety: failed tool call records failed entry with 0 units and does NOT deduct quota', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_fail_quota',
      quota: { rpc: { total: 10, remaining: 10 } }
    })
  }));

  const loop = new AgentLoop(sessionDO, DEFAULT_MCP_SERVERS);
  // Simulate network/RPC error
  loop.mcpClient.callTool = async () => {
    throw new Error('Simulated network error');
  };

  const stepResult = await loop.executeStep(0);
  assert.equal(stepResult.toolSuccess, false, 'Step should record failure');

  // Verify DO quota was NOT deducted
  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();
  assert.equal(state.quota.rpc.remaining, 10, 'Quota must NOT be deducted on failed tool calls');

  // Verify failed entry exists with units: 0
  const failedEntry = state.ledger.find(e => e.status === 'failed');
  assert.ok(failedEntry, 'Failed tool call must be recorded in ledger');
  assert.equal(failedEntry.units, 0, 'Failed entry must have 0 units deducted');
});

test('10. Transparency: ondocs proof failure records failed SYSTEM entry without halting task', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_ondocs_fail',
      quota: { rpc: { total: 5, remaining: 5 } }
    })
  }));

  const loop = new AgentLoop(sessionDO, DEFAULT_MCP_SERVERS);
  // Force search on ondocs to fail
  const origCall = loop.mcpClient.callTool.bind(loop.mcpClient);
  loop.mcpClient.callTool = async (tool, args) => {
    if (tool === 'search') {
      throw new Error('Simulated ondocs 503 error');
    }
    return origCall(tool, args);
  };

  // Run setup()
  await loop.setup();

  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();

  const failedProofEntry = state.ledger.find(e => 
    e.type === LedgerType.SYSTEM && e.status === 'failed' && e.reasoning && e.reasoning.includes('ondocs')
  );

  assert.ok(failedProofEntry, 'ondocs proof failure must be honestly recorded in ledger');
  assert.equal(failedProofEntry.units, 0, 'Proof failure must not deduct quota');
  assert.equal(state.quota.rpc.remaining, 5, 'Quota must remain intact');
});

test('11. Brain Economic Deliberation: valid JSON within cap transitions to awaiting_purchase with 0 spend', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_deliberate_valid',
      quota: { rpc: { total: 5, remaining: 0, consumed: 5 } },
      budgetCapUsd: 5.00
    })
  }));

  const mockAdapter = {
    chat: async () => ({
      text: JSON.stringify({
        action: 'buy',
        item: 'rpc-1000',
        rail: 'paypal',
        estimated_cost_usd: 2.00,
        estimated_calls_covered: 1000,
        reasoning: 'Task is 60% complete with 400 RPC calls needed. rpc-1000 ($2.00 via PayPal) covers the remaining workload within the $5.00 budget cap with $3.00 margin remaining.',
        alternative_considered: 'x402-rpc-micro was evaluated but would require 400 individual on-chain micro-transactions ($0.40 total), which incurs higher latency compared to a single PayPal volume pack.'
      })
    })
  };
  sessionDO.adapter = mockAdapter;

  const deliberateRes = await sessionDO.fetch(new Request('https://do/deliberate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));

  assert.equal(deliberateRes.status, 200);
  const data = await deliberateRes.json();
  assert.equal(data.success, true);
  assert.equal(data.decision.action, 'buy');
  assert.equal(data.decision.item, 'rpc-1000');
  assert.equal(data.decision.guardrailStatus, 'accepted');
  assert.equal(data.sessionStatus, SessionStatus.AWAITING_PURCHASE);

  // Verify DO State: spentUsd MUST be 0 (Zero charges today per §0)
  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();
  assert.equal(state.status, SessionStatus.AWAITING_PURCHASE);
  assert.equal(state.spentUsd, 0, 'ZERO charges must occur today; spentUsd must remain 0.00');

  // Verify Ledger: DECISION entry exists with lean fields
  const decisionEntry = state.ledger.find(e => e.type === LedgerType.DECISION);
  assert.ok(decisionEntry, 'Decision entry must be recorded in ledger');
  assert.equal(decisionEntry.item, 'rpc-1000');
  assert.equal(decisionEntry.guardrailStatus, 'accepted');
});

test('12. Hard Guardrail 1 (Budget Cap): over-cap buy ($8.00 on $5.00 cap) rejected by code', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_deliberate_overcap',
      quota: { rpc: { total: 5, remaining: 0, consumed: 5 } },
      budgetCapUsd: 5.00
    })
  }));

  const overCapAdapter = {
    chat: async () => ({
      text: JSON.stringify({
        action: 'buy',
        item: 'rpc-5000',
        rail: 'paypal',
        estimated_cost_usd: 8.00,
        estimated_calls_covered: 5000,
        reasoning: 'Proposing rpc-5000 for high buffer margin.',
        alternative_considered: 'rpc-1000'
      })
    })
  };
  sessionDO.adapter = overCapAdapter;

  const deliberateRes = await sessionDO.fetch(new Request('https://do/deliberate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));

  const data = await deliberateRes.json();
  assert.equal(data.success, true);
  assert.equal(data.decision.guardrailStatus, 'rejected');
  assert.match(data.decision.rejectionReason, /budget cap|Over-cap/i);
  assert.equal(data.sessionStatus, SessionStatus.PAUSED_QUOTA_EXHAUSTED);

  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.notEqual(state.status, SessionStatus.AWAITING_PURCHASE);
  assert.equal(state.spentUsd, 0);
});

test('13. Hard Guardrail 2 (Catalogue Allowlist): unlisted/invented item rejected by code', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_deliberate_unlisted',
      budgetCapUsd: 5.00
    })
  }));

  const unlistedAdapter = {
    chat: async () => ({
      text: JSON.stringify({
        action: 'buy',
        item: 'unlimited-super-pack',
        rail: 'paypal',
        estimated_cost_usd: 2.00,
        estimated_calls_covered: 10000,
        reasoning: 'Invented non-catalogue package.',
        alternative_considered: 'None'
      })
    })
  };
  sessionDO.adapter = unlistedAdapter;

  const deliberateRes = await sessionDO.fetch(new Request('https://do/deliberate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));

  const data = await deliberateRes.json();
  assert.equal(data.decision.guardrailStatus, 'rejected');
  assert.match(data.decision.rejectionReason, /allowlist|live catalogue/i);
  assert.equal(data.sessionStatus, SessionStatus.PAUSED_QUOTA_EXHAUSTED);
});

test('14. Brain Fail-Safe: malformed model prose with failed 1-retry repair safely fails to no_buy', async () => {
  let callCount = 0;
  const malformedAdapter = {
    chat: async () => {
      callCount++;
      return {
        text: 'I think the agent should really buy some more quota because we are nearly finished with the analysis.'
      };
    }
  };

  const brain = new Brain(malformedAdapter);
  const decision = await brain.deliberate({
    task: 'Test task',
    budget_cap_usd: 5.00,
    spent_usd: 0.00
  });

  // Verify 1 initial attempt + 1 repair attempt occurred
  assert.equal(callCount, 2, 'Must attempt 1 initial prompt and exactly 1 repair retry');
  assert.equal(decision.action, 'no_buy');
  assert.equal(decision.guardrailStatus, 'rejected');
  assert.match(decision.rejectionReason, /Malformed model output/i);
  assert.equal(decision.nextSessionStatus, SessionStatus.PAUSED_QUOTA_EXHAUSTED);
});

test('15. Meta Model Compliance: zero occurrences of "contributor" across src/ and exact SPARK_MODEL', async () => {
  // Check 1: Model constant is muse-spark-1.3
  assert.equal(SPARK_MODEL, 'muse-spark-1.3', 'Model must be exact standard muse-spark-1.3');

  // Check 2: Scan all files under src/ for forbidden variant 'contributor'
  const srcDir = path.resolve(__dirname, '../src');
  const files = fs.readdirSync(srcDir);
  const violations = [];

  for (const file of files) {
    const fullPath = path.join(srcDir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.toLowerCase().includes('contributor')) {
        violations.push(file);
      }
    }
  }

  assert.equal(violations.length, 0, `Forbidden string 'contributor' found in src files: ${violations.join(', ')}`);
});
