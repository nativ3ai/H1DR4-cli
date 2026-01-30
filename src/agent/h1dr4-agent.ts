import { H1dr4Message, H1dr4ToolCall } from "../h1dr4/types";
import { LLMProvider } from "../providers/llm-provider";
import { createProvider, ProviderName } from "../providers/provider-factory";
import {
  getAllH1dr4Tools,
  getMCPManager,
  initializeMCPServers,
} from "../h1dr4/tools";
import { loadMCPConfig } from "../mcp/config";
import {
  TextEditorTool,
  MorphEditorTool,
  BashTool,
  TodoTool,
  ConfirmationTool,
  SearchTool,
  OSINTTool,
  ReasoningWorker,
  GdeltTool,
  LiveSearchTool,
} from "../tools";
import { ToolResult } from "../types";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createTokenCounter, TokenCounter } from "../utils/token-counter";
import { loadCustomInstructions } from "../utils/custom-instructions";

export interface AgentConfig {
  provider: ProviderName;
  apiKey?: string;
  baseURL?: string;
  model: string;
  ollamaHost: string;
  ollamaKeepAlive?: string;
  localOnly?: boolean;
  maxToolRounds?: number;
  maxHistoryMessages?: number;
  maxHistoryTokens?: number;
  debug?: boolean;
  debugPerf?: boolean;
  liveSearchEnabled?: boolean;
  maxSources?: number;
  citations?: boolean;
}

export interface ChatEntry {
  type: "user" | "assistant" | "tool_result" | "tool_call";
  content: string;
  timestamp: Date;
  toolCalls?: H1dr4ToolCall[];
  toolCall?: H1dr4ToolCall;
  toolResult?: { success: boolean; output?: string; error?: string };
  isStreaming?: boolean;
}

export interface StreamingChunk {
  type: "content" | "tool_calls" | "tool_result" | "done" | "token_count";
  content?: string;
  toolCalls?: H1dr4ToolCall[];
  toolCall?: H1dr4ToolCall;
  toolResult?: ToolResult;
  tokenCount?: number;
}

export class H1dr4Agent extends EventEmitter {
  private llmProvider: LLMProvider;
  private textEditor: TextEditorTool;
  private morphEditor: MorphEditorTool | null;
  private bash: BashTool;
  private todoTool: TodoTool;
  private confirmationTool: ConfirmationTool;
  private search: SearchTool;
  private liveSearch: LiveSearchTool;
  private osint: OSINTTool;
  private gdelt: GdeltTool;
  private reasoningWorker: ReasoningWorker;
  private chatHistory: ChatEntry[] = [];
  private messages: H1dr4Message[] = [];
  private tokenCounter: TokenCounter;
  private abortController: AbortController | null = null;
  private mcpInitialized: boolean = false;
  private maxToolRounds: number;
  private maxHistoryMessages: number;
  private maxHistoryTokens: number;
  private debug: boolean;
  private debugPerf: boolean;

