/**
 * AgentPay Agent Loop v1 Task Executor
 * 
 * Executes real multi-chain tasks using generic MCP tools (skuuy-mcp & ondocs).
 * Consumes REAL RPC quota on each execution step.
 * 
 * Strict v1 Rule (§8):
 * - At quota exhaustion (remaining === 0), loop PAUSES CLEANLY.
 * - DOES NOT BUY ANYTHING YET (economic deliberation & buy wiring are scheduled for 29-30 Oct).
 */

import { MCPClient } from './mcp-client.js';
import { SessionStatus, LedgerType, ResourceType, DEFAULT_MCP_SERVERS } from './types.js';

export class AgentLoop {
  /**
   * @param {Object} doStub - Durable Object stub or mock coordinator
   * @param {Array} servers - List of MCP server configs
   * @param {Object} [options] - Loop options (e.g. customAdapter for brain)
   */
  constructor(doStub, servers = DEFAULT_MCP_SERVERS, options = {}) {
    this.doStub = doStub;
    this.mcpClient = new MCPClient(servers);
    this.customAdapter = options.customAdapter || null;
    this.initialized = false;
    this.ondocsProofRan = false;
    this.deliberationRan = false;
  }

  /**
   * Initialize generic MCP connections and register server status in DO
   */
  async setup() {
    if (this.initialized) return;

    // Connect to all configured servers (skuuy-mcp + ondocs)
    const serverStatuses = await this.mcpClient.initializeAll();
    
    // Update connected servers snapshot in DO
    if (this.doStub) {
      await this.doStub.fetch('https://do/update-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: serverStatuses })
      });
    }

