import { H1dr4Client } from "../h1dr4/client";
import { OllamaProvider } from "./ollama-provider";
import { LLMProvider } from "./llm-provider";

export type ProviderName = "ollama" | "remote";

export interface ProviderConfig {
  provider: ProviderName;
  apiKey?: string;
  baseURL?: string;
  model: string;
  ollamaHost: string;
  ollamaKeepAlive?: string;
  localOnly?: boolean;
}

export function createProvider(config: ProviderConfig): LLMProvider {
  if (config.localOnly && config.provider === "remote") {
    throw new Error("Remote providers are disabled when LOCAL_ONLY is true.");
  }

  if (config.provider === "ollama") {
    return new OllamaProvider(
      config.ollamaHost,
      config.model,
      config.ollamaKeepAlive
    );
  }

  if (!config.apiKey) {
    throw new Error(
      "API key required for remote provider. Set GROK_API_KEY or use --api-key."
    );
  }

  return new H1dr4Client(config.apiKey, config.model, config.baseURL);
}
