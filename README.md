# AgentPay

Autonomous operating budget delegation and quota procurement for AI agents.

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
   Deliberates on task      Config-driven MCP client   PayPal Orders v2 &
   progress & pricing       invoking runtime tools     x402 Base USDC
```

---

## How It Works

1. **Task Initialization**: The operator provides a task description alongside a strict budget ceiling (e.g., $5.00). The session runtime initializes quota tracking across defined resource categories.
2. **Execution & Metering**: The agent carries out task steps using standard Model Context Protocol (MCP) tool calls. Every execution atomically decrements the corresponding resource quota.
3. **Exhaustion Guard**: When a resource reaches zero, execution pauses cleanly. The session coordinator verifies whether remaining workload warrants procurement.
4. **Economic Deliberation**: The reasoning engine weighs remaining steps against live catalog prices (e.g., micro-units vs. volume packs) to select the optimal settlement rail.
5. **Mandate Enforcement**: All purchases are validated against the operator's spending mandate (budget cap, authorized categories, maximum per-transaction limit) before execution.
6. **Task Resumption**: Upon successful settlement and quota issuance, the agent immediately resumes work and generates an execution report.

---

## Architecture

- **Session Coordinator**: A single-threaded, stateful actor providing authoritative state management, atomic quota decrement, and an owner-controlled emergency freeze mechanism.
- **Config-Driven MCP Client**: Protocol-compliant (`2025-11-25`) Streamable HTTP client that dynamically discovers tools at runtime via `tools/list` across any configured endpoints.
- **Dual Payment Rails**: Supports both fiat transactions (PayPal Orders v2) and autonomous on-chain micropayments (x402 USDC on Base).
- **Zero-Log Spend Ledger**: Privacy-first financial auditing. Only transaction metadata (timestamps, units, costs, rails, rationale) is stored. Request payloads, response data, and file contents are never persisted.

---

## Configuration

MCP servers are configured via declarative endpoints. Tools are discovered dynamically at runtime:

```json
[
  {
    "name": "primary-tools",
    "url": "https://mcp.skuuy.com/mcp",
    "transport": "streamable-http"
  },
  {
    "name": "reference-docs",
    "url": "https://docs.example.com/api/mcp",
    "transport": "streamable-http"
  }
]
```

---

## Project Structure

```
agentpay/
├── src/
│   ├── index.js          # HTTP routing, Server-Sent Events, Worker entrypoint
│   ├── session-do.js     # Session Coordinator Durable Object & spend ledger
│   ├── agent-loop.js     # Task execution lifecycle & quota consumption
│   ├── mcp-client.js     # Generic Streamable HTTP MCP client
│   ├── dashboard.js      # Operator interface & real-time telemetry
│   └── types.js          # Shared schemas, constants, and status definitions
├── test/
│   └── agentpay.test.js  # Integration & lifecycle test suite
├── wrangler.toml         # Cloudflare Worker & Durable Object configuration
├── package.json
└── LICENSE
```

---

## Development & Testing

### Prerequisites

- Node.js 20+

### Setup

```bash
# Clone repository
git clone https://github.com/deaabie/agentpay.git
cd agentpay

# Run integration tests
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
