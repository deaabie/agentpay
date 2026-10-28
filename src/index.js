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
import { DEFAULT_MCP_SERVERS } from './types.js';

export { AgentSession };

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

    // Diagnostic endpoint: live test Meta Model API directly with dummy prompt
    // Gated: Requires ?demo=true to prevent unauthenticated crawler traffic (§Cleanup step 1)
    if (path === '/api/test-spark') {
      const isDemo = url.searchParams.get('demo') === 'true' || env.ENABLE_TEST_SPARK === 'true';
      if (!isDemo) {
        return new Response(JSON.stringify({
          error: 'Diagnostic endpoint gated. Pass ?demo=true to execute live sanity test.'
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        const apiKey = env.META_MODEL_API_KEY || null;
        if (!apiKey) {
          return new Response(JSON.stringify({
            success: false,
            error: 'META_MODEL_API_KEY is not configured in Worker secrets.'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const adapter = new MetaModelAdapter({ apiKey });
        const result = await adapter.chat([
          {
            role: 'system',
            content: 'You are a test assistant. Answer ONLY in JSON format: {"status": "ok", "message": "hello from muse-spark"}'
          },
          {
            role: 'user',
            content: 'Say hello in JSON'
          }
        ]);

        return new Response(JSON.stringify({
          success: true,
          model: SPARK_MODEL,
          extractedText: result.text,
          diagnostic: result.diagnostic,
          usage: result.usage
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: err.message
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
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
        const body = await request.json().catch(() => ({}));
        const res = await doStub.fetch('https://do/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
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
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
