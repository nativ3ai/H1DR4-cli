import axios from "axios";
import * as cheerio from "cheerio";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ToolResult } from "../types";

export interface LiveSearchOptions {
  query: string;
  max_results?: number;
  fetch_pages?: boolean;
  max_chars_per_page?: number;
  region?: string;
  safe?: "on" | "moderate" | "off";
  mode?: "fast" | "robust";
}

interface LiveSearchResult {
  title: string;
  url: string;
  snippet?: string;
  source: "duckduckgo" | "scrapegraphai";
  fetched?: boolean;
  content_text?: string;
  content_excerpt?: string;
}

interface LiveSearchResponse {
  query: string;
  results: LiveSearchResult[];
  citations: Array<{ index: number; url: string; title: string }>;
}

const DEFAULT_TIMEOUT_MS = 10000;
const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 400;
const MAX_CONCURRENCY = 3;
const PYTHON_SCRIPT_RELATIVE_PATH = path.join("tools", "python", "live_search.py");
const PYTHON_TIMEOUT_MS = 15000;
const LIVE_SEARCH_MODE = process.env.LIVE_SEARCH_MODE ?? "fast";
const SCRAPEGRAPH_ENV_KEYS = ["OPENAI_API_KEY", "SCRAPEGRAPH_API_KEY"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): Promise<void> {
  const delay =
    MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
  return sleep(delay);
}

function normalizeDuckDuckGoUrl(url: string): string {
  try {
    const normalized = url.startsWith("/")
      ? `https://duckduckgo.com${url}`
      : url;
    const parsed = new URL(normalized);
    if (parsed.hostname.includes("duckduckgo.com")) {
      const target = parsed.searchParams.get("uddg");
      if (target) {
        return decodeURIComponent(target);
      }
    }
  } catch {
    return url;
  }
  return url.startsWith("/") ? `https://duckduckgo.com${url}` : url;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSearchQuery(query: string): string {
  const cleaned = query
    .replace(/[“”"]/g, "")
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return query;

  const stopWords = new Set([
    "please",
    "pls",
    "plz",
    "ok",
    "okay",
    "hey",
    "hi",
    "can",
    "could",
    "would",
    "you",
    "me",
    "tell",
    "show",
    "find",
    "search",
    "check",
    "get",
    "latest",
  ]);
  const tokens = cleaned
    .split(" ")
    .filter((token) => token && !stopWords.has(token.toLowerCase()));
  return tokens.length > 0 ? tokens.join(" ") : cleaned;
}

function extractReadableText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg, iframe, canvas").remove();

  const article = $("article").first();
  if (article.length) {
    return cleanText(article.text());
  }

  const main = $("main").first();
  if (main.length) {
    return cleanText(main.text());
  }

  const paragraphs = $("p")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter(Boolean);
  if (paragraphs.length > 0) {
    return paragraphs.join("\n");
  }

  return cleanText($("body").text());
}

function toExcerpt(text: string, maxChars: number): string {
  if (!text) return "";
  const trimmed = text.slice(0, maxChars);
  return trimmed;
}

function safeSearchParam(safe: "on" | "moderate" | "off"): string {
  if (safe === "off") {
    return "-1";
  }
  return "1";
}

function resolvePythonScriptPath(): string | null {
  const distPath = path.resolve(__dirname, "python", "live_search.py");
  if (fs.existsSync(distPath)) {
    return distPath;
  }

  const cwdPath = path.resolve(process.cwd(), "src", PYTHON_SCRIPT_RELATIVE_PATH);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  return null;
}

async function runPythonLiveSearch(
  options: LiveSearchOptions
): Promise<LiveSearchResponse> {
  const scriptPath = resolvePythonScriptPath();
  if (!scriptPath) {
    throw new Error("Python live_search script not found");
  }

  const payload = {
    query: options.query,
    max_results: options.max_results,
    fetch_pages: options.fetch_pages,
    max_chars_per_page: options.max_chars_per_page,
    region: options.region,
    safe: options.safe,
  };

  const executables = process.platform === "win32" ? ["python"] : ["python3", "python"];
  let lastError: Error | null = null;

  for (const executable of executables) {
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(executable, [scriptPath], {
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        });

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Python live_search timed out"));
        }, PYTHON_TIMEOUT_MS);

        child.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        child.on("error", (error) => {
          reject(error);
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(
              new Error(
                stderr.trim() || `Python live_search exited with code ${code}`
              )
            );
            return;
          }
          resolve(stdout.trim());
        });

        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
      });

      const parsed = JSON.parse(output);
      if (!parsed?.success) {
        throw new Error(parsed?.error || "Python live_search failed");
      }
      return parsed.data as LiveSearchResponse;
    } catch (error: any) {
      lastError = error;
    }
  }

  throw lastError || new Error("Python live_search failed");
}

