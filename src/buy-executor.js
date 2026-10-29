/**
 * AgentPay Buy Executor: Autonomous Settlement & Quota Issuance Engine
 * 
 * Sits between 'awaiting_purchase' and 'resumed' / 'executing'.
 * Enforces strict, code-governed checks in exact sequence:
 * 1. Re-validate DELIBERATE guardrails against live catalogue
 * 2. Mandate Check (Guardrail #7): budget, expiry, categories, max per purchase
 * 3. Autonomous Charge (PayPal Vault Sandbox or x402 Base USDC)
 * 4. Quota Refill from catalogue mapping
 * 5. Idempotent recording of TRANSACTION ledger entry
 */

import { CATALOGUE_ALLOWLIST, SessionStatus, LedgerType } from './types.js';

export class BuyExecutor {
  /**
   * @param {Object} [options]
   * @param {Object} [options.env] - Worker environment bindings
   * @param {Object} [options.paypalClient] - Custom PayPal client or stub
   * @param {Object} [options.x402Client] - Custom x402 client or stub
   */
  constructor(options = {}) {
    this.env = options.env || {};
    this.paypalClient = options.paypalClient || null;
    this.x402Client = options.x402Client || null;
  }

  /**
   * Execute autonomous buy flow on a verified decision
   * @param {Object} session - Authoritative session state from DO
   * @param {Object} decision - The active deliberation decision
   * @returns {Promise<Object>} Result with updated session fields and transaction
   */
  async executeBuy(session, decision) {
    if (!decision || decision.action !== 'buy') {
      return {
        success: false,
        error: 'INVALID_DECISION',
        reason: 'Decision is not a valid buy proposal',
        sessionStatus: session.status
      };
    }

    // Idempotency check: if already settled for this decision, return existing transaction
    const existingTx = (session.transactions || []).find(t => t.decisionId === decision.id);
    if (existingTx) {
      return {
        success: true,
        alreadyProcessed: true,
        transaction: existingTx,
        sessionStatus: SessionStatus.EXECUTING
      };
    }

    const spent = Number(session.spentUsd) || 0;
    const cap = Number(session.budgetCapUsd) || 5.00;
    const cost = Number(decision.estimated_cost_usd) || 0;

    // =========================================================================
    // Check 1: Re-validate DELIBERATE guardrails against live catalogue
    // =========================================================================
    // 1a. Budget Cap
    if (cost + spent > cap) {
      return {
        success: false,
        error: 'BUDGET_CAP_EXCEEDED',
        reason: `Re-check failed: Proposed cost $${cost.toFixed(2)} + spent $${spent.toFixed(2)} exceeds cap $${cap.toFixed(2)}.`,
        sessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // 1b. Catalogue Allowlist
    const catalogueEntry = CATALOGUE_ALLOWLIST.find(c => c.item === decision.item);
    if (!catalogueEntry) {
      return {
        success: false,
        error: 'UNLISTED_ITEM',
        reason: `Re-check failed: Item "${decision.item}" is not in the live catalogue allowlist.`,
        sessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // 1c. Exact Price Match (tolerance 0.001)
    if (Math.abs(cost - catalogueEntry.priceUsd) > 0.001) {
      return {
        success: false,
        error: 'PRICE_MISMATCH',
        reason: `Re-check failed: Price changed or mismatched. Decision: $${cost.toFixed(2)}, Catalogue: $${catalogueEntry.priceUsd.toFixed(2)}.`,
        sessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // 1d. Rail Match
    if (decision.rail !== catalogueEntry.rail) {
      return {
        success: false,
        error: 'RAIL_MISMATCH',
        reason: `Re-check failed: Item ${decision.item} requires "${catalogueEntry.rail}", got "${decision.rail}".`,
        sessionStatus: SessionStatus.PAUSED_QUOTA_EXHAUSTED
      };
    }

    // =========================================================================
    // Check 2: Mandate Check (Guardrail #7)
    // =========================================================================
    const mandate = session.mandate;
    if (!mandate) {
      return {
        success: false,
        error: 'MANDATE_MISSING',
        reason: 'Mandate check failed: No active delegated spending mandate found for this session.',
        sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
      };
    }

    // For PayPal rail, require an authorized non-placeholder vault token
    if (decision.rail === 'paypal') {
      const token = mandate._vaultToken || mandate.vaultToken;
      if (!token) {
        return {
          success: false,
          error: 'MANDATE_MISSING',
          reason: 'Mandate check failed: No active delegated PayPal vault token found for this session.',
          sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
        };
      }

      // Reject placeholder tokens (fail closed, no fake mandates allowed)
      if (token === 'VAULT_SANDBOX_DELEGATION_MANDATE' || token.startsWith('VAULT_')) {
        return {
          success: false,
          error: 'MANDATE_TOKEN_PLACEHOLDER',
          reason: 'Mandate check failed: Mandate token is a placeholder. A real PayPal Vault authorization is required.',
          sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
        };
      }
    }

    // 2a. Expiry
    if (mandate.expiresAt && new Date(mandate.expiresAt).getTime() <= Date.now()) {
      return {
        success: false,
        error: 'MANDATE_EXPIRED',
        reason: `Mandate check failed: Mandate expired on ${mandate.expiresAt}.`,
        sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
      };
    }

    // 2b. Remaining budget under mandate
    const remainingBudget = cap - spent;
    if (cost > remainingBudget) {
      return {
        success: false,
        error: 'MANDATE_BUDGET_EXCEEDED',
        reason: `Mandate check failed: Proposed cost $${cost.toFixed(2)} exceeds remaining mandate budget $${remainingBudget.toFixed(2)}.`,
        sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
      };
    }

    // 2c. Category check
    const allowedCategories = mandate.allowedCategories || ['rpc', 'read', 'file', 'quota_packs'];
    const isCategoryAllowed = allowedCategories.includes(catalogueEntry.resource) ||
                              allowedCategories.includes('quota_packs');
    if (!isCategoryAllowed) {
      return {
        success: false,
        error: 'MANDATE_CATEGORY_DISALLOWED',
        reason: `Mandate check failed: Resource "${catalogueEntry.resource}" is not permitted by mandate policy.`,
        sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
      };
    }

    // 2d. Max per purchase limit ($2.50)
    const maxPerPurchase = Number(mandate.maxPerPurchaseUsd) || 2.50;
    if (cost > maxPerPurchase) {
      return {
        success: false,
        error: 'MANDATE_MAX_PER_PURCHASE_EXCEEDED',
        reason: `Mandate check failed: Cost $${cost.toFixed(2)} exceeds max per-transaction policy $${maxPerPurchase.toFixed(2)}.`,
        sessionStatus: SessionStatus.NEEDS_MANDATE_AMENDMENT
      };
    }

    // =========================================================================
    // Check 3: Charge Execution (PayPal Vault vs x402)
    // =========================================================================
    let chargeResult;

    if (decision.rail === 'paypal') {
      chargeResult = await this._chargePayPalVault(mandate, catalogueEntry, decision);
    } else if (decision.rail === 'x402') {
      chargeResult = await this._chargeX402Micro(catalogueEntry, decision);
    } else {
      return {
        success: false,
        error: 'UNSUPPORTED_RAIL',
        reason: `Unknown settlement rail: ${decision.rail}`,
        sessionStatus: SessionStatus.BUY_FAILED
      };
    }

    // Handle Charge Failure
    if (!chargeResult.success) {
      const failedTxEntry = {
        id: `tx_${Date.now()}_failed`,
        decisionId: decision.id,
        timestamp: new Date().toISOString(),
        type: LedgerType.TRANSACTION,
        resource: catalogueEntry.resource,
        units: 0,
        costUsd: 0.00,
        rail: decision.rail,
        status: 'failed',
        reasoning: `Charge failed on ${decision.rail.toUpperCase()}: ${chargeResult.error || 'Gateway error'}. Loop paused.`
      };

      return {
        success: false,
        error: chargeResult.error,
        reason: chargeResult.error,
        transaction: failedTxEntry,
        sessionStatus: SessionStatus.BUY_FAILED
      };
    }

    // =========================================================================
    // Step 4: Quota Refill from Catalogue Mapping
    // =========================================================================
    const unitsToAdd = catalogueEntry.calls;
    const resourceKey = catalogueEntry.resource;

    // =========================================================================
    // Step 5: Successful Transaction Record
    // =========================================================================
    const txEntry = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      decisionId: decision.id,
      timestamp: new Date().toISOString(),
      type: LedgerType.TRANSACTION,
      resource: resourceKey,
      units: unitsToAdd,
      costUsd: catalogueEntry.priceUsd,
      rail: decision.rail,
      status: 'success',
      reference: chargeResult.captureId || chargeResult.txHash || 'sandbox_vault_verified',
      reasoning: `Purchased ${catalogueEntry.item} via ${decision.rail.toUpperCase()} (${chargeResult.note || 'Sandbox Vault'}). +${unitsToAdd} ${resourceKey.toUpperCase()} quota refilled.`
    };

    return {
      success: true,
      transaction: txEntry,
      unitsToAdd,
      resourceKey,
      chargedAmountUsd: catalogueEntry.priceUsd,
      sessionStatus: SessionStatus.EXECUTING,
      mandateStatus: 'PASS'
    };
  }

  /**
   * Execute PayPal Vault Charge in Sandbox
   * Fail closed: requires real keys, real token, and verified capture status COMPLETED.
   */
  async _chargePayPalVault(mandate, catalogueEntry, decision) {
    const vaultToken = mandate._vaultToken || mandate.vaultToken;

    // If a custom or stubbed PayPal client is provided (e.g. in tests)
    if (this.paypalClient) {
      return await this.paypalClient.charge({
        vaultToken,
        amount: catalogueEntry.priceUsd,
        currency: 'USD',
        item: catalogueEntry.item
      });
    }

    const clientId = this.env?.PAYPAL_CLIENT_ID;
    const clientSecret = this.env?.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: 'PAYPAL_KEYS_MISSING',
        reason: 'PayPal client credentials missing (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not configured in Worker secrets).'
      };
    }

    try {
      const auth = btoa(`${clientId}:${clientSecret}`);
      const baseUrl = 'https://api-m.sandbox.paypal.com';

      // 1. Get access token
      const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return {
          success: false,
          error: tokenData.error_description || tokenData.error || 'Failed to retrieve PayPal Sandbox access token'
        };
      }

      // 2. Create Order with vaulted token & idempotency key
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': requestId,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: `agentpay-${decision.id || Date.now()}`,
            description: `AgentPay Quota Refill: ${catalogueEntry.item}`,
            amount: {
              currency_code: 'USD',
              value: catalogueEntry.priceUsd.toFixed(2)
            }
          }],
          payment_source: {
            token: {
              id: vaultToken,
              type: 'BILLING_AGREEMENT'
            }
          }
        })
      });

      const orderData = await orderRes.json();

      if (orderRes.ok && orderData.status === 'COMPLETED') {
        const capture = orderData.purchase_units?.[0]?.payments?.captures?.[0];
        const capturedAmount = Number(capture?.amount?.value);
        const expectedAmount = Number(catalogueEntry.priceUsd.toFixed(2));

        if (capture?.status === 'COMPLETED' && Math.abs(capturedAmount - expectedAmount) < 0.001 && capture?.id) {
          return {
            success: true,
            orderId: orderData.id,
            captureId: capture.id,
            status: 'COMPLETED',
            amount: capture.amount.value,
            currency: 'USD',
            note: 'PayPal Sandbox Orders v2 Vault Capture'
          };
        }
      }

      // If status is not COMPLETED (e.g. APPROVED), capture the order
      if (orderRes.ok && orderData.id) {
        const capRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderData.id}/capture`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': `cap-${requestId}`
          }
        });
        const capData = await capRes.json();
        const capture = capData.purchase_units?.[0]?.payments?.captures?.[0];
        const capturedAmount = Number(capture?.amount?.value);
        const expectedAmount = Number(catalogueEntry.priceUsd.toFixed(2));

        if (capRes.ok && capData.status === 'COMPLETED' && capture?.status === 'COMPLETED' && Math.abs(capturedAmount - expectedAmount) < 0.001 && capture?.id) {
          return {
            success: true,
            orderId: orderData.id,
            captureId: capture.id,
            status: 'COMPLETED',
            amount: capture.amount.value,
            currency: 'USD',
            note: 'PayPal Sandbox Orders v2 Capture Verified'
          };
        }

        return {
          success: false,
          error: capData.message || capData.name || `PayPal capture failed with status: ${capData.status || capRes.status}`
        };
      }

      return {
        success: false,
        error: orderData.message || orderData.name || `PayPal order creation failed with status: ${orderRes.status}`
      };
    } catch (err) {
      return {
        success: false,
        error: `PayPal Sandbox error: ${err.message}`
      };
    }
  }

  /**
   * Execute x402 Base USDC Micropayment
   * Production path is disabled and fails closed until full on-chain facilitator settlement is verified.
   */
  async _chargeX402Micro(catalogueEntry, decision) {
    if (this.x402Client) {
      return await this.x402Client.charge({
        amount: catalogueEntry.priceUsd,
        currency: 'USDC',
        network: 'base'
      });
    }

    const payerSecret = this.env?.X402_PAYER_SECRET;
    if (!payerSecret) {
      return {
        success: false,
        error: 'x402 wallet not configured (X402_PAYER_SECRET missing)'
      };
    }

    // Production x402 path fails closed with X402_NOT_IMPLEMENTED
    return {
      success: false,
      error: 'X402_NOT_IMPLEMENTED',
      reason: 'x402 on-chain settlement is not implemented for production in this build. Path is safely disabled.'
    };
  }
}
