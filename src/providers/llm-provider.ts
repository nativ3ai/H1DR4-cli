import type { H1dr4Message, H1dr4Response, H1dr4Tool, SearchOptions } from "../h1dr4/types";

export interface LLMProvider {
  chat(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    searchOptions?: SearchOptions
  ): Promise<H1dr4Response>;
  chatStream(
    messages: H1dr4Message[],
    tools?: H1dr4Tool[],
    model?: string,
    searchOptions?: SearchOptions
  ): AsyncGenerator<any, void, unknown>;
  reason(prompt: string, model?: string): Promise<string>;
  setModel(model: string): void;
  getCurrentModel(): string;
}