  constructor(config: AgentConfig) {
    super();
    const modelToUse = config.model;
    this.maxToolRounds = config.maxToolRounds || 400;
    this.maxHistoryMessages = config.maxHistoryMessages || 20;
    this.maxHistoryTokens = config.maxHistoryTokens || 4000;
    this.debug = config.debug || false;
    this.debugPerf = config.debugPerf || false;
    this.llmProvider = createProvider({
      provider: config.provider,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: modelToUse,
      ollamaHost: config.ollamaHost,
      ollamaKeepAlive: config.ollamaKeepAlive,
      localOnly: config.localOnly,
    });
    this.textEditor = new TextEditorTool();
    this.morphEditor = process.env.MORPH_API_KEY ? new MorphEditorTool() : null;
    this.bash = new BashTool();
    this.todoTool = new TodoTool();
    this.todoTool.on('todo_update', (output: string) => {
      const entry: ChatEntry = {
        type: 'assistant',
        content: output,
        timestamp: new Date(),
      };
      this.addChatEntry(entry);
      // Preserve context for future interactions
      this.messages.push({ role: 'assistant', content: output });
    });
    this.confirmationTool = new ConfirmationTool();
    this.search = new SearchTool();
    this.liveSearch = new LiveSearchTool(this.llmProvider, {
      enabled: config.liveSearchEnabled,
      maxSources: config.maxSources,
      citations: config.citations,
    });
    this.osint = new OSINTTool();
    this.gdelt = new GdeltTool();
    this.reasoningWorker = new ReasoningWorker();
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Load custom instructions
    const customInstructions = loadCustomInstructions();
    const customInstructionsSection = customInstructions
      ? `\n\nCUSTOM INSTRUCTIONS:\n${customInstructions}\n\nThe above custom instructions should be followed alongside the standard instructions below.`
      : "";

    // Initialize with system message
    this.messages.push({
      role: "system",
      content: `You are H1dr4 CLI, an AI assistant that helps with file editing, coding tasks, and system operations.${customInstructionsSection}

You have access to these tools:
- view_file: View file contents or directory listings
- create_file: Create new files with content (ONLY use this for files that don't exist yet)
- str_replace_editor: Replace text in existing files (ALWAYS use this to edit or update existing files)${
        this.morphEditor
          ? "\n- edit_file: High-speed file editing with Morph Fast Apply (4,500+ tokens/sec with 98% accuracy)"
          : ""
      }
- bash: Execute bash commands (use for searching, file discovery, navigation, and system operations)
- search: Unified search tool for finding text content or files (similar to Cursor's search functionality)
- create_todo_list: Create a visual todo list for planning and tracking tasks
- update_todo_list: Update existing todos in your todo list
- osint_search: Perform OSINT leak retrieval for defined entities like email addresses, phone numbers, usernames, or domains
- gdelt_query: Query the GDELT proxy for conflict levels, country risk, bilateral relations, high-impact or economic events, BBVA-style bilateral conflict coverage, custom date searches, and keyword context retrieval (supports /gdelt and /gdelt/v2 with daily granularity options)
- live_search: Search the web locally using Crawl4AI + ScrapeGraphAI for citations
- reason: Use a dedicated reasoning model for predictions, market or geopolitical analysis, strategic planning, and other complex questions

GDELT TOOL QUICK REFERENCE:
- test → Check connectivity (/gdelt?action=test)
- conflict → Global conflict intensity; supports start_year, months, and daily granularity triggers
- country → Country risk (country code required, optional start_year, limit, daily granularity)
- bilateral → Bilateral relations (country1, country2, months or date_start/date_end with daily granularity)
- high-impact → Filter by Goldstein threshold, limit, start_year
- economic → Economic cooperation/conflict data with start_year, limit, and daily options
- search → Custom date range search (date_start, date_end, limit)
- bilateral_conflict_coverage → BBVA directional conflict coverage (actor1_code, actor2_code, date_start, date_end, optional cameos, include_total)
- context → Keyword-filtered context retrieval (date_start, date_end, optional keywords, limit, include_insights)

REASONING WORKER BEST PRACTICES:
 - Best for: Market analysis, geopolitical intelligence, predictive analysis, strategic planning, Monte Carlo simulations, or complex synthesis of multiple news sources
- Effective queries are comprehensive, provide context, and specify timeframes
- Include relevant keywords to trigger specialized modes (e.g., polymarket, election, news, crypto, remember, search, comprehensive, osint, blockchain, economic)
- Ineffective queries are vague, lack context, or are single words

LIVE SEARCH (LOCAL):
 Use the live_search tool to query the web using the local Crawl4AI + ScrapeGraphAI pipeline.
 Provide descriptive queries; mode defaults to auto and citations are returned unless you disable them.
 Prefer live_search for current events or up-to-the-minute data instead of the reasoning tool.
 This capability is independent from the reasoning worker and does not require user confirmation.

TOOL USE POLICY:
- When the user asks you to perform an action that maps to a tool, CALL THE TOOL directly.
- Do NOT instruct the user to run tools or print tool JSON without executing it.
- If you need to call a tool and native tool calls are unavailable, respond with ONLY a single JSON object:
  {"tool":"tool_name","args":{...}}

 IMPORTANT TOOL USAGE RULES:
- NEVER use create_file on files that already exist - this will overwrite them completely
- ALWAYS use str_replace_editor to modify existing files, even for small changes
- Before editing a file, use view_file to see its current contents
- Use create_file ONLY when creating entirely new files that don't exist

SEARCHING AND EXPLORATION:
- Use search for fast, powerful text search across files or finding files by name (unified search tool)
- Examples: search for text content like "import.*react", search for files like "component.tsx"
- Use bash with commands like 'find', 'grep', 'rg', 'ls' for complex file operations and navigation
- view_file is best for reading specific files you already know exist

When a user asks you to edit, update, modify, or change an existing file:
1. First use view_file to see the current contents
2. Then use str_replace_editor to make the specific changes
3. Never use create_file for existing files

When a user asks you to create a new file that doesn't exist:
1. Use create_file with the full content

TASK PLANNING WITH TODO LISTS:
- For complex requests with multiple steps, ALWAYS create a todo list first to plan your approach
- Use create_todo_list to break down tasks into manageable items with priorities
- Mark tasks as 'in_progress' when you start working on them (only one at a time)
- Mark tasks as 'completed' immediately when finished
- Use update_todo_list to track your progress throughout the task
- Todo lists provide visual feedback with colors: ✅ Green (completed), 🔄 Cyan (in progress), ⏳ Yellow (pending)
- Always create todos with priorities: 'high' (🔴), 'medium' (🟡), 'low' (🟢)

PROGRAMMATIC CLI:
- Run single prompts non-interactively with \`h1dr4 --prompt "<text>"\` or \`h1dr4 -p "<text>"\`
- Control tool usage with \`--max-tool-rounds <n>\` (default 400)
- Embed these commands inside schedules or alerts for automation

SCHEDULING TASKS:
- Schedule shell commands with \`h1dr4 schedule add [--notify] [--criteria "<text>"] "<cron>" "<command>"\`
- Include \`--notify\` to show output when the command finishes or \`--criteria\` to alert only on matches
- Commands can include \`h1dr4 -p "<prompt>" [--max-tool-rounds <n>]\` for programmatic tasks
- Use \`h1dr4 schedule list\` to view existing tasks
- Use \`h1dr4 schedule remove <id>\` to cancel a task; to modify one, remove it and add a new entry
- Tasks are stored in \`~/.h1dr4/schedules.json\`, run automatically when due, and bypass confirmation

ALERT MONITORING:
- Create alerts that run commands on a schedule and trigger when output matches specific text
- Use \`h1dr4 alert add "<cron>" "<criteria>" "<command>"\` to add an alert
- Use \`h1dr4 alert list\` to view existing alerts
- Use \`h1dr4 alert remove <id>\` to delete an alert
- Use \`h1dr4 alert history\` to view triggered alert events
- Alerts are stored in \`~/.h1dr4/alerts.json\` and continue running in the background like scheduled tasks
- Commands can include \`h1dr4 -p "<prompt>" [--max-tool-rounds <n>]\` to run prompts headlessly

USER CONFIRMATION SYSTEM:
File operations (create_file, str_replace_editor) and bash commands will automatically request user confirmation before execution. The confirmation system will show users the actual content or command before they decide. Users can choose to approve individual operations or approve all operations of that type for the session.

If a user rejects an operation, the tool will return an error and you should not proceed with that specific operation.

Be helpful, direct, and efficient. Always explain what you're doing and show the results.

IMPORTANT RESPONSE GUIDELINES:
- After using tools, do NOT respond with pleasantries like "Thanks for..." or "Great!"
- Only provide necessary explanations or next steps if relevant to the task
- Keep responses concise and focused on the actual work being done
- If a tool execution completes the user's request, you can remain silent or give a brief confirmation

Current working directory: ${process.cwd()}`,
    });
  }

