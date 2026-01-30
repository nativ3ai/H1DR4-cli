#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { program } from "commander";
import * as dotenv from "dotenv";
import { H1dr4Agent } from "./agent/h1dr4-agent";
import ChatInterface from "./ui/components/chat-interface";
import { getSettingsManager } from "./utils/settings-manager";
import { ConfirmationService } from "./utils/confirmation-service";
import { createMCPCommand } from "./commands/mcp";
import { createRSSCommand } from "./commands/rss";
import { createScheduleCommand } from "./commands/schedule";
import { startAllTasks } from "./schedule/runner";
import { createAlertCommand } from "./commands/alert";
import { startAllAlerts } from "./alerts/runner";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import fs from "fs";
import path from "path";
import os from "os";
import {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_MAX_HISTORY_MESSAGES,
  DEFAULT_MAX_HISTORY_TOKENS,
  parseBoolean,
  parseNumber,
  resolveProvider,
} from "./utils/config";

// Load environment variables
dotenv.config();
startAllTasks();
process.on("SIGUSR1", startAllTasks);

const ALERT_PID_FILE = path.join(os.homedir(), ".h1dr4", "alerts.pid");

function alertDaemonRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(ALERT_PID_FILE, "utf8"), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (!alertDaemonRunning()) {
  startAllAlerts();
  process.on("SIGUSR2", startAllAlerts);
}

const UI_PID_FILE = path.join(os.homedir(), ".h1dr4", "ui.pid");

function writeUIPid(): void {
  try {
    fs.writeFileSync(UI_PID_FILE, String(process.pid));
  } catch {
    // ignore
  }
}

function removeUIPid(): void {
  try {
    fs.unlinkSync(UI_PID_FILE);
  } catch {
    // ignore
  }
}

// Disable default SIGINT handling to let Ink handle Ctrl+C
// We'll handle exit through the input system instead

process.on("SIGTERM", () => {
  // Restore terminal to normal mode before exit
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch (e) {
      // Ignore errors when setting raw mode
    }
  }
  removeUIPid();
  console.log("\nGracefully shutting down...");
  process.exit(0);
});

// Handle uncaught exceptions to prevent hanging
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Ensure user settings are initialized
function ensureUserSettingsDirectory(): void {
  try {
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch (error) {
    // Silently ignore errors during setup
  }
}

// Load API key from user settings if not in environment
function loadApiKey(): string | undefined {
  const manager = getSettingsManager();
  return manager.getApiKey();
}

// Load base URL from user settings if not in environment
function loadBaseURL(): string {
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line settings to user settings file
async function saveCommandLineSettings(apiKey?: string, baseURL?: string): Promise<void> {
  try {
    const manager = getSettingsManager();

    // Update with command line values
    if (apiKey) {
      manager.updateUserSetting('apiKey', apiKey);
      console.log("✅ API key saved to ~/.h1dr4/user-settings.json");
    }
    if (baseURL) {
      manager.updateUserSetting('baseURL', baseURL);
      console.log("✅ Base URL saved to ~/.h1dr4/user-settings.json");
    }
  } catch (error) {
    console.warn("⚠️ Could not save settings to file:", error instanceof Error ? error.message : "Unknown error");
  }
}

// Load model from user settings if not in environment
function loadModel(provider: "ollama" | "remote"): string | undefined {
  if (provider === "ollama") {
    return process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  }

  // First check environment variables
  let model = process.env.H1DR4_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
    } catch (error) {
      // Ignore errors, model will remain undefined
    }
  }

  return model;
}

function resolveAgentConfig(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: string;
  localOnly?: boolean | string;
  liveSearch?: string;
  maxSources?: string;
  citations?: string;
  maxToolRounds?: string;
  maxHistory?: string;
  maxHistoryTokens?: string;
  debug?: boolean;
  debugPerf?: boolean;
}) {
  const provider = resolveProvider(
    options.provider || process.env.H1DR4_PROVIDER
  );
  const localOnly = parseBoolean(
    options.localOnly ?? process.env.LOCAL_ONLY,
    false
  );
  const model =
    options.model ||
    loadModel(provider) ||
    (provider === "ollama" ? DEFAULT_OLLAMA_MODEL : "grok-4-latest");
  const maxToolRounds = parseNumber(options.maxToolRounds, 400);
  const liveSearchEnabled = parseBoolean(
    options.liveSearch || process.env.H1DR4_LIVE_SEARCH,
    true
  );
  const maxSources = parseNumber(
    options.maxSources || process.env.H1DR4_MAX_SOURCES,
    5
  );
  const citations = parseBoolean(
    options.citations || process.env.H1DR4_CITATIONS,
    true
  );
  const maxHistoryMessages = parseNumber(
    options.maxHistory || process.env.H1DR4_MAX_HISTORY,
    DEFAULT_MAX_HISTORY_MESSAGES
  );
  const maxHistoryTokens = parseNumber(
    options.maxHistoryTokens || process.env.H1DR4_MAX_HISTORY_TOKENS,
    DEFAULT_MAX_HISTORY_TOKENS
  );
  const debug = parseBoolean(
    options.debug ?? process.env.H1DR4_DEBUG,
    false
  );
  const debugPerf = parseBoolean(
    options.debugPerf ?? process.env.H1DR4_DEBUG_PERF,
    false
  );

  return {
    provider,
    localOnly,
    model,
    maxToolRounds,
    maxHistoryMessages,
    maxHistoryTokens,
    debug,
    debugPerf,
    apiKey: options.apiKey || (provider === "remote" ? loadApiKey() : undefined),
    baseURL: options.baseUrl || loadBaseURL(),
    ollamaHost: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
    ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE,
    liveSearchEnabled,
    maxSources,
    citations,
  };
}

