import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fetch } from "undici";
import * as cheerio from "cheerio";
import { LLMProvider } from "../providers/llm-provider";
import { SearchProvider } from "./search-provider";
import {
  DiscoveryResult,
  LiveSearchQueryOptions,
  LiveSearchSummary,
  CrawlResult,
} from "./types";
import {
  DEFAULT_LIVESEARCH_CACHE_TTL_MS,
  DEFAULT_LIVESEARCH_CONCURRENCY,
  DEFAULT_LIVESEARCH_MAX_CONTENT_BYTES,
  DEFAULT_LIVESEARCH_MAX_SOURCES,
  DEFAULT_LIVESEARCH_PER_DOMAIN_DELAY_MS,
  DEFAULT_LIVESEARCH_TIMEOUT_MS,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  parseNumber,
} from "../utils/config";

interface LocalLiveSearchConfig {
  cacheDir: string;
  cacheTtlMs: number;
  concurrency: number;
  perDomainDelayMs: number;
  timeoutMs: number;
  maxContentBytes: number;
  ollamaHost: string;
  ollamaModel: string;
  pythonBin: string;
}

interface PythonSummary {
  answer?: string;
  key_points?: string[];
  sources?: Array<{ url: string; title?: string }>;
  confidence?: string;
  raw_sources?: CrawlResult[];
  errors?: string[];
}

export class LocalLiveSearchProvider implements SearchProvider {
  private llmProvider: LLMProvider;
  private config: LocalLiveSearchConfig;

  constructor(llmProvider: LLMProvider) {
    this.llmProvider = llmProvider;
    this.config = {
      cacheDir:
        process.env.LIVESEARCH_CACHE_DIR ||
        path.join(os.homedir(), ".h1dr4", "live-search-cache"),
      cacheTtlMs: parseNumber(
        process.env.LIVESEARCH_CACHE_TTL,
        DEFAULT_LIVESEARCH_CACHE_TTL_MS
      ),
      concurrency: parseNumber(
        process.env.LIVESEARCH_CONCURRENCY,
        DEFAULT_LIVESEARCH_CONCURRENCY
      ),
      perDomainDelayMs: parseNumber(
        process.env.LIVESEARCH_PER_DOMAIN_DELAY,
        DEFAULT_LIVESEARCH_PER_DOMAIN_DELAY_MS
      ),
      timeoutMs: parseNumber(
        process.env.LIVESEARCH_TIMEOUT,
        DEFAULT_LIVESEARCH_TIMEOUT_MS
      ),
      maxContentBytes: parseNumber(
        process.env.LIVESEARCH_MAX_CONTENT_BYTES,
        DEFAULT_LIVESEARCH_MAX_CONTENT_BYTES
      ),
      ollamaHost: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
      ollamaModel: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
      pythonBin: process.env.PYTHON_BIN || "python3",
    };
  }

  async search(
    query: string,
    options?: LiveSearchQueryOptions
  ): Promise<LiveSearchSummary> {
    const maxSources = options?.maxSources ?? DEFAULT_LIVESEARCH_MAX_SOURCES;
    const includeCitations = options?.citations ?? true;

    const queries = await this.expandQueries(query);
    const discovery = await this.discover(queries, maxSources);
    const urls = this.filterUrls(discovery.map((item) => item.url)).slice(
      0,
      maxSources
    );

    if (urls.length === 0) {
      return {
        answer: "No safe URLs found for the query.",
        key_points: [],
        sources: [],
        discovery,
      };
    }

    const cacheKey = this.buildCacheKey(query, urls);
    const cached = this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const summary = await this.runPythonPipeline(query, urls, includeCitations);
    if (!summary) {
      const fallback = await this.summarizeDiscovery(query, discovery);
      this.writeCache(cacheKey, fallback);
      return fallback;
    }

    const result: LiveSearchSummary = {
      answer: summary.answer || "No answer produced.",
      key_points: summary.key_points || [],
      sources: summary.sources || urls.map((url) => ({ url })),
      confidence: summary.confidence,
      raw_sources: summary.raw_sources,
      discovery,
    };

    this.writeCache(cacheKey, result);
    return result;
  }

