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
        <button id="btn-killswitch" class="btn-killswitch" onclick="toggleKillSwitch()">🛑 Kill Switch</button>
      </div>
    </header>

    <div class="hero-card">
      <div class="task-inputs">
        <input type="text" id="task-input" value="Audit multi-chain smart contracts & wallet activity on Base and Ethereum">
        <div class="budget-pill">
          <span>Delegated: $5.00</span>
        </div>
        <button class="btn-primary" id="btn-run" onclick="runAgentTask()">▶ Run Agent Task</button>
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
        document.getElementById('status-message').innerText = 'Consuming real RPC quota via skuuy-mcp tools...';
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
        tbody.innerHTML = data.ledger.slice().reverse().map(item => \`
          <tr>
            <td>\${item.timestamp.slice(11, 19)}</td>
            <td><span style="color: #8b949e;">\${item.type}</span></td>
            <td style="color: var(--accent-cyan);">\${item.resource || '—'}</td>
            <td>\${item.units}</td>
            <td style="color: var(--accent-green);">$0.00</td>
            <td style="color: var(--text-bright);">\${item.reasoning || ''}</td>
          </tr>
        \`).join('');
      }
    }

    async function runAgentTask() {
      const btn = document.getElementById('btn-run');
      btn.disabled = true;
      btn.innerText = 'Running...';

      try {
        await fetch('/api/session/' + sessionId + '/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxSteps: 20 })
        });
      } finally {
        btn.disabled = false;
        btn.innerText = '▶ Run Agent Task';
        fetchState();
      }
    }

    async function toggleKillSwitch() {
      await fetch('/api/session/' + sessionId + '/freeze', { method: 'POST' });
      fetchState();
    }

    // Initial state fetch
    fetchState();
  </script>
</body>
</html>`;
}
