import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import { z } from "zod";
import os from "os";

const CONFIG_PATH =
  process.env.RSS_CONFIG ||
  path.join(os.homedir(), ".h1dr4", "rss-feeds.json");

function loadFeeds(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

const parser = new Parser();

const server = new McpServer(
  { name: "rss", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "get-news",
  {
    description: "Fetch items from a configured RSS feed or a direct URL",
    inputSchema: {
      name: z.string().describe("Feed name or URL"),
      limit: z.number().describe("Number of items to fetch").optional(),
    },
  },
  async ({ name, limit }) => {
    try {
      const feeds = loadFeeds();
      const url = feeds[name] || name; // allow direct URL
      const feed = await parser.parseURL(url);
      const items = feed.items.slice(0, limit || 5).map((item) => ({
        title: item.title,
        link: item.link,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(items, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching feed: ${error.message || error}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("RSS MCP server running...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
