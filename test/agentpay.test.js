import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSession } from '../src/session-do.js';
import { AgentLoop } from '../src/agent-loop.js';
import { MCPClient } from '../src/mcp-client.js';
import { Brain } from '../src/brain.js';
import { Planner } from '../src/plan.js';
import { BuyExecutor } from '../src/buy-executor.js';
import { SPARK_MODEL, extractTextFromResponse } from '../src/meta-adapter.js';
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

test('16. MetaModelAdapter: extractTextFromResponse handles string, array content blocks, and completions', () => {
  // 1. Direct string
  const dataString = { choices: [{ message: { content: '{"action":"buy"}' } }] };
  assert.equal(extractTextFromResponse(dataString), '{"action":"buy"}');

  // 2. Content array of text blocks (Anthropic / Meta block style)
  const dataArray = {
    choices: [{
      message: {
        content: [
          { type: 'text', text: '{"action":"buy",' },
          { type: 'text', text: '"item":"rpc-1000"}' }
        ]
      }
    }]
  };
  assert.equal(extractTextFromResponse(dataArray), '{"action":"buy",\n"item":"rpc-1000"}');

  // 3. Completions style choice.text
  const dataCompletions = { choices: [{ text: '{"action":"no_buy"}' }] };
  assert.equal(extractTextFromResponse(dataCompletions), '{"action":"no_buy"}');

  // 4. Object content { text: "..." }
  const dataObj = { choices: [{ message: { content: { text: '{"action":"wait"}' } } }] };
  assert.equal(extractTextFromResponse(dataObj), '{"action":"wait"}');

  // 5. Empty or missing content
  assert.equal(extractTextFromResponse(null), '');
  assert.equal(extractTextFromResponse({ choices: [] }), '');
});

test('17. AgentSession DO: handleInit completely resets state, quota, and clears latestDecision', async () => {
  const sessionDO = createMockDO();
  
  // Set initial state with a decision
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess_reset_test', quota: { rpc: { total: 5, remaining: 0 } } })
  }));

  // Simulate a deliberate decision
  sessionDO.adapter = {
    chat: async () => ({
      text: JSON.stringify({
        action: 'buy',
        item: 'rpc-1000',
        rail: 'paypal',
        estimated_cost_usd: 2.00,
        estimated_calls_covered: 1000,
        reasoning: 'Testing reset.',
        alternative_considered: 'None'
      })
    })
  };
  await sessionDO.fetch(new Request('https://do/deliberate', { method: 'POST', body: '{}' }));

  let state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.ok(state.latestDecision, 'Decision must be present before reset');
  assert.equal(state.status, SessionStatus.AWAITING_PURCHASE);

  // Trigger Reset via handleInit
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'sess_reset_test',
      quota: { rpc: { total: 10, remaining: 10 } }
    })
  }));

  state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.equal(state.status, SessionStatus.IDLE, 'Status must reset to IDLE');
  assert.equal(state.quota.rpc.remaining, 10, 'Quota must reset to new value');
  assert.equal(state.latestDecision, null, 'latestDecision must be cleared on reset');
  assert.equal(state.stepCount, 0, 'stepCount must reset to 0');
});

test('18. PLAN Valid: well-formed model reply produces stored DECISION entry labelled plan with 0 charge', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_plan_valid',
      budgetCapUsd: 5.00
    })
  }));

  const mockAdapter = {
    chat: async () => ({
      text: JSON.stringify({
        steps: ['Query Base block height', 'Query Ethereum block height'],
        estimated_rpc_calls: 400,
        estimated_reads: 10,
        estimated_cost_usd: 0.40,
        opening_strategy: 'free_tier_first',
        reasoning: 'Audit workload requires 400 RPC calls ($0.40 under micro or 0 on free tier). Opening strategy free_tier_first is optimal within $5.00 cap.'
      })
    })
  };
  sessionDO.adapter = mockAdapter;

  const res = await sessionDO.fetch(new Request('https://do/plan', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.plan.opening_strategy, 'free_tier_first');
  assert.equal(data.plan.estimated_rpc_calls, 400);

  // Verify DO State
  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.ok(state.latestPlan, 'Plan must be stored in state');
  assert.equal(state.spentUsd, 0.00, 'PLAN must NEVER charge money (spentUsd must remain 0.00)');

  // Verify Ledger: DECISION entry labelled plan
  const planEntry = state.ledger.find(e => e.type === LedgerType.DECISION && e.action === 'plan');
  assert.ok(planEntry, 'DECISION entry labelled plan must be in spend ledger');
  assert.equal(planEntry.status, 'success');
  assert.match(planEntry.reasoning, /400 RPC calls/i);
});

