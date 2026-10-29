/**
 * AgentPay Receipt Engine — Muse Image & R2 Storage
 * 
 * Generates verified visual receipts for completed purchases via Meta Muse Image (muse-image-1.0).
 * Persists image assets to Cloudflare R2 keyed by transaction ID.
 * 
 * Rules:
 * - Triggered ONLY after successful buy settlement and ledger recording.
 * - Async & non-blocking: image failure NEVER rolls back a settled buy or quota refill.
 * - Standard tier muse-image-1.0 only (standard, plain, no tier suffix).
 * - Exact data only: item, amount, units, rail, capture ref, date.
 * - Idempotent backfill supported for existing verified transactions.
 */

export const IMAGE_MODEL = 'muse-image-1.0';

export class ReceiptGenerator {
  /**
   * @param {Object} options
   * @param {Object} [options.env] - Worker environment bindings (including RECEIPTS_BUCKET)
   * @param {Object} [options.adapter] - MetaModelAdapter instance
   * @param {Object} [options.r2Bucket] - Explicit R2 bucket instance or mock
   */
  constructor(options = {}) {
    this.env = options.env || {};
    this.adapter = options.adapter || null;
    this.r2Bucket = options.r2Bucket || this.env?.RECEIPTS_BUCKET || null;
  }

  /**
   * Build minimal, high-contrast prompt for muse-image-1.0
   * Keeps text minimal to prevent model garbling; HTML caption provides authoritative numbers.
   */
  buildPrompt({ item, amountUsd, units, resource, captureRef, timestamp }) {
    const dateStr = new Date(timestamp || Date.now()).toISOString().split('T')[0];
    const cleanRef = (captureRef || 'SANDBOX').slice(0, 17);

    return [
      'A clean, minimalist, high-contrast fintech receipt card for AgentPay.',
      `Header: AGENTPAY OFFICIAL RECEIPT`,
      `Item: ${item}`,
      `Total: $${Number(amountUsd).toFixed(2)} USD`,
      `Quota Refill: +${units} ${String(resource).toUpperCase()}`,
      `Payment Method: PAID via PayPal Sandbox`,
      `Reference ID: ${cleanRef}`,
      `Date: ${dateStr}`,
      'Style: Crisp typography, dark card container on pure background, large bold legible numbers, minimalist design, zero clutter.'
    ].join('\n');
  }

  /**
   * Generate receipt image and store in R2
   * @param {Object} params
   * @param {Object} params.transaction - Authoritative ledger transaction
   * @param {Object} [params.decision] - Deliberation decision
   * @param {string} [params.sessionId] - Session identifier
   * @returns {Promise<Object>} Receipt record
   */
  async generateReceipt({ transaction, decision, sessionId = 'default' }) {
    if (!transaction || transaction.type !== 'transaction' || transaction.status !== 'success') {
      throw new Error('Receipt generation requires a successful settled transaction.');
    }

    const txId = transaction.id;
    const item = decision?.item || transaction.item || (transaction.resource ? `${transaction.resource}-${transaction.units}` : 'quota-refill');
    const amountUsd = Number(transaction.costUsd) || Number(decision?.estimated_cost_usd) || 0;
    const units = transaction.units || decision?.estimated_calls_covered || 0;
    const resource = transaction.resource || 'rpc';
    const captureRef = transaction.reference || 'SANDBOX_CAPTURE';
    const timestamp = transaction.timestamp || new Date().toISOString();
    const imageKey = `receipt-${txId}.png`;

    const prompt = this.buildPrompt({
      item,
      amountUsd,
      units,
      resource,
      captureRef,
      timestamp
    });

    try {
      if (!this.adapter) {
        throw new Error('MetaModelAdapter is not provided for receipt image generation.');
      }

      // Call muse-image-1.0 via adapter
      const imageResult = await this.adapter.generateImage(prompt);
      const imageBuffer = imageResult?.buffer;

      if (!imageBuffer) {
        throw new Error('Image generation completed without returning binary image data.');
      }

      // Store in R2 bucket if bound
      if (this.r2Bucket && typeof this.r2Bucket.put === 'function') {
        await this.r2Bucket.put(imageKey, imageBuffer, {
          httpMetadata: {
            contentType: 'image/png',
            cacheControl: 'public, max-age=86400'
          },
          customMetadata: {
            transactionId: txId,
            sessionId,
            captureRef,
            amountUsd: String(amountUsd),
            item
          }
        });
      }

      return {
        id: `rcpt_${txId}`,
        transactionId: txId,
        sessionId,
        captureRef,
        item,
        amountUsd,
        units,
        resource,
        rail: transaction.rail || 'paypal',
        timestamp,
        status: 'completed',
        imageKey,
        imageUrl: `/api/session/${sessionId}/receipts/${txId}`,
        error: null,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.warn(`[ReceiptGenerator] Image generation failed for ${txId}:`, err.message);
      return {
        id: `rcpt_${txId}`,
        transactionId: txId,
        sessionId,
        captureRef,
        item,
        amountUsd,
        units,
        resource,
        rail: transaction.rail || 'paypal',
        timestamp,
        status: 'failed',
        imageKey: null,
        imageUrl: null,
        error: err.message,
        created_at: new Date().toISOString()
      };
    }
  }
}
