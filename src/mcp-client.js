/**
 * Generic Config-Driven MCP Client
 * 
 * Supports Model Context Protocol (MCP) version 2025-11-25 over Streamable HTTP.
 * Discovers tools dynamically via tools/list at runtime.
 * Works with any standard MCP server.
 */

export class MCPClient {
  /**
   * @param {Array<{name: string, url: string, transport: string, role?: string}>} servers
   */
  constructor(servers = []) {
    this.servers = servers;
    this.toolsByServer = new Map();
    this.serverStatus = new Map();
    this.requestId = 1;
  }

  /**
   * Initialize and discover tools from all configured servers
   */
  async initializeAll() {
    const results = [];
    for (const server of this.servers) {
      const res = await this.initializeServer(server);
      results.push(res);
    }
    return results;
  }

  /**
   * Initialize a single MCP server
   */
  async initializeServer(server) {
    const start = Date.now();
    try {
      // 1. Send initialize
      const initRes = await this._post(server.url, {
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'agentpay-runtime',
            version: '1.0.0'
          }
        }
      });

      if (!initRes || initRes.error) {
        throw new Error(initRes?.error?.message || 'Initialize failed');
      }

      // 2. Discover tools dynamically via tools/list
      const listRes = await this._post(server.url, {
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'tools/list',
        params: {}
      });

      const tools = listRes?.result?.tools || [];
      const latencyMs = Date.now() - start;

      this.toolsByServer.set(server.name, tools);
      const statusObj = {
        name: server.name,
        url: server.url,
        status: 'connected',
        serverInfo: initRes.result?.serverInfo || {},
        toolsCount: tools.length,
        latencyMs,
        lastChecked: new Date().toISOString()
      };
      this.serverStatus.set(server.name, statusObj);
      return statusObj;
    } catch (err) {
      const latencyMs = Date.now() - start;
      const statusObj = {
        name: server.name,
        url: server.url,
        status: 'error',
        error: err.message,
        toolsCount: 0,
        latencyMs,
        lastChecked: new Date().toISOString()
      };
      this.serverStatus.set(server.name, statusObj);
      return statusObj;
    }
  }

  /**
   * Get all discovered tools across all servers
   */
  getAllDiscoveredTools() {
    const all = [];
    for (const [serverName, tools] of this.toolsByServer.entries()) {
      for (const tool of tools) {
        all.push({
          serverName,
          ...tool
        });
      }
    }
    return all;
  }

  /**
   * Find which server hosts a specific tool
   */
  findServerForTool(toolName) {
    for (const [serverName, tools] of this.toolsByServer.entries()) {
      if (tools.some(t => t.name === toolName)) {
        return this.servers.find(s => s.name === serverName);
      }
    }
    return null;
  }

  /**
   * Execute a tool on the appropriate MCP server
   */
  async callTool(toolName, args = {}) {
    const server = this.findServerForTool(toolName);
    if (!server) {
      throw new Error(`Tool "${toolName}" not found on any connected MCP server.`);
    }

    const start = Date.now();
    const response = await this._post(server.url, {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    });

    const durationMs = Date.now() - start;

    if (response?.error) {
      throw new Error(`MCP Error [${response.error.code}]: ${response.error.message}`);
    }

    return {
      success: !response.result?.isError,
      result: response.result,
      durationMs,
      serverName: server.name
    };
  }

  /**
   * Get status snapshot of all connected servers
   */
  getServersSnapshot() {
    return Array.from(this.serverStatus.values());
  }

  /**
   * Helper to execute JSON-RPC POST request
   */
  async _post(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }

    return await res.json();
  }
}
