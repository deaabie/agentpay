/**
 * AgentSession Durable Object
 * 
 * Provides single-threaded, authoritative state coordination for an agent session.
 * Features:
 * - State machine: IDLE -> PLANNING -> EXECUTING -> MONITORING -> PAUSED_QUOTA_EXHAUSTED
 * - Strictly zero-log spend ledger
 * - Atomic quota tracking
 * - Owner-only kill switch (instant freeze)
 * - Real-time SSE broadcasting to connected dashboards
 */

import { SessionStatus, LedgerType, INITIAL_DEMO_QUOTA, CATALOGUE_ALLOWLIST } from './types.js';
import { Brain } from './brain.js';
import { MetaModelAdapter } from './meta-adapter.js';

export class AgentSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.subscribers = new Set();
  }

  /**
   * Main fetch dispatcher for DO requests
   */
  async fetch(request, init) {
    const req = typeof request === 'string' ? new Request(request, init) : request;
    const url = new URL(req.url);
    const action = url.pathname.replace(/^\//, '');

    try {
      if (action === 'init' && req.method === 'POST') {
        const body = await req.json();
        return await this.handleInit(body);
      }

      if (action === 'state' && req.method === 'GET') {
        const state = await this.getState();
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (action === 'freeze' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return await this.handleFreeze(body.freeze);
      }

      if (action === 'deduct-quota' && req.method === 'POST') {
        const body = await req.json();
        return await this.handleDeductQuota(body);
      }

      if (action === 'add-ledger' && req.method === 'POST') {
        const body = await req.json();
        return await this.handleAddLedger(body);
      }

      if (action === 'update-status' && req.method === 'POST') {
        const body = await req.json();
        return await this.handleUpdateStatus(body.status, body.reason);
      }

      if (action === 'update-servers' && req.method === 'POST') {
        const body = await req.json();
        return await this.handleUpdateServers(body.servers);
      }

      if (action === 'deliberate' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return await this.handleDeliberate(body);
      }

      if (action === 'stream') {
        return this.handleStream(req);
      }

      return new Response(JSON.stringify({ error: 'Action not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Initialize or reset a session
   */
  async handleInit(body) {
    const sessionData = {
      sessionId: body.sessionId || `sess_${Date.now()}`,
      task: body.task || 'Audit multi-chain smart contracts & wallet activity on Base and Ethereum',
      budgetCapUsd: Number(body.budgetCapUsd) || 5.00,
      spentUsd: 0.00,
      status: SessionStatus.IDLE,
      isFrozen: false,
      stepCount: 0,
      quota: {
        rpc: {
          total: body.quota?.rpc?.total ?? INITIAL_DEMO_QUOTA.rpc.total,
          remaining: body.quota?.rpc?.remaining ?? INITIAL_DEMO_QUOTA.rpc.remaining,
          consumed: 0
        },
        read: {
          total: body.quota?.read?.total ?? INITIAL_DEMO_QUOTA.read.total,
          remaining: body.quota?.read?.remaining ?? INITIAL_DEMO_QUOTA.read.remaining,
          consumed: 0
        },
        file: {
          total: body.quota?.file?.total ?? INITIAL_DEMO_QUOTA.file.total,
          remaining: body.quota?.file?.remaining ?? INITIAL_DEMO_QUOTA.file.remaining,
          consumed: 0
        }
      },
      ledger: [
        {
          id: `ledg_${Date.now()}_init`,
          timestamp: new Date().toISOString(),
          type: LedgerType.SYSTEM,
          resource: null,
          units: 0,
          costUsd: 0,
          rail: null,
          reasoning: `Session initialized. Budget delegated: $${(Number(body.budgetCapUsd) || 5.00).toFixed(2)}. Demo RPC quota: ${body.quota?.rpc?.remaining ?? INITIAL_DEMO_QUOTA.rpc.remaining} units.`,
          status: 'success'
        }
      ],
      connectedServers: body.connectedServers || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await this.state.storage.put('session', sessionData);
    this.broadcast('session_init', sessionData);

    return new Response(JSON.stringify({ success: true, session: sessionData }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Retrieve state with lazy initialization fallback
   */
  async getState() {
    let session = await this.state.storage.get('session');
    if (!session) {
      session = {
        sessionId: `sess_${Date.now()}`,
        task: 'Audit multi-chain wallet activity on Base and Ethereum',
        budgetCapUsd: 5.00,
        spentUsd: 0.00,
        status: SessionStatus.IDLE,
        isFrozen: false,
        stepCount: 0,
        quota: JSON.parse(JSON.stringify(INITIAL_DEMO_QUOTA)),
        ledger: [],
        connectedServers: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await this.state.storage.put('session', session);
    }
    return session;
  }

  /**
   * Owner-only kill switch toggle
   */
  async handleFreeze(shouldFreeze) {
    const session = await this.getState();
    const freezeState = typeof shouldFreeze === 'boolean' ? shouldFreeze : !session.isFrozen;
    
    session.isFrozen = freezeState;
    if (freezeState) {
      session.status = SessionStatus.FROZEN_BY_KILLSWITCH;
      session.ledger.push({
        id: `ledg_${Date.now()}_freeze`,
        timestamp: new Date().toISOString(),
        type: LedgerType.SYSTEM,
        resource: null,
        units: 0,
        costUsd: 0,
        rail: null,
        reasoning: 'EMERGENCY KILL SWITCH ACTIVATED: Owner froze the agent session.',
        status: 'paused'
      });
    } else {
      session.status = SessionStatus.IDLE;
      session.ledger.push({
        id: `ledg_${Date.now()}_unfreeze`,
        timestamp: new Date().toISOString(),
        type: LedgerType.SYSTEM,
        resource: null,
        units: 0,
        costUsd: 0,
        rail: null,
        reasoning: 'Kill switch deactivated: Session unfrozen by owner.',
        status: 'success'
      });
    }

    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('freeze_toggled', session);

    return new Response(JSON.stringify({ success: true, isFrozen: session.isFrozen, status: session.status }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Atomically deduct quota and check for exhaustion
   */
  async handleDeductQuota({ resource = 'rpc', units = 1 }) {
    const session = await this.getState();

    if (session.isFrozen) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SESSION_FROZEN',
        message: 'Cannot deduct quota: session is frozen by kill switch.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const quotaBucket = session.quota[resource];
    if (!quotaBucket) {
      return new Response(JSON.stringify({ success: false, error: 'UNKNOWN_RESOURCE' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if exhaustion reached
    if (quotaBucket.remaining < units) {
      session.status = SessionStatus.PAUSED_QUOTA_EXHAUSTED;
      
      const ledgerEntry = {
        id: `ledg_${Date.now()}_exhaustion`,
        timestamp: new Date().toISOString(),
        type: LedgerType.SYSTEM,
        resource,
        units: 0,
        costUsd: 0,
        rail: null,
        reasoning: `Quota exhausted for ${resource.toUpperCase()} (${quotaBucket.remaining} remaining, needed ${units}). Agent loop cleanly paused awaiting economic deliberation.`,
        status: 'paused'
      };

      session.ledger.push(ledgerEntry);
      session.updated_at = new Date().toISOString();
      await this.state.storage.put('session', session);
      this.broadcast('quota_exhausted', { session, resource });

      return new Response(JSON.stringify({
        success: false,
        error: 'QUOTA_EXHAUSTED',
        status: session.status,
        remaining: quotaBucket.remaining,
        needed: units
      }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Deduct quota atomically
    quotaBucket.remaining -= units;
    quotaBucket.consumed += units;
    session.stepCount += 1;

    // Check if remaining hit exactly zero
    if (quotaBucket.remaining === 0) {
      session.status = SessionStatus.PAUSED_QUOTA_EXHAUSTED;
      session.ledger.push({
        id: `ledg_${Date.now()}_zero`,
        timestamp: new Date().toISOString(),
        type: LedgerType.SYSTEM,
        resource,
        units: 0,
        costUsd: 0,
        rail: null,
        reasoning: `Demo session ${resource.toUpperCase()} quota reached 0. Loop cleanly PAUSED. Ready for deliberation.`,
        status: 'paused'
      });
    }

    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('quota_deducted', { resource, remaining: quotaBucket.remaining, consumed: quotaBucket.consumed, status: session.status });

    return new Response(JSON.stringify({
      success: true,
      resource,
      remaining: quotaBucket.remaining,
      consumed: quotaBucket.consumed,
      status: session.status
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Append zero-log spend ledger entry
   */
  async handleAddLedger(entry) {
    const session = await this.getState();

    // Zero-Log Discipline Validation: only allow lean fields
    const safeEntry = {
      id: entry.id || `ledg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      type: entry.type || LedgerType.USAGE,
      resource: entry.resource || null,
      units: Number(entry.units) || 0,
      costUsd: entry.costUsd !== undefined ? Number(entry.costUsd) : 0,
      rail: entry.rail || null,
      reasoning: entry.reasoning ? String(entry.reasoning).slice(0, 500) : null,
      status: entry.status || 'success'
    };

    session.ledger.push(safeEntry);
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('ledger_added', safeEntry);

    return new Response(JSON.stringify({ success: true, entry: safeEntry }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Update session status
   */
  async handleUpdateStatus(newStatus, reason = '') {
    const session = await this.getState();
    session.status = newStatus;
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('status_changed', { status: newStatus, reason });

    return new Response(JSON.stringify({ success: true, status: newStatus }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Update connected MCP servers list
   */
  async handleUpdateServers(servers) {
    const session = await this.getState();
    session.connectedServers = servers || [];
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('servers_updated', session.connectedServers);

    return new Response(JSON.stringify({ success: true, servers: session.connectedServers }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Autonomous Economic Deliberation via Brain & Muse Spark
   * Invoked at quota exhaustion. Evaluates pricing, applies hard code guardrails.
   * Validated buy decisions end in 'awaiting_purchase'. ZERO charges occur today (§0).
   */
  async handleDeliberate(body = {}) {
    const session = await this.getState();

    if (session.isFrozen) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SESSION_FROZEN',
        message: 'Cannot deliberate: session is frozen by kill switch.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    session.status = SessionStatus.DELIBERATING;
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('status_changed', { status: SessionStatus.DELIBERATING, reason: 'Initiating economic deliberation with Muse Spark' });

    // Build structured deliberation context
    const context = {
      task: session.task,
      progress_percent: body.progress_percent ?? Math.min(100, Math.round((session.stepCount / 20) * 100) || 60),
      completed_steps: session.stepCount,
      quota_remaining: {
        rpc: session.quota.rpc.remaining,
        read: session.quota.read.remaining,
        file: session.quota.file.remaining
      },
      quota_consumed: {
        rpc: session.quota.rpc.consumed,
        read: session.quota.read.consumed,
        file: session.quota.file.consumed
      },
      budget_cap_usd: session.budgetCapUsd,
      spent_usd: session.spentUsd,
      session_spending_history: session.ledger.filter(l => l.type === LedgerType.TRANSACTION || l.type === LedgerType.DECISION),
      tools_available: body.tools_available || ['skuuy_rpc', 'search'],
      estimated_remaining_need: body.estimated_remaining_need || { rpc_calls: 400, note: 'Estimated remaining workload from unfinished task steps' }
    };

    let adapter = body.customAdapter || this.customAdapter || this.adapter || this.env?.adapter;
    if (!adapter || typeof adapter.chat !== 'function') {
      const apiKey = this.env?.META_MODEL_API_KEY || null;
      adapter = new MetaModelAdapter({ apiKey });
    }

    const brain = new Brain(adapter);
    const decision = await brain.deliberate(context);

    // Save decision to ledger as a DECISION entry
    const catalogueEntry = CATALOGUE_ALLOWLIST.find(c => c.item === decision.item);
    const ledgerEntry = {
      id: `ledg_${Date.now()}_decision`,
      timestamp: new Date().toISOString(),
      type: LedgerType.DECISION,
      resource: catalogueEntry ? catalogueEntry.resource : null,
      units: decision.estimated_calls_covered || 0,
      costUsd: decision.estimated_cost_usd || 0,
      rail: decision.rail || null,
      action: decision.action,
      item: decision.item,
      reasoning: decision.reasoning,
      alternativeConsidered: decision.alternative_considered || null,
      guardrailStatus: decision.guardrailStatus,
      rejectionReason: decision.rejectionReason,
      status: decision.guardrailStatus === 'accepted' ? 'success' : 'failed'
    };

    session.ledger.push(ledgerEntry);
    session.status = decision.nextSessionStatus;
    session.latestDecision = decision;
    session.updated_at = new Date().toISOString();

    await this.state.storage.put('session', session);
    this.broadcast('decision_made', { decision, ledgerEntry, sessionStatus: session.status });

    return new Response(JSON.stringify({
      success: true,
      decision,
      ledgerEntry,
      sessionStatus: session.status
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Server-Sent Events (SSE) Stream handler for live dashboard
   */
  handleStream(request) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    this.subscribers.add(writer);

    // Send initial snapshot
    this.getState().then(state => {
      writer.write(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`));
    }).catch(() => {});

    request.signal.addEventListener('abort', () => {
      this.subscribers.delete(writer);
      try { writer.close(); } catch (e) {}
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * Broadcast SSE event to all connected dashboards
   */
  broadcast(event, data) {
    const encoder = new TextEncoder();
    const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    for (const writer of this.subscribers) {
      writer.write(payload).catch(() => {
        this.subscribers.delete(writer);
      });
    }
  }
}
