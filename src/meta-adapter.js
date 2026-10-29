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

/**
 * Universal response extractor for Meta / OpenAI / Anthropic chat structures.
 * Handles:
 * - String content: "..."
 * - Content blocks array: [{ type: "text", text: "..." }]
 * - Object content: { text: "..." }
 * - Direct text fields: choice.text, message.text, data.output_text, data.response
 */
export function extractTextFromResponse(data) {
  if (!data) return '';

  if (typeof data === 'string') return data;

  const choice = data.choices?.[0];
  if (choice) {
    const msg = choice.message;
    if (msg) {
      const content = msg.content;
      // 1. Direct string content
      if (typeof content === 'string' && content.trim().length > 0) {
        return content;
      }
      // 2. Array of content blocks
      if (Array.isArray(content)) {
        const textParts = content.map(part => {
          if (typeof part === 'string') return part;
          if (typeof part === 'object' && part !== null) {
            return part.text || part.content || part.value || '';
          }
          return '';
        }).filter(Boolean);
        if (textParts.length > 0) return textParts.join('\n');
      }
      // 3. Object content
      if (typeof content === 'object' && content !== null) {
        if (content.text) return content.text;
        if (content.value) return content.value;
      }
      // 4. Message text field
      if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
        return msg.text;
      }
      // 4b. Reasoning content fallback: if content is empty or null, check if reasoning has a JSON block
      const reasoning = msg.reasoning_content || msg.reasoning || msg.thought;
      if (typeof reasoning === 'string' && reasoning.includes('{') && reasoning.includes('}')) {
        return reasoning;
      }
    }

    // 5. Completions text on choice
    if (typeof choice.text === 'string' && choice.text.trim().length > 0) {
      return choice.text;
    }
    if (Array.isArray(choice.text)) {
      return choice.text.join('\n');
    }

    // 6. Streaming delta content fallback
    if (choice.delta?.content) {
      return typeof choice.delta.content === 'string' ? choice.delta.content : JSON.stringify(choice.delta.content);
    }
  }

  // 7. Alternative top-level vendor fields
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.response === 'string') return data.response;
  if (typeof data.generated_text === 'string') return data.generated_text;
  if (data.output?.[0]?.text) return data.output[0].text;
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;

  return '';
}

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
   * @returns {Promise<{text: string, usage?: Object, diagnostic: Object, raw: Object}>}
   */
  async chat(messages, params = {}) {
    if (!this.apiKey) {
      throw new Error('META_MODEL_API_KEY is not configured in Worker secrets.');
    }

    const buildPayload = (withResponseFormat = false) => {
      const p = {
        model: this.model,
        messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.max_tokens ?? 4096,
        stream: false
      };
      if (withResponseFormat || params.response_format) {
        p.response_format = params.response_format || { type: 'json_object' };
      }
      return p;
    };

    // Attempt 1: Standard clean payload without forced response_format
    let res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(buildPayload(false))
    });

    // If 400 Bad Request on initial payload, retry with response_format
    if (!res.ok && res.status === 400) {
      console.warn('[MetaModelAdapter] HTTP 400 on initial payload, retrying with response_format...');
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(buildPayload(true))
      });
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Meta API error HTTP ${res.status}: ${errorText}`);
    }

    let data = await res.json();
    let text = extractTextFromResponse(data);
    let fallbackAttempted = false;
    let fallbackSucceeded = false;

    // If text was empty despite HTTP 200, try fallback with response_format
    if (!text || text.trim().length === 0) {
      console.warn('[MetaModelAdapter] Empty content extracted on first format, attempting fallback payload...');
      fallbackAttempted = true;
      try {
        const altRes = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(buildPayload(true))
        });
        if (altRes.ok) {
          const altData = await altRes.json();
          const altText = extractTextFromResponse(altData);
          if (altText && altText.trim().length > 0) {
            text = altText;
            data = altData;
            fallbackSucceeded = true;
          }
        }
      } catch (altErr) {
        console.warn('[MetaModelAdapter] Fallback request failed:', altErr.message);
      }
    }

    const choice0 = data.choices?.[0];
    const rawContent = choice0?.message?.content;
    const usage = data.usage || {};
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0;

    // Server-side diagnostic log (structural only: NO secrets, NO full prompts)
    const diagnostic = {
      http_status: res.status,
      content_type: typeof rawContent,
      content_is_array: Array.isArray(rawContent),
      extracted_length: text.length,
      finish_reason: choice0?.finish_reason ?? null,
      reasoning_tokens: reasoningTokens,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      fallback_attempted: fallbackAttempted,
      fallback_succeeded: fallbackSucceeded
    };

    console.log('[MetaModelAdapter Diagnostic]', JSON.stringify(diagnostic));

    return {
      text,
      usage: data.usage || null,
      diagnostic,
      raw: data
    };
  }
}
