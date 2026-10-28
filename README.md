# 🤖 AgentPay

**Autonomous AI Agent Operating Budget Manager on PayPal Fiat Rails & x402 Base USDC**

Built for the **Meta Global AI Developer Hackathon 2026** (Indie Developer Track).

---

## 💡 The Core Problem & Concept

Other AI agents require a human to manually approve every single micro-purchase and API quota refill. This breaks autonomy and interrupts workflows.

**AgentPay introduces delegated economic agency:**
A human delegates an operating budget **ONCE** — like giving an employee a corporate card with a strictly enforced spending limit. When an agent runs out of quota mid-task:
1. **The Brain (Muse Spark `muse-spark-1.3`)** deliberates over the task progress, spending history, and live catalog prices to decide what to buy, when, and how much.
2. **The Wallet (PayPal Orders v2 / x402)** executes the purchase seamlessly within the human's spending mandate.
3. **The Receipt (Muse Image `muse-image-1.0`)** generates a visual receipt card stored in R2.
4. **The Agent Resumes** its autonomous task without human intervention.

```
       ┌────────────────────────────────────────────────────────┐
       │              DELEGATED OPERATING BUDGET               │
       │           (Human signs Spending Mandate ONCE)          │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │       AGENT RUNTIME          │
                   │   AgentSession Durable Object│
                   └──────────────┬───────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
    🧠 THE BRAIN             ✋ THE HANDS            💳 THE WALLET
  Meta Muse Spark          Config-Driven MCP        PayPal Orders v2
 (muse-spark-1.3)        (skuuy-mcp + ondocs)        + x402 Base USDC
Deliberates & Plans     Real Tools & Executions     Autonomous Rails
```

---

## ⚡ Live Rails & Generic MCP Architecture

AgentPay is **NOT** a single-vendor wrapper; it features a generic, config-driven Model Context Protocol (MCP) engine:
- **Server 1 (`skuuy-mcp`)**: `https://mcp.skuuy.com/mcp` (Streamable HTTP, 16 tools, dual-stack network & EVM RPC relay).
- **Server 2 (`ondocs`)**: `https://ondocs.vercel.app/api/mcp` (Third-party generic MCP server proving multi-server discovery).
- **Runtime Discovery**: Tools are discovered dynamically at runtime via `tools/list` protocol 2025-11-25.

---

## 🛡️ Security & Zero-Log Discipline

- **Machine-Enforced Budget Cap**: Stored authoritatively in SQLite-backed `AgentSession` Durable Object storage. Spark proposes, code enforces.
- **Zero-Log Ledger**: The spend ledger strictly logs *only* transaction metadata (timestamp, resource, units, cost, reasoning). Request bodies, file contents, and raw payloads are **never** persisted.
- **Owner-Only Kill Switch**: Instant freeze capability halting all active sessions immediately.
- **Vendor-Neutral UI**: Zero vendor infrastructure names shown in the user-facing interface.

---

## 🚀 State Machine (v1 Loop)

```
[PLAN] ➔ [EXECUTE] ➔ [MONITOR] ➔ [PAUSE (Exhausted)]
                                        │
                                        ▼ (29-30 Oct Target)
                             [DELIBERATE] ➔ [BUY] ➔ [RESUME]
```

At quota exhaustion, loop v1 pauses cleanly and records its state without attempting early purchases.

---

## 🧪 Testing & Verification

Run the comprehensive unit and integration test suite:

```bash
# Clone the repository
git clone https://github.com/deaabie/agentpay.git
cd agentpay

# Run tests (100% native Node.js test runner)
npm test
```

### Verified Test Suite (7/7 Passing):
1. **Generic Config-Driven MCP Client**: Initializes `skuuy-mcp` and `ondocs` live.
2. **Live MCP Execution**: Executes `skuuy_rpc` on Base and `search` on `ondocs`.
3. **AgentSession DO**: Authoritative lifecycle, atomic quota decrement, and state machine.
4. **Clean Pause on Quota Exhaustion**: Reaches balance 0 and pauses cleanly without purchasing.
5. **Owner-Only Kill Switch**: Freezes execution immediately upon trigger.
6. **Zero-Log Discipline**: Strips forbidden payloads; records only lean financial audit metadata.
7. **AgentLoop v1 Integration**: Runs real task steps, consumes quota on real calls, and cleanly halts.

---

## 📄 License

MIT © 2026 Skuuy Tools