  private async expandQueries(query: string): Promise<string[]> {
    const prompt = `Generate 2-6 search queries related to the user request.
Return ONLY a JSON array of strings.`;
    const response = await this.llmProvider.chat([
      { role: "system", content: prompt },
      { role: "user", content: query },
    ]);
    const content = response.choices[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => typeof item === "string").slice(0, 6);
      }
    } catch {
      // ignore
    }
    return [query];
  }

  private async discover(
    queries: string[],
    maxSources: number
  ): Promise<DiscoveryResult[]> {
    const results: DiscoveryResult[] = [];

    for (const query of queries) {
      if (results.length >= maxSources) break;
      const queryResults = await this.fetchDuckDuckGo(query);
      for (const item of queryResults) {
        if (!results.find((existing) => existing.url === item.url)) {
          results.push(item);
        }
        if (results.length >= maxSources) break;
      }
    }

    return results;
  }

  private async fetchDuckDuckGo(query: string): Promise<DiscoveryResult[]> {
    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(
      query
    )}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; H1DR4-CLI/1.0; +https://h1dr4.dev)",
      },
    });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    const results: DiscoveryResult[] = [];
    $(".result").each((_, element) => {
      const titleEl = $(element).find(".result__a");
      const snippetEl = $(element).find(".result__snippet");
      const href = titleEl.attr("href");
      const title = titleEl.text().trim();
      const snippet = snippetEl.text().trim();

      if (href && title) {
        results.push({ title, url: href, snippet });
      }
    });

    return results;
  }

  private filterUrls(urls: string[]): string[] {
    return urls.filter((url) => this.isSafeUrl(url));
  }

  private isSafeUrl(urlString: string): boolean {
    try {
      const parsed = new URL(urlString);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname.endsWith(".local")) return false;
      if (this.isPrivateIp(hostname)) return false;
      return true;
    } catch {
      return false;
    }
  }

  private isPrivateIp(hostname: string): boolean {
    const ipMatch = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    if (!ipMatch) return false;
    const parts = hostname.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  private buildCacheKey(query: string, urls: string[]): string {
    const bucket = Math.floor(Date.now() / this.config.cacheTtlMs);
    const hash = crypto
      .createHash("sha256")
      .update(`${query}|${bucket}|${urls.join("|")}`)
      .digest("hex");
    return hash;
  }

  private readCache(cacheKey: string): LiveSearchSummary | null {
    try {
      const cachePath = path.join(this.config.cacheDir, `${cacheKey}.json`);
      if (!fs.existsSync(cachePath)) return null;
      const content = fs.readFileSync(cachePath, "utf8");
      return JSON.parse(content) as LiveSearchSummary;
    } catch {
      return null;
    }
  }

  private writeCache(cacheKey: string, summary: LiveSearchSummary): void {
    try {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
      const cachePath = path.join(this.config.cacheDir, `${cacheKey}.json`);
      fs.writeFileSync(cachePath, JSON.stringify(summary, null, 2));
    } catch {
      // ignore cache failures
    }
  }

  private async runPythonPipeline(
    query: string,
    urls: string[],
    includeCitations: boolean
  ): Promise<PythonSummary | null> {
    const scriptPath = path.resolve(
      __dirname,
      "../../scripts/live_search_pipeline.py"
    );
    if (!fs.existsSync(scriptPath)) {
      return null;
    }

    const payload = {
      query,
      urls,
      include_citations: includeCitations,
      ollama_host: this.config.ollamaHost,
      ollama_model: this.config.ollamaModel,
      concurrency: this.config.concurrency,
      per_domain_delay_ms: this.config.perDomainDelayMs,
      timeout_ms: this.config.timeoutMs,
      max_content_bytes: this.config.maxContentBytes,
    };

    return await new Promise<PythonSummary | null>((resolve) => {
      const child = spawn(this.config.pythonBin, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, this.config.timeoutMs + 5000);

      child.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as PythonSummary;
          resolve(parsed);
        } catch {
          if (stderr) {
            resolve(null);
          } else {
            resolve(null);
          }
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  private async summarizeDiscovery(
    query: string,
    discovery: DiscoveryResult[]
  ): Promise<LiveSearchSummary> {
    const summaryPrompt = `Summarize the following search results for the query: "${query}".
Provide a concise answer and 3-5 key points.`;
    const formatted = discovery
      .map((item, index) => `${index + 1}. ${item.title} - ${item.snippet}`)
      .join("\n");
    const response = await this.llmProvider.chat([
      { role: "system", content: summaryPrompt },
      { role: "user", content: formatted },
    ]);
    const answer = response.choices[0]?.message?.content || "";
    return {
      answer: answer.trim() || "No answer produced.",
      key_points: [],
      sources: discovery.map((item) => ({ url: item.url, title: item.title })),
      discovery,
    };
  }
}