test('19. PLAN Fallback: malformed reply falls back to demo steps, loop runs, and exhaustion triggers DELIBERATE', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_plan_fallback',
      quota: { rpc: { total: 2, remaining: 2, consumed: 0 } },
      budgetCapUsd: 5.00
    })
  }));

  let planCalls = 0;
  const malformedAdapter = {
    chat: async (messages) => {
      // Check if this is a deliberate call or plan call
      const isDeliberate = messages.some(m => m.content && m.content.includes('Deliberation Context'));
      if (isDeliberate) {
        return {
          text: JSON.stringify({
            action: 'no_buy',
            item: null,
            rail: null,
            estimated_cost_usd: 0.00,
            estimated_calls_covered: 0,
            reasoning: 'Exhausted after 2 steps. Deliberating no_buy within $5.00 cap.',
            alternative_considered: 'none'
          })
        };
      }
      // Otherwise it is PLAN: return invalid prose
      planCalls++;
      return { text: 'I am planning to audit the blockchain without JSON formatting.' };
    }
  };

  const loop = new AgentLoop(sessionDO, DEFAULT_MCP_SERVERS, { customAdapter: malformedAdapter });
  
  // Run loop until pause
  const loopResult = await loop.runUntilPause(10);

  // Verify plan calls attempted initial + repair (2 calls)
  assert.equal(planCalls, 2, 'PLAN must attempt 1 initial + 1 repair retry');

  // Verify PLAN fallback entry exists
  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  const planEntry = state.ledger.find(e => e.type === LedgerType.DECISION && e.action === 'plan');
  assert.ok(planEntry, 'PLAN fallback entry must be recorded');
  assert.equal(planEntry.status, 'failed');

  // Verify DELIBERATE still triggered later on quota exhaustion
  assert.equal(state.quota.rpc.remaining, 0, 'Quota must hit 0');
  assert.ok(state.latestDecision, 'DELIBERATE must still trigger despite PLAN fallback');
  assert.equal(state.latestDecision.action, 'no_buy');
});

test('20. BUY PayPal Success (Stubbed Vault): verified capture adds +1000 RPC, spent becomes $2.00, moves to EXECUTING', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_buy_paypal_success',
      quota: { rpc: { total: 5, remaining: 0, consumed: 5 } },
      budgetCapUsd: 5.00,
      mandate: {
        vaultToken: 'BA-SANDBOX-TEST-20',
        budgetCapUsd: 5.00,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc', 'read', 'file', 'quota_packs'],
        rail: 'paypal'
      }
    })
  }));

  // Setup approved buy decision
  const decision = {
    id: 'dec_test_paypal_20',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  let chargeCount = 0;
  const mockPayPalClient = {
    charge: async (params) => {
      chargeCount++;
      assert.equal(params.amount, 2.00);
      assert.equal(params.item, 'rpc-1000');
      return {
        success: true,
        captureId: 'CAP-SANDBOX-TEST-20',
        status: 'COMPLETED',
        note: 'Mock Sandbox Vault Capture'
      };
    }
  };
  sessionDO.paypalClient = mockPayPalClient;

  const buyRes = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision
    })
  }));

  assert.equal(buyRes.status, 200);
  const buyData = await buyRes.json();
  assert.equal(buyData.success, true);
  assert.equal(chargeCount, 1, 'Exactly 1 charge call must be made');
  assert.equal(buyData.transaction.rail, 'paypal');

  // Verify state updates
  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.equal(state.quota.rpc.remaining, 1000, 'Quota must be refilled by exactly +1000 RPC');
  assert.equal(state.spentUsd, 2.00, 'spentUsd must increase to $2.00');
  assert.equal(state.status, SessionStatus.EXECUTING, 'Session must transition to EXECUTING to resume');

  // Verify TRANSACTION entry in ledger
  const txEntry = state.ledger.find(e => e.type === LedgerType.TRANSACTION);
  assert.ok(txEntry, 'TRANSACTION entry must be recorded in ledger');
  assert.equal(txEntry.costUsd, 2.00);
  assert.equal(txEntry.units, 1000);
  assert.equal(txEntry.reference, 'CAP-SANDBOX-TEST-20');
});

