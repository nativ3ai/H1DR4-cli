import chalk from "chalk";
import { H1dr4Client, H1dr4Message } from "../h1dr4/client";
import { ScheduledTask, ImpactLevel } from "./config";
import { loadWatchState, saveWatchState } from "./state";

interface WatchItem {
  id: string;
  summary: string;
  metadata: Record<string, string>;
}

async function fetchNewItems(task: ScheduledTask): Promise<WatchItem[]> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    console.warn("GROK_API_KEY not set; skipping watch task");
    return [];
  }

  const client = new H1dr4Client(
    apiKey,
    process.env.H1DR4_MODEL,
    process.env.GROK_BASE_URL
  );

  const keywords = task.watch?.keywords || [];
  const tickers = task.watch?.tickers || [];
  const sources = task.watch?.sources || [];

  if (
    keywords.length === 0 &&
    tickers.length === 0 &&
    sources.length === 0
  ) {
    return [];
  }

  const watchDescription = [
    tickers.length ? `Tickers: ${tickers.join(", ")}` : undefined,
    keywords.length ? `Keywords: ${keywords.join(", ")}` : undefined,
    sources.length ? `Sources: ${sources.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: H1dr4Message[] = [
    {
      role: "system",
      content:
        "You are an event detection agent. Use any tools at your disposal (live_search, RSS, reasoning) to find the latest public posts or news that match the user's watchlist. Return each distinct item on its own line with a brief summary and link if available.",
    },
    {
      role: "user",
      content: `${watchDescription}\nReturn only new items discovered during this run.`,
    },
  ];

  try {
    const response = await client.chat(messages, [], undefined, {
      search_parameters: { mode: "on", max_search_results: 10 },
    });
    const content = response.choices[0]?.message.content || "";
    const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const items: WatchItem[] = [];
    for (const line of lines) {
      const meta: Record<string, string> = {};
      const urlMatch = line.match(/https?:\/\/\S+/);
      if (urlMatch) meta.link = urlMatch[0];
      items.push({ id: line, summary: line, metadata: meta });
    }
    return items;
  } catch (error) {
    console.warn(`Query failed: ${(error as Error).message}`);
    return [];
  }
}

async function analyzeImpact(
  item: WatchItem,
  task: ScheduledTask
): Promise<ImpactLevel> {
  const criteria = task.watch?.criteria;
  if (!criteria) return "High";
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return "Low";
  const client = new H1dr4Client(
    apiKey,
    process.env.H1DR4_MODEL,
    process.env.GROK_BASE_URL
  );
  const messages: H1dr4Message[] = [
    {
      role: "system",
      content:
        "You rate whether an item meets the user's alert criteria. Respond with only one of: Low, Mid-High, High.",
    },
    {
      role: "user",
      content: `Criteria: ${criteria}\nItem: ${item.summary}`,
    },
  ];
  try {
    const resp = await client.chat(messages);
    const text = resp.choices[0]?.message.content?.toLowerCase() || "";
    if (text.includes("mid")) return "Mid-High";
    if (text.includes("high")) return "High";
    return "Low";
  } catch {
    return "Low";
  }
}

export async function runWatchTask(task: ScheduledTask): Promise<void> {
  const state = loadWatchState();
  const taskState = state[task.id] || { seenIds: [] };
  const items = await fetchNewItems(task);
  const unseen = items.filter((i) => !taskState.seenIds.includes(i.id));
  if (unseen.length === 0) return;
  const threshold = task.watch?.threshold || "Low";
  const levels: Record<ImpactLevel, number> = { Low: 1, "Mid-High": 2, High: 3 };
  for (const item of unseen) {
    const impact = await analyzeImpact(item, task);
    if (levels[impact] >= levels[threshold]) {
      console.log(
        chalk.yellow(
          `[Alert] ${item.summary} -> Estimated ${impact} impact`
        )
      );
    }
    taskState.seenIds.push(item.id);
  }
  state[task.id] = taskState;
  saveWatchState(state);
}
