/**
 * AgentSession Durable Object
 * 
 * Provides single-threaded, authoritative state coordination for an agent session.
 * Features:
 * - State machine: IDLE -> PLANNING -> EXECUTING -> MONITORING -> PAUSED_QUOTA_EXHAUSTED
 * - Strictly zero-log spend ledger
 * - Atomic quota tracking
 * - Operator freeze button (public demo endpoint; sealed proof sessions are protected server-side)
 * - Real-time SSE broadcasting to connected dashboards
 */

import { SessionStatus, LedgerType, INITIAL_DEMO_QUOTA, CATALOGUE_ALLOWLIST, DEFAULT_MANDATE, SEALED_PROOF_SESSIONS, maskVaultToken } from './types.js';
import { Brain } from './brain.js';
import { Planner } from './plan.js';
import { BuyExecutor } from './buy-executor.js';
import { MetaModelAdapter } from './meta-adapter.js';
import { ReceiptGenerator } from './receipts.js';

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

    // Server-side Defense-in-Depth: Block mutating actions on sealed proof sessions
    const currentState = await this.getState();
    if (SEALED_PROOF_SESSIONS.has(currentState.sessionId)) {
      if (action !== 'state' && action !== 'stream') {
        return new Response(JSON.stringify({
          success: false,
          error: 'SESSION_SEALED',
          message: 'Session is an immutable proof artifact and cannot be modified.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    try {
      if (action === 'init' && req.method === 'POST') {
        const body = await req.json();
        return await this.handleInit(body);
      }

      if (action === 'state' && req.method === 'GET') {
        const state = await this.getState();
        return new Response(JSON.stringify(this._sanitizeSession(state)), {
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

      if (action === 'plan' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return await this.handlePlan(body);
      }

      if (action === 'buy' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return await this.handleBuy(body);
      }

      if (action === 'mandate' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return await this.handleMandate(body);
      }

      if (action === 'backfill-receipt' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return await this.handleBackfillReceipt(body);
      }

      if (action === 'report' && req.method === 'POST') {
        return await this.handleFinancialReport();
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
    if (body.sessionId && SEALED_PROOF_SESSIONS.has(body.sessionId)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SESSION_SEALED',
        message: 'Cannot re-initialize sealed proof session.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    let mandate = body.mandate ? JSON.parse(JSON.stringify(body.mandate)) : JSON.parse(JSON.stringify(DEFAULT_MANDATE));
    if (mandate.vaultToken) {
      const raw = mandate._vaultToken || mandate.vaultToken;
      mandate._vaultToken = raw;
      mandate.vaultToken = maskVaultToken(raw);
    }

    const sessionData = {
      sessionId: body.sessionId || `sess_${Date.now()}`,
      task: body.task || 'Audit multi-chain smart contracts & wallet activity on Base and Ethereum',
      budgetCapUsd: Number(body.budgetCapUsd) || 5.00,
      spentUsd: 0.00,
      status: SessionStatus.IDLE,
      isFrozen: false,
      stepCount: 0,
      latestDecision: null,
      latestPlan: null,
      latestPlanDiagnostic: null,
      latestDeliberateDiagnostic: null,
      mandate,
      transactions: [],
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
    this.broadcast('session_init', this._sanitizeSession(sessionData));

    return new Response(JSON.stringify({ success: true, session: this._sanitizeSession(sessionData) }), {
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
        latestDecision: null,
        latestPlan: null,
        latestPlanDiagnostic: null,
        latestDeliberateDiagnostic: null,
        mandate: JSON.parse(JSON.stringify(DEFAULT_MANDATE)),
        transactions: [],
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
   * Operator freeze button toggle (public demo endpoint; sealed proof sessions are protected server-side)
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
      reference: entry.reference ? String(entry.reference).slice(0, 100) : null,
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

    // Derive workload estimates from latest plan and consumed quota
    const plannedRpc = session.latestPlan?.estimated_rpc_calls || 150;
    const consumedRpc = session.quota?.rpc?.consumed || session.stepCount || 0;
    
    // Remaining need derived from plan minus consumed, ensuring minimum need if paused at 0
    const remainingRpcNeed = Math.max(
      session.quota.rpc.remaining === 0 ? 50 : 0,
      plannedRpc - consumedRpc
    );

    // Calculate progress percentage accurately from actual execution vs plan
    let progressPercent;
    if (body.progress_percent !== undefined) {
      progressPercent = Number(body.progress_percent);
    } else if (session.latestPlan?.steps?.length) {
      const totalSteps = Math.max(session.latestPlan.steps.length, Math.ceil(plannedRpc / 10));
      progressPercent = Math.min(85, Math.round((session.stepCount / totalSteps) * 100));
    } else {
      progressPercent = Math.min(85, Math.round((consumedRpc / plannedRpc) * 100));
    }
    // Prevent false 100% progress when quota is exhausted and work remains
    if (session.quota.rpc.remaining === 0 && progressPercent >= 100) {
      progressPercent = 75;
    }

    // Build structured deliberation context
    const context = {
      task: session.task,
      progress_percent: progressPercent,
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
      estimated_remaining_need: body.estimated_remaining_need || {
        rpc_calls: remainingRpcNeed,
        note: `Derived from plan (${plannedRpc} planned - ${consumedRpc} consumed)`
      }
    };

    let adapter = (body.customAdapter && typeof body.customAdapter.chat === 'function')
      ? body.customAdapter
      : (this.customAdapter || this.adapter || this.env?.adapter);
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
    session.latestDeliberateDiagnostic = decision._diagnostic || null;
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
   * Strategic Planning via Muse Spark
   * Runs at session init BEFORE EXECUTE. Advisory only: never buys, never charges.
   */
  async handlePlan(body = {}) {
    const session = await this.getState();
    if (session.isFrozen) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SESSION_FROZEN',
        message: 'Cannot plan: session is frozen by kill switch.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    session.status = SessionStatus.PLANNING;
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('status_changed', { status: SessionStatus.PLANNING, reason: 'Developing strategic plan with Muse Spark' });

    let adapter = (body.customAdapter && typeof body.customAdapter.chat === 'function')
      ? body.customAdapter
      : (this.customAdapter || this.adapter || this.env?.adapter);
    if (!adapter || typeof adapter.chat !== 'function') {
      const apiKey = this.env?.META_MODEL_API_KEY || null;
      adapter = new MetaModelAdapter({ apiKey });
    }

    const planner = new Planner(adapter);
    const plan = await planner.plan({
      task: session.task,
      budget_cap_usd: session.budgetCapUsd,
      demo_quota: {
        rpc: session.quota.rpc.total,
        read: session.quota.read.total,
        file: session.quota.file.total
      },
      tools_available: body.tools_available || ['skuuy_rpc', 'search']
    });

    const planLedgerEntry = {
      id: `ledg_${Date.now()}_plan`,
      timestamp: new Date().toISOString(),
      type: LedgerType.DECISION,
      resource: 'rpc',
      units: plan.estimated_rpc_calls || 0,
      costUsd: plan.estimated_cost_usd || 0,
      rail: plan.opening_strategy === 'buy_pack_upfront' ? 'paypal' : null,
      action: 'plan',
      item: plan.pack_name || null,
      reasoning: plan.reasoning,
      guardrailStatus: plan.guardrailStatus,
      rejectionReason: plan.rejectionReason,
      status: plan.status === 'failed' ? 'failed' : 'success',
      plan: {
        steps: plan.steps,
        estimated_rpc_calls: plan.estimated_rpc_calls,
        estimated_reads: plan.estimated_reads,
        estimated_cost_usd: plan.estimated_cost_usd,
        opening_strategy: plan.opening_strategy,
        reasoning: plan.reasoning
      }
    };

    session.ledger.push(planLedgerEntry);
    session.latestPlan = plan;
    session.latestPlanDiagnostic = plan._diagnostic || null;
    session.status = SessionStatus.IDLE;
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    this.broadcast('plan_made', { plan, ledgerEntry: planLedgerEntry });

    return new Response(JSON.stringify({
      success: true,
      plan,
      ledgerEntry: planLedgerEntry
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Set or update delegated spending mandate policy
   */
  async handleMandate(body = {}) {
    const session = await this.getState();
    const rawToken = body.vaultToken !== undefined ? body.vaultToken : (session.mandate?._vaultToken || session.mandate?.vaultToken || null);

    session.mandate = {
      budgetCapUsd: Number(body.budgetCapUsd) || session.mandate?.budgetCapUsd || 5.00,
      maxPerPurchaseUsd: Number(body.maxPerPurchaseUsd) || session.mandate?.maxPerPurchaseUsd || 2.50,
      allowedCategories: body.allowedCategories || session.mandate?.allowedCategories || ['rpc', 'read', 'file', 'quota_packs'],
      rail: body.rail || session.mandate?.rail || 'paypal',
      _vaultToken: rawToken,
      vaultToken: rawToken ? maskVaultToken(rawToken) : null,
      expiresAt: body.expiresAt || session.mandate?.expiresAt || '2026-11-30T00:00:00.000Z'
    };

    const mandateEntry = {
      id: `ledg_${Date.now()}_mandate`,
      timestamp: new Date().toISOString(),
      type: LedgerType.SYSTEM,
      resource: null,
      units: 0,
      costUsd: 0,
      rail: session.mandate.rail,
      reasoning: `Delegated spending mandate updated. Cap: $${session.mandate.budgetCapUsd.toFixed(2)}, Max/tx: $${session.mandate.maxPerPurchaseUsd.toFixed(2)}.`,
      status: 'success'
    };

    session.ledger.push(mandateEntry);
    session.updated_at = new Date().toISOString();
    await this.state.storage.put('session', session);
    const publicMandate = this._sanitizeSession(session).mandate;
    this.broadcast('mandate_updated', publicMandate);

    return new Response(JSON.stringify({ success: true, mandate: publicMandate }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Remove sensitive fields (like private unmasked _vaultToken) before exposing session.
   * Recursively traverses data to ensure no nested object leaks _vaultToken.
   */
  _sanitizeSession(data) {
    if (!data || typeof data !== 'object') return data;
    const clone = JSON.parse(JSON.stringify(data));
    const stripToken = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          stripToken(obj[i]);
        }
        return;
      }
      if ('_vaultToken' in obj) {
        delete obj._vaultToken;
      }
      for (const key of Object.keys(obj)) {
        stripToken(obj[key]);
      }
    };
    stripToken(clone);
    return clone;
  }

  /**
   * Autonomous Buy Settlement & Quota Issuance
   * Converts a verified DELIBERATE decision into a real Sandbox/live charge
   */
  async handleBuy(body = {}) {
    const session = await this.getState();

    if (session.isFrozen) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SESSION_FROZEN',
        reason: 'Session is frozen by kill switch'
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // H1 Hardening: Only settle valid buy decisions with accepted guardrail status
    let decision = session.latestDecision;

    if (decision) {
      if (decision.action !== 'buy' || decision.guardrailStatus !== 'accepted') {
        return new Response(JSON.stringify({
          success: false,
          error: 'NO_VALID_BUY_DECISION',
          reason: 'Active decision is not approved for buy settlement.'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      // If a decision was passed in body, it MUST match the active deliberated decision id
      if (body.decision && body.decision.id && body.decision.id !== decision.id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'DECISION_MISMATCH',
          reason: 'Provided decision does not match active deliberated decision.'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    } else if (body.decision) {
      // In direct DO invocations (e.g. tests), decision must be explicitly accepted
      if (body.decision.action !== 'buy' || body.decision.guardrailStatus !== 'accepted') {
        return new Response(JSON.stringify({
          success: false,
          error: 'NO_VALID_BUY_DECISION',
          reason: 'Decision is not approved with accepted guardrails.'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      decision = body.decision;
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'NO_VALID_BUY_DECISION',
        reason: 'No active approved buy decision available for settlement.'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const paypalClient = (body.paypalClient && typeof body.paypalClient.charge === 'function')
      ? body.paypalClient
      : (this.paypalClient || this.env?.paypalClient);

    const x402Client = (body.x402Client && typeof body.x402Client.charge === 'function')
      ? body.x402Client
      : (this.x402Client || this.env?.x402Client);

    const executor = new BuyExecutor({
      env: this.env,
      paypalClient,
      x402Client
    });

    const buyResult = await executor.executeBuy(session, decision);

    if (!buyResult.success) {
      const freshSession = await this.getState();
      freshSession.status = buyResult.sessionStatus;
      freshSession.latestBuyReason = buyResult.reason || buyResult.error || null;
      if (buyResult.transaction) {
        freshSession.ledger.push(buyResult.transaction);
      }
      freshSession.updated_at = new Date().toISOString();
      await this.state.storage.put('session', freshSession);
      this.broadcast('status_changed', { status: freshSession.status, reason: buyResult.reason });

      return new Response(JSON.stringify(buyResult), {
        status: buyResult.sessionStatus === SessionStatus.NEEDS_MANDATE_AMENDMENT ? 403 : 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (buyResult.alreadyProcessed) {
      return new Response(JSON.stringify(buyResult), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // M1 Concurrency Hardening: Re-read fresh state after charge to prevent lost updates or double charges
    const freshSession = await this.getState();
    if (!freshSession.transactions) freshSession.transactions = [];

    // Check if another concurrent call already recorded this transaction
    if (freshSession.transactions.some(t => t.id === buyResult.transaction?.id || (t.reference && t.reference === buyResult.transaction?.reference))) {
      return new Response(JSON.stringify({ ...buyResult, alreadyProcessed: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Process successful buy: refill quota, record ledger, increment spentUsd
    freshSession.ledger.push(buyResult.transaction);
    freshSession.transactions.push(buyResult.transaction);

    freshSession.spentUsd = Number((freshSession.spentUsd + buyResult.chargedAmountUsd).toFixed(4));
    freshSession.quota[buyResult.resourceKey].remaining += buyResult.unitsToAdd;
    freshSession.quota[buyResult.resourceKey].total += buyResult.unitsToAdd;
    freshSession.status = SessionStatus.EXECUTING;
    freshSession.updated_at = new Date().toISOString();

    await this.state.storage.put('session', freshSession);
    this.broadcast('buy_completed', {
      transaction: buyResult.transaction,
      spentUsd: freshSession.spentUsd,
      quota: freshSession.quota,
      sessionStatus: freshSession.status
    });

    // Trigger visual receipt generation and financial report generation
    // Async & non-blocking: failure in either MUST NEVER roll back or block the settled buy
    try {
      await Promise.allSettled([
        this.triggerReceiptGeneration(buyResult.transaction, decision),
        this.generateFinancialReportInternal()
      ]);
    } catch (postBuyErr) {
      console.warn('[SessionDO] Post-buy automatic triggers non-blocking note:', postBuyErr.message);
    }

    return new Response(JSON.stringify({
      success: true,
      transaction: buyResult.transaction,
      spentUsd: freshSession.spentUsd,
      refilledQuota: freshSession.quota,
      sessionStatus: freshSession.status
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Internal helper to generate and store receipt for a transaction
   * Compatible with triggerReceiptGeneration(transaction, decision) or (session, transaction, decision)
   */
  async triggerReceiptGeneration(sessionOrTx, maybeTx, maybeDecision) {
    let transaction = maybeTx;
    let decision = maybeDecision;
    if (sessionOrTx && sessionOrTx.type === 'transaction') {
      transaction = sessionOrTx;
      decision = maybeTx;
    }
    if (!transaction || transaction.status !== 'success' || !transaction.costUsd) {
      return null;
    }

    const session = await this.getState();
    if (!session.receipts) session.receipts = [];
    const existing = session.receipts.find(r => r.transactionId === transaction.id && r.status === 'completed');
    if (existing) {
      return existing;
    }

    const adapter = this.adapter || new MetaModelAdapter({
      apiKey: this.env?.META_MODEL_API_KEY
    });

    const generator = new ReceiptGenerator({
      env: this.env,
      adapter,
      r2Bucket: this.env?.RECEIPTS_BUCKET
    });

    let receipt;
    try {
      receipt = await generator.generateReceipt({
        transaction,
        decision,
        sessionId: session.sessionId || 'default'
      });
    } catch (err) {
      receipt = {
        id: `rcpt_${transaction.id}`,
        transactionId: transaction.id,
        sessionId: session.sessionId || 'default',
        captureRef: transaction.reference || 'SANDBOX_CAPTURE',
        item: decision?.item || transaction.item || 'rpc-1000',
        amountUsd: Number(transaction.costUsd) || 0,
        units: transaction.units || 1000,
        resource: transaction.resource || 'rpc',
        rail: transaction.rail || 'paypal',
        timestamp: transaction.timestamp || new Date().toISOString(),
        status: 'failed',
        imageKey: null,
        imageUrl: null,
        error: err.message,
        created_at: new Date().toISOString()
      };
    }

    const freshSession = await this.getState();
    if (!freshSession.receipts) freshSession.receipts = [];
    const idx = freshSession.receipts.findIndex(r => r.transactionId === transaction.id);
    if (idx >= 0) {
      freshSession.receipts[idx] = receipt;
    } else {
      freshSession.receipts.push(receipt);
    }

    freshSession.updated_at = new Date().toISOString();
    await this.state.storage.put('session', freshSession);
    this.broadcast('receipt_updated', { receipt, sessionId: freshSession.sessionId });

    return receipt;
  }

  /**
   * Backfill or regenerate receipt for an existing verified transaction
   */
  async handleBackfillReceipt(body = {}) {
    const session = await this.getState();
    const txId = body.transactionId || body.txId;

    let transaction = null;
    if (txId) {
      transaction = (session.ledger || []).find(x => x.id === txId && x.type === 'transaction');
    } else {
      const successTxs = (session.ledger || []).filter(x => x.type === 'transaction' && x.status === 'success' && x.costUsd > 0);
      transaction = successTxs[successTxs.length - 1];
    }

    if (!transaction) {
      return new Response(JSON.stringify({
        success: false,
        error: 'TRANSACTION_NOT_FOUND',
        message: 'No eligible successful settled transaction found for receipt backfill.'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (transaction.status !== 'success' || !transaction.costUsd) {
      return new Response(JSON.stringify({
        success: false,
        error: 'INVALID_TRANSACTION_STATUS',
        message: 'Cannot generate receipt for non-successful or zero-cost transaction.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!session.receipts) session.receipts = [];
    const existing = session.receipts.find(r => r.transactionId === transaction.id && r.status === 'completed');
    if (existing) {
      return new Response(JSON.stringify({
        success: true,
        alreadyExists: true,
        receipt: existing
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const decision = session.latestDecision;
    const receipt = await this.triggerReceiptGeneration(transaction, decision);

    return new Response(JSON.stringify({
      success: receipt?.status === 'completed',
      receipt
    }), {
      status: receipt?.status === 'completed' ? 200 : 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Internal helper to generate and store narrative financial report
   */
  async generateFinancialReportInternal() {
    const session = await this.getState();
    const cap = Number(session.budgetCapUsd) || 5.00;
    const spent = Number(session.spentUsd) || 0;
    const remaining = Number((cap - spent).toFixed(2));
    const successTxs = (session.ledger || []).filter(x => x.type === 'transaction' && x.status === 'success');
    const decisions = (session.ledger || []).filter(x => x.type === 'decision' && x.action === 'buy');

    const promptMessages = [
      {
        role: 'system',
        content: 'You are AgentPay Financial Auditor. Summarize autonomous operating budget procurement strictly and honestly from the provided ledger data. Only cite exact numbers from the ledger. Do not invent numbers.'
      },
      {
        role: 'user',
        content: `Audit this agent execution session:
- Initial Budget Cap: $${cap.toFixed(2)}
- Total Settled Spend: $${spent.toFixed(2)}
- Remaining Budget: $${remaining.toFixed(2)}
- Successful Procurements: ${JSON.stringify(successTxs.map(t => ({ item: t.item || 'rpc-1000', costUsd: t.costUsd, units: t.units, rail: t.rail, reference: t.reference })))}
- Deliberation Rationale: ${JSON.stringify(decisions.map(d => d.reasoning))}

Write a concise 2-3 sentence narrative financial summary explaining what was procured, the total expenditure, remaining budget, and why this procurement was necessary. Return ONLY the narrative prose.`
      }
    ];

    let summary = `Task operating budget audit: $${spent.toFixed(2)} settled out of $${cap.toFixed(2)} delegated budget cap ($${remaining.toFixed(2)} remaining). Autonomous procurement executed ${successTxs.length} transaction(s) refilling required quota without human intervention.`;

    try {
      const adapter = this.adapter || new MetaModelAdapter({
        apiKey: this.env?.META_MODEL_API_KEY
      });
      const res = await adapter.chat(promptMessages, { max_tokens: 512, temperature: 0.1 });
      if (res?.text && res.text.trim().length > 0) {
        summary = res.text.trim();
      }
    } catch (err) {
      console.warn('[FinancialReport] Spark narrative call failed, using deterministic summary:', err.message);
    }

    const freshSession = await this.getState();
    freshSession.financialReport = {
      summary,
      budgetCapUsd: cap,
      spentUsd: spent,
      remainingBudgetUsd: remaining,
      transactionsSettled: successTxs.length,
      generated_at: new Date().toISOString()
    };

    freshSession.updated_at = new Date().toISOString();
    await this.state.storage.put('session', freshSession);
    this.broadcast('report_updated', { report: freshSession.financialReport });

    return freshSession.financialReport;
  }

  /**
   * Narrative Financial Report Card generator via Meta Muse Spark (muse-spark-1.3)
   */
  async handleFinancialReport() {
    const report = await this.generateFinancialReportInternal();
    return new Response(JSON.stringify({
      success: true,
      report
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
      writer.write(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(this._sanitizeSession(state))}\n\n`));
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
    const sanitized = this._sanitizeSession(data);
    const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(sanitized)}\n\n`);

    for (const writer of this.subscribers) {
      writer.write(payload).catch(() => {
        this.subscribers.delete(writer);
      });
    }
  }
}