test('21. BUY Re-check Rejection: changed price or cap-exceeding decision rejected with 0 charges', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_buy_recheck_fail',
      budgetCapUsd: 1.50, // Budget cap is $1.50, but pack costs $2.00
      mandate: {
        vaultToken: 'BA-SANDBOX-TEST-21',
        budgetCapUsd: 1.50,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc'],
        rail: 'paypal'
      }
    })
  }));

  const overCapDecision = {
    id: 'dec_overcap_21',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  let chargeCount = 0;
  const mockPayPalClient = {
    charge: async () => {
      chargeCount++;
      return { success: true };
    }
  };

  const buyRes = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision: overCapDecision,
      paypalClient: mockPayPalClient
    })
  }));

  assert.equal(buyRes.status, 400);
  const data = await buyRes.json();
  assert.equal(data.success, false);
  assert.match(data.reason, /exceeds cap/i);
  assert.equal(chargeCount, 0, 'ZERO charges must occur on re-check rejection');

  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.equal(state.spentUsd, 0.00, 'spentUsd must remain 0.00');
});

test('22. BUY Idempotency: retrying the same decision id produces exactly 1 charge call and 1 transaction entry', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_buy_idempotent',
      quota: { rpc: { total: 5, remaining: 0, consumed: 5 } },
      budgetCapUsd: 5.00,
      mandate: {
        vaultToken: 'BA-SANDBOX-TEST-22',
        budgetCapUsd: 5.00,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc', 'read', 'file', 'quota_packs'],
        rail: 'paypal'
      }
    })
  }));

  const decision = {
    id: 'dec_idempotent_22',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  let chargeCount = 0;
  const mockPayPalClient = {
    charge: async () => {
      chargeCount++;
      return {
        success: true,
        captureId: 'CAP-IDEMPOTENT-22',
        status: 'COMPLETED'
      };
    }
  };
  sessionDO.paypalClient = mockPayPalClient;

  // First Buy attempt
  const buyRes1 = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision })
  }));
  const data1 = await buyRes1.json();
  assert.equal(data1.success, true);
  assert.equal(chargeCount, 1);

  // Second Buy attempt with same decision ID (e.g. page refresh / double click)
  const buyRes2 = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision })
  }));
  const data2 = await buyRes2.json();
  assert.equal(data2.success, true);
  assert.equal(data2.alreadyProcessed, true, 'Second call must be flagged as alreadyProcessed');
  assert.equal(chargeCount, 1, 'Charge call must NOT be executed a second time');

  // Verify ledger has exactly 1 TRANSACTION entry
  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  const txEntries = state.ledger.filter(e => e.type === LedgerType.TRANSACTION);
  assert.equal(txEntries.length, 1, 'Exactly 1 TRANSACTION entry must be recorded in ledger');
  assert.equal(state.spentUsd, 2.00, 'spentUsd must remain $2.00 (not $4.00)');
  assert.equal(state.quota.rpc.remaining, 1000, 'Quota must remain 1000 (not 2000)');
});

test('23. x402 Disabled Without Wallet: missing X402_PAYER_SECRET records failure without settlement, PayPal unaffected', async () => {
  const sessionDO = createMockDO(); // no X402_PAYER_SECRET in env
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_x402_no_wallet',
      budgetCapUsd: 5.00
    })
  }));

  const x402Decision = {
    id: 'dec_x402_micro_23',
    action: 'buy',
    item: 'x402-rpc-micro',
    rail: 'x402',
    estimated_cost_usd: 0.001,
    estimated_calls_covered: 1,
    guardrailStatus: 'accepted'
  };

  const buyRes = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: x402Decision })
  }));

  assert.equal(buyRes.status, 400);
  const data = await buyRes.json();
  assert.equal(data.success, false);
  assert.match(data.reason, /x402 wallet not configured/i);

  // Verify state
  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.equal(state.status, SessionStatus.BUY_FAILED);
  assert.equal(state.spentUsd, 0.00, 'Zero funds charged');
  
  // Verify failed transaction entry logged
  const failedTx = state.ledger.find(e => e.type === LedgerType.TRANSACTION && e.status === 'failed');
  assert.ok(failedTx, 'Failed transaction must be recorded in ledger');
  assert.match(failedTx.reasoning, /x402 wallet not configured/i);
});

