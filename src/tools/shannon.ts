import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types";
import { ConfirmationService } from "../utils/confirmation-service";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);
const DEFAULT_TIMEOUT_MS = 120000;

export interface ShannonOptions {
  command: string;
  working_directory?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
}

function resolveShannonPath(workingDirectory?: string): string {
  if (process.env.SHANNON_PATH) {
    return process.env.SHANNON_PATH;
  }

  const cwd = workingDirectory || process.cwd();
  const localPath = path.join(cwd, "shannon");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return "shannon";
}

export class ShannonTool {
  private confirmationService = ConfirmationService.getInstance();

  async run(options: ShannonOptions): Promise<ToolResult> {
    try {
      const command = options.command?.trim();
      if (!command) {
        return { success: false, error: "command is required for shannon tool" };
      }

      const shannonPath = resolveShannonPath(options.working_directory);
      const fullCommand = `${shannonPath} ${command}`;

      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: "Run Shannon CLI",
              filename: fullCommand,
              showVSCodeOpen: false,
              content: `Command: ${fullCommand}\nWorking directory: ${
                options.working_directory || process.cwd()
              }`,
            },
            "bash"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || "Shannon command cancelled",
          };
        }
      }

      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd: options.working_directory || process.cwd(),
        timeout: options.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ...(options.env || {}),
        },
      });

      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
      return {
        success: true,
        output: output.trim() || "Shannon command executed successfully",
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Shannon command failed: ${error.message}`,
      };
    }
  }
}
