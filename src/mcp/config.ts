import path from "path";
import os from "os";
import { MCPServerConfig } from "./client";
import { getSettingsManager } from "../utils/settings-manager";

export interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * Load MCP configuration from project settings
 */
export function loadMCPConfig(): MCPConfig {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const servers = projectSettings.mcpServers
    ? (Object.values(projectSettings.mcpServers) as MCPServerConfig[])
    : [];
  return { servers };
}

export function saveMCPConfig(config: MCPConfig): void {
  const manager = getSettingsManager();
  const mcpServers: Record<string, MCPServerConfig> = {};

  // Convert servers array to object keyed by name
  for (const server of config.servers) {
    mcpServers[server.name] = server;
  }

  manager.updateProjectSetting('mcpServers', mcpServers);
}

export function addMCPServer(config: MCPServerConfig): void {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const mcpServers = projectSettings.mcpServers || {};

  mcpServers[config.name] = config;
  manager.updateProjectSetting('mcpServers', mcpServers);
}

export function removeMCPServer(serverName: string): void {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const mcpServers = projectSettings.mcpServers;

  if (mcpServers) {
    delete mcpServers[serverName];
    manager.updateProjectSetting('mcpServers', mcpServers);
  }
}

export function getMCPServer(serverName: string): MCPServerConfig | undefined {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  return projectSettings.mcpServers?.[serverName];
}

// Predefined server configurations
export const PREDEFINED_SERVERS: Record<string, MCPServerConfig> = {
  "market-data": {
    name: "market-data",
    transport: {
      type: "stdio",
      command: "node",
      args: [path.join(__dirname, "servers", "market-data-server.js")],
      env: {
        FMP_API_KEY: process.env.FMP_API_KEY || "demo",
      },
    },
  },
  fred: {
    name: "fred",
    transport: {
      type: "stdio",
      command: "node",
      args: [path.join(__dirname, "servers", "fred-server.js")],
      env: {
        FRED_API_KEY: process.env.FRED_API_KEY || "",
      },
    },
  },
  rss: {
    name: "rss",
    transport: {
      type: "stdio",
      command: "node",
      args: [path.join(__dirname, "servers", "rss-server.js")],
      env: {
        RSS_CONFIG: path.join(os.homedir(), ".h1dr4", "rss-feeds.json"),
      },
    },
  },
  openbb: {
    name: "openbb",
    transport: {
      type: "sse",
      url: "https://server.smithery.ai/@DidierRLopes/openbb-docs-mcp/sse",
    },
  },
};
