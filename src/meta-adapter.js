/**
 * Meta Model API Adapter
 * 
 * One layer, swappable interface to Meta Model API.
 * Uses exact model: "muse-spark-1.3" (standard, plain, no suffix).
 * 
 * All Muse Spark interactions flow strictly through this adapter.
 */

export const SPARK_MODEL = 'muse-spark-1.3';
export const META_API_BASE = 'https://api.meta.ai/v1';

export class MetaModelAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.apiKey] - API key from Worker secrets (META_MODEL_API_KEY)
   * @param {string} [options.baseUrl] - Base API endpoint
   * @param {string} [options.model] - Model name (must be muse-spark-1.3)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.baseUrl = options.baseUrl || META_API_BASE;
    this.model = options.model || SPARK_MODEL;
  }

  /**
   * Send a chat completion request to Meta Model API
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [params]
   * @returns {Promise<{text: string, usage?: Object}>}
   */
  async chat(messages, params = {}) {
    if (!this.apiKey) {
      throw new Error('META_MODEL_API_KEY is not configured in Worker secrets.');
    }

    const payload = {
      model: this.model,
      messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens ?? 1024,
      response_format: params.response_format || { type: 'json_object' }
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Meta API error HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      text: content,
      usage: data.usage || null,
      raw: data
    };
  }
}
