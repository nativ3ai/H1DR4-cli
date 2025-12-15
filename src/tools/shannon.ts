import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs-extra";
import { ToolResult } from "../types";
import { ConfirmationService } from "../utils/confirmation-service";

interface ShannonRunOptions {
  targetUrl: string;
  repoPath?: string;
  configPath?: string;
  image?: string;
  disableHostNetwork?: boolean;
  additionalArgs?: string[];
}

export class ShannonTool {
  private confirmationService = ConfirmationService.getInstance();

  async runScan(options: ShannonRunOptions): Promise<ToolResult> {
    const { targetUrl, repoPath, configPath, image, disableHostNetwork, additionalArgs } = options;

    if (!targetUrl) {
      return { success: false, error: "target_url is required" };
    }

    const resolvedRepoPath = path.resolve(repoPath || process.cwd());
    if (!(await fs.pathExists(resolvedRepoPath))) {
      return {
        success: false,
        error: `Repository path does not exist: ${resolvedRepoPath}`,
      };
    }

    if (configPath && !(await fs.pathExists(configPath))) {
      return {
        success: false,
        error: `Config file not found at: ${path.resolve(configPath)}`,
      };
    }

    const { envArgs, missingCredentialMessage } = this.buildCredentialEnv();
    if (missingCredentialMessage) {
      return { success: false, error: missingCredentialMessage };
    }

    const dockerArgs = ["run", "--rm", "--cap-add=NET_RAW", "--cap-add=NET_ADMIN"];
    if (!disableHostNetwork) {
      dockerArgs.push("--network", "host");
    }

    dockerArgs.push("-v", `${resolvedRepoPath}:/app/repos/target`);

    if (configPath) {
      const resolvedConfig = path.resolve(configPath);
      dockerArgs.push("-v", `${path.dirname(resolvedConfig)}:/app/configs`);
    }

    if (process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) {
      dockerArgs.push(
        "-e",
        `CLAUDE_CODE_MAX_OUTPUT_TOKENS=${process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS}`
      );
    }

    envArgs.forEach((envVar) => {
      dockerArgs.push("-e", envVar);
    });

    const imageName = image || "shannon:latest";
    dockerArgs.push(imageName, targetUrl, "/app/repos/target");

    if (configPath) {
      const containerConfigPath = `/app/configs/${path.basename(configPath)}`;
      dockerArgs.push("--config", containerConfigPath);
    }

    if (additionalArgs?.length) {
      dockerArgs.push(...additionalArgs);
    }

    const commandPreview = ["docker", ...dockerArgs].join(" ");

    const confirmationResult = await this.confirmationService.requestConfirmation(
      {
        operation: "Run Shannon pentest",
        filename: imageName,
        content: `Command: ${commandPreview}`,
        showVSCodeOpen: false,
      },
      "bash"
    );

    if (!confirmationResult.confirmed) {
      return {
        success: false,
        error: confirmationResult.feedback || "Shannon execution cancelled by user",
      };
    }

    return await this.executeDockerCommand(dockerArgs, commandPreview);
  }

  private async executeDockerCommand(args: string[], preview: string): Promise<ToolResult> {
    return new Promise((resolve) => {
      const dockerProcess = spawn("docker", args, { env: process.env });
      let output = "";
      let errorOutput = "";

      dockerProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      dockerProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      dockerProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `Failed to start Docker: ${error.message}`,
        });
      });

      dockerProcess.on("close", (code) => {
        if (code === 0) {
          resolve({ success: true, output: output.trim() || preview });
        } else {
          resolve({
            success: false,
            error:
              errorOutput.trim() ||
              `Shannon run failed with exit code ${code ?? "unknown"}`,
          });
        }
      });
    });
  }

  private buildCredentialEnv(): { envArgs: string[]; missingCredentialMessage?: string } {
    const envArgs: string[] = [];

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      envArgs.push(`CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`);
    }

    if (process.env.ANTHROPIC_API_KEY) {
      envArgs.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
    }

    if (envArgs.length === 0) {
      return {
        envArgs,
        missingCredentialMessage:
          "Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY to run Shannon inside the CLI.",
      };
    }

    return { envArgs };
  }
}
