import { ProviderName } from "../providers/provider-factory";

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL =
  "huihui_ai/qwen2.5-coder-abliterate:7b";

export const DEFAULT_LIVESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LIVESEARCH_MAX_SOURCES = 5;
export const DEFAULT_LIVESEARCH_CONCURRENCY = 2;
export const DEFAULT_LIVESEARCH_PER_DOMAIN_DELAY_MS = 1000;
export const DEFAULT_LIVESEARCH_TIMEOUT_MS = 45000;
export const DEFAULT_LIVESEARCH_MAX_CONTENT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_HISTORY_MESSAGES = 20;
export const DEFAULT_MAX_HISTORY_TOKENS = 4000;

export function parseBoolean(
  value: string | boolean | undefined,
  defaultValue: boolean
): boolean {
  if (typeof value === "boolean") return value;
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function parseNumber(
  value: string | number | undefined,
  defaultValue: number
): number {
  if (typeof value === "number") return value;
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function resolveProvider(input?: string): ProviderName {
  const normalized = (input || "").toLowerCase();
  if (normalized === "remote") return "remote";
  return "ollama";
}