async function searchViaDuckDuckGo(
  options: LiveSearchOptions
): Promise<LiveSearchResponse> {
  const query = normalizeSearchQuery(options.query?.trim() ?? "");
  if (!query) {
    throw new Error("Query is required for live_search");
  }

  const maxResults = Math.max(1, options.max_results ?? 5);
  const fetchPages = options.fetch_pages ?? false;
  const maxChars = Math.max(1000, options.max_chars_per_page ?? 8000);
  const region = options.region ?? "wt-wt";
  const safe = options.safe ?? "moderate";

  const results: LiveSearchResult[] = [];
  const seenUrls = new Set<string>();
  const sources = [
    "https://duckduckgo.com/html/",
    "https://html.duckduckgo.com/html/",
    "https://lite.duckduckgo.com/lite/",
  ];

  for (const sourceUrl of sources) {
    if (results.length >= maxResults) {
      break;
    }

    const searchUrl = new URL(sourceUrl);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("kl", region);
    searchUrl.searchParams.set("kp", safeSearchParam(safe));

    const response = await axios.get(searchUrl.toString(), {
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const $ = cheerio.load(response.data);
    const selectors = sourceUrl.includes("lite")
      ? ["a.result-link"]
      : ["a.result__a", "a.result__url"];

    selectors.forEach((selector) => {
      if (results.length >= maxResults) {
        return;
      }

      $(selector).each((_, element) => {
        if (results.length >= maxResults) {
          return;
        }
        const linkEl = $(element);
        const title = cleanText(linkEl.text());
        const rawUrl = linkEl.attr("href") || "";
        if (!rawUrl || rawUrl.startsWith("/?q=")) {
          return;
        }
        const url = normalizeDuckDuckGoUrl(rawUrl);
        if (
          url.includes("duckduckgo.com") ||
          url.includes("duck.com") ||
          url.includes("duckduckgo.com/html")
        ) {
          return;
        }
        if (seenUrls.has(url)) {
          return;
        }
        const snippet = cleanText(
          linkEl
            .closest("tr, div, li")
            .find(".result__snippet, .result__body, .snippet")
            .first()
            .text()
        );

        seenUrls.add(url);
        results.push({
          title: title || url,
          url,
          snippet: snippet || undefined,
          source: "duckduckgo",
        });
      });
    });
  }

  if (fetchPages && results.length > 0) {
    const queue = results.slice(0, maxResults);
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) return;
          await randomDelay();
          try {
            const pageResponse = await axios.get(item.url, {
              timeout: DEFAULT_TIMEOUT_MS,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              maxRedirects: 5,
            });

            const contentType = pageResponse.headers["content-type"] || "";
            if (!contentType.includes("text/html")) {
              item.fetched = false;
              continue;
            }

            const text = extractReadableText(pageResponse.data);
            if (!text) {
              item.fetched = false;
              continue;
            }

            const truncated = text.slice(0, maxChars);
            item.fetched = true;
            item.content_text = truncated;
            item.content_excerpt = toExcerpt(truncated, Math.min(500, maxChars));
          } catch {
            item.fetched = false;
          }
        }
      }
    );

    await Promise.all(workers);
  }

  return {
    query,
    results,
    citations: results.map((result, index) => ({
      index,
      url: result.url,
      title: result.title,
    })),
  };
}

export class LiveSearchTool {
  async search(options: LiveSearchOptions): Promise<ToolResult> {
    try {
      const query = options.query?.trim();
      if (!query) {
        return { success: false, error: "Query is required for live_search" };
      }

      const mode =
        options.mode ??
        (SCRAPEGRAPH_ENV_KEYS.some((key) => Boolean(process.env[key]))
          ? "robust"
          : LIVE_SEARCH_MODE);
      const effectiveOptions: LiveSearchOptions = {
        ...options,
        fetch_pages: options.fetch_pages ?? mode === "robust",
      };

      let payload: LiveSearchResponse | null = null;
      if (mode === "robust") {
        try {
          payload = await runPythonLiveSearch(effectiveOptions);
        } catch {
          payload = await searchViaDuckDuckGo(effectiveOptions);
        }
      } else {
        payload = await searchViaDuckDuckGo(effectiveOptions);
        if (payload.results.length === 0) {
          try {
            payload = await runPythonLiveSearch(effectiveOptions);
          } catch {
            payload = await searchViaDuckDuckGo(effectiveOptions);
          }
        }
      }

      return {
        success: true,
        output: JSON.stringify(payload, null, 2),
        data: payload,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Live search error: ${error.message}`,
      };
    }
  }
}