    // Execute ondocs proof shot ONCE ONLY (§8 locked rule: never in loop cycles)
    if (!this.ondocsProofRan) {
      this.ondocsProofRan = true;
      try {
        await this.mcpClient.callTool('search', { query: 'getting started' });
        if (this.doStub) {
          await this.doStub.fetch('https://do/add-ledger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: LedgerType.SYSTEM,
              resource: null,
              units: 0,
              costUsd: 0,
              rail: null,
              reasoning: 'Verified multi-server generic MCP connectivity: ondocs discovery proof successful (read-only)',
              status: 'success'
            })
          });
        }
      } catch (err) {
        // ondocs failure must NEVER deduct quota and must NEVER halt the task
        // But MUST record a transparent failed SYSTEM entry so failure is visible (§8)
        console.warn('[!] ondocs one-time proof shot non-blocking note:', err.message);
        if (this.doStub) {
          await this.doStub.fetch('https://do/add-ledger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: LedgerType.SYSTEM,
              resource: null,
              units: 0,
              costUsd: 0,
              rail: null,
              reasoning: `Multi-server generic MCP proof shot: ondocs unreachable (${err.message.slice(0, 100)}). Non-blocking, task continuing.`,
              status: 'failed'
            })
          });
        }
      }
    }

    this.initialized = true;
    return serverStatuses;
  }

  /**
   * Execute a single step in the task sequence
   * @param {number} stepIndex
   */
  async executeStep(stepIndex) {
    await this.setup();

    // 1. Check current session state from DO
    const stateRes = await this.doStub.fetch('https://do/state');
    const state = await stateRes.json();

    if (state.isFrozen) {
      return {
        halted: true,
        reason: 'SESSION_FROZEN',
        status: SessionStatus.FROZEN_BY_KILLSWITCH
      };
    }

    if (state.status === SessionStatus.PAUSED_QUOTA_EXHAUSTED || state.quota.rpc.remaining <= 0) {
      return {
        halted: true,
        reason: 'QUOTA_EXHAUSTED',
        status: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // 2. Define real task steps (pure RPC audit tasks, zero ondocs dependency in loop)
    // Multi-chain wallet & contract freshness audit
    const demoSteps = [
      {
        name: 'Query Base latest block height',
        type: 'rpc',
        server: 'skuuy-mcp',
        tool: 'skuuy_rpc',
        args: { chain: 'base', method: 'eth_blockNumber', params: [] },
        resource: ResourceType.RPC,
        units: 1,
        desc: 'Read latest blockNumber from Base via skuuy_rpc'
      },
      {
        name: 'Query Ethereum latest block height',
        type: 'rpc',
        server: 'skuuy-mcp',
        tool: 'skuuy_rpc',
        args: { chain: 'eth', method: 'eth_blockNumber', params: [] },
        resource: ResourceType.RPC,
        units: 1,
        desc: 'Read latest blockNumber from Ethereum via skuuy_rpc'
      },
      {
        name: 'Verify Base chain ID',
        type: 'rpc',
        server: 'skuuy-mcp',
        tool: 'skuuy_rpc',
        args: { chain: 'base', method: 'eth_chainId', params: [] },
        resource: ResourceType.RPC,
        units: 1,
        desc: 'Verified Base chainId via skuuy_rpc'
      },
      {
        name: 'Audit Vitalik wallet balance on Base',
        type: 'rpc',
        server: 'skuuy-mcp',
        tool: 'skuuy_rpc',
        args: { chain: 'base', method: 'eth_getBalance', params: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'latest'] },
        resource: ResourceType.RPC,
        units: 1,
        desc: 'Checked Vitalik wallet balance on Base'
      },
      {
        name: 'Audit 1inch router balance on Base',
        type: 'rpc',
        server: 'skuuy-mcp',
        tool: 'skuuy_rpc',
        args: { chain: 'base', method: 'eth_getBalance', params: ['0x1111111254fb6c44bac0bed2854e76f90643097d', 'latest'] },
        resource: ResourceType.RPC,
        units: 1,
        desc: 'Checked 1inch router balance on Base'
      }
    ];

    // Pick action for this step (cycling through real calls)
    const taskDef = demoSteps[stepIndex % demoSteps.length];

    // 3. Update status to EXECUTING
    await this.doStub.fetch('https://do/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: SessionStatus.EXECUTING, reason: taskDef.name })
    });

    // 4. Execute real tool call on the live MCP server
    let toolResult;
    try {
      toolResult = await this.mcpClient.callTool(taskDef.tool, taskDef.args);
    } catch (err) {
      toolResult = { success: false, error: err.message };
    }

    // If tool execution failed, DO NOT deduct quota (charge only on success)
    if (!toolResult.success) {
      await this.doStub.fetch('https://do/add-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: LedgerType.USAGE,
          resource: taskDef.resource,
          units: 0,
          costUsd: 0.00,
          rail: 'free_tier',
          reasoning: `${taskDef.desc} failed (${toolResult.error || 'MCP error'}). Zero quota deducted.`,
          status: 'failed'
        })
      });

      return {
        halted: false,
        step: taskDef.name,
        status: SessionStatus.EXECUTING,
        toolSuccess: false,
        error: toolResult.error
      };
    }

    // 5. Tool succeeded: deduct quota atomically from DO
    const deductRes = await this.doStub.fetch('https://do/deduct-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: taskDef.resource, units: taskDef.units })
    });

    const deductData = await deductRes.json();

    // 6. Record zero-log spend ledger entry for successful execution
    await this.doStub.fetch('https://do/add-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: LedgerType.USAGE,
        resource: taskDef.resource,
        units: taskDef.units,
        costUsd: 0.00,
        rail: 'free_tier',
        reasoning: `${taskDef.desc} (MCP tool: ${taskDef.tool}, server: ${taskDef.server})`,
        status: 'success'
      })
    });

    // 7. Check if quota exhausted after this call
    if (!deductData.success || deductData.status === SessionStatus.PAUSED_QUOTA_EXHAUSTED) {
      let deliberateResult = null;
      if (!this.deliberationRan && this.doStub) {
        this.deliberationRan = true;
        try {
          const dRes = await this.doStub.fetch('https://do/deliberate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customAdapter: this.customAdapter || null
            })
          });
          deliberateResult = await dRes.json();
        } catch (delibErr) {
          console.warn('[!] Deliberation invocation error:', delibErr.message);
        }
      }

      return {
        halted: true,
        reason: 'QUOTA_EXHAUSTED',
        status: deliberateResult?.sessionStatus || SessionStatus.PAUSED_QUOTA_EXHAUSTED,
        decision: deliberateResult?.decision || null,
        step: taskDef.name,
        remaining: deductData.remaining
      };
    }

    return {
      halted: false,
      step: taskDef.name,
      status: SessionStatus.EXECUTING,
      remaining: deductData.remaining,
      toolSuccess: toolResult.success
    };
  }

  /**
   * Run the loop until completion or quota exhaustion
   * @param {number} maxSteps
   */
  async runUntilPause(maxSteps = 50) {
    await this.setup();

    const results = [];
    for (let i = 0; i < maxSteps; i++) {
      const stepRes = await this.executeStep(i);
      results.push(stepRes);

      if (stepRes.halted) {
        break;
      }
    }

    const finalStateRes = await this.doStub.fetch('https://do/state');
    const finalState = await finalStateRes.json();

    return {
      completedSteps: results.length,
      finalStatus: finalState.status,
      quotaRemaining: finalState.quota,
      isFrozen: finalState.isFrozen,
      steps: results
    };
  }
}
