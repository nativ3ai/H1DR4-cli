import { LLMProvider } from "../providers/llm-provider";
import { LocalLiveSearchProvider } from "../search/local-live-search-provider";
import { SearchProvider } from "../search/search-provider";
import { LiveSearchSummary } from "../search/types";
import { ToolResult } from "../types";
import {
  DEFAULT_LIVESEARCH_MAX_SOURCES,
  parseBoolean,
  parseNumber,
} from "../utils/config";

interface LiveSearchToolConfig {
  enabled: boolean;
  citations: boolean;
  maxSources: number;
}

export class LiveSearchTool {
  private provider: SearchProvider;
  private config: LiveSearchToolConfig;

  constructor(llmProvider: LLMProvider, config?: Partial<LiveSearchToolConfig>) {
    this.provider = new LocalLiveSearchProvider(llmProvider);
    this.config = {
      enabled: parseBoolean(
        process.env.H1DR4_LIVE_SEARCH,
        config?.enabled ?? true
      ),
      citations: parseBoolean(
        process.env.H1DR4_CITATIONS,
        config?.citations ?? true
      ),
      maxSources: parseNumber(
        process.env.H1DR4_MAX_SOURCES,
        config?.maxSources ?? DEFAULT_LIVESEARCH_MAX_SOURCES
      ),
    };
  }

  async search(
    query: string,
    options?: {
      search_parameters?: {
        mode?: "auto" | "on" | "off";
        max_search_results?: number;
        return_citations?: boolean;
      };
      max_sources?: number;
      citations?: boolean;
      return_raw?: boolean;
    }
  ): Promise<ToolResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        error: "Live search is disabled. Enable with --live-search on.",
      };
    }

    if (options?.search_parameters?.mode === "off") {
      return {
        success: false,
        error: "Live search was turned off by request.",
      };
    }

    const maxSources =
      options?.max_sources ||
      options?.search_parameters?.max_search_results ||
      this.config.maxSources;
    const citations =
      options?.citations ??
      options?.search_parameters?.return_citations ??
      this.config.citations;
    const returnRaw = options?.return_raw ?? false;

    try {
      const summary = await this.provider.search(query, {
        maxSources,
        citations,
        returnRaw,
      });
      const output = this.formatSummary(summary, {
        citations,
        returnRaw,
      });
      return { success: true, output };
    } catch (error: any) {
      return {
        success: false,
        error: `Live search failed: ${error.message}`,
      };
    }
  }

  private formatSummary(
    summary: LiveSearchSummary,
    options: { citations: boolean; returnRaw: boolean }
  ): string {
    const lines: string[] = [];
    lines.push(summary.answer || "No answer produced.");

    if (summary.key_points?.length) {
      lines.push("");
      lines.push("Key points:");
      summary.key_points.forEach((point) => {
        lines.push(`- ${point}`);
      });
    }

    if (options.citations && summary.sources?.length) {
      lines.push("");
      lines.push("Sources:");
      summary.sources.forEach((source, index) => {
        const label = `[${index + 1}]`;
        const title = source.title ? ` - ${source.title}` : "";
        lines.push(`${label} ${source.url}${title}`);
      });
    }

    if (options.returnRaw && summary.raw_sources?.length) {
      lines.push("");
      lines.push("Raw sources:");
      summary.raw_sources.forEach((source, index) => {
        const label = `[${index + 1}]`;
        lines.push(`${label} ${source.url}`);
        if (source.title) {
          lines.push(`Title: ${source.title}`);
        }
        if (source.headings?.length) {
          lines.push(`Headings: ${source.headings.join(" | ")}`);
        }
        if (source.content) {
          lines.push(source.content.trim());
        }
        lines.push("");
      });
    }

    return lines.join("\n").trim();
  }
}
