/**
 * AgentPay Planner: Muse Spark Strategic Planning Engine
 * 
 * Runs at session initialization BEFORE EXECUTE.
 * - Advisory-only: never buys, never charges, never blocks execution.
 * - Analyzes task, estimates resource needs, and selects opening strategy.
 * - Enforces hard code guardrails (cost <= cap, allowlist for upfront packs).
 * - Fallback to default demo steps on any malformed output after 1 repair attempt.
 */

import { CATALOGUE_ALLOWLIST, PLATFORM_FREE_TIERS, SessionStatus, LedgerType } from './types.js';

export class Planner {
  /**
   * @param {Object} adapter - MetaModelAdapter instance
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * Execute strategic planning on session init
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async plan(context) {
    const budgetCap = Number(context.budget_cap_usd) || 5.00;
    const demoQuota = context.demo_quota || { rpc: 100, read: 20, file: 5 };

    const systemPrompt = `You are the strategic planning core of an autonomous AI agent operating under a strict budget mandate.
Before task execution begins, break the task into discrete operational steps, estimate resource needs (RPC calls, web reads), and select an opening strategy.

Allowed opening_strategy values:
- "free_tier_first": Utilize demo quota and daily platform free tiers before considering any purchases.
- "buy_pack_upfront": Propose purchasing a volume pack from the live catalogue immediately if workload strictly requires it.
- "micro_topup": Use per-call micropayments ($0.001/call) for very small tasks.

Rules:
1. NEVER propose buying anything from ondocs (it is documentation reference only).
2. Any pack proposed must be in the live catalogue allowlist and cost MUST NOT exceed the budget cap ($${budgetCap.toFixed(2)}). Under a $5.00 cap, rpc-5000 ($8.00) can never be an opening strategy.
3. Reasoning MUST include exact numbers (estimated calls, estimated cost, budget cap).
4. Return ONLY a valid JSON object matching the requested schema. No surrounding markdown, no conversational prose.`;

    const userPrompt = `Planning Context:
${JSON.stringify({
  task: context.task,
  budget_cap_usd: budgetCap,
  demo_quota: demoQuota,
  platform_free_tiers: PLATFORM_FREE_TIERS,
  live_catalogue: CATALOGUE_ALLOWLIST.map(c => ({
    item: c.item,
    resource: c.resource,
    calls: c.calls,
    price_usd: c.priceUsd,
    rail: c.rail
  })),
  tools_available: context.tools_available || ['skuuy_rpc', 'search']
}, null, 2)}

Required Output JSON Schema:
{
  "steps": ["Step 1 description", "Step 2 description", "..."],
  "estimated_rpc_calls": number,
  "estimated_reads": number,
  "estimated_cost_usd": number,
  "opening_strategy": "free_tier_first" | "buy_pack_upfront" | "micro_topup",
  "pack_name": string | null,
  "reasoning": "One concise sentence citing numbers (estimated calls, estimated cost, budget cap)"
}`;

    let parsedPlan = null;

    // First attempt
    try {
      const response = await this.adapter.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);
      parsedPlan = this._parseAndValidateJSON(response.text);
    } catch (firstErr) {
      console.warn('[Planner] Initial attempt failed:', firstErr.message);
      // Exactly 1 repair retry (§Part A Guardrail 5)
      try {
        const repairResponse = await this.adapter.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'user', content: 'Return only the raw JSON object adhering to the schema, with no additional text or formatting.' }
        ]);
        parsedPlan = this._parseAndValidateJSON(repairResponse.text);
      } catch (secondErr) {
        console.warn('[Planner] Repair retry failed:', secondErr.message);
        // Fallback to default demo plan (§Part A Guardrail 4)
        parsedPlan = {
          steps: [
            'Query Base latest block height',
            'Query Ethereum latest block height',
            'Verify Base chain ID',
            'Audit Vitalik wallet balance on Base',
            'Audit 1inch router balance on Base'
          ],
          estimated_rpc_calls: 5,
          estimated_reads: 0,
          estimated_cost_usd: 0.00,
          opening_strategy: 'free_tier_first',
          pack_name: null,
          reasoning: 'Plan generation failed after repair attempt, safely falling back to 5 default audit steps on free tier ($0.00 within $5.00 cap).',
          guardrailStatus: 'fallback',
          rejectionReason: `Malformed model output: ${secondErr.message}`,
          status: 'failed'
        };
      }
    }

    // Apply Code Guardrails
    return this.applyGuardrails(parsedPlan, budgetCap);
  }

  /**
   * Code-enforced Guardrails for PLAN
   * Model proposes -> Code enforces
   */
  applyGuardrails(plan, budgetCap) {
    const cost = Number(plan.estimated_cost_usd) || 0;

    // Guardrail 1: Cost Check
    if (cost > budgetCap) {
      return {
        ...plan,
        action: 'plan',
        opening_strategy: 'free_tier_first',
        guardrailStatus: 'rejected-advisory',
        rejectionReason: `Estimated cost $${cost.toFixed(2)} exceeds delegated budget cap $${budgetCap.toFixed(2)}. Falling back to free tier first.`,
        status: 'rejected'
      };
    }

    // Guardrail 2: Allowlist Check (for buy_pack_upfront)
    if (plan.opening_strategy === 'buy_pack_upfront') {
      const catalogueEntry = CATALOGUE_ALLOWLIST.find(c => c.item === plan.pack_name);
      if (!catalogueEntry) {
        return {
          ...plan,
          action: 'plan',
          opening_strategy: 'free_tier_first',
          guardrailStatus: 'rejected-advisory',
          rejectionReason: `Pack "${plan.pack_name}" is not in the live catalogue allowlist. Falling back to free tier first.`,
          status: 'rejected'
        };
      }
      if (catalogueEntry.priceUsd > budgetCap) {
        return {
          ...plan,
          action: 'plan',
          opening_strategy: 'free_tier_first',
          guardrailStatus: 'rejected-advisory',
          rejectionReason: `Pack "${plan.pack_name}" cost $${catalogueEntry.priceUsd.toFixed(2)} exceeds budget cap $${budgetCap.toFixed(2)}.`,
          status: 'rejected'
        };
      }
    }

    return {
      ...plan,
      action: 'plan',
      guardrailStatus: plan.guardrailStatus || 'accepted',
      rejectionReason: plan.rejectionReason || null,
      status: plan.guardrailStatus === 'fallback' ? 'failed' : 'success'
    };
  }

