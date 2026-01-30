import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import axios from "axios";

export type H1dr4Message = ChatCompletionMessageParam;

export interface H1dr4Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface H1dr4ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface SearchParameters {
  mode?: "auto" | "on" | "off";
  from_date?: string;
  to_date?: string;
  max_search_results?: number;
  return_citations?: boolean;
  // sources removed - let API use default sources to avoid format issues
}

export interface SearchOptions {
  search_parameters?: SearchParameters;
}

export interface H1dr4Response {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: H1dr4ToolCall[];
    };
    finish_reason: string;
  }>;
}

type ProviderType = "grok" | "ollama";

export class H1dr4Client {
  private client?: OpenAI;
  private currentModel: string = "grok-3-latest";
  private provider: ProviderType;
  private ollamaBaseURL: string;
  private requestTimeoutMs: number = 20000;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.provider =
      process.env.H1DR4_PROVIDER?.toLowerCase() === "ollama"
        ? "ollama"
        : "grok";
    this.ollamaBaseURL =
      baseURL || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    if (process.env.H1DR4_HTTP_TIMEOUT_MS) {
      const parsed = Number.parseInt(process.env.H1DR4_HTTP_TIMEOUT_MS, 10);
      if (!Number.isNaN(parsed)) {
        this.requestTimeoutMs = parsed;
      }
    }

    if (this.provider === "ollama") {
      this.currentModel =
        process.env.H1DR4_MODEL || "huihui_ai/qwen2.5-coder-abliterate:7b";
    }

    if (this.provider === "grok") {
      this.client = new OpenAI({
        apiKey,
        baseURL: baseURL || process.env.GROK_BASE_URL || "https://api.x.ai/v1",
        timeout: 360000,
      });
    }
    if (model) {
      this.currentModel = model;
    }
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  getProvider(): ProviderType {
    return this.provider;
  }

  async chat(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    searchOptions?: SearchOptions
  ): Promise<H1dr4Response> {
    try {
      if (this.provider === "ollama") {
        return await this.chatOllama(messages, tools, model);
      }

      const requestPayload: any = {
        model: model || this.currentModel,
        messages,
        tools: tools || [],
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_tokens: 4000,
      };

      // Add search parameters if specified
      if (searchOptions?.search_parameters) {
        requestPayload.search_parameters = searchOptions.search_parameters;
      }

      const response = await this.client.chat.completions.create(
        requestPayload
      );

      return response as H1dr4Response;
    } catch (error: any) {
      throw new Error(`H1dr4 API error: ${error.message}`);
    }
  }

  async *chatStream(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    searchOptions?: SearchOptions
  ): AsyncGenerator<any, void, unknown> {
    try {
      if (this.provider === "ollama") {
        yield* this.chatStreamOllama(messages, tools, model);
        return;
      }

      const requestPayload: any = {
        model: model || this.currentModel,
        messages,
        tools: tools || [],
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_tokens: 4000,
        stream: true,
      };

      // Add search parameters if specified
      if (searchOptions?.search_parameters) {
        requestPayload.search_parameters = searchOptions.search_parameters;
      }

      const stream = (await this.client.chat.completions.create(
        requestPayload
      )) as any;

      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (error: any) {
      throw new Error(`H1dr4 API error: ${error.message}`);
    }
  }

  async reason(prompt: string, model?: string): Promise<string> {
    try {
      if (this.provider === "ollama") {
        const response = await this.chat(
          [
            {
              role: "system",
              content: "Provide a detailed, thoughtful response.",
            },
            { role: "user", content: prompt },
          ],
          [],
          model
        );
        return response.choices[0]?.message?.content || "";
      }

      const response: any = await (this.client as any).responses.create({
        model: model || this.currentModel,
        input: prompt,
        reasoning: { effort: "medium" },
      });
      return response.output_text;
    } catch (error: any) {
      throw new Error(`H1dr4 reasoning error: ${error.message}`);
    }
  }

  async search(
    query: string,
    searchParameters?: SearchParameters
  ): Promise<H1dr4Response> {
    if (this.provider === "ollama") {
      throw new Error("Search is not supported for the Ollama provider.");
    }

    const searchMessage: H1dr4Message = {
      role: "user",
      content: query,
    };

    const searchOptions: SearchOptions = {
      search_parameters: searchParameters || { mode: "on" },
    };

    return this.chat([searchMessage], [], undefined, searchOptions);
  }

  private normalizeOllamaToolCalls(
    toolCalls: any[]
  ): H1dr4ToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) {
      return undefined;
    }

    return toolCalls.map((call, index) => {
      const functionCall = call.function || call;
      const args = functionCall.arguments ?? call.arguments ?? {};
      return {
        id: call.id || `ollama-${Date.now()}-${index}`,
        type: "function",
        function: {
          name: functionCall.name || "",
          arguments:
            typeof args === "string" ? args : JSON.stringify(args ?? {}),
        },
      };
    });
  }

  private async chatOllama(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string
  ): Promise<H1dr4Response> {
    const payload: any = {
      model: model || this.currentModel,
      messages,
      stream: false,
      tools: tools || [],
      options: {
        temperature: 0.7,
        num_predict: 4000,
      },
    };

    const response = await axios.post(
      `${this.ollamaBaseURL}/api/chat`,
      payload,
      { timeout: this.requestTimeoutMs }
    );

    const message = response.data?.message || {};
    const toolCalls = this.normalizeOllamaToolCalls(message.tool_calls);

    return {
      choices: [
        {
          message: {
            role: message.role || "assistant",
            content: message.content ?? "",
            tool_calls: toolCalls,
          },
          finish_reason: toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
        },
      ],
    };
  }

  private async *chatStreamOllama(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string
  ): AsyncGenerator<any, void, unknown> {
    const payload: any = {
      model: model || this.currentModel,
      messages,
      stream: true,
      tools: tools || [],
      options: {
        temperature: 0.7,
        num_predict: 4000,
      },
    };

    const response = await axios.post(
      `${this.ollamaBaseURL}/api/chat`,
      payload,
      { timeout: this.requestTimeoutMs, responseType: "stream" }
    );

    const stream = response.data;
    let buffer = "";

    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const data = JSON.parse(trimmed);
        const message = data.message || {};
        const toolCalls = this.normalizeOllamaToolCalls(message.tool_calls);

        if (data.done) {
          yield {
            choices: [
              {
                delta: {},
                finish_reason: "stop",
              },
            ],
          };
          continue;
        }

        const delta: any = {};
        if (message.content) {
          delta.content = message.content;
        }
        if (toolCalls) {
          delta.tool_calls = toolCalls;
        }

        yield {
          choices: [
            {
              delta,
            },
          ],
        };
      }
    }
  }
}