  private async initializeMCP(): Promise<void> {
    // Initialize MCP in the background without blocking
    Promise.resolve().then(async () => {
      try {
        const config = loadMCPConfig();
        if (config.servers.length > 0) {
          await initializeMCPServers();
        }
      } catch (error) {
        console.warn('MCP initialization failed:', error);
      } finally {
        this.mcpInitialized = true;
      }
    });
  }

  private logDebug(message: string): void {
    if (this.debug) {
      console.log(`[debug] ${message}`);
    }
  }

  private logPerf(message: string): void {
    if (this.debugPerf) {
      console.log(`[perf] ${message}`);
    }
  }

  private getPromptStats(): { tokens: number; systemCount: number } {
    const tokens = this.tokenCounter.countMessageTokens(this.messages as any);
    const systemCount = this.messages.filter((msg) => msg.role === "system")
      .length;
    return { tokens, systemCount };
  }

  private stripCodeFences(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith("```")) {
      return trimmed.replace(/^```(?:json)?\n?/i, "").replace(/```$/, "").trim();
    }
    return trimmed;
  }

  private parseToolCallFromContent(
    content: string | null,
    tools: Awaited<ReturnType<typeof getAllH1dr4Tools>>
  ): H1dr4ToolCall[] | null {
    if (!content) return null;
    const cleaned = this.stripCodeFences(content);
    if (!cleaned.startsWith("{") || !cleaned.includes('"tool"')) {
      return null;
    }
    try {
      const parsed = JSON.parse(cleaned) as { tool?: string; args?: any };
      if (!parsed.tool) return null;
      const known = tools.some((tool) => tool.function.name === parsed.tool);
      if (!known) return null;
      return [
        {
          id: randomUUID(),
          type: "function",
          function: {
            name: parsed.tool,
            arguments: JSON.stringify(parsed.args ?? {}),
          },
        },
      ];
    } catch {
      return null;
    }
  }

  private async compressHistoryIfNeeded(): Promise<void> {
    const { tokens } = this.getPromptStats();
    if (
      this.messages.length <= this.maxHistoryMessages &&
      tokens <= this.maxHistoryTokens
    ) {
      return;
    }

    const systemMessage = this.messages.find((msg) => msg.role === "system");
    const nonSystemMessages = this.messages.filter(
      (msg) => msg.role !== "system"
    );
    const keepTail = nonSystemMessages.slice(-10);
    const toSummarize = nonSystemMessages.slice(0, -10);

    if (toSummarize.length === 0) {
      return;
    }

    this.logDebug(
      `Summarizing history: ${toSummarize.length} messages, tokens=${tokens}`
    );

    const summaryPrompt = `Summarize the prior conversation in 6-10 bullet points. Focus on decisions, tool outputs, and user intent.`;
    const response = await this.llmProvider.chat([
      { role: "system", content: summaryPrompt },
      {
        role: "user",
        content: toSummarize
          .map((msg) => `${msg.role.toUpperCase()}: ${msg.content || ""}`)
          .join("\n"),
      },
    ]);
    const summaryContent =
      response.choices[0]?.message?.content?.trim() ||
      "Summary unavailable.";

    const summaryMessage: H1dr4Message = {
      role: "assistant",
      content: `[Conversation summary]\n${summaryContent}`,
    };

    this.messages = [
      ...(systemMessage ? [systemMessage] : []),
      summaryMessage,
      ...keepTail,
    ];
  }

  private addChatEntry(entry: ChatEntry): void {
    this.chatHistory.push(entry);
    this.emit("chat_entry", entry);
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    const requestStart = Date.now();
    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });

    const newEntries: ChatEntry[] = [userEntry];

    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;

    try {
      const tools = await getAllH1dr4Tools();
      await this.compressHistoryIfNeeded();
      const { tokens, systemCount } = this.getPromptStats();
      this.logDebug(
        `promptTokens=${tokens} systemMessages=${systemCount} historyCount=${this.messages.length}`
      );
      if (systemCount > 1) {
        this.logDebug("System prompt duplication detected.");
      }

      let currentResponse = await this.llmProvider.chat(this.messages, tools);

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        const assistantMessage = currentResponse.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("No response from LLM provider");
        }

        const parsedToolCalls =
          assistantMessage.tool_calls ||
          this.parseToolCallFromContent(assistantMessage.content, tools);
        if (assistantMessage.tool_calls?.length) {
          this.logDebug("Tool call detected via native tool calls.");
        } else if (parsedToolCalls) {
          this.logDebug("Tool call detected via JSON envelope.");
        }
        const assistantContent =
          parsedToolCalls && !assistantMessage.tool_calls
            ? ""
            : assistantMessage.content || "";

        // Handle tool calls
        if (
          parsedToolCalls &&
          parsedToolCalls.length > 0
        ) {
          toolRounds++;

          // Add assistant message with tool calls
          const assistantEntry: ChatEntry = {
            type: "assistant",
            content: assistantContent || "Using tools to help you...",
            timestamp: new Date(),
            toolCalls: parsedToolCalls,
          };
          this.chatHistory.push(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          this.messages.push({
            role: "assistant",
            content: assistantContent,
            tool_calls: parsedToolCalls,
          } as any);

          // Create initial tool call entries to show tools are being executed
          parsedToolCalls.forEach((toolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            this.chatHistory.push(toolCallEntry);
            newEntries.push(toolCallEntry);
          });

          // Execute tool calls and update the entries
          for (const toolCall of parsedToolCalls) {
            const toolStart = Date.now();
            const result = await this.executeTool(toolCall);
            this.logPerf(
              `tool=${toolCall.function.name} durationMs=${Date.now() - toolStart}`
            );

            // Update the existing tool_call entry with the result
            const entryIndex = this.chatHistory.findIndex(
              (entry) =>
                entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
            );

            if (entryIndex !== -1) {
              const updatedEntry: ChatEntry = {
                ...this.chatHistory[entryIndex],
                type: "tool_result",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error occurred",
                toolResult: result,
              };
              this.chatHistory[entryIndex] = updatedEntry;

              // Also update in newEntries for return value
              const newEntryIndex = newEntries.findIndex(
                (entry) =>
                  entry.type === "tool_call" &&
                  entry.toolCall?.id === toolCall.id
              );
              if (newEntryIndex !== -1) {
                newEntries[newEntryIndex] = updatedEntry;
              }
            }

            // Add tool result to messages with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Get next response - this might contain more tool calls
          await this.compressHistoryIfNeeded();
          const stats = this.getPromptStats();
          this.logDebug(
            `promptTokens=${stats.tokens} systemMessages=${stats.systemCount} historyCount=${this.messages.length}`
          );
          currentResponse = await this.llmProvider.chat(this.messages, tools);
        } else {
          // No more tool calls, add final response
          const finalEntry: ChatEntry = {
            type: "assistant",
            content:
              assistantMessage.content ||
              "I understand, but I don't have a specific response.",
            timestamp: new Date(),
          };
          this.chatHistory.push(finalEntry);
          this.messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
          });
          newEntries.push(finalEntry);
          break; // Exit the loop
        }
      }

      if (toolRounds >= maxToolRounds) {
        const warningEntry: ChatEntry = {
          type: "assistant",
          content:
            "Maximum tool execution rounds reached. Stopping to prevent infinite loops.",
          timestamp: new Date(),
        };
        this.chatHistory.push(warningEntry);
        newEntries.push(warningEntry);
      }

      return newEntries;
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      return [userEntry, errorEntry];
    } finally {
      this.logPerf(`totalResponseMs=${Date.now() - requestStart}`);
    }
  }

  private messageReducer(previous: any, item: any): any {
    const reduce = (acc: any, delta: any) => {
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
        if (acc[key] === undefined || acc[key] === null) {
          acc[key] = value;
          // Clean up index properties from tool calls
          if (Array.isArray(acc[key])) {
            for (const arr of acc[key]) {
              delete arr.index;
            }
          }
        } else if (typeof acc[key] === "string" && typeof value === "string") {
          (acc[key] as string) += value;
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key] as any[];
          for (let i = 0; i < value.length; i++) {
            if (!accArray[i]) accArray[i] = {};
            accArray[i] = reduce(accArray[i], value[i]);
          }
        } else if (typeof acc[key] === "object" && typeof value === "object") {
          acc[key] = reduce(acc[key], value);
        }
      }
      return acc;
    };

    return reduce(previous, item.choices[0]?.delta || {});
  }

  async *processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    const requestStart = Date.now();
    // Create new abort controller for this request
    this.abortController = new AbortController();

    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });

    // Calculate input tokens
    let inputTokens = this.tokenCounter.countMessageTokens(
      this.messages as any
    );
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;
    let totalOutputTokens = 0;

    try {
      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        // Check if operation was cancelled
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
          return;
        }

        // Stream response and accumulate
        const tools = await getAllH1dr4Tools();
        await this.compressHistoryIfNeeded();
        const { tokens, systemCount } = this.getPromptStats();
        this.logDebug(
          `promptTokens=${tokens} systemMessages=${systemCount} historyCount=${this.messages.length}`
        );
        if (systemCount > 1) {
          this.logDebug("System prompt duplication detected.");
        }

        const stream = this.llmProvider.chatStream(this.messages, tools);
        let accumulatedMessage: any = {};
        let accumulatedContent = "";
        let toolCallsYielded = false;
        let firstTokenLogged = false;

        for await (const chunk of stream) {
          // Check for cancellation in the streaming loop
          if (this.abortController?.signal.aborted) {
            yield {
              type: "content",
              content: "\n\n[Operation cancelled by user]",
            };
            yield { type: "done" };
            return;
          }

          if (!chunk.choices?.[0]) continue;

          // Accumulate the message using reducer
          accumulatedMessage = this.messageReducer(accumulatedMessage, chunk);

          // Check for tool calls - yield when we have complete tool calls with function names
          if (!toolCallsYielded && accumulatedMessage.tool_calls?.length > 0) {
            // Check if we have at least one complete tool call with a function name
            const hasCompleteTool = accumulatedMessage.tool_calls.some(
              (tc: any) => tc.function?.name
            );
            if (hasCompleteTool) {
              yield {
                type: "tool_calls",
                toolCalls: accumulatedMessage.tool_calls,
              };
              toolCallsYielded = true;
            }
          }

          // Stream content as it comes
          if (chunk.choices[0].delta?.content) {
            accumulatedContent += chunk.choices[0].delta.content;
            if (!firstTokenLogged) {
              this.logPerf(
                `timeToFirstTokenMs=${Date.now() - requestStart}`
              );
              firstTokenLogged = true;
            }

            // Update token count in real-time including accumulated content and any tool calls
            const currentOutputTokens =
              this.tokenCounter.estimateStreamingTokens(accumulatedContent) +
              (accumulatedMessage.tool_calls
                ? this.tokenCounter.countTokens(
                    JSON.stringify(accumulatedMessage.tool_calls)
                  )
                : 0);
            totalOutputTokens = currentOutputTokens;

            yield {
              type: "content",
              content: chunk.choices[0].delta.content,
            };

            // Emit token count update
            yield {
              type: "token_count",
              tokenCount: inputTokens + totalOutputTokens,
            };
          }
        }

        // Add assistant entry to history
        if (!accumulatedMessage.tool_calls?.length) {
          const parsedToolCalls = this.parseToolCallFromContent(
            accumulatedMessage.content,
            tools
          );
          if (parsedToolCalls) {
            accumulatedMessage.tool_calls = parsedToolCalls;
            accumulatedMessage.content = "";
            this.logDebug("Tool call detected via JSON envelope.");
          }
        } else {
          this.logDebug("Tool call detected via native tool calls.");
        }

        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: accumulatedMessage.content || "Using tools to help you...",
          timestamp: new Date(),
          toolCalls: accumulatedMessage.tool_calls || undefined,
        };
        this.chatHistory.push(assistantEntry);

        // Add accumulated message to conversation
        this.messages.push({
          role: "assistant",
          content: accumulatedMessage.content || "",
          tool_calls: accumulatedMessage.tool_calls,
        } as any);

        // Handle tool calls if present
        if (accumulatedMessage.tool_calls?.length > 0) {
          toolRounds++;

          // Only yield tool_calls if we haven't already yielded them during streaming
          if (!toolCallsYielded) {
            yield {
              type: "tool_calls",
              toolCalls: accumulatedMessage.tool_calls,
            };
          }

          // Execute tools
          for (const toolCall of accumulatedMessage.tool_calls) {
            // Check for cancellation before executing each tool
            if (this.abortController?.signal.aborted) {
              yield {
                type: "content",
                content: "\n\n[Operation cancelled by user]",
              };
              yield { type: "done" };
              return;
            }

            const toolStart = Date.now();
            const result = await this.executeTool(toolCall);
            this.logPerf(
              `tool=${toolCall.function.name} durationMs=${Date.now() - toolStart}`
            );

            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result,
            };
            this.chatHistory.push(toolResultEntry);

            yield {
              type: "tool_result",
              toolCall,
              toolResult: result,
            };

            // Add tool result with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Update token count after processing all tool calls to include tool results
          inputTokens = this.tokenCounter.countMessageTokens(
            this.messages as any
          );
          yield {
            type: "token_count",
            tokenCount: inputTokens + totalOutputTokens,
          };

          // Continue the loop to get the next response (which might have more tool calls)
        } else {
          // No tool calls, we're done
          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield {
          type: "content",
          content:
            "\n\nMaximum tool execution rounds reached. Stopping to prevent infinite loops.",
        };
      }

      yield { type: "done" };
    } catch (error: any) {
      // Check if this was a cancellation
      if (this.abortController?.signal.aborted) {
        yield {
          type: "content",
          content: "\n\n[Operation cancelled by user]",
        };
        yield { type: "done" };
        return;
      }

      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      yield {
        type: "content",
        content: errorEntry.content,
      };
      yield { type: "done" };
    } finally {
      this.logPerf(`totalResponseMs=${Date.now() - requestStart}`);
      // Clean up abort controller
      this.abortController = null;
    }
  }

  private async executeTool(toolCall: H1dr4ToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);

      switch (toolCall.function.name) {
        case "view_file":
          const range: [number, number] | undefined =
            args.start_line && args.end_line
              ? [args.start_line, args.end_line]
              : undefined;
          return await this.textEditor.view(args.path, range);

        case "create_file":
          return await this.textEditor.create(args.path, args.content);

        case "str_replace_editor":
          return await this.textEditor.strReplace(
            args.path,
            args.old_str,
            args.new_str,
            args.replace_all
          );

        case "edit_file":
          if (!this.morphEditor) {
            return {
              success: false,
              error:
                "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
            };
          }
          return await this.morphEditor.editFile(
            args.target_file,
            args.instructions,
            args.code_edit
          );

        case "bash":
          return await this.bash.execute(args.command);

        case "create_todo_list":
          // Run todo list creation in the background
          this.todoTool.createTodoList(args.todos).then((result) => {
            if (!result.success) {
              const entry: ChatEntry = {
                type: "assistant",
                content: result.error || "Error occurred",
                timestamp: new Date(),
              };
              this.addChatEntry(entry);
              this.messages.push({ role: "assistant", content: entry.content });
            }
          });
          return { success: true, output: "Planning started (async)" };

        case "update_todo_list":
          // Run todo list updates in the background
          this.todoTool.updateTodoList(args.updates).then((result) => {
            if (!result.success) {
              const entry: ChatEntry = {
                type: "assistant",
                content: result.error || "Error occurred",
                timestamp: new Date(),
              };
              this.addChatEntry(entry);
              this.messages.push({ role: "assistant", content: entry.content });
            }
          });
          return { success: true, output: "Todo list update started (async)" };

        case "search":
          return await this.search.search(args.query, {
            searchType: args.search_type,
            includePattern: args.include_pattern,
            excludePattern: args.exclude_pattern,
            caseSensitive: args.case_sensitive,
            wholeWord: args.whole_word,
            regex: args.regex,
            maxResults: args.max_results,
            fileTypes: args.file_types,
            includeHidden: args.include_hidden,
          });

        case "osint_search":
          return await this.osint.search(args.query);

        case "gdelt_query":
          return await this.gdelt.query({
            action: args.action,
            endpointVersion: args.endpoint_version,
            params:
              args.query_parameters ?? args.params ?? args.parameters ?? undefined,
            timeoutMs: args.timeout_ms,
          });

        case "live_search":
          return await this.liveSearch.search(args.query, {
            search_parameters: args.search_parameters,
            max_sources: args.max_sources,
            citations: args.citations,
            return_raw: args.return_raw,
          });

        case "reason":
          const confirmation = await this.confirmationTool.requestConfirmation({
            operation: "Use reasoning tool",
            filename: "reasoning",
            description: args.prompt,
          });
          if (!confirmation.success) {
            return { success: false, error: "Reasoning operation rejected by user" };
          }
          // Add a reasoning task to the current plan
          const reasoningId = `reason-${Date.now()}`;
          const reasoningTodo = [
            {
              id: reasoningId,
              content: args.prompt as string,
              status: "in_progress" as const,
              priority: "high" as const,
            },
          ];
          const createResult = await this.todoTool.createTodoList(reasoningTodo);
          if (!createResult.success) {
            const entry: ChatEntry = {
              type: "assistant",
              content: createResult.error || "Error occurred",
              timestamp: new Date(),
            };
            this.addChatEntry(entry);
            this.messages.push({ role: "assistant", content: entry.content });
          }

          // Wait for reasoning result before responding
          const reasoningResult = await this.reasoningWorker.analyze(args.prompt);

          const entry: ChatEntry = {
            type: "assistant",
            content: reasoningResult.success
              ? reasoningResult.output || "Success"
              : reasoningResult.error || "Error occurred",
            timestamp: new Date(),
          };
          this.addChatEntry(entry);
          this.messages.push({ role: "assistant", content: entry.content });

          await this.todoTool.updateTodoList([
            { id: reasoningId, status: "completed" as const },
          ]);

          return reasoningResult;

        default:
          // Check if this is an MCP tool
          if (toolCall.function.name.startsWith("mcp__")) {
            return await this.executeMCPTool(toolCall);
          }

          return {
            success: false,
            error: `Unknown tool: ${toolCall.function.name}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Tool execution error: ${error.message}`,
      };
    }
  }

  private async executeMCPTool(toolCall: H1dr4ToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const mcpManager = getMCPManager();

      const result = await mcpManager.callTool(toolCall.function.name, args);

      if (result.isError) {
        return {
          success: false,
          error: (result.content[0] as any)?.text || "MCP tool error",
        };
      }

      // Extract content from result
      const output = result.content
        .map((item) => {
          if (item.type === "text") {
            return item.text;
          } else if (item.type === "resource") {
            return `Resource: ${item.resource?.uri || "Unknown"}`;
          } else if (item.type === "image") {
            return `data:${(item as any).mimeType};base64,${(item as any).data}`;
          }
          return String(item);
        })
        .join("\n");

      return {
        success: true,
        output: output || "Success",
      };
    } catch (error: any) {
      return {
        success: false,
        error: `MCP tool execution error: ${error.message}`,
      };
    }
  }

  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  getCurrentDirectory(): string {
    return this.bash.getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.bash.execute(command);
  }

  getCurrentModel(): string {
    return this.llmProvider.getCurrentModel();
  }

  setModel(model: string): void {
    this.llmProvider.setModel(model);
    // Update token counter for new model
    this.tokenCounter.dispose();
    this.tokenCounter = createTokenCounter(model);
  }

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
