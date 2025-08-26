import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";

const FRED_API_KEY = process.env.FRED_API_KEY || "";

const server = new McpServer(
  { name: "fred", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "get-series",
  {
    description: "Fetch time series data from the FRED API",
    inputSchema: {
      series: z.string().describe("FRED series ID"),
      startDate: z.string().describe("Observation start date YYYY-MM-DD").optional(),
      endDate: z.string().describe("Observation end date YYYY-MM-DD").optional(),
    },
  },
  async ({ series, startDate, endDate }) => {
    try {
      const params = new URLSearchParams({
        series_id: series,
        api_key: FRED_API_KEY,
        file_type: "json",
      });
      if (startDate) params.append("observation_start", startDate);
      if (endDate) params.append("observation_end", endDate);
      const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
      const { data } = await axios.get(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching data: ${error.message || error}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("FRED MCP server running...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
