# AgentPay

Autonomous operating budget delegation and quota procurement for AI agents.

**Live Demo**: [agentpay.skuuy.com](https://agentpay.skuuy.com)

---

## Overview

AI agents executing multi-step tasks often hit external API rate limits, RPC ceilings, or compute boundaries mid-execution. Current systems either abort the workflow or interrupt the operator with repeated approval prompts for minor top-ups.

**AgentPay** introduces **delegated economic agency**. An operator assigns an operating budget and policy mandate once. When the agent exhausts a resource mid-task, it evaluates its remaining workload, assesses live pricing options, procures the required quota within its authorized limits, and resumes execution seamlessly.

```
                  ┌─────────────────────────────────────┐
                  │      DELEGATED OPERATING BUDGET     │
                  │   (Operator signs mandate once)     │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │          SESSION RUNTIME            │
                  │   State Machine & Quota Ledger      │
                  └──────────────────┬──────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
   🧠 REASONING CORE         ✋ TOOL EXECUTION          💳 PAYMENT RAILS
   Meta Muse Spark          Config-driven MCP client   PayPal Orders v2 Vault
   (muse-spark-1.3)         invoking runtime tools     & x402 Base USDC
```

---

## Autonomous Lifecycle: PLAN → EXECUTE → DELIBERATE → BUY

1. **Mandate Setup (Human-Gated Authorization)**: The human operator configures spending limits ($5.00 default cap, $2.50 max per transaction) and clicks **Authorize with PayPal (Sandbox)**. The session runtime requests a PayPal Vault setup token via the Payment Method Tokens API and exchanges it upon payer approval for a secure payment method token. Without an authorized mandate, the session is in a "NO MANDATE" state and all purchase attempts fail closed before any charge.
2. **Strategic PLAN (Advisory Only)**: At session initialization before any execution, **Meta Muse Spark (`muse-spark-1.3`)** assesses task complexity, evaluates free-tier allowances, estimates resource needs, and proposes an opening strategy (`free_tier_first`). PLAN is strictly advisory: it never charges, never buys, and automatically falls back to default steps if model output is malformed.
3. **Execution & Metering**: The agent carries out task steps using standard Model Context Protocol (MCP) tool calls (`skuuy_rpc`, `search`). Every successful execution atomically decrements the corresponding resource quota in the `AgentSession` Durable Object. Failed calls never deduct quota.
4. **Clean Exhaustion Pause**: When a quota bucket hits zero, execution pauses cleanly (`paused_quota_exhausted`). No guessed charges or overspending can occur.
5. **Economic Deliberation**: The agent triggers **Meta Muse Spark (`muse-spark-1.3`)**. The model analyzes remaining workload, completion progress, live catalog pricing (e.g. micro vs. pack volume), and outputs strict JSON with numerical reasoning to select the optimal procurement option.
6. **Mandate & Guardrail Checks**: Before any charge is initiated, the code strictly validates in sequence:
   - Budget cap compliance (`cost + spentUsd <= cap`)
   - Live catalog price and item allowlist match
   - Mandate token validity (rejects missing or placeholder tokens), expiry, allowed categories, and per-purchase ceiling ($2.50 max/tx).
   - If checks fail, the session moves to `needs_mandate_amendment` with zero charge.
7. **Autonomous Buy & Quota Refill**: Once validated, the runtime executes autonomous settlement via PayPal Orders v2 Vault capture (or x402 on-chain USDC when enabled), adds refilled quota according to the catalog mapping, records a `TRANSACTION` ledger entry, and increments `spentUsd`.
8. **Auto-Resume**: The agent loop automatically resumes execution immediately with refilled quota without requiring operator intervention.

---

## Architecture

- **Session Coordinator**: A single-threaded, stateful actor (`AgentSession` Durable Object) providing authoritative state management, atomic quota decrement, and an owner-controlled emergency freeze mechanism.
- **Reasoning Core**: Powered by **Meta Muse Spark (`muse-spark-1.3`)** for strategic planning, resource estimation, and economic deliberation.
- **Visual Receipts**: *Planned (31 Oct)* — Transaction receipt card rendering via Meta Muse Image (`muse-image-1.0`) persisted to R2 storage.
- **Engineered with Meta Tooling**: Core runtime, state machine coordination, and agent loops were constructed using Meta's **Muse Code** coding agent.
- **Config-Driven MCP Client**: Protocol-compliant (`2025-11-25`) Streamable HTTP client that dynamically discovers tools at runtime via `tools/list` across configured endpoints.
- **Dual Payment Rails**:
  - **PayPal Orders v2 & Vault Spending Mandate**: Primary zero-click autonomous checkout for quota packs within human-authorized spending limits.
  - **x402 Base USDC**: Autonomous on-chain micropayment settlement for pay-as-you-go micro-units.
- **Zero-Log Spend Ledger**: Privacy-first financial auditing. Only lean metadata (timestamps, units, costs, rails, rationale) is stored. Request payloads, response data, payment tokens, and file contents are never persisted.

---

## Pre-existing Work Disclosure

In accordance with hackathon guidelines, pre-existing and event-built components are delineated as follows:

- **Pre-existing Work (Created prior to event)**:
  - `skuuy-mcp`: Hosted developer utilities and JSON-RPC relay (`https://mcp.skuuy.com/mcp`).
  - `checkout.skuuy.com`: Existing PayPal Orders v2 sandbox checkout rails and QuotaCoordinator.
  - x402 Base USDC facilitator rails (`bc_c61pqqgo`).
- **New Work Built During the Event (27 Oct – 4 Nov 2026)**:
  - AgentPay core runtime and state machine (`AgentSession` Durable Object).
  - Strategic Planner (`src/plan.js`) and autonomous Buy Executor (`src/buy-executor.js`).
  - Config-driven generic MCP client engine (`src/mcp-client.js`).
  - Autonomous deliberation engine and economic prompt integration with Meta Muse Spark (`src/brain.js`, `src/meta-adapter.js`).
  - PayPal Vault spending mandate verification and autonomous charge executor.
  - Real-time telemetry dashboard (`src/dashboard.js`) and zero-log spend ledger.
  - All event-built code constructed using Meta's **Muse Code** coding agent.

---

## Project Structure

```
agentpay/
├── src/
│   ├── index.js          # HTTP routing, Server-Sent Events, Worker entrypoint
│   ├── session-do.js     # Session Coordinator Durable Object & spend ledger
│   ├── agent-loop.js     # Task execution lifecycle, PLAN init & auto-resumption
│   ├── plan.js           # Strategic task planning via Muse Spark (advisory only)
│   ├── brain.js          # Economic deliberation engine via Muse Spark
│   ├── buy-executor.js   # Mandate verification & autonomous purchase settlement
│   ├── meta-adapter.js   # Standard Meta model client (muse-spark-1.3)
│   ├── mcp-client.js     # Generic Streamable HTTP MCP client
│   ├── dashboard.js      # Operator interface & real-time telemetry
│   └── types.js          # Shared schemas, constants, and status definitions
├── test/
│   └── agentpay.test.js  # 33-test integration & lifecycle suite
├── wrangler.toml         # Cloudflare Worker & Durable Object configuration
├── package.json
└── LICENSE
```

---

## API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` | `GET` | Operator Dashboard & real-time telemetry |
| `/api/session/:id/state` | `GET` | Current session state, quota balances, mandate, and ledger |
| `/api/session/:id/init` | `POST` | Initialize or reset session with custom quota and budget cap |
| `/api/session/:id/run` | `POST` | Execute agent loop steps against live MCP tools |
| `/api/session/:id/plan` | `POST` | Generate strategic plan via Muse Spark (advisory only) |
| `/api/session/:id/deliberate`| `POST` | Trigger economic deliberation upon quota exhaustion |
| `/api/session/:id/buy` | `POST` | Execute mandate-enforced purchase and refill quota |
| `/api/session/:id/mandate` | `POST` | Authorize or update human-gated spending mandate |
| `/api/session/:id/mandate/setup-token` | `POST` | Create PayPal Vault setup token for buyer authorization |
| `/api/session/:id/mandate/paypal-callback` | `GET` | Handle buyer approval redirect and exchange for vault token |
| `/api/session/:id/mandate/exchange-token` | `POST` | Exchange approved setup token for vaulted payment token |
| `/api/session/:id/freeze` | `POST` | Emergency kill switch (freezes execution immediately) |
| `/api/session/:id/unfreeze`| `POST` | Unfreeze session and restore execution |
| `/api/session/:id/stream` | `GET` | Real-time Server-Sent Events (SSE) telemetry stream |

---

## Environment Secrets

Secrets are configured via Worker environment bindings (never committed to repository):

- `META_MODEL_API_KEY`: API key for Meta Muse Spark model calls (`muse-spark-1.3`).
- `PAYPAL_CLIENT_ID`: PayPal Sandbox REST API App Client ID (set by operator).
- `PAYPAL_CLIENT_SECRET`: PayPal Sandbox REST API App Client Secret (set by operator).
- `X402_PAYER_SECRET`: *(Optional)* Payer private key for x402 Base USDC micropayments. When unset, the x402 path safely disables itself with a descriptive error while the PayPal Vault path remains fully operational.

> [!NOTE]
> **Zero Simulation Policy**: There is no simulation mode. A buy without PayPal keys, or with a placeholder mandate token, fails closed with no charge and no quota.

---

## Development & Testing

### Prerequisites

- Node.js 20+

### Setup

```bash
# Clone repository
git clone https://github.com/deaabie/agentpay.git
cd agentpay

# Run full 33-test suite
npm test
```

### Local Development

```bash
# Start local development server
npm run dev
```

---

## License

MIT © 2026 Skuuy Tools
