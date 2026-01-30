import { fetch } from "undici";
import { randomUUID } from "crypto";
import { LLMProvider } from "./llm-provider";
import {
  H1dr4Message,
  H1dr4Response,
  H1dr4Tool,
  H1dr4ToolCall,
} from "../h1dr4/types";

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, any> | string;
      };
    }>;
  };
  done?: boolean;
}

interface OllamaStreamChunk extends OllamaChatResponse {
  done?: boolean;
}

interface ToolEnvelope {
  tool?: string | null;
  args?: Record<string, any>;
}

export class OllamaProvider implements LLMProvider {
  private host: string;
  private currentModel: string;
  private keepAlive?: string;

  constructor(host: string, model: string, keepAlive?: string) {
    this.host = host.replace(/\/+$/, "");
    this.currentModel = model;
    this.keepAlive = keepAlive;
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
    _searchOptions?: unknown
  ): Promise<H1dr4Response> {
    const response = await this.requestChat(messages, tools, model, false);
    return this.mapResponse(response, messages, tools, model);
  }

  async *chatStream(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    _searchOptions?: unknown
  ): AsyncGenerator<any, void, unknown> {
    const response = await this.requestChat(messages, tools, model, true);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Ollama stream unavailable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const chunk = JSON.parse(line) as OllamaStreamChunk;
          const delta: any = {};
          if (chunk.message?.content) {
            delta.content = chunk.message.content;
          }
          if (chunk.message?.tool_calls) {
            delta.tool_calls = this.mapToolCalls(chunk.message.tool_calls);
          }
          if (Object.keys(delta).length > 0) {
            yield { choices: [{ delta }] };
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  }

  async reason(prompt: string, model?: string): Promise<string> {
    const response = await this.chat(
      [
        {
          role: "system",
          content:
            "Provide a thorough, step-by-step reasoning answer to the user's request.",
        },
        { role: "user", content: prompt },
      ],
      undefined,
      model
    );
    return response.choices[0]?.message?.content || "";
  }

  private async requestChat(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    stream?: boolean
  ) {
    const payload: Record<string, any> = {
      model: model || this.currentModel,
      messages,
      stream: stream ?? false,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    if (this.keepAlive) {
      payload.keep_alive = this.keepAlive;
    }

    const response = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${errorText}`);
    }

    return response;
  }

  private async mapResponse(
    response: any,
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string
  ): Promise<H1dr4Response> {
    const body = (await response.json()) as OllamaChatResponse;
    const message = body.message || { role: "assistant", content: "" };
    let toolCalls: H1dr4ToolCall[] | undefined;

    if (message.tool_calls?.length) {
      toolCalls = this.mapToolCalls(message.tool_calls);
    } else if (tools && tools.length > 0) {
      toolCalls = await this.tryParseToolCall(message.content, messages, tools, model);
    }

    return {
      choices: [
        {
          message: {
            role: message.role || "assistant",
            content: toolCalls ? "" : message.content || "",
            tool_calls: toolCalls,
          },
          finish_reason: body.done ? "stop" : "length",
        },
      ],
    };
  }

  private mapToolCalls(
    toolCalls: Array<{ function: { name: string; arguments: any } }>
  ): H1dr4ToolCall[] {
    return toolCalls.map((toolCall) => ({
      id: randomUUID(),
      type: "function",
      function: {
        name: toolCall.function.name,
        arguments:
          typeof toolCall.function.arguments === "string"
            ? toolCall.function.arguments
            : JSON.stringify(toolCall.function.arguments ?? {}),
      },
    }));
  }

  private async tryParseToolCall(
    content: string,
    messages: H1dr4Message[],
    tools: H1dr4Tool[],
    model?: string
  ): Promise<H1dr4ToolCall[] | undefined> {
    const trimmed = (content || "").trim();
    const parsed = this.parseToolEnvelope(trimmed);
    if (parsed) {
      return [this.toToolCall(parsed, tools)];
    }

    if (!trimmed.startsWith("{") || !trimmed.includes('"tool"')) {
      return undefined;
    }

    const retry = await this.requestToolFix(content, messages, model);
    if (!retry) {
      return undefined;
    }

    return [this.toToolCall(retry, tools)];
  }

  private parseToolEnvelope(content: string): ToolEnvelope | null {
    const trimmed = (content || "").trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as ToolEnvelope;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      if (!parsed.tool) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async requestToolFix(
    content: string,
    messages: H1dr4Message[],
    model?: string
  ): Promise<ToolEnvelope | null> {
    const fixPrompt = `Return ONLY valid JSON for a tool call in the form {"tool":"tool_name","args":{...}}.
If no tool is required, return {"tool":null,"args":{}}.
Fix this output:\n${content}`;
    const response = await this.chat(
      [...messages, { role: "user", content: fixPrompt }],
      undefined,
      model
    );
    const candidate = response.choices[0]?.message?.content;
    if (!candidate) return null;
    return this.parseToolEnvelope(candidate);
  }

  private toToolCall(parsed: ToolEnvelope, tools: H1dr4Tool[]): H1dr4ToolCall {
    const toolName = parsed.tool || "";
    const known = tools.some((tool) => tool.function.name === toolName);
    if (!known) {
      return {
        id: randomUUID(),
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(parsed.args ?? {}),
        },
      };
    }
    return {
      id: randomUUID(),
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(parsed.args ?? {}),
      },
    };
  }
}
