import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

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

export class H1dr4Client {
  private client: OpenAI;
  private currentModel: string = "grok-3-latest";

  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || process.env.GROK_BASE_URL || "https://api.x.ai/v1",
      timeout: 360000,
    });
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

  async chat(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    searchOptions?: SearchOptions
  ): Promise<H1dr4Response> {
    try {
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
    const searchMessage: H1dr4Message = {
      role: "user",
      content: query,
    };

    const searchOptions: SearchOptions = {
      search_parameters: searchParameters || { mode: "on" },
    };

    return this.chat([searchMessage], [], undefined, searchOptions);
  }
}
