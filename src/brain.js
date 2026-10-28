/**
 * AgentPay Brain: Muse Spark Economic Deliberation Engine
 * 
 * Sits at quota exhaustion to deliberate autonomously over:
 * - Task progress % and estimated remaining needs
 * - Budget cap and historical spend
 * - Live price catalogue (PayPal volume packs vs x402 micro top-ups)
 * 
 * Strict Principle:
 * - Spark proposes in structured JSON.
 * - CODE strictly enforces hard guardrails.
 * - At this stage, validated buy decisions transition to 'awaiting_purchase'. ZERO charges occur.
 */

import { CATALOGUE_ALLOWLIST, SessionStatus, LedgerType } from './types.js';

export class Brain {
  /**
   * @param {Object} adapter - MetaModelAdapter instance or stub
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * Execute economic deliberation on quota exhaustion
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async deliberate(context) {
    const systemPrompt = `You are the economic reasoning core of an autonomous AI agent operating under a strict budget mandate.
Your quota has run out mid-task. Deliberate over the task progress, remaining workload, spending history, and available live price catalogue.
Decide whether to buy additional quota ("buy"), stop without buying ("no_buy"), or pause/wait ("wait").
Explain your reasoning clearly in human language, citing exact numbers (progress %, remaining steps, cost comparison).

Rules:
1. NEVER propose buying anything from ondocs (it is read-only documentation reference).
2. ONLY select items from the live catalogue allowlist.
3. Total cost plus spent_usd MUST NOT exceed budget_cap_usd.
4. Return ONLY a valid JSON object matching the requested schema. No surrounding markdown, no conversational prose.`;

    const userPrompt = `Deliberation Context:
${JSON.stringify({
  task: context.task,
  progress_percent: context.progress_percent,
  completed_steps: context.completed_steps,
  quota_remaining: context.quota_remaining,
  quota_consumed: context.quota_consumed,
  budget_cap_usd: context.budget_cap_usd,
  spent_usd: context.spent_usd,
  remaining_budget_usd: (context.budget_cap_usd - context.spent_usd).toFixed(2),
  session_spending_history: context.session_spending_history || [],
  price_catalogue: CATALOGUE_ALLOWLIST.map(c => ({
    item: c.item,
    resource: c.resource,
    calls: c.calls,
    price_usd: c.priceUsd,
    rail: c.rail
  })),
  tools_available: context.tools_available || ['skuuy_rpc', 'search'],
  estimated_remaining_need: context.estimated_remaining_need || { rpc_calls: 400, note: 'Calculated from remaining steps' }
}, null, 2)}

Required Output JSON Schema:
{
  "action": "buy" | "no_buy" | "wait",
  "item": string | null,
  "rail": "paypal" | "x402" | null,
  "estimated_cost_usd": number,
  "estimated_calls_covered": number,
  "reasoning": "Human-readable reasoning citing numbers (progress %, needed calls, cost comparison)",
  "alternative_considered": "Alternative pricing or rail evaluated and why it was rejected"
}`;

    let parsedDecision = null;

    // First attempt
    try {
      const response = await this.adapter.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);
      parsedDecision = this._parseAndValidateJSON(response.text);
    } catch (firstErr) {
      // Retry ONCE with a concise repair prompt (§3)
      try {
        const repairResponse = await this.adapter.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'user', content: 'Return only the raw JSON object adhering to the schema, with no additional text or formatting.' }
        ]);
        parsedDecision = this._parseAndValidateJSON(repairResponse.text);
      } catch (secondErr) {
        // Fail-safe to no_buy on invalid output
        parsedDecision = {
          action: 'no_buy',
          item: null,
          rail: null,
          estimated_cost_usd: 0,
          estimated_calls_covered: 0,
          reasoning: 'Brain output invalid, failing safe to no purchase.',
          alternative_considered: null,
          guardrailStatus: 'rejected',
          rejectionReason: `Malformed model output after repair attempt: ${secondErr.message}`
        };
      }
    }

    // Apply Code Guardrails (§4)
    return this.applyGuardrails(parsedDecision, context);
  }

  /**
   * Code-enforced Guardrails
   * Spark proposes -> Code enforces
   */
  applyGuardrails(decision, context) {
    // If action is not buy (no_buy or wait), guardrails pass vacuously
    if (decision.action !== 'buy') {
      return {
        ...decision,
        guardrailStatus: decision.guardrailStatus || 'accepted',
        rejectionReason: decision.rejectionReason || null,
        nextSessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    const spent = Number(context.spent_usd) || 0;
    const cap = Number(context.budget_cap_usd) || 5.00;
    const cost = Number(decision.estimated_cost_usd) || 0;

    // Guardrail 1: Budget Cap
    if (cost + spent > cap) {
      return {
        ...decision,
        guardrailStatus: 'rejected',
        rejectionReason: `Over-cap: Proposed cost $${cost.toFixed(2)} + spent $${spent.toFixed(2)} exceeds delegated budget cap $${cap.toFixed(2)}.`,
        nextSessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // Guardrail 2: Allowlist Check
    const catalogueEntry = CATALOGUE_ALLOWLIST.find(c => c.item === decision.item);
    if (!catalogueEntry) {
      return {
        ...decision,
        guardrailStatus: 'rejected',
        rejectionReason: `Item "${decision.item}" is not in the live catalogue allowlist.`,
        nextSessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // Guardrail 3: Price Match
    if (Math.abs(cost - catalogueEntry.priceUsd) > 0.001) {
      return {
        ...decision,
        guardrailStatus: 'rejected',
        rejectionReason: `Price mismatch: Proposed $${cost.toFixed(2)}, catalogue price for ${decision.item} is $${catalogueEntry.priceUsd.toFixed(2)}.`,
        nextSessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // Guardrail 4: Rail Match
    if (decision.rail !== catalogueEntry.rail) {
      return {
        ...decision,
        guardrailStatus: 'rejected',
        rejectionReason: `Rail mismatch: ${decision.item} requires "${catalogueEntry.rail}", but "${decision.rail}" was proposed.`,
        nextSessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // All Guardrails PASS: Transition to awaiting_purchase
    // NO CHARGE OCCURS TODAY (§0)
    return {
      ...decision,
      guardrailStatus: 'accepted',
      rejectionReason: null,
      nextSessionStatus: SessionStatus.AWAITING_PURCHASE
    };
  }

  /**
   * Helper to clean and parse strict JSON from model output
   */
  _parseAndValidateJSON(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Empty model response');
    }

    // Extract JSON block if wrapped in markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }

    const obj = JSON.parse(jsonMatch[0]);

    if (!obj.action || !['buy', 'no_buy', 'wait'].includes(obj.action)) {
      throw new Error(`Invalid action: "${obj.action}"`);
    }

    if (!obj.reasoning || typeof obj.reasoning !== 'string' || obj.reasoning.trim().length === 0) {
      throw new Error('Missing or empty reasoning field');
    }

    if (obj.action === 'buy') {
      if (!obj.item || typeof obj.item !== 'string') {
        throw new Error('Missing item for buy action');
      }
      if (!obj.rail || !['paypal', 'x402'].includes(obj.rail)) {
        throw new Error(`Invalid rail for buy action: "${obj.rail}"`);
      }
      if (typeof obj.estimated_cost_usd !== 'number') {
        throw new Error('Missing or non-numeric estimated_cost_usd');
      }
    }

    return obj;
  }
}
