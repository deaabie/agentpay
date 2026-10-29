/**
 * AgentPay Neo-Brutalist Dashboard UI
 * 
 * Standing Rule (§2):
 * - ZERO vendor infrastructure names in user-facing UI.
 * - Clean, responsive, high-contrast interface.
 * - Real-time SSE event consumption.
 */

export function renderDashboardHTML(sessionId = 'default') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentPay — Autonomous AI Agent Operating Budget Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --accent-yellow: #f1e05a;
      --accent-cyan: #58a6ff;
      --accent-green: #3fb950;
      --accent-red: #f85149;
      --text: #c9d1d9;
      --text-bright: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', sans-serif;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
    
    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: var(--card-bg);
      border: 2px solid var(--border);
      border-radius: 12px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand h1 { font-size: 24px; font-weight: 900; color: var(--text-bright); letter-spacing: -0.5px; }
    .brand .badge {
      background: #238636;
      color: white;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 8px;
      border-radius: 6px;
      text-transform: uppercase;
    }
    .header-actions { display: flex; gap: 12px; align-items: center; }
    .btn-killswitch {
      background: #da3633;
      color: white;
      border: none;
      padding: 8px 16px;
      font-weight: 800;
      font-size: 13px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s;
    }
    .btn-killswitch:hover { background: #b62324; }
    .btn-killswitch.frozen { background: #8957e5; }

    /* Task & Budget Bar */
    .hero-card {
      background: var(--card-bg);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .task-inputs { display: grid; grid-template-columns: 1fr 220px auto; gap: 16px; }
    input[type="text"] {
      background: #090d13;
      border: 1px solid var(--border);
      color: var(--text-bright);
      padding: 12px 16px;
      font-size: 14px;
      border-radius: 8px;
      font-family: inherit;
      outline: none;
    }
    .budget-pill {
      background: #090d13;
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 16px;
      border-radius: 8px;
      color: var(--accent-green);
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
    }
    .btn-primary {
      background: var(--accent-cyan);
      color: black;
      border: none;
      padding: 12px 24px;
      font-weight: 800;
      font-size: 14px;
      border-radius: 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-primary:hover { opacity: 0.9; }

    /* Grid layout */
    .dashboard-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; }
    @media (max-width: 900px) { .dashboard-grid { grid-template-columns: 1fr; } }

    /* Meter Cards */
    .meters-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .meter-card {
      background: var(--card-bg);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .meter-header { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #8b949e; text-transform: uppercase; }
    .meter-value { font-size: 28px; font-weight: 900; color: var(--text-bright); font-family: 'JetBrains Mono', monospace; }
    .progress-bar-bg { background: #21262d; height: 8px; border-radius: 4px; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }

    /* Server cards */
    .servers-panel {
      background: var(--card-bg);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .panel-title { font-size: 14px; font-weight: 800; color: var(--text-bright); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .server-item {
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .server-name { font-weight: 800; color: var(--text-bright); font-size: 13px; }
    .server-url { font-size: 11px; color: #8b949e; font-family: 'JetBrains Mono', monospace; }
    .server-status-pill {
      font-size: 11px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(63, 185, 80, 0.15);
      color: var(--accent-green);
      border: 1px solid rgba(63, 185, 80, 0.4);
    }
    .server-status-pill.error {
      background: rgba(248, 81, 73, 0.15);
      color: var(--accent-red);
      border: 1px solid rgba(248, 81, 73, 0.4);
    }

    /* Execution Log */
    .log-panel {
      background: var(--card-bg);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .status-badge {
      font-size: 12px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-block;
      text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
    }
    .status-executing { background: rgba(88, 166, 255, 0.2); color: var(--accent-cyan); border: 1px solid var(--accent-cyan); }
    .status-paused { background: rgba(241, 224, 90, 0.2); color: var(--accent-yellow); border: 1px solid var(--accent-yellow); }
    .status-idle { background: #21262d; color: #8b949e; }
    .status-frozen { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); border: 1px solid var(--accent-red); }

    /* Ledger */
    .ledger-table-wrap {
      overflow-x: auto;
      max-height: 280px;
      background: #090d13;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
    th { padding: 10px 12px; background: #161b22; color: #8b949e; border-bottom: 1px solid var(--border); font-weight: 700; }
    td { padding: 8px 12px; border-bottom: 1px solid #21262d; font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>AGENTPAY</h1>
        <span class="badge">Meta AI Hackathon 2026</span>
        <span class="badge" style="background: #1f6feb;">Indie Track</span>
      </div>
      <div class="header-actions">
        <span id="session-tag" style="font-size: 12px; color: #8b949e; font-family: 'JetBrains Mono', monospace;">Session: ${sessionId}</span>
        <button id="btn-reset" class="btn-killswitch" style="background: #21262d; border-color: #30363d; color: var(--text-bright);" onclick="resetCurrentSession()">🔄 Reset Session</button>
        <button id="btn-killswitch" class="btn-killswitch" onclick="toggleKillSwitch()">🛑 Kill Switch</button>
      </div>
    </header>

    <!-- Judge Demo & Evidence Replay Bar -->
    <div id="judge-replay-bar" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 18px; background: rgba(88, 166, 255, 0.08); border: 1px solid rgba(88, 166, 255, 0.35); border-radius: 10px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 13px; font-weight: 800; color: var(--accent-cyan); text-transform: uppercase;">⚖️ Judge Evaluation Mode:</span>
        <span id="replay-status-text" style="font-size: 12px; color: var(--text-bright);">Inspect verified evidence chain or launch an isolated fresh test run.</span>
      </div>
      <div style="display: flex; gap: 10px;">
        <button id="btn-view-proof" class="btn-primary" style="padding: 6px 14px; font-size: 12px; background: #238636; border: none; font-weight: 700; border-radius: 6px; cursor: pointer; color: #fff;" onclick="window.location.href='/?session=spark_live_pos'">▶ Verified Proof Replay (spark_live_pos)</button>
        <button id="btn-new-demo" class="btn-primary" style="padding: 6px 14px; font-size: 12px; background: #1f6feb; border: none; font-weight: 700; border-radius: 6px; cursor: pointer; color: #fff;" onclick="launchFreshDemoSession()">✨ Launch Fresh Live Test</button>
      </div>
    </div>

    <!-- Replay Lock Banner for spark_live_pos -->
    <div id="replay-lock-banner" style="display: none; padding: 12px 18px; background: rgba(63, 185, 80, 0.15); border: 1px solid var(--accent-green); border-radius: 10px; color: var(--accent-green); font-size: 13px; font-weight: 700;">
      🛡️ VERIFIED EVIDENCE REPLAY (READ-ONLY) — PayPal Sandbox Orders v2 Capture 9YL05462XC5957258 settled on 29 Oct 2026 19:11:04 WIB ($2.00, +1000 RPC). Live execution controls are locked to preserve audit evidence.
    </div>

    <div class="hero-card">
      <div class="task-inputs">
        <input type="text" id="task-input" value="Audit multi-chain smart contracts & wallet activity on Base and Ethereum">
        <div class="budget-pill">
          <span id="budget-pill-text">Delegated: $5.00 | Spent: $0.00</span>
        </div>
        <button class="btn-primary" id="btn-run" onclick="runAgentTask()">▶ Run Agent Task</button>
      </div>
    </div>

    <!-- Delegated Spending Mandate Policy Card -->
    <div id="mandate-card" style="background: #161b22; border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 13px; font-weight: 800; color: var(--accent-yellow); text-transform: uppercase;">💳 Delegated Spending Mandate (Zero-Click Vault)</span>
          <span id="mandate-status-badge" class="status-badge" style="background: rgba(241, 224, 90, 0.2); color: var(--accent-yellow); border: 1px solid var(--accent-yellow);">NO MANDATE</span>
        </div>
        <div id="mandate-action-btn-container">
          <button id="btn-auth-paypal" class="btn-primary" style="padding: 6px 14px; font-size: 12px; background: #0070ba; border: none; cursor: pointer; border-radius: 6px; font-weight: 700; color: #fff;" onclick="authorizePayPalSandbox()">⚡ Authorize with PayPal (Sandbox)</button>
        </div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: #8b949e; font-family: 'JetBrains Mono', monospace;">
        <div>Budget Cap: <strong id="mandate-cap" style="color: var(--text-bright);">$5.00</strong></div>
        <div>Max/Tx: <strong id="mandate-max-tx" style="color: var(--text-bright);">$2.50</strong></div>
        <div>Rail: <strong id="mandate-rail" style="color: var(--accent-cyan);">PayPal Sandbox Vault</strong></div>
        <div>Token: <strong id="mandate-token-display" style="color: var(--text-bright);">None</strong></div>
        <div>Policy Check: <span id="mandate-check-line" style="color: var(--accent-yellow); font-weight: 700;">No active mandate. Authorization required before autonomous buy.</span></div>
      </div>
      <div id="mandate-error-msg" style="display: none; margin-top: 10px; padding: 8px 12px; background: rgba(248, 81, 73, 0.15); border: 1px solid var(--accent-red); border-radius: 6px; color: var(--accent-red); font-size: 12px; font-family: 'JetBrains Mono', monospace;"></div>
    </div>

    <!-- Muse Spark Strategic Plan Card (§Part A) -->
    <div id="plan-card-container" style="display: none; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 13px; font-weight: 800; color: #58a6ff; text-transform: uppercase;">📋 Strategic Plan (Muse Spark)</span>
          <span id="plan-guardrail-badge" class="status-badge" style="background: rgba(88, 166, 255, 0.2); color: var(--accent-cyan); border: 1px solid var(--accent-cyan);">Advisory Verified</span>
        </div>
        <span id="plan-timestamp" style="font-size: 11px; color: #8b949e; font-family: 'JetBrains Mono', monospace;"></span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px; background: #090d13; padding: 10px; border-radius: 8px; border: 1px solid var(--border);">
        <div>
          <div style="font-size: 10px; color: #8b949e; text-transform: uppercase;">Opening Strategy</div>
          <div id="plan-strategy" style="font-size: 13px; font-weight: 800; color: var(--accent-green); font-family: 'JetBrains Mono', monospace;">—</div>
        </div>
        <div>
          <div style="font-size: 10px; color: #8b949e; text-transform: uppercase;">Estimated Needs</div>
          <div id="plan-calls" style="font-size: 13px; font-weight: 800; color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace;">—</div>
        </div>
        <div>
          <div style="font-size: 10px; color: #8b949e; text-transform: uppercase;">Estimated Upfront Cost</div>
          <div id="plan-cost" style="font-size: 13px; font-weight: 800; color: var(--accent-yellow); font-family: 'JetBrains Mono', monospace;">—</div>
        </div>
      </div>

      <div>
        <div style="font-size: 11px; font-weight: 700; color: #8b949e; text-transform: uppercase; margin-bottom: 4px;">Strategic Reasoning (Muse Spark):</div>
        <div id="plan-reasoning" style="font-size: 12px; color: var(--text-bright); line-height: 1.5; background: #090d13; padding: 10px; border-radius: 8px; border: 1px solid var(--border);"></div>
      </div>

      <div id="plan-fallback-wrap" style="display: none; margin-top: 8px; padding: 8px 12px; background: rgba(248, 81, 73, 0.15); border: 1px solid var(--accent-red); border-radius: 6px; color: var(--accent-red); font-size: 12px; font-family: 'JetBrains Mono', monospace;">
        <strong>Plan Rejection / Fallback:</strong> <span id="plan-rejection-reason"></span>
      </div>
      <div id="plan-diagnostic-line" style="display: none; margin-top: 6px; font-size: 11px; color: #8b949e; font-family: 'JetBrains Mono', monospace;">
        <strong>Spark Diagnostic:</strong> <span id="plan-diagnostic-text"></span>
      </div>
    </div>

    <!-- Quota Meters -->
    <div class="meters-row">
      <div class="meter-card">
        <div class="meter-header">
          <span>RPC Quota</span>
          <span id="rpc-percent">100%</span>
        </div>
        <div class="meter-value" id="rpc-remaining">100</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="rpc-fill" style="width: 100%; background: var(--accent-cyan);"></div>
        </div>
      </div>

      <div class="meter-card">
        <div class="meter-header">
          <span>Read Quota</span>
          <span id="read-percent">100%</span>
        </div>
        <div class="meter-value" id="read-remaining">20</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="read-fill" style="width: 100%; background: var(--accent-green);"></div>
        </div>
      </div>

      <div class="meter-card">
        <div class="meter-header">
          <span>File Drops</span>
          <span id="file-percent">100%</span>
        </div>
        <div class="meter-value" id="file-remaining">5</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="file-fill" style="width: 100%; background: var(--accent-yellow);"></div>
        </div>
      </div>
    </div>

    <!-- Muse Spark Economic Deliberation Card -->
    <div id="decision-card-container" style="display: none; background: #161b22; border: 2px solid var(--accent-cyan); border-radius: 12px; padding: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px; font-weight: 800; color: var(--accent-cyan); text-transform: uppercase;">🧠 Muse Spark Economic Deliberation</span>
          <span id="decision-guardrail-badge" class="status-badge" style="background: rgba(63, 185, 80, 0.2); color: var(--accent-green); border: 1px solid var(--accent-green);">Awaiting Purchase</span>
        </div>
        <span id="decision-timestamp" style="font-size: 11px; color: #8b949e; font-family: 'JetBrains Mono', monospace;"></span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px; background: #090d13; padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
        <div>
          <div style="font-size: 11px; color: #8b949e; text-transform: uppercase;">Proposed Action</div>
          <div id="decision-action" style="font-size: 14px; font-weight: 800; color: var(--text-bright); font-family: 'JetBrains Mono', monospace;">—</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #8b949e; text-transform: uppercase;">Item & Rail</div>
          <div id="decision-item-rail" style="font-size: 14px; font-weight: 800; color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace;">—</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #8b949e; text-transform: uppercase;">Cost & Coverage</div>
          <div id="decision-cost-coverage" style="font-size: 14px; font-weight: 800; color: var(--accent-green); font-family: 'JetBrains Mono', monospace;">—</div>
        </div>
      </div>

      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; font-weight: 800; color: #8b949e; text-transform: uppercase; margin-bottom: 4px;">Deliberation Rationale (Human Language):</div>
        <div id="decision-reasoning" style="font-size: 13px; color: var(--text-bright); line-height: 1.6; background: #090d13; padding: 12px; border-radius: 8px; border: 1px solid var(--border);"></div>
      </div>

      <div id="decision-alt-wrap" style="font-size: 12px; color: #8b949e;">
        <strong>Alternative Evaluated:</strong> <span id="decision-alt"></span>
      </div>

      <div id="decision-purchase-line" style="display: none; margin-top: 10px; padding: 10px 14px; background: rgba(63, 185, 80, 0.1); border: 1px solid var(--accent-green); border-radius: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace;">
        <span style="color: var(--accent-green); font-weight: 700;">⚡ Autonomous Charge Executed:</span>
        <span id="decision-purchase-desc" style="color: var(--text-bright);"></span>
      </div>

      <div id="decision-retry-wrap" style="display: none; margin-top: 10px;">
        <button id="btn-retry-buy" class="btn-primary" style="background: #238636; font-size: 12px; padding: 8px 16px;" onclick="retryAutonomousBuy()">🔄 Retry Autonomous Settlement</button>
      </div>
      
      <div id="decision-rejection-wrap" style="display: none; margin-top: 8px; padding: 8px 12px; background: rgba(248, 81, 73, 0.15); border: 1px solid var(--accent-red); border-radius: 6px; color: var(--accent-red); font-size: 12px;">
        <strong>Guardrail Rejection:</strong> <span id="decision-rejection-reason"></span>
      </div>

      <div id="decision-diagnostic-line" style="display: none; margin-top: 6px; font-size: 11px; color: #8b949e; font-family: 'JetBrains Mono', monospace;">
        <strong>Spark Diagnostic:</strong> <span id="decision-diagnostic-text"></span>
      </div>
    </div>

    <div class="dashboard-grid">
      <!-- Live Execution Log & State -->
      <div class="log-panel">
        <div class="panel-title">
          <span>Live Agent Runtime State</span>
          <span class="status-badge status-idle" id="status-badge">IDLE</span>
        </div>
        <div id="status-message" style="font-size: 13px; color: #8b949e; min-height: 24px;">Ready to execute autonomous workflow.</div>
        
        <div class="panel-title" style="margin-top: 12px;">Spend Ledger (Zero-Log Audit Trail)</div>
        <div class="ledger-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Resource</th>
                <th>Units</th>
                <th>Cost</th>
                <th>Reasoning / Action</th>
              </tr>
            </thead>
            <tbody id="ledger-body">
              <tr>
                <td colspan="6" style="text-align: center; color: #8b949e; padding: 24px;">No transactions recorded yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Connected MCP Servers (Generic Proof) -->
      <div class="servers-panel">
        <div class="panel-title">
          <span>Connected MCP Servers (Config-Driven)</span>
          <span style="font-size: 11px; color: #8b949e;">Live Dynamic Discovery</span>
        </div>
        
        <div id="servers-container">
          <div style="color: #8b949e; font-size: 12px; padding: 12px; text-align: center;">Discovering MCP servers...</div>
        </div>

        <div style="margin-top: 16px; padding: 12px; background: #090d13; border-radius: 8px; border: 1px solid var(--border);">
          <div style="font-size: 11px; font-weight: 800; color: #8b949e; text-transform: uppercase;">Economic Rail Binding</div>
          <div style="font-size: 12px; color: var(--text-bright); margin-top: 4px;">
            Primary: PayPal Orders v2 Sandbox<br>
            Secondary: x402 Base USDC Micropayments
          </div>
        </div>
      </div>
    </div>

    <!-- Financial Audit Report & Procurement Efficiency -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px;">
      <!-- Narrative Financial Report Card -->
      <div style="background: var(--card-bg); border: 2px solid var(--border); border-radius: 12px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 13px; font-weight: 800; color: var(--accent-green); text-transform: uppercase;">📊 Financial Audit Report (Muse Spark)</span>
          </div>
          <button id="btn-refresh-report" class="btn-primary" style="padding: 4px 10px; font-size: 11px; background: #21262d; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; color: var(--text-bright);" onclick="generateFinancialReport()">🔄 Audit Spend</button>
        </div>
        <div id="financial-report-metrics" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; background: #090d13; padding: 10px; border-radius: 8px; border: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; font-size: 11px;">
          <div>
            <div style="color: #8b949e; text-transform: uppercase; font-size: 10px;">Delegated Cap</div>
            <div id="report-cap" style="color: var(--text-bright); font-weight: 700; font-size: 13px;">$5.00</div>
          </div>
          <div>
            <div style="color: #8b949e; text-transform: uppercase; font-size: 10px;">Settled Spend</div>
            <div id="report-spent" style="color: var(--accent-green); font-weight: 700; font-size: 13px;">$0.00</div>
          </div>
          <div>
            <div style="color: #8b949e; text-transform: uppercase; font-size: 10px;">Remaining</div>
            <div id="report-remaining" style="color: var(--accent-cyan); font-weight: 700; font-size: 13px;">$5.00</div>
          </div>
        </div>
        <div id="financial-report-text" style="font-size: 12px; line-height: 1.6; color: var(--text-bright); background: #090d13; padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
          No audit summary generated yet. Click "Audit Spend" to generate a narrative audit via Meta Muse Spark.
        </div>
      </div>

      <!-- Honest Procurement Efficiency Counter -->
      <div style="background: var(--card-bg); border: 2px solid var(--border); border-radius: 12px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 13px; font-weight: 800; color: var(--accent-cyan); text-transform: uppercase;">⚡ Procurement Efficiency & Avoided Friction</span>
          <span class="status-badge" style="background: rgba(88, 166, 255, 0.2); color: var(--accent-cyan); border: 1px solid var(--accent-cyan);">HONEST ARITHMETIC</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; background: #090d13; padding: 10px; border-radius: 8px; border: 1px solid var(--border); font-family: 'JetBrains Mono', monospace;">
          <div>
            <div style="color: #8b949e; font-size: 10px; text-transform: uppercase;">Avoided Invoices</div>
            <div id="efficiency-avoided-count" style="font-size: 18px; font-weight: 900; color: var(--accent-green);">999</div>
            <div style="font-size: 10px; color: #8b949e;">Micro-tx settlements eliminated</div>
          </div>
          <div>
            <div style="color: #8b949e; font-size: 10px; text-transform: uppercase;">Human Interruptions</div>
            <div style="font-size: 18px; font-weight: 900; color: var(--accent-yellow);">0</div>
            <div style="font-size: 10px; color: #8b949e;">100% autonomous execution</div>
          </div>
        </div>
        <div style="font-size: 11px; color: #8b949e; line-height: 1.5; background: #090d13; padding: 10px; border-radius: 8px; border: 1px solid var(--border); font-family: 'JetBrains Mono', monospace;">
          <div>Bulk Refill: <strong>$2.00 / 1000 RPC</strong> ($0.002/call bulk rate)</div>
          <div>Pay-As-You-Go: <strong>$0.001 / call</strong> ($1.00 for 1000 calls across 1000 discrete invoices)</div>
          <div style="margin-top: 4px; color: var(--text-bright);">Value: Single-settlement efficiency eliminates 999 roundtrips, wallet approvals, and execution halts.</div>
        </div>
      </div>
    </div>

    <!-- Visual Receipts Gallery (Muse Image + Storage) -->
    <div style="background: var(--card-bg); border: 2px solid var(--border); border-radius: 12px; padding: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px; font-weight: 800; color: var(--text-bright); text-transform: uppercase;">🧾 Visual Receipts Gallery (Muse Image)</span>
          <span class="status-badge" style="background: rgba(35, 134, 54, 0.2); color: var(--accent-green); border: 1px solid var(--accent-green);">Verified Proof Assets</span>
        </div>
        <button id="btn-backfill-receipt" class="btn-primary" style="display: none; padding: 6px 14px; font-size: 12px; background: #238636; border: none; border-radius: 6px; cursor: pointer; color: #fff; font-weight: 700;" onclick="backfillLatestReceipt()">⚡ Backfill Proven Receipt</button>
      </div>

      <div id="receipts-gallery-container">
        <div style="text-align: center; color: #8b949e; padding: 24px; font-size: 12px; background: #090d13; border: 1px dashed var(--border); border-radius: 8px;">
          No receipts recorded yet. Completed purchases automatically generate a visual receipt card via Meta Muse Image.
        </div>
      </div>
    </div>
  </div>

  <script>
    const sessionId = "${sessionId}";

    // Connect to Server-Sent Events stream for live real-time updates
    const evtSource = new EventSource('/api/session/' + sessionId + '/stream');

    evtSource.addEventListener('snapshot', e => {
      const data = JSON.parse(e.data);
      updateDashboard(data);
    });

    evtSource.addEventListener('servers_updated', e => {
      fetchState();
    });

    evtSource.addEventListener('quota_deducted', e => {
      fetchState();
    });

    evtSource.addEventListener('quota_exhausted', e => {
      fetchState();
    });

    evtSource.addEventListener('ledger_added', e => {
      fetchState();
    });

    evtSource.addEventListener('buy_completed', e => {
      fetchState();
    });

    evtSource.addEventListener('receipt_updated', e => {
      fetchState();
    });

    evtSource.addEventListener('report_updated', e => {
      fetchState();
    });

    evtSource.addEventListener('decision_made', e => {
      fetchState();
    });

    evtSource.addEventListener('freeze_toggled', e => {
      fetchState();
    });

    async function fetchState() {
      const res = await fetch('/api/session/' + sessionId + '/state');
      const data = await res.json();
      updateDashboard(data);
    }

    function updateDashboard(data) {
      if (!data) return;

      // Update connected servers dynamically from real state
      const sContainer = document.getElementById('servers-container');
      if (data.connectedServers && data.connectedServers.length > 0) {
        sContainer.innerHTML = data.connectedServers.map(s => {
          const isOk = s.status === 'connected';
          const pillClass = isOk ? 'server-status-pill' : 'server-status-pill error';
          const pillText = isOk
            ? (s.toolsCount + ' Tools (' + (s.latencyMs || 0) + 'ms)')
            : (s.error ? ('Error: ' + s.error.slice(0, 16)) : 'Disconnected');
          return '<div class="server-item">' +
            '<div>' +
              '<div class="server-name">' + s.name + '</div>' +
              '<div class="server-url">' + s.url + '</div>' +
            '</div>' +
            '<span class="' + pillClass + '">' + pillText + '</span>' +
          '</div>';
        }).join('');
      } else {
        sContainer.innerHTML = '<div style="color: #8b949e; font-size: 12px; padding: 12px; text-align: center;">No MCP servers registered.</div>';
      }

      if (!data.quota) return;

      // Update budget pill
      const bp = document.getElementById('budget-pill-text');
      if (bp) {
        bp.innerText = 'Delegated: $' + (data.budgetCapUsd || 5.00).toFixed(2) + ' | Spent: $' + (data.spentUsd || 0).toFixed(2);
      }

      // Update Plan Card
      const pContainer = document.getElementById('plan-card-container');
      if (data.latestPlan) {
        pContainer.style.display = 'block';
        const pl = data.latestPlan;
        document.getElementById('plan-strategy').innerText = (pl.opening_strategy || 'free_tier_first').toUpperCase().replace(/_/g, ' ');
        document.getElementById('plan-calls').innerText = (pl.estimated_rpc_calls || 0) + ' RPC (' + (pl.estimated_reads || 0) + ' Read)';
        document.getElementById('plan-cost').innerText = '$' + (pl.estimated_cost_usd || 0).toFixed(2);
        document.getElementById('plan-reasoning').innerText = pl.reasoning || 'No strategic rationale recorded.';

        const pBadge = document.getElementById('plan-guardrail-badge');
        const pRejWrap = document.getElementById('plan-fallback-wrap');
        const pDiagLine = document.getElementById('plan-diagnostic-line');

        if (pl.guardrailStatus === 'rejected-advisory' || pl.status === 'rejected') {
          pBadge.style.background = 'rgba(241, 224, 90, 0.2)';
          pBadge.style.color = 'var(--accent-yellow)';
          pBadge.style.border = '1px solid var(--accent-yellow)';
          pBadge.innerText = 'REJECTED-ADVISORY (FREE TIER FIRST)';
        } else if (pl.guardrailStatus === 'fallback') {
          pBadge.style.background = 'rgba(139, 148, 158, 0.2)';
          pBadge.style.color = '#8b949e';
          pBadge.style.border = '1px solid #8b949e';
          pBadge.innerText = 'FALLBACK PLAN';
        } else {
          pBadge.style.background = 'rgba(88, 166, 255, 0.2)';
          pBadge.style.color = 'var(--accent-cyan)';
          pBadge.style.border = '1px solid var(--accent-cyan)';
          pBadge.innerText = 'ADVISORY VERIFIED';
        }

        if (pl.rejectionReason && (pl.guardrailStatus === 'fallback' || pl.status === 'rejected')) {
          pRejWrap.style.display = 'block';
          document.getElementById('plan-rejection-reason').innerText = pl.rejectionReason;
        } else {
          pRejWrap.style.display = 'none';
        }

        if (data.latestPlanDiagnostic) {
          pDiagLine.style.display = 'block';
          const d = data.latestPlanDiagnostic;
          document.getElementById('plan-diagnostic-text').innerText =
            'HTTP ' + (d.http_status || '200') +
            ' | finish: ' + (d.finish_reason || 'N/A') +
            ' | reasoning_tokens: ' + (d.reasoning_tokens ?? 0) +
            ' | completion_tokens: ' + (d.completion_tokens ?? 0) +
            ' | attempt: ' + (d.attempt || 1) +
            ' | parse: ' + (d.parse_status || 'success') +
            (d.parse_error ? ' (' + d.parse_error + ')' : '');
        } else {
          pDiagLine.style.display = 'none';
        }
      } else {
        pContainer.style.display = 'none';
      }

      // Update Mandate Card
      if (data.mandate) {
        document.getElementById('mandate-cap').innerText = '$' + (data.mandate.budgetCapUsd || 5.00).toFixed(2);
        document.getElementById('mandate-max-tx').innerText = '$' + (data.mandate.maxPerPurchaseUsd || 2.50).toFixed(2);
        document.getElementById('mandate-rail').innerText = (data.mandate.rail === 'paypal' ? 'PayPal Sandbox Vault' : 'x402 Base USDC');

        const mCheckLine = document.getElementById('mandate-check-line');
        const mBadge = document.getElementById('mandate-status-badge');
        const tokenDisplay = document.getElementById('mandate-token-display');
        const authBtn = document.getElementById('btn-auth-paypal');

        const hasToken = data.mandate.vaultToken && data.mandate.vaultToken !== 'VAULT_SANDBOX_DELEGATION_MANDATE' && !data.mandate.vaultToken.startsWith('VAULT_');

        if (tokenDisplay) {
          tokenDisplay.innerText = hasToken ? data.mandate.vaultToken : 'None';
          tokenDisplay.style.color = hasToken ? 'var(--accent-green)' : '#8b949e';
        }

        if (data.status === 'needs_mandate_amendment') {
          mBadge.style.background = 'rgba(248, 81, 73, 0.2)';
          mBadge.style.color = 'var(--accent-red)';
          mBadge.style.border = '1px solid var(--accent-red)';
          mBadge.innerText = 'AMENDMENT REQUIRED';
          mCheckLine.style.color = 'var(--accent-red)';
          const failedTx = (data.ledger || []).slice().reverse().find(l => l.type === 'transaction' && l.status === 'failed');
          const failReason = failedTx?.reasoning || data.latestBuyReason || data.latestDecision?.rejectionReason || 'MANDATE_MISSING: No active delegated PayPal vault token. Loop paused.';
          mCheckLine.innerText = 'REJECTED: ' + failReason;
          if (authBtn) {
            authBtn.style.display = 'inline-block';
            authBtn.innerText = '⚡ Re-authorize with PayPal';
          }
        } else if (!hasToken) {
          mBadge.style.background = 'rgba(241, 224, 90, 0.2)';
          mBadge.style.color = 'var(--accent-yellow)';
          mBadge.style.border = '1px solid var(--accent-yellow)';
          mBadge.innerText = 'NO MANDATE';
          mCheckLine.style.color = 'var(--accent-yellow)';
          mCheckLine.innerText = 'No authorized payment method. Authorization required before autonomous buy.';
          if (authBtn) {
            authBtn.style.display = 'inline-block';
            authBtn.innerText = '⚡ Authorize with PayPal (Sandbox)';
          }
        } else {
          mBadge.style.background = 'rgba(63, 185, 80, 0.2)';
          mBadge.style.color = 'var(--accent-green)';
          mBadge.style.border = '1px solid var(--accent-green)';
          mBadge.innerText = 'ACTIVE POLICY';
          mCheckLine.style.color = 'var(--accent-green)';
          mCheckLine.innerText = 'PASS (Mandate verified: Token active, Budget, Expiry, Category, Tx Cap)';
          if (authBtn) {
            authBtn.style.display = 'inline-block';
            authBtn.innerText = '✓ Re-authorize Mandate';
          }
        }
      }

      // Update meters
      const rpc = data.quota.rpc;
      document.getElementById('rpc-remaining').innerText = rpc.remaining;
      const rpcPct = Math.round((rpc.remaining / rpc.total) * 100);
      document.getElementById('rpc-percent').innerText = rpcPct + '%';
      document.getElementById('rpc-fill').style.width = rpcPct + '%';

      const read = data.quota.read;
      document.getElementById('read-remaining').innerText = read.remaining;
      const readPct = Math.round((read.remaining / read.total) * 100);
      document.getElementById('read-percent').innerText = readPct + '%';
      document.getElementById('read-fill').style.width = readPct + '%';

      // Update status badge
      const badge = document.getElementById('status-badge');
      badge.className = 'status-badge';
      if (data.status === 'executing') {
        badge.classList.add('status-executing');
        badge.innerText = 'EXECUTING';
        document.getElementById('status-message').innerText = 'Executing multi-chain audit tasks via MCP tools...';
      } else if (data.status === 'planning') {
        badge.classList.add('status-paused');
        badge.innerText = 'PLANNING';
        document.getElementById('status-message').innerText = 'Muse Spark is formulating strategic task execution plan...';
      } else if (data.status === 'deliberating') {
        badge.classList.add('status-paused');
        badge.innerText = 'DELIBERATING';
        document.getElementById('status-message').innerText = 'Muse Spark is evaluating workload, pricing catalog, and remaining budget...';
      } else if (data.status === 'awaiting_purchase') {
        badge.style.background = 'rgba(63, 185, 80, 0.2)';
        badge.style.color = 'var(--accent-green)';
        badge.style.border = '1px solid var(--accent-green)';
        badge.innerText = 'AWAITING PURCHASE';
        document.getElementById('status-message').innerText = 'Deliberation completed. Code guardrails PASSED. Ready for delegated mandate settlement.';
      } else if (data.status === 'needs_mandate_amendment') {
        badge.classList.add('status-frozen');
        badge.innerText = 'NEEDS AMENDMENT';
        document.getElementById('status-message').innerText = 'Autonomous buy halted: Proposed purchase violates operator spending mandate limits.';
      } else if (data.status === 'buy_failed') {
        badge.classList.add('status-frozen');
        badge.innerText = 'BUY FAILED';
        document.getElementById('status-message').innerText = 'Autonomous settlement failed. Loop cleanly paused.';
      } else if (data.status === 'paused_quota_exhausted') {
        badge.classList.add('status-paused');
        badge.innerText = 'PAUSED (EXHAUSTED)';
        document.getElementById('status-message').innerText = 'Demo RPC quota exhausted. Loop cleanly paused awaiting economic deliberation.';
      } else if (data.isFrozen) {
        badge.classList.add('status-frozen');
        badge.innerText = 'FROZEN';
        document.getElementById('status-message').innerText = 'Session frozen by owner kill switch.';
      } else {
        badge.classList.add('status-idle');
        badge.innerText = data.status.toUpperCase();
      }

      // Render Decision Card
      const dContainer = document.getElementById('decision-card-container');
      if (data.latestDecision) {
        dContainer.style.display = 'block';
        const dec = data.latestDecision;
        document.getElementById('decision-action').innerText = (dec.action || '—').toUpperCase();
        document.getElementById('decision-item-rail').innerText = (dec.item || 'N/A') + ' (' + (dec.rail || 'NONE').toUpperCase() + ')';
        document.getElementById('decision-cost-coverage').innerText = '$' + (dec.estimated_cost_usd || 0).toFixed(2) + ' (' + (dec.estimated_calls_covered || 0) + ' calls)';
        document.getElementById('decision-reasoning').innerText = dec.reasoning || 'No rationale recorded.';
        
        const altWrap = document.getElementById('decision-alt-wrap');
        if (dec.alternative_considered) {
          altWrap.style.display = 'block';
          document.getElementById('decision-alt').innerText = dec.alternative_considered;
        } else {
          altWrap.style.display = 'none';
        }

        // Purchase Line
        const pLine = document.getElementById('decision-purchase-line');
        const pDesc = document.getElementById('decision-purchase-desc');
        const latestTx = (data.ledger || []).slice().reverse().find(l => l.type === 'transaction' && l.status === 'success');
        if (latestTx) {
          pLine.style.display = 'block';
          pDesc.innerText = 'Captured $' + Number(latestTx.costUsd || 0).toFixed(2) + ' via ' + (latestTx.rail || 'paypal').toUpperCase() + ' (Sandbox Vault Ref: ' + (latestTx.reference || 'Verified') + ') | +' + latestTx.units + ' ' + (latestTx.resource || 'RPC').toUpperCase() + ' quota credited.';
        } else {
          pLine.style.display = 'none';
        }

        // Retry button
        const retryWrap = document.getElementById('decision-retry-wrap');
        if (data.status === 'buy_failed' || data.status === 'needs_mandate_amendment') {
          retryWrap.style.display = 'block';
        } else {
          retryWrap.style.display = 'none';
        }

        const rejWrap = document.getElementById('decision-rejection-wrap');
        const gBadge = document.getElementById('decision-guardrail-badge');
        if (dec.guardrailStatus === 'rejected') {
          gBadge.style.background = 'rgba(248, 81, 73, 0.2)';
          gBadge.style.color = 'var(--accent-red)';
          gBadge.style.border = '1px solid var(--accent-red)';
          gBadge.innerText = 'GUARDRAIL REJECTED';
          rejWrap.style.display = 'block';
          document.getElementById('decision-rejection-reason').innerText = dec.rejectionReason || 'Policy check failed.';
        } else {
          gBadge.style.background = 'rgba(63, 185, 80, 0.2)';
          gBadge.style.color = 'var(--accent-green)';
          gBadge.style.border = '1px solid var(--accent-green)';
          gBadge.innerText = 'GUARDRAIL VERIFIED';
          rejWrap.style.display = 'none';
        }

        const dDiagLine = document.getElementById('decision-diagnostic-line');
        if (data.latestDeliberateDiagnostic) {
          dDiagLine.style.display = 'block';
          const dd = data.latestDeliberateDiagnostic;
          document.getElementById('decision-diagnostic-text').innerText =
            'HTTP ' + (dd.http_status || '200') +
            ' | finish: ' + (dd.finish_reason || 'N/A') +
            ' | reasoning_tokens: ' + (dd.reasoning_tokens ?? 0) +
            ' | completion_tokens: ' + (dd.completion_tokens ?? 0) +
            ' | attempt: ' + (dd.attempt || 1) +
            ' | parse: ' + (dd.parse_status || 'success') +
            (dd.parse_error ? ' (' + dd.parse_error + ')' : '');
        } else {
          dDiagLine.style.display = 'none';
        }
      } else {
        dContainer.style.display = 'none';
      }

      // Killswitch button state
      const ksBtn = document.getElementById('btn-killswitch');
      if (data.isFrozen) {
        ksBtn.classList.add('frozen');
        ksBtn.innerText = '🔓 Unfreeze Session';
      } else {
        ksBtn.classList.remove('frozen');
        ksBtn.innerText = '🛑 Kill Switch';
      }

      // Update ledger
      if (data.ledger && data.ledger.length > 0) {
        const tbody = document.getElementById('ledger-body');
        tbody.innerHTML = data.ledger.slice().reverse().map(item => {
          let typeColor = '#8b949e';
          if (item.type === 'transaction') typeColor = 'var(--accent-green)';
          else if (item.type === 'decision') typeColor = 'var(--accent-cyan)';
          else if (item.type === 'system') typeColor = 'var(--accent-yellow)';

          const costStr = Number(item.costUsd || 0) > 0 ? '$' + Number(item.costUsd).toFixed(2) : '$0.00';
          const costColor = Number(item.costUsd || 0) > 0 ? 'var(--accent-green)' : '#8b949e';

          return \`<tr>
            <td>\${item.timestamp.slice(11, 19)}</td>
            <td><span style="color: \${typeColor}; font-weight: \${item.type === 'transaction' ? '800' : 'bold'}; text-transform: uppercase;">\${item.type}</span></td>
            <td style="color: var(--accent-cyan);">\${item.resource || '—'}</td>
            <td>\${item.units}</td>
            <td style="color: \${costColor}; font-weight: bold;">\${costStr}</td>
            <td style="color: var(--text-bright);">\${item.reasoning || ''}</td>
          </tr>\`;
        }).join('');
      }

      // Replay mode enforcement for spark_live_pos
      if (sessionId === 'spark_live_pos') {
        const lockBanner = document.getElementById('replay-lock-banner');
        if (lockBanner) lockBanner.style.display = 'block';
        const runBtn = document.getElementById('btn-run');
        if (runBtn) {
          runBtn.disabled = true;
          runBtn.style.opacity = '0.6';
          runBtn.innerText = '🔒 Verified Proof Sealed (Read-Only)';
        }
        const resetBtn = document.getElementById('btn-reset');
        if (resetBtn) resetBtn.style.display = 'none';
        const ksBtn = document.getElementById('btn-killswitch');
        if (ksBtn) ksBtn.style.display = 'none';
        const authBtn = document.getElementById('btn-auth-paypal');
        if (authBtn) authBtn.style.display = 'none';
      }

      // Update receipts gallery
      const rContainer = document.getElementById('receipts-gallery-container');
      const receipts = data.receipts || [];
      const hasSuccessTx = (data.ledger || []).some(l => l.type === 'transaction' && l.status === 'success' && l.costUsd > 0);
      const backfillBtn = document.getElementById('btn-backfill-receipt');

      if (backfillBtn) {
        backfillBtn.style.display = hasSuccessTx ? 'inline-block' : 'none';
      }

      if (receipts.length > 0) {
        rContainer.innerHTML = receipts.map(r => {
          if (r.status === 'completed' && r.imageUrl) {
            return '<div style="display: flex; flex-wrap: wrap; gap: 20px; background: #090d13; border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 12px;">' +
              '<div style="flex: 0 0 240px; text-align: center;">' +
                '<img src="' + r.imageUrl + '" alt="Receipt ' + (r.captureRef || '') + '" style="width: 100%; max-width: 240px; border-radius: 8px; border: 1px solid var(--border); display: block;" onerror="this.onerror=null; this.parentElement.innerHTML=\'<div style=\\\'height:180px;background:#161b22;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#8b949e;font-size:11px;\\\'>Receipt asset stored in R2</div>\'">' +
                '<div style="margin-top: 6px; font-size: 10px; color: #8b949e; font-family: monospace;">Key: ' + (r.imageKey || '') + '</div>' +
              '</div>' +
              '<div style="flex: 1; min-width: 260px; display: flex; flex-direction: column; justify-content: space-between;">' +
                '<div>' +
                  '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
                    '<span style="font-size: 14px; font-weight: 800; color: var(--text-bright);">AGENTPAY OFFICIAL RECEIPT</span>' +
                    '<span class="status-badge" style="background: rgba(63, 185, 80, 0.2); color: var(--accent-green); border: 1px solid var(--accent-green);">Verified & Stored in R2</span>' +
                  '</div>' +
                  '<div style="font-size: 12px; font-family: \'JetBrains Mono\', monospace; color: #8b949e; line-height: 1.8;">' +
                    '<div>Capture Reference: <strong style="color: var(--accent-cyan);">' + (r.captureRef || '—') + '</strong></div>' +
                    '<div>Item Procured: <strong style="color: var(--text-bright);">' + (r.item || 'rpc-1000') + '</strong></div>' +
                    '<div>Settled Amount: <strong style="color: var(--accent-green);">$' + Number(r.amountUsd || 0).toFixed(2) + ' USD</strong></div>' +
                    '<div>Quota Refilled: <strong style="color: var(--accent-yellow);">+' + (r.units || 0) + ' ' + (r.resource || 'rpc').toUpperCase() + '</strong></div>' +
                    '<div>Payment Rail: <strong style="color: var(--text-bright);">' + (r.rail || 'paypal').toUpperCase() + ' Sandbox Vault</strong></div>' +
                    '<div>Settled Timestamp: <span>' + (r.timestamp ? new Date(r.timestamp).toLocaleString() : '—') + '</span></div>' +
                  '</div>' +
                '</div>' +
                '<div style="margin-top: 10px;">' +
                  '<button class="btn-primary" style="padding: 4px 10px; font-size: 11px; background: #21262d; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; color: var(--text-bright);" onclick="backfillReceipt(\'' + r.transactionId + '\')">🔄 Regenerate Visual Asset</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          } else {
            return '<div style="background: #090d13; border: 1px solid var(--accent-red); border-radius: 10px; padding: 16px; margin-bottom: 12px;">' +
              '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
                '<strong style="color: var(--accent-red);">Receipt Generation Pending / Failed</strong>' +
                '<button class="btn-primary" style="padding: 4px 10px; font-size: 11px; background: #238636; border: none; border-radius: 6px; cursor: pointer; color: #fff;" onclick="backfillReceipt(\'' + r.transactionId + '\')">🔄 Retry Receipt Generation</button>' +
              '</div>' +
              '<div style="font-size: 11px; color: #8b949e; font-family: monospace;">' + (r.error || 'Image generation pending') + '</div>' +
            '</div>';
          }
        }).join('');
      } else {
        rContainer.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 24px; font-size: 12px; background: #090d13; border: 1px dashed var(--border); border-radius: 8px;">' +
          (hasSuccessTx
            ? 'A verified buy transaction exists in the ledger! Click "Backfill Proven Receipt" above to generate the visual receipt asset via Meta Muse Image.'
            : 'No receipts recorded yet. Completed purchases automatically generate a visual receipt card via Meta Muse Image.') +
        '</div>';
      }

      // Update financial report card
      if (data.financialReport) {
        document.getElementById('report-cap').innerText = '$' + (data.financialReport.budgetCapUsd || 5.00).toFixed(2);
        document.getElementById('report-spent').innerText = '$' + (data.financialReport.spentUsd || 0).toFixed(2);
        document.getElementById('report-remaining').innerText = '$' + (data.financialReport.remainingBudgetUsd || 0).toFixed(2);
        document.getElementById('financial-report-text').innerText = data.financialReport.summary || 'Audit complete.';
      }

      // Update efficiency metrics
      const successTxCount = (data.ledger || []).filter(l => l.type === 'transaction' && l.status === 'success' && l.costUsd > 0).length;
      const countEl = document.getElementById('efficiency-avoided-count');
      if (countEl) {
        countEl.innerText = successTxCount > 0 ? (successTxCount * 999) : '0';
      }
    }

    async function backfillLatestReceipt() {
      const btn = document.getElementById('btn-backfill-receipt');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Generating via Muse Image...';
      }
      try {
        const res = await fetch('/api/session/' + sessionId + '/receipts/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (!res.ok) {
          alert('Receipt backfill note: ' + (data.message || data.error || 'Failed to backfill receipt'));
        }
        await fetchState();
      } catch (err) {
        alert('Backfill error: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '⚡ Backfill Proven Receipt';
        }
      }
    }

    async function backfillReceipt(txId) {
      try {
        await fetch('/api/session/' + sessionId + '/receipts/' + txId + '/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionId: txId })
        });
        await fetchState();
      } catch (err) {
        alert('Regenerate error: ' + err.message);
      }
    }

    async function generateFinancialReport() {
      const btn = document.getElementById('btn-refresh-report');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Auditing...';
      }
      try {
        await fetch('/api/session/' + sessionId + '/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        await fetchState();
      } catch (err) {
        alert('Report audit error: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '🔄 Audit Spend';
        }
      }
    }

    function launchFreshDemoSession() {
      const newId = 'demo_' + Math.random().toString(36).substring(2, 8);
      window.location.href = '/?session=' + newId + '&quota=5&reset=true';
    }

    async function runAgentTask() {
      const btn = document.getElementById('btn-run');
      btn.disabled = true;
      btn.innerText = 'Running...';

      try {
        while (true) {
          const res = await fetch('/api/session/' + sessionId + '/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxSteps: 20 })
          });
          const data = await res.json();
          await fetchState();

          // Stop if session is paused (quota exhausted), deliberated/awaiting purchase, frozen, or error
          if (data.finalStatus !== 'executing' && data.finalStatus !== 'idle') {
            break;
          }
          if (!data.steps || data.steps.length === 0 || data.steps.some(s => s.halted)) {
            break;
          }
        }
      } catch (err) {
        console.error('Run task error:', err);
      } finally {
        btn.disabled = false;
        btn.innerText = '▶ Run Agent Task';
        fetchState();
      }
    }

    async function retryAutonomousBuy() {
      const btn = document.getElementById('btn-retry-buy');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Settling...';
      }
      try {
        await fetch('/api/session/' + sessionId + '/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        await fetchState();
      } catch (err) {
        console.error('Buy retry error:', err);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '🔄 Retry Autonomous Settlement';
        }
      }
    }

    async function authorizePayPalSandbox() {
      const btn = document.getElementById('btn-auth-paypal');
      const errBox = document.getElementById('mandate-error-msg');
      if (errBox) errBox.style.display = 'none';

      if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Contacting PayPal Sandbox...';
      }

      try {
        const res = await fetch('/api/session/' + sessionId + '/mandate/setup-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          const errMsg = data.paypalError || data.message || data.error || 'Failed to create PayPal Setup Token';
          if (errBox) {
            errBox.innerText = 'PayPal Sandbox error: ' + errMsg;
            errBox.style.display = 'block';
          } else {
            alert('PayPal Sandbox Error: ' + errMsg);
          }
          if (btn) {
            btn.disabled = false;
            btn.innerText = '⚡ Authorize with PayPal (Sandbox)';
          }
          return;
        }

        if (data.approveUrl) {
          if (btn) btn.innerText = '↗ Redirecting to PayPal...';
          window.location.href = data.approveUrl;
        } else {
          throw new Error('Approval URL missing from PayPal setup response');
        }
      } catch (err) {
        if (errBox) {
          errBox.innerText = 'Authorization error: ' + err.message;
          errBox.style.display = 'block';
        } else {
          alert('Error: ' + err.message);
        }
        if (btn) {
          btn.disabled = false;
          btn.innerText = '⚡ Authorize with PayPal (Sandbox)';
        }
      }
    }

    async function toggleKillSwitch() {
      await fetch('/api/session/' + sessionId + '/freeze', { method: 'POST' });
      fetchState();
    }

    async function resetCurrentSession() {
      const btn = document.getElementById('btn-reset');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Resetting...';
      }
      try {
        const customQ = parseInt(new URLSearchParams(window.location.search).get('quota'), 10);
        await fetch('/api/session/' + sessionId + '/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'Audit multi-chain smart contracts & wallet activity on Base and Ethereum',
            budgetCapUsd: 5.00,
            quota: customQ > 0 ? {
              rpc: { total: customQ, remaining: customQ },
              read: { total: 20, remaining: 20 },
              file: { total: 5, remaining: 5 }
            } : undefined
          })
        });
        await fetchState();
      } catch (err) {
        console.error('Reset error:', err);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '🔄 Reset Session';
        }
      }
    }

    // Support optional ?quota=N URL param for custom demo exhaustion thresholds
    const urlParams = new URLSearchParams(window.location.search);
    const customQuota = parseInt(urlParams.get('quota'), 10);
    const shouldReset = urlParams.get('reset') === 'true';

    if (shouldReset) {
      resetCurrentSession().then(() => {
        const cleanUrl = window.location.pathname + (customQuota > 0 ? '?quota=' + customQuota + '&session=' + sessionId : '?session=' + sessionId);
        window.history.replaceState({}, '', cleanUrl);
      });
    } else if (customQuota > 0) {
      fetch('/api/session/' + sessionId + '/state')
        .then(r => r.json())
        .then(s => {
          if (s.stepCount === 0 && s.quota && s.quota.rpc.total !== customQuota) {
            return fetch('/api/session/' + sessionId + '/init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                quota: {
                  rpc: { total: customQuota, remaining: customQuota },
                  read: { total: 20, remaining: 20 },
                  file: { total: 5, remaining: 5 }
                }
              })
            }).then(() => fetchState());
          }
        })
        .catch(() => {});
    }

    // Check for authorization callback notices
    if (urlParams.get('mandate_authorized') === 'true') {
      const errBox = document.getElementById('mandate-error-msg');
      if (errBox) {
        errBox.style.background = 'rgba(63, 185, 80, 0.15)';
        errBox.style.border = '1px solid var(--accent-green)';
        errBox.style.color = 'var(--accent-green)';
        errBox.innerText = '✓ PayPal Vault spending mandate authorized successfully! Zero-click autonomous buy is now enabled.';
        errBox.style.display = 'block';
      }
    } else if (urlParams.get('error')) {
      const errBox = document.getElementById('mandate-error-msg');
      if (errBox) {
        errBox.style.display = 'block';
        errBox.innerText = 'Authorization notice: ' + decodeURIComponent(urlParams.get('error'));
      }
    }

    // Initial state fetch
    fetchState();
  </script>
</body>
</html>`;
}