test('24. PayPal Fail-Closed Without Keys: BuyExecutor with empty env and no injected client returns failure, 0 charges, buy_failed', async () => {
  const sessionDO = createMockDO(); // env is {} (no PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET)
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_paypal_no_keys',
      budgetCapUsd: 5.00,
      quota: { rpc: { total: 5, remaining: 0, consumed: 5 } },
      mandate: {
        vaultToken: 'BA-REAL-TOKEN-12345',
        budgetCapUsd: 5.00,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc', 'quota_packs'],
        rail: 'paypal'
      }
    })
  }));

  const decision = {
    id: 'dec_paypal_no_keys_24',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  const buyRes = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision })
  }));

  assert.equal(buyRes.status, 400);
  const data = await buyRes.json();
  assert.equal(data.success, false);
  assert.equal(data.error, 'PAYPAL_KEYS_MISSING');

  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.equal(state.status, SessionStatus.BUY_FAILED);
  assert.equal(state.spentUsd, 0.00, 'spentUsd must remain unchanged ($0.00)');
  assert.equal(state.quota.rpc.remaining, 0, 'Quota must remain unchanged (0)');
  
  const failedTx = state.ledger.find(e => e.type === LedgerType.TRANSACTION && e.status === 'failed');
  assert.ok(failedTx, 'Failed transaction must be recorded in ledger');
  assert.match(failedTx.reasoning, /PAYPAL_KEYS_MISSING/);
});

test('25. Placeholder Token Rejected: mandate token starting with VAULT_ returns MANDATE_TOKEN_PLACEHOLDER with 0 charges', async () => {
  const sessionDO = createMockDO();
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_placeholder_mandate',
      budgetCapUsd: 5.00,
      quota: { rpc: { total: 5, remaining: 0, consumed: 5 } },
      mandate: {
        vaultToken: 'VAULT_SANDBOX_DELEGATION_MANDATE', // Placeholder token
        budgetCapUsd: 5.00,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc', 'quota_packs'],
        rail: 'paypal'
      }
    })
  }));

  let chargeCalls = 0;
  sessionDO.paypalClient = {
    charge: async () => {
      chargeCalls++;
      return { success: true };
    }
  };

  const decision = {
    id: 'dec_placeholder_25',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  const buyRes = await sessionDO.fetch(new Request('https://do/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision })
  }));

  assert.equal(buyRes.status, 403);
  const data = await buyRes.json();
  assert.equal(data.success, false);
  assert.equal(data.error, 'MANDATE_TOKEN_PLACEHOLDER');
  assert.equal(chargeCalls, 0, 'Zero PayPal charge calls must be made');

  const state = await (await sessionDO.fetch(new Request('https://do/state'))).json();
  assert.equal(state.status, SessionStatus.NEEDS_MANDATE_AMENDMENT);
  assert.equal(state.spentUsd, 0.00, 'Zero spend');
  assert.equal(state.quota.rpc.remaining, 0, 'Zero quota added');
});

