/**
 * AgentPay — Cloudflare Worker Entrypoint
 * 
 * Routes:
 * - GET  /                         -> Live Dashboard UI
 * - GET  /health                   -> Health check & server diagnostics
 * - GET  /api/session/:id/state    -> Session state snapshot
 * - POST /api/session/:id/init     -> Initialize task & budget cap
 * - POST /api/session/:id/run      -> Run agent loop until exhaustion/pause
 * - POST /api/session/:id/step     -> Execute a single task step
 * - POST /api/session/:id/freeze   -> Owner kill-switch toggle
 * - GET  /api/session/:id/stream   -> Real-time SSE stream
 * 
 * Exported Durable Object: AgentSession
 */

import { AgentSession } from './session-do.js';
import { AgentLoop } from './agent-loop.js';
import { MetaModelAdapter, SPARK_MODEL } from './meta-adapter.js';
import { renderDashboardHTML } from './dashboard.js';
import { DEFAULT_MCP_SERVERS, SEALED_PROOF_SESSIONS, maskVaultToken } from './types.js';
import { rateLimiter, RateLimiter } from './rate-limiter.js';

function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xForwarded = request.headers.get('x-forwarded-for');
  if (xForwarded) return xForwarded.split(',')[0].trim();
  return '127.0.0.1';
}

function getWriteCategory(subpath, method) {
  if (method !== 'POST') return null;

  if (
    subpath === '/plan' ||
    subpath === '/deliberate' ||
    subpath === '/report' ||
    subpath === '/receipts/backfill' ||
    subpath === '/backfill-receipt' ||
    /^\/receipts\/[^/]+\/backfill$/.test(subpath)
  ) {
    return 'model';
  }

  if (
    subpath === '/init' ||
    subpath === '/freeze' ||
    subpath === '/step' ||
    subpath === '/run' ||
    subpath === '/buy' ||
    subpath.startsWith('/mandate')
  ) {
    return 'mutation';
  }

  return null;
}

