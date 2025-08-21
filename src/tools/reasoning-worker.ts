import { spawn } from "child_process";
import { ToolResult } from "../types";

export class ReasoningWorker {
  async analyze(query: string): Promise<ToolResult> {
    try {
      const args = [
        "-X",
        "POST",
        "https://my-search-proxy.ew.r.appspot.com/reasoning",
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({ query }),
      ];

      return await new Promise<ToolResult>((resolve) => {
        const child = spawn("curl", args);
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        child.on("error", (error) => {
          resolve({
            success: false,
            error: `Reasoning error: ${error.message}`,
          });
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve({ success: true, output: stdout.trim() });
          } else {
            resolve({
              success: false,
              error:
                stderr.trim() || `Reasoning process exited with code ${code}`,
            });
          }
        });
      });
    } catch (error: any) {
      return { success: false, error: `Reasoning error: ${error.message}` };
    }
  }
}