// Handle commit-and-push command in headless mode
async function handleCommitAndPushHeadless(
  agentConfig: ReturnType<typeof resolveAgentConfig>
): Promise<void> {
  try {
    const agent = new H1dr4Agent(agentConfig);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    console.log("🤖 Processing commit and push...\n");
    console.log("> /commit-and-push\n");

    // First check if there are any changes at all
    const initialStatusResult = await agent.executeBashCommand(
      "git status --porcelain"
    );

    if (!initialStatusResult.success || !initialStatusResult.output?.trim()) {
      console.log("❌ No changes to commit. Working directory is clean.");
      process.exit(1);
    }

    console.log("✅ git status: Changes detected");

    // Add all changes
    const addResult = await agent.executeBashCommand("git add .");

    if (!addResult.success) {
      console.log(
        `❌ git add: ${addResult.error || "Failed to stage changes"}`
      );
      process.exit(1);
    }

    console.log("✅ git add: Changes staged");

    // Get staged changes for commit message generation
    const diffResult = await agent.executeBashCommand("git diff --cached");

    // Generate commit message using AI
    const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || "No staged changes shown"}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

    console.log("🤖 Generating commit message...");

    const commitMessageEntries = await agent.processUserMessage(commitPrompt);
    let commitMessage = "";

    // Extract the commit message from the AI response
    for (const entry of commitMessageEntries) {
      if (entry.type === "assistant" && entry.content.trim()) {
        commitMessage = entry.content.trim();
        break;
      }
    }

    if (!commitMessage) {
      console.log("❌ Failed to generate commit message");
      process.exit(1);
    }

    // Clean the commit message
    const cleanCommitMessage = commitMessage.replace(/^["']|["']$/g, "");
    console.log(`✅ Generated commit message: "${cleanCommitMessage}"`);

    // Execute the commit
    const commitCommand = `git commit -m "${cleanCommitMessage}"`;
    const commitResult = await agent.executeBashCommand(commitCommand);

    if (commitResult.success) {
      console.log(
        `✅ git commit: ${
          commitResult.output?.split("\n")[0] || "Commit successful"
        }`
      );

      // If commit was successful, push to remote
      // First try regular push, if it fails try with upstream setup
      let pushResult = await agent.executeBashCommand("git push");

      if (
        !pushResult.success &&
        pushResult.error?.includes("no upstream branch")
      ) {
        console.log("🔄 Setting upstream and pushing...");
        pushResult = await agent.executeBashCommand("git push -u origin HEAD");
      }

      if (pushResult.success) {
        console.log(
          `✅ git push: ${
            pushResult.output?.split("\n")[0] || "Push successful"
          }`
        );
      } else {
        console.log(`❌ git push: ${pushResult.error || "Push failed"}`);
        process.exit(1);
      }
    } else {
      console.log(`❌ git commit: ${commitResult.error || "Commit failed"}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("❌ Error during commit and push:", error.message);
    process.exit(1);
  }
}

// Headless mode processing function
async function processPromptHeadless(
  prompt: string,
  agentConfig: ReturnType<typeof resolveAgentConfig>
): Promise<void> {
  try {
    const agent = new H1dr4Agent(agentConfig);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    // Convert chat entries to OpenAI compatible message objects
    const messages: ChatCompletionMessageParam[] = [];

    for (const entry of chatEntries) {
      switch (entry.type) {
        case "user":
          messages.push({
            role: "user",
            content: entry.content,
          });
          break;

        case "assistant":
          const assistantMessage: ChatCompletionMessageParam = {
            role: "assistant",
            content: entry.content,
          };

          // Add tool calls if present
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            assistantMessage.tool_calls = entry.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }));
          }

          messages.push(assistantMessage);
          break;

        case "tool_result":
          if (entry.toolCall) {
            messages.push({
              role: "tool",
              tool_call_id: entry.toolCall.id,
              content: entry.content,
            });
          }
          break;
      }
    }

    // Output each message as a separate JSON object
    for (const message of messages) {
      console.log(JSON.stringify(message));
    }
  } catch (error: any) {
    // Output error in OpenAI compatible format
    console.log(
      JSON.stringify({
        role: "assistant",
        content: `Error: ${error.message}`,
      })
    );
    process.exit(1);
  }
}

program
  .name("h1dr4")
  .description(
    "A conversational AI CLI tool powered by H1dr4 with text editor capabilities"
  )
  .version("1.0.1")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option(
    "-k, --api-key <key>",
    "API key for remote provider (or set GROK_API_KEY env var)"
  )
  .option(
    "-u, --base-url <url>",
    "Remote API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "--provider <provider>",
    "LLM provider to use (ollama|remote) (default: ollama)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., huihui_ai/qwen2.5-coder-abliterate:7b, grok-4-latest) (or set H1DR4_MODEL/OLLAMA_MODEL env var)"
  )
  .option(
    "--local-only",
    "Forbid remote provider usage (or set LOCAL_ONLY=true)"
  )
  .option(
    "--live-search <mode>",
    "Enable live search (on|off) (default: on)"
  )
  .option(
    "--max-sources <n>",
    "Maximum live search sources (default: 5)"
  )
  .option(
    "--citations <mode>",
    "Include citations in live search (on|off) (default: on)"
  )
  .option(
    "-p, --prompt <prompt>",
    "process a single prompt and exit (headless mode)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .option(
    "--max-history <count>",
    "maximum number of recent messages to keep before summarizing"
  )
  .option(
    "--max-history-tokens <count>",
    "maximum prompt tokens before summarizing history"
  )
  .option("--debug", "enable debug logging")
  .option("--debug-perf", "enable performance profiling logs")
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      const agentConfig = resolveAgentConfig(options);

      if (agentConfig.localOnly && agentConfig.provider === "remote") {
        console.error(
          "❌ Error: Remote provider blocked because LOCAL_ONLY is enabled."
        );
        process.exit(1);
      }

      if (agentConfig.provider === "remote" && !agentConfig.apiKey) {
        console.error(
          "❌ Error: API key required for remote provider. Set GROK_API_KEY or use --api-key."
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      // Headless mode: process prompt and exit
      if (options.prompt) {
        await processPromptHeadless(options.prompt, agentConfig);
        return;
      }

      // Interactive mode: launch UI
      const agent = new H1dr4Agent(agentConfig);
      console.log("🤖 Starting H1dr4 CLI Conversational Assistant...\n");

      ensureUserSettingsDirectory();
      writeUIPid();
      process.on("exit", removeUIPid);

      render(React.createElement(ChatInterface, { agent }));
    } catch (error: any) {
      console.error("❌ Error initializing H1dr4 CLI:", error.message);
      process.exit(1);
    }
  });

// Git subcommand
const gitCommand = program
  .command("git")
  .description("Git operations with AI assistance");

gitCommand
  .command("commit-and-push")
  .description("Generate AI commit message and push to remote")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option(
    "-k, --api-key <key>",
    "API key for remote provider (or set GROK_API_KEY env var)"
  )
  .option(
    "-u, --base-url <url>",
    "Remote API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "--provider <provider>",
    "LLM provider to use (ollama|remote) (default: ollama)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., huihui_ai/qwen2.5-coder-abliterate:7b, grok-4-latest) (or set H1DR4_MODEL/OLLAMA_MODEL env var)"
  )
  .option(
    "--local-only",
    "Forbid remote provider usage (or set LOCAL_ONLY=true)"
  )
  .option(
    "--live-search <mode>",
    "Enable live search (on|off) (default: on)"
  )
  .option(
    "--max-sources <n>",
    "Maximum live search sources (default: 5)"
  )
  .option(
    "--citations <mode>",
    "Include citations in live search (on|off) (default: on)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .option(
    "--max-history <count>",
    "maximum number of recent messages to keep before summarizing"
  )
  .option(
    "--max-history-tokens <count>",
    "maximum prompt tokens before summarizing history"
  )
  .option("--debug", "enable debug logging")
  .option("--debug-perf", "enable performance profiling logs")
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      const agentConfig = resolveAgentConfig(options);

      if (agentConfig.localOnly && agentConfig.provider === "remote") {
        console.error(
          "❌ Error: Remote provider blocked because LOCAL_ONLY is enabled."
        );
        process.exit(1);
      }

      if (agentConfig.provider === "remote" && !agentConfig.apiKey) {
        console.error(
          "❌ Error: API key required for remote provider. Set GROK_API_KEY or use --api-key."
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      await handleCommitAndPushHeadless(agentConfig);
    } catch (error: any) {
      console.error("❌ Error during git commit-and-push:", error.message);
      process.exit(1);
    }
  });

// MCP command
program.addCommand(createMCPCommand());
program.addCommand(createRSSCommand());
program.addCommand(createScheduleCommand());
program.addCommand(createAlertCommand());

program.parse();
