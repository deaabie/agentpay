/**
 * AgentPay — In-Memory Sliding-Window Rate Limiter
 * 
 * Protects paid-model and state-mutation endpoints against automated spam/abuse (H2).
 * Operates in Worker isolate memory with zero external dependencies.
 */

export class RateLimiter {
  constructor(options = {}) {
    this.modelLimit = options.modelLimit ?? 10;       // 10 requests / min for AI model calls
    this.mutationLimit = options.mutationLimit ?? 60; // 60 requests / min for general state mutations
    this.windowMs = options.windowMs ?? 60000;         // 1 minute sliding window
    this.records = new Map();                         // key -> number[] (timestamps)
  }

  /**
   * Determine if request exceeds rate limit
   * @param {string} ip - Client IP
   * @param {'model' | 'mutation'} category - Rate limit tier
   * @returns {boolean} true if limited (exceeded), false if permitted
   */
  isRateLimited(ip, category) {
    const limit = category === 'model' ? this.modelLimit : this.mutationLimit;
    const now = Date.now();
    const key = `${ip || '127.0.0.1'}:${category}`;
    
    let timestamps = this.records.get(key);
    if (!timestamps) {
      timestamps = [];
      this.records.set(key, timestamps);
    }

    const windowStart = now - this.windowMs;
    // Evict expired entries
    while (timestamps.length > 0 && timestamps[0] <= windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      return true;
    }

    timestamps.push(now);
    return false;
  }

  /**
   * Clear all records (useful for testing)
   */
  reset() {
    this.records.clear();
  }
}

export const rateLimiter = new RateLimiter();