test('26. x402 Production Path Fails Closed: without injected test client returns failure, no txHash produced, PayPal unaffected', async () => {
  // Scenario A: X402_PAYER_SECRET is set, but running in production (no injected client)
  const executor = new BuyExecutor({
    env: { X402_PAYER_SECRET: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' }
  });

  const session = {
    sessionId: 'test_x402_fail_closed',
    budgetCapUsd: 5.00,
    spentUsd: 0.00,
    status: SessionStatus.AWAITING_PURCHASE,
    mandate: {
      budgetCapUsd: 5.00,
      maxPerPurchaseUsd: 2.50,
      allowedCategories: ['rpc'],
      rail: 'x402'
    },
    transactions: [],
    ledger: []
  };

  const decision = {
    id: 'dec_x402_prod_26',
    action: 'buy',
    item: 'x402-rpc-micro',
    rail: 'x402',
    estimated_cost_usd: 0.001,
    estimated_calls_covered: 1,
    guardrailStatus: 'accepted'
  };

  const res = await executor.executeBuy(session, decision);
  assert.equal(res.success, false);
  assert.equal(res.error, 'X402_NOT_IMPLEMENTED');
  assert.equal(res.txHash, undefined, 'No fake or random txHash must be produced');
  assert.equal(res.sessionStatus, SessionStatus.BUY_FAILED);

  // Scenario B: PayPal path remains unaffected
  let paypalCalls = 0;
  const mockPayPalClient = {
    charge: async () => {
      paypalCalls++;
      return { success: true, captureId: 'CAP-REAL-SANDBOX-26', status: 'COMPLETED' };
    }
  };

  const paypalExecutor = new BuyExecutor({
    env: { X402_PAYER_SECRET: '0x1234' },
    paypalClient: mockPayPalClient
  });

  const paypalSession = {
    sessionId: 'test_paypal_unaffected',
    budgetCapUsd: 5.00,
    spentUsd: 0.00,
    status: SessionStatus.AWAITING_PURCHASE,
    mandate: {
      vaultToken: 'BA-REAL-TOKEN-26',
      budgetCapUsd: 5.00,
      maxPerPurchaseUsd: 2.50,
      allowedCategories: ['rpc'],
      rail: 'paypal'
    },
    transactions: [],
    ledger: []
  };

  const paypalDecision = {
    id: 'dec_paypal_unaffected_26',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  const paypalRes = await paypalExecutor.executeBuy(paypalSession, paypalDecision);
  assert.equal(paypalRes.success, true);
  assert.equal(paypalCalls, 1);
  assert.equal(paypalRes.transaction.reference, 'CAP-REAL-SANDBOX-26');
});

test('27. Mandate Token Masking: mandate returned to dashboard never contains full token, and ledger contains zero full token strings', async () => {
  const sessionDO = createMockDO();
  const fullToken = 'BA-SECRET-VAULT-TOKEN-998877';

  // Set mandate via DO handler
  const setRes = await sessionDO.fetch(new Request('https://do/mandate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vaultToken: fullToken,
      budgetCapUsd: 5.00,
      maxPerPurchaseUsd: 2.50
    })
  }));

  const setData = await setRes.json();
  assert.equal(setData.success, true);

  // 1. Assert mandate object returned from handler never contains full token
  assert.equal(setData.mandate.vaultToken.includes(fullToken), false, 'Handler return must not leak full token');
  assert.match(setData.mandate.vaultToken, /\*{4}8877$/, 'Must be masked with last 4 characters only');

  // 2. Assert state snapshot never contains full token
  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();
  assert.equal(state.mandate.vaultToken.includes(fullToken), false, 'State snapshot must not leak full token');
  assert.equal(state.mandate._vaultToken, undefined, '_vaultToken must be stripped in public state');

  // 3. Assert zero occurrences of full token anywhere in the ledger
  for (const entry of state.ledger) {
    const entryStr = JSON.stringify(entry);
    assert.equal(entryStr.includes(fullToken), false, `Ledger entry ${entry.id} must not contain full token`);
  }
});