  /**
   * Parse strict JSON from model response
   */
  _parseAndValidateJSON(text) {
    if (!text || typeof text !== 'string') {
      throw new Error(`Empty model response (type: ${typeof text})`);
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in response`);
    }

    const obj = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
      throw new Error('Missing or empty steps array');
    }

    if (typeof obj.estimated_rpc_calls !== 'number') {
      throw new Error('Missing or invalid estimated_rpc_calls');
    }

    if (typeof obj.estimated_cost_usd !== 'number') {
      throw new Error('Missing or invalid estimated_cost_usd');
    }

    const allowedStrategies = ['free_tier_first', 'buy_pack_upfront', 'micro_topup'];
    if (!obj.opening_strategy || !allowedStrategies.includes(obj.opening_strategy)) {
      throw new Error(`Invalid opening_strategy: "${obj.opening_strategy}"`);
    }

    if (!obj.reasoning || typeof obj.reasoning !== 'string' || obj.reasoning.trim().length === 0) {
      throw new Error('Missing or empty reasoning');
    }

    // Reasoning must contain at least one digit (§Part A requirement: reasoning with numbers)
    if (!/\d/.test(obj.reasoning)) {
      throw new Error('Reasoning must include numbers (estimated calls, cost, cap)');
    }

    return obj;
  }
}