export { AgentSession, RateLimiter, rateLimiter };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'agentpay',
        version: '1.0.0',
        environment: env.ENVIRONMENT || 'production',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Dashboard root
    if (path === '/' || path === '/dashboard') {
      const sessionId = url.searchParams.get('session') || 'default';
      const html = renderDashboardHTML(sessionId);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // API Routes: /api/session/:id/*
    const sessionMatch = path.match(/^\/api\/session\/([a-zA-Z0-9_-]+)(\/.*)?$/);
    if (sessionMatch && env.AGENTPAY_SESSIONS) {
      const sessionId = sessionMatch[1];
      const subpath = sessionMatch[2] || '';
      const doId = env.AGENTPAY_SESSIONS.idFromName(sessionId);
      const doStub = env.AGENTPAY_SESSIONS.get(doId);

      // Guard: Sealed proof sessions are immutable on server (read-only)
      if (SEALED_PROOF_SESSIONS.has(sessionId)) {
        const isRead = request.method === 'GET' && (
          subpath === '/state' ||
          subpath === '/stream' ||
          subpath.startsWith('/receipts/')
        );
        if (!isRead) {
          return new Response(JSON.stringify({
            success: false,
            error: 'SESSION_SEALED',
            message: 'Session is an immutable proof artifact and cannot be modified.'
          }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // Rate limiting: H2 protection for write and model-trigger endpoints
      const writeCategory = getWriteCategory(subpath, request.method);
      if (writeCategory) {
        const clientIp = getClientIp(request);
        const limiter = env.rateLimiter || rateLimiter;
        if (limiter.isRateLimited(clientIp, writeCategory)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'RATE_LIMITED',
            message: 'Too many requests. Please wait before retrying.'
          }), {
            status: 429,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': '60'
            }
          });
        }
      }

      // GET /api/session/:id/state
      if (subpath === '/state' && request.method === 'GET') {
        const res = await doStub.fetch('https://do/state');
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/init
      if (subpath === '/init' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        body.sessionId = sessionId;
        const res = await doStub.fetch('https://do/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/freeze (Owner Kill Switch)
      if (subpath === '/freeze' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const res = await doStub.fetch('https://do/freeze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/step
      if (subpath === '/step' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const loop = new AgentLoop(doStub, DEFAULT_MCP_SERVERS);
        const result = await loop.executeStep(Number(body.stepIndex) || 0);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/run
      if (subpath === '/run' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const maxSteps = Number(body.maxSteps) || 20;
        const loop = new AgentLoop(doStub, DEFAULT_MCP_SERVERS);
        const result = await loop.runUntilPause(maxSteps);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/deliberate (Trigger economic deliberation directly)
      if (subpath === '/deliberate' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const res = await doStub.fetch('https://do/deliberate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/plan (Trigger strategic planning)
      if (subpath === '/plan' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const res = await doStub.fetch('https://do/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/buy (Trigger autonomous buy settlement)
      if (subpath === '/buy' && request.method === 'POST') {
        // Enforce deliberation binding: public HTTP /buy only settles session.latestDecision
        const res = await doStub.fetch('https://do/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/mandate/setup-token (Create PayPal Vault Setup Token)
      if (subpath === '/mandate/setup-token' && request.method === 'POST') {
        const clientId = env.PAYPAL_CLIENT_ID;
        const clientSecret = env.PAYPAL_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return new Response(JSON.stringify({
            success: false,
            error: 'PAYPAL_KEYS_MISSING',
            message: 'PayPal client credentials missing (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not configured in Worker secrets).'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          const auth = btoa(`${clientId}:${clientSecret}`);
          const baseUrl = 'https://api-m.sandbox.paypal.com';

          // 1. Get OAuth access token
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
            return new Response(JSON.stringify({
              success: false,
              error: 'PAYPAL_AUTH_FAILED',
              message: tokenData.error_description || tokenData.error || 'Failed to authenticate with PayPal Sandbox'
            }), {
              status: 502,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // 2. Create Setup Token via Payment Method Tokens API
          const returnUrl = `${url.origin}/api/session/${sessionId}/mandate/paypal-callback`;
          const cancelUrl = `${url.origin}/?session=${sessionId}`;

          const setupRes = await fetch(`${baseUrl}/v3/vault/setup-tokens`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json',
              'PayPal-Request-Id': `setup-${sessionId}-${Date.now()}`
            },
            body: JSON.stringify({
              payment_source: {
                paypal: {
                  usage_type: 'MERCHANT',
                  customer_type: 'CONSUMER',
                  experience_context: {
                    brand_name: 'AgentPay',
                    locale: 'en-US',
                    return_url: returnUrl,
                    cancel_url: cancelUrl,
                    shipping_preference: 'NO_SHIPPING'
                  }
                }
              }
            })
          });

          const setupData = await setupRes.json();
          if (!setupRes.ok || !setupData.id) {
            const detailsText = Array.isArray(setupData.details)
              ? setupData.details.map(d => `${d.issue || 'ISSUE'}: ${d.description || ''}`).join('; ')
              : '';
            const errorParts = [
              setupData.name || 'ERROR',
              setupData.message || '',
              detailsText ? `[Details: ${detailsText}]` : '',
              setupData.debug_id ? `[debug_id: ${setupData.debug_id}]` : ''
            ].filter(Boolean).join(' - ');

            return new Response(JSON.stringify({
              success: false,
              error: 'PAYPAL_SETUP_TOKEN_FAILED',
              paypalStatus: setupRes.status,
              paypalError: errorParts,
              name: setupData.name || null,
              message: setupData.message || null,
              debug_id: setupData.debug_id || null,
              details: setupData.details || null
            }), {
              status: setupRes.status >= 400 && setupRes.status < 600 ? setupRes.status : 502,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          const approveLink = (setupData.links || []).find(l => l.rel === 'approve');
          return new Response(JSON.stringify({
            success: true,
            setupTokenId: setupData.id,
            approveUrl: approveLink ? approveLink.href : null
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(JSON.stringify({
            success: false,
            error: 'PAYPAL_SETUP_TOKEN_ERROR',
            message: err.message
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // GET /api/session/:id/mandate/paypal-callback (Payer approved redirect)
      if (subpath === '/mandate/paypal-callback' && request.method === 'GET') {
        const approvalTokenId = url.searchParams.get('approval_token_id') || url.searchParams.get('token');
        if (!approvalTokenId) {
          return Response.redirect(`${url.origin}/?session=${sessionId}&error=MISSING_APPROVAL_TOKEN`, 302);
        }

        const clientId = env.PAYPAL_CLIENT_ID;
        const clientSecret = env.PAYPAL_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return Response.redirect(`${url.origin}/?session=${sessionId}&error=PAYPAL_KEYS_MISSING`, 302);
        }

        try {
          const auth = btoa(`${clientId}:${clientSecret}`);
          const baseUrl = 'https://api-m.sandbox.paypal.com';

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
            return Response.redirect(`${url.origin}/?session=${sessionId}&error=PAYPAL_AUTH_FAILED`, 302);
          }

          // Exchange setup token for payment method token
          const payRes = await fetch(`${baseUrl}/v3/vault/payment-tokens`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json',
              'PayPal-Request-Id': `paytoken-${sessionId}-${Date.now()}`
            },
            body: JSON.stringify({
              payment_source: {
                token: {
                  id: approvalTokenId,
                  type: 'SETUP_TOKEN'
                }
              }
            })
          });

          const payData = await payRes.json();
          if (!payRes.ok || !payData.id) {
            const errName = encodeURIComponent(payData.name || payData.message || 'PAYMENT_TOKEN_FAILED');
            return Response.redirect(`${url.origin}/?session=${sessionId}&error=${errName}`, 302);
          }

          // Update DO mandate with real vaulted payment token
          await doStub.fetch('https://do/mandate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vaultToken: payData.id,
              rail: 'paypal'
            })
          });

          return Response.redirect(`${url.origin}/?session=${sessionId}&mandate_authorized=true`, 302);
        } catch (err) {
          return Response.redirect(`${url.origin}/?session=${sessionId}&error=${encodeURIComponent(err.message)}`, 302);
        }
      }

      // POST /api/session/:id/mandate/exchange-token (Direct API exchange)
      if (subpath === '/mandate/exchange-token' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const approvalTokenId = body.approvalTokenId || body.setupTokenId;
        if (!approvalTokenId) {
          return new Response(JSON.stringify({
            success: false,
            error: 'MISSING_APPROVAL_TOKEN',
            message: 'approvalTokenId is required'
          }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const clientId = env.PAYPAL_CLIENT_ID;
        const clientSecret = env.PAYPAL_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return new Response(JSON.stringify({
            success: false,
            error: 'PAYPAL_KEYS_MISSING'
          }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        try {
          const auth = btoa(`${clientId}:${clientSecret}`);
          const baseUrl = 'https://api-m.sandbox.paypal.com';

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
            return new Response(JSON.stringify({
              success: false,
              error: 'PAYPAL_AUTH_FAILED'
            }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }

          const payRes = await fetch(`${baseUrl}/v3/vault/payment-tokens`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json',
              'PayPal-Request-Id': `paytoken-${sessionId}-${Date.now()}`
            },
            body: JSON.stringify({
              payment_source: {
                token: {
                  id: approvalTokenId,
                  type: 'SETUP_TOKEN'
                }
              }
            })
          });

          const payData = await payRes.json();
          if (!payRes.ok || !payData.id) {
            return new Response(JSON.stringify({
              success: false,
              error: 'PAYMENT_TOKEN_FAILED',
              paypalStatus: payRes.status,
              paypalError: payData.name || payData.message || JSON.stringify(payData)
            }), { status: payRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }

          const mandateRes = await doStub.fetch('https://do/mandate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vaultToken: payData.id,
              rail: 'paypal'
            })
          });
          const mandateData = await mandateRes.json();

          return new Response(JSON.stringify({
            success: true,
            paymentTokenId: maskVaultToken(payData.id),
            mandate: mandateData.mandate
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(JSON.stringify({
            success: false,
            error: 'EXCHANGE_ERROR',
            message: err.message
          }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // POST /api/session/:id/mandate (Set or update spending mandate)
      if (subpath === '/mandate' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const res = await doStub.fetch('https://do/mandate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // GET /api/session/:id/stream (SSE Stream)
      if (subpath === '/stream' && request.method === 'GET') {
        return await doStub.fetch('https://do/stream');
      }

      // GET /api/session/:id/receipts/:txId (Receipt image from R2)
      const receiptImgMatch = subpath.match(/^\/receipts\/([^/]+)$/);
      if (receiptImgMatch && request.method === 'GET') {
        const txId = receiptImgMatch[1];
        const imageKey = `receipt-${txId}.png`;
        if (env.RECEIPTS_BUCKET && typeof env.RECEIPTS_BUCKET.get === 'function') {
          const object = await env.RECEIPTS_BUCKET.get(imageKey);
          if (object) {
            return new Response(object.body, {
              headers: {
                ...corsHeaders,
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400'
              }
            });
          }
        }
        return new Response(JSON.stringify({ error: 'Receipt image not found in storage' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/receipts/:txId/backfill or /receipts/backfill
      const receiptBackfillMatch = subpath.match(/^\/receipts\/([^/]+)\/backfill$/) ||
                                   subpath === '/receipts/backfill' ||
                                   subpath === '/backfill-receipt';
      if (receiptBackfillMatch && request.method === 'POST') {
        const txId = Array.isArray(receiptBackfillMatch) ? receiptBackfillMatch[1] : null;
        const body = await request.json().catch(() => ({}));
        const payload = { transactionId: txId || body.transactionId || body.txId };
        const res = await doStub.fetch('https://do/backfill-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/session/:id/report (Narrative Financial Report Card via Muse Spark)
      if (subpath === '/report' && request.method === 'POST') {
        const res = await doStub.fetch('https://do/report', { method: 'POST' });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Direct receipt image route: GET /api/receipts/:txId
    const directReceiptMatch = path.match(/^\/api\/receipts\/([^/]+)$/);
    if (directReceiptMatch && request.method === 'GET') {
      const txId = directReceiptMatch[1];
      const imageKey = `receipt-${txId}.png`;
      if (env.RECEIPTS_BUCKET && typeof env.RECEIPTS_BUCKET.get === 'function') {
        const object = await env.RECEIPTS_BUCKET.get(imageKey);
        if (object) {
          return new Response(object.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=86400'
            }
          });
        }
      }
      return new Response(JSON.stringify({ error: 'Receipt image not found in storage' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