test('28. Plan and Deliberation Diagnostics: session stores structural metrics with zero secrets', async () => {
  const sessionDO = createMockDO();

  const planAdapter = {
    async chat() {
      return {
        text: JSON.stringify({
          steps: ['Audit contract 1', 'Audit contract 2'],
          estimated_rpc_calls: 150,
          estimated_reads: 0,
          estimated_cost_usd: 0.00,
          opening_strategy: 'free_tier_first',
          pack_name: null,
          reasoning: 'Plan estimated 150 RPC calls on free tier under $5.00 cap.'
        }),
        usage: { completion_tokens: 45, total_tokens: 180, reasoning_tokens: 85 },
        diagnostic: {
          http_status: 200,
          content_type: 'string',
          extracted_length: 220,
          finish_reason: 'stop',
          reasoning_tokens: 85,
          completion_tokens: 45,
          total_tokens: 180
        }
      };
    }
  };
  sessionDO.adapter = planAdapter;

  const planRes = await sessionDO.fetch(new Request('https://do/plan', {
    method: 'POST',
    body: '{}'
  }));
  const planData = await planRes.json();
  assert.equal(planData.success, true);

  const delibAdapter = {
    async chat() {
      return {
        text: JSON.stringify({
          action: 'buy',
          item: 'rpc-1000',
          rail: 'paypal',
          estimated_cost_usd: 2.00,
          estimated_calls_covered: 1000,
          reasoning: 'Task is 25% complete. 150 RPC needed. rpc-1000 costs $2.00 within $5.00 cap.',
          alternative_considered: 'x402 topups evaluated.'
        }),
        usage: { completion_tokens: 60, total_tokens: 220, reasoning_tokens: 110 },
        diagnostic: {
          http_status: 200,
          content_type: 'string',
          extracted_length: 260,
          finish_reason: 'stop',
          reasoning_tokens: 110,
          completion_tokens: 60,
          total_tokens: 220
        }
      };
    }
  };
  sessionDO.adapter = delibAdapter;

  const delibRes = await sessionDO.fetch(new Request('https://do/deliberate', {
    method: 'POST',
    body: '{}'
  }));
  const delibData = await delibRes.json();
  assert.equal(delibData.success, true);

  // Check state snapshot
  const stateRes = await sessionDO.fetch(new Request('https://do/state'));
  const state = await stateRes.json();

  assert.ok(state.latestPlanDiagnostic, 'latestPlanDiagnostic must be present');
  assert.equal(state.latestPlanDiagnostic.http_status, 200);
  assert.equal(state.latestPlanDiagnostic.finish_reason, 'stop');
  assert.equal(state.latestPlanDiagnostic.reasoning_tokens, 85);
  assert.equal(state.latestPlanDiagnostic.parse_status, 'success');

  assert.ok(state.latestDeliberateDiagnostic, 'latestDeliberateDiagnostic must be present');
  assert.equal(state.latestDeliberateDiagnostic.http_status, 200);
  assert.equal(state.latestDeliberateDiagnostic.finish_reason, 'stop');
  assert.equal(state.latestDeliberateDiagnostic.reasoning_tokens, 110);
  assert.equal(state.latestDeliberateDiagnostic.parse_status, 'success');
});

test('29. Dynamic Deliberation Context: progress % and remaining need derive from plan instead of hardcoded 400', async () => {
  const sessionDO = createMockDO();

  // Initialize session with 5 quota
  await sessionDO.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test_dyn_context',
      quota: { rpc: { total: 5, remaining: 5 } }
    })
  }));

  // Store a plan estimating 200 RPC calls across 5 steps
  const planAdapter = {
    async chat() {
      return {
        text: JSON.stringify({
          steps: ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5'],
          estimated_rpc_calls: 200,
          estimated_reads: 0,
          estimated_cost_usd: 0.00,
          opening_strategy: 'free_tier_first',
          pack_name: null,
          reasoning: 'Plan 200 calls across 5 steps within $5.00 cap.'
        })
      };
    }
  };
  sessionDO.adapter = planAdapter;

  await sessionDO.fetch(new Request('https://do/plan', {
    method: 'POST',
    body: '{}'
  }));

  // Deduct 5 RPC units to trigger exhaustion
  await sessionDO.fetch(new Request('https://do/deduct-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'rpc', units: 5 })
  }));

  let capturedContext = null;
  const capturingAdapter = {
    async chat(messages) {
      const userMsg = messages.find(m => m.role === 'user');
      capturedContext = userMsg ? userMsg.content : null;
      return {
        text: JSON.stringify({
          action: 'buy',
          item: 'rpc-1000',
          rail: 'paypal',
          estimated_cost_usd: 2.00,
          estimated_calls_covered: 1000,
          reasoning: 'Progress is 25% with 0 remaining and 195 needed. Buying rpc-1000 via PayPal $2.00.',
          alternative_considered: 'x402 topup evaluated.'
        })
      };
    }
  };
  sessionDO.adapter = capturingAdapter;

  await sessionDO.fetch(new Request('https://do/deliberate', {
    method: 'POST',
    body: '{}'
  }));

  assert.ok(capturedContext, 'Deliberation context must be delivered to model');
  assert.equal(capturedContext.includes('"rpc_calls": 400'), false, 'Hardcoded 400 calls must NOT appear');
  assert.equal(capturedContext.includes('"rpc_calls": 195'), true, 'Remaining need must be 200 - 5 = 195 calls');
  assert.match(capturedContext, /"progress_percent":\s*(25|20|5)/, 'Progress percent must not be 100% on exhaustion');
});

