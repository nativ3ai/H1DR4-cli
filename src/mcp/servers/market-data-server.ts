import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";

const API_BASE = "https://financialmodelingprep.com/api/v3";
const apiKey = process.env.FMP_API_KEY || "demo";

const server = new McpServer(
  { name: "market-data", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "get-market-data",
  {
    description: "Fetch market data for commodities, equities, index, RWAs, or crypto. Provide category and optional symbol.",
    inputSchema: {
      category: z.enum(["commodities", "equities", "index", "rwa", "crypto"]).describe("Asset class to query"),
      symbol: z.string().describe("Ticker symbol (e.g., GOLD, AAPL, ^GSPC, BTCUSD)").optional(),
    },
  },
  async ({ category, symbol }) => {
    try {
      const url = buildUrl(category, symbol);
      const response = await axios.get(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        return {
          content: [
            {
              type: "text",
              text: "Unauthorized: please set FMP_API_KEY environment variable with your Financial Modeling Prep API key",
            },
          ],
        };
      }
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

function buildUrl(category: string, symbol?: string): string {
  switch (category) {
    case "commodities":
      if (symbol) return `${API_BASE}/quote/${symbol}?apikey=${apiKey}`;
      return `${API_BASE}/quotes/commodity?apikey=${apiKey}`;
    case "equities":
      if (!symbol) throw new Error("symbol is required for equities");
      return `${API_BASE}/quote/${symbol}?apikey=${apiKey}`;
    case "index":
      if (symbol) return `${API_BASE}/quote/${symbol}?apikey=${apiKey}`;
      return `${API_BASE}/quotes/index?apikey=${apiKey}`;
    case "rwa":
      // Use treasury endpoint as proxy for real world asset data
      return `${API_BASE}/treasury?apikey=${apiKey}`;
    case "crypto":
      if (symbol) return `${API_BASE}/quote/${symbol}?apikey=${apiKey}`;
      return `${API_BASE}/quotes/crypto?apikey=${apiKey}`;
    default:
      throw new Error("Unknown category");
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Market data MCP server running...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});

