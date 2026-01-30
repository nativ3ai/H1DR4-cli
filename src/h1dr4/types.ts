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
  from_date?: string;
  to_date?: string;
  max_search_results?: number;
  return_citations?: boolean;
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