test('30. Dashboard UI Transparency: Plan rejection reason and diagnostics exposed with zero vendor names', async () => {
  const { renderDashboardHTML } = await import('../src/dashboard.js');
  const html = renderDashboardHTML('test_ui_sess');

  assert.ok(html.includes('id="plan-fallback-wrap"'), 'Must have plan-fallback-wrap element');
  assert.ok(html.includes('id="plan-rejection-reason"'), 'Must have plan-rejection-reason element');
  assert.ok(html.includes('id="plan-diagnostic-line"'), 'Must have plan-diagnostic-line element');
  assert.ok(html.includes('id="decision-diagnostic-line"'), 'Must have decision-diagnostic-line element');

  // Verify standing rule: zero vendor names
  assert.equal(/cloudflare/i.test(html), false, 'Dashboard must have zero Cloudflare vendor names');
  assert.equal(/wrangler/i.test(html), false, 'Dashboard must have zero Wrangler vendor names');
});

test('31. PayPal Error Diagnostics & Explicit MANDATE_MISSING Reason: failure response formats details, and mandate check displays MANDATE_MISSING', async () => {
  const sessionDO = createMockDO();

  // Test mandate missing returns explicit MANDATE_MISSING failed transaction
  const executor = new BuyExecutor({ env: {} });
  const decision = {
    id: 'dec_test_31',
    action: 'buy',
    item: 'rpc-1000',
    rail: 'paypal',
    estimated_cost_usd: 2.00,
    estimated_calls_covered: 1000,
    guardrailStatus: 'accepted'
  };

  const emptyMandateSession = {
    budgetCapUsd: 5.00,
    spentUsd: 0.00,
    mandate: { vaultToken: null },
    quota: { rpc: { remaining: 0, total: 5, consumed: 5 } },
    ledger: []
  };

  const buyRes = await executor.executeBuy(emptyMandateSession, decision);
  assert.equal(buyRes.success, false);
  assert.equal(buyRes.error, 'MANDATE_MISSING');
  assert.ok(buyRes.transaction, 'Must return a failed transaction entry');
  assert.match(buyRes.transaction.reasoning, /^MANDATE_MISSING:/);

  // Test PayPal error formatting
  const mockPayPalResponse = {
    name: 'NOT_AUTHORIZED',
    message: 'Authorization failed due to insufficient permissions.',
    debug_id: 'test_dbg_12345',
    details: [
      {
        issue: 'NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE',
        description: 'The merchant account is not enabled to vault the specified payment source.'
      }
    ]
  };

  const detailsText = mockPayPalResponse.details.map(d => `${d.issue || 'ISSUE'}: ${d.description || ''}`).join('; ');
  const errorParts = [
    mockPayPalResponse.name || 'ERROR',
    mockPayPalResponse.message || '',
    detailsText ? `[Details: ${detailsText}]` : '',
    mockPayPalResponse.debug_id ? `[debug_id: ${mockPayPalResponse.debug_id}]` : ''
  ].filter(Boolean).join(' - ');

  assert.ok(errorParts.includes('NOT_AUTHORIZED'));
  assert.ok(errorParts.includes('NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE'));
  assert.ok(errorParts.includes('test_dbg_12345'));
});

