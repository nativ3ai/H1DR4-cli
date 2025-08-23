import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { getMCPManager } from "../../h1dr4/tools";
import { MCPTool } from "../../mcp/client";

interface MCPStatusProps {}

export function MCPStatus({}: MCPStatusProps) {
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  const [availableTools, setAvailableTools] = useState<MCPTool[]>([]);

  useEffect(() => {
    const manager = getMCPManager();

    const updateStatus = () => {
      try {
        setConnectedServers(manager.getServers());
        setAvailableTools(manager.getTools());
      } catch {
        setConnectedServers([]);
        setAvailableTools([]);
      }
    };

    updateStatus();

    manager.on("serverAdded", updateStatus);
    manager.on("serverRemoved", updateStatus);
    manager.on("serverError", updateStatus);

    return () => {
      manager.off("serverAdded", updateStatus);
      manager.off("serverRemoved", updateStatus);
      manager.off("serverError", updateStatus);
    };
  }, []);

  if (connectedServers.length === 0) {
    return null;
  }

  return (
    <Box marginLeft={1}>
      <Text color="green">⚒ mcps: {connectedServers.length} </Text>
    </Box>
  );
}
