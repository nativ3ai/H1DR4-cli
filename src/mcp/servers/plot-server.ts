import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { z } from "zod";

const server = new McpServer(
  { name: "plot", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "plot-data",
  {
    description: "Plot x and y data and return a PNG image",
    inputSchema: {
      x: z.array(z.number()).describe("X values"),
      y: z.array(z.number()).describe("Y values"),
      title: z.string().describe("Chart title").optional(),
    },
  },
  async ({ x, y, title }) => {
    try {
      const width = 800;
      const height = 600;
      const canvas = new ChartJSNodeCanvas({ width, height });
      const configuration = {
        type: "line" as const,
        data: {
          labels: x,
          datasets: [
            {
              label: title || "Series",
              data: y,
            },
          ],
        },
      };
      const image = await canvas.renderToBuffer(configuration);
      return {
        content: [
          {
            type: "image",
            media_type: "image/png",
            data: image.toString("base64"),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error generating plot: ${error.message || error}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Plot MCP server running...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