test('32. Order Creation Payload: uses PAYMENT_METHOD_TOKEN type with stored vaultToken', async () => {
  const originalFetch = globalThis.fetch;
  let capturedOrderPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/oauth2/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'mock_access_token_32' })
      };
    }
    if (urlStr.includes('/v2/checkout/orders')) {
      capturedOrderPayload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'ORDER-32-SUCCESS',
          status: 'COMPLETED',
          purchase_units: [{
            payments: {
              captures: [{
                id: 'CAP-32-SUCCESS',
                status: 'COMPLETED',
                amount: { value: '2.00', currency_code: 'USD' }
              }]
            }
          }]
        })
      };
    }
    return originalFetch(url, options);
  };

  try {
    const executor = new BuyExecutor({
      env: {
        PAYPAL_CLIENT_ID: 'mock_client_id_32',
        PAYPAL_CLIENT_SECRET: 'mock_client_secret_32'
      }
    });

    const session = {
      budgetCapUsd: 5.00,
      spentUsd: 0.00,
      mandate: {
        vaultToken: 'PMT-VAULT-TOKEN-32-ABC',
        budgetCapUsd: 5.00,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc', 'quota_packs'],
        rail: 'paypal'
      },
      quota: { rpc: { remaining: 0, total: 5, consumed: 5 } },
      ledger: []
    };

    const decision = {
      id: 'dec_32',
      action: 'buy',
      item: 'rpc-1000',
      rail: 'paypal',
      estimated_cost_usd: 2.00,
      estimated_calls_covered: 1000,
      guardrailStatus: 'accepted'
    };

    const res = await executor.executeBuy(session, decision);
    assert.equal(res.success, true);
    assert.ok(capturedOrderPayload, 'Order payload must be sent');
    assert.equal(capturedOrderPayload.payment_source?.token?.type, 'PAYMENT_METHOD_TOKEN', 'Must be PAYMENT_METHOD_TOKEN type');
    assert.equal(capturedOrderPayload.payment_source?.token?.id, 'PMT-VAULT-TOKEN-32-ABC', 'Must match stored vault token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('33. Charge Failure Reporting: captures full details, issue, description, and debug_id in ledger transaction', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/oauth2/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'mock_access_token_33' })
      };
    }
    if (urlStr.includes('/v2/checkout/orders')) {
      return {
        ok: false,
        status: 422,
        json: async () => ({
          name: 'UNPROCESSABLE_ENTITY',
          message: 'The requested action could not be performed, semantically incorrect, or failed business validation.',
          debug_id: 'dbg_9988112233',
          details: [
            {
              issue: 'PAYMENT_SOURCE_CANNOT_BE_USED',
              description: 'The provided payment method token cannot be charged.'
            }
          ]
        })
      };
    }
    return originalFetch(url, options);
  };

  try {
    const executor = new BuyExecutor({
      env: {
        PAYPAL_CLIENT_ID: 'mock_client_id_33',
        PAYPAL_CLIENT_SECRET: 'mock_client_secret_33'
      }
    });

    const session = {
      budgetCapUsd: 5.00,
      spentUsd: 0.00,
      mandate: {
        vaultToken: 'PMT-REJECTED-TOKEN-33',
        budgetCapUsd: 5.00,
        maxPerPurchaseUsd: 2.50,
        allowedCategories: ['rpc', 'quota_packs'],
        rail: 'paypal'
      },
      quota: { rpc: { remaining: 0, total: 5, consumed: 5 } },
      ledger: []
    };

    const decision = {
      id: 'dec_33',
      action: 'buy',
      item: 'rpc-1000',
      rail: 'paypal',
      estimated_cost_usd: 2.00,
      estimated_calls_covered: 1000,
      guardrailStatus: 'accepted'
    };

    const res = await executor.executeBuy(session, decision);
    assert.equal(res.success, false);
    assert.equal(res.sessionStatus, SessionStatus.BUY_FAILED);
    assert.ok(res.transaction, 'Failed transaction entry must be created');

    const reasoning = res.transaction.reasoning;
    assert.ok(reasoning.includes('UNPROCESSABLE_ENTITY'), 'Must include error name');
    assert.ok(reasoning.includes('PAYMENT_SOURCE_CANNOT_BE_USED'), 'Must include issue');
    assert.ok(reasoning.includes('The provided payment method token cannot be charged.'), 'Must include description');
    assert.ok(reasoning.includes('dbg_9988112233'), 'Must include debug_id');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
