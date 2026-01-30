#!/usr/bin/env python3
import asyncio
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple


def fail(message: str) -> None:
    print(json.dumps({"success": False, "error": message}))
    sys.exit(1)


def extract_urls(data: Any) -> List[str]:
    urls: List[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in {"url", "link"} and isinstance(item, str):
                    urls.append(item)
                else:
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str):
            for match in re.findall(r"https?://[^\s\"']+", value):
                urls.append(match)

    walk(data)
    deduped = []
    seen = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            deduped.append(url)
    return deduped


def parse_search_results(data: Any) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []

    if isinstance(data, dict):
        candidates = data.get("results") or data.get("sources") or data.get("items")
        if isinstance(candidates, list):
            for item in candidates:
                if isinstance(item, dict):
                    url = item.get("url") or item.get("link")
                    if url:
                        results.append(
                            {
                                "title": item.get("title") or url,
                                "url": url,
                                "snippet": item.get("snippet") or item.get("description"),
                            }
                        )

    if results:
        return results

    urls = extract_urls(data)
    return [{"title": url, "url": url} for url in urls]


async def crawl_pages(
    results: List[Dict[str, Any]],
    max_chars: int,
) -> None:
    try:
        from crawl4ai import AsyncWebCrawler, CacheMode, CrawlerRunConfig
    except Exception as exc:  # pragma: no cover - runtime dependency
        fail(f"crawl4ai import error: {exc}")

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        remove_overlay_elements=True,
    )

    async with AsyncWebCrawler(verbose=False) as crawler:
        for result in results:
            url = result["url"]
            try:
                response = await crawler.arun(url, config=run_config)
            except Exception:
                result["fetched"] = False
                continue

            text = (
                getattr(response, "markdown", None)
                or getattr(response, "cleaned_html", None)
                or getattr(response, "text", None)
                or ""
            )
            if not text:
                result["fetched"] = False
                continue

            cleaned = " ".join(str(text).split())
            truncated = cleaned[:max_chars]
            result["fetched"] = True
            result["content_text"] = truncated
            result["content_excerpt"] = truncated[: min(500, max_chars)]


def run_search(query: str, max_results: int) -> Tuple[List[Dict[str, Any]], str]:
    try:
        from scrapegraphai.graphs import SearchGraph
    except Exception as exc:  # pragma: no cover - runtime dependency
        fail(f"scrapegraphai import error: {exc}")

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("SCRAPEGRAPH_API_KEY")
    if not api_key:
        fail("Missing OPENAI_API_KEY or SCRAPEGRAPH_API_KEY for ScrapeGraphAI.")

    config: Dict[str, Any] = {
        "llm": {
            "api_key": api_key,
            "model": os.environ.get("SCRAPEGRAPH_LLM_MODEL", "gpt-4o-mini"),
        },
        "search_engine": os.environ.get("SCRAPEGRAPH_SEARCH_ENGINE", "duckduckgo"),
        "verbose": False,
    }

    try:
        graph = SearchGraph(prompt=query, config=config)
        result = graph.run()
    except Exception as exc:
        fail(f"ScrapeGraphAI search error: {exc}")

    results = parse_search_results(result)
    if not results:
        fail("ScrapeGraphAI search returned no results.")

    return results[:max_results], "scrapegraphai"


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        fail(f"Invalid JSON payload: {exc}")

    query = str(payload.get("query", "")).strip()
    if not query:
        fail("Query is required for live_search")

    max_results = max(1, int(payload.get("max_results", 5)))
    fetch_pages = payload.get("fetch_pages", True)
    max_chars = max(1000, int(payload.get("max_chars_per_page", 8000)))

    results, source = run_search(query, max_results)

    if fetch_pages and results:
        asyncio.run(crawl_pages(results, max_chars))

    response = {
        "query": query,
        "results": [
            {
                "title": item.get("title") or item.get("url"),
                "url": item.get("url"),
                "snippet": item.get("snippet"),
                "source": source,
                "fetched": item.get("fetched"),
                "content_text": item.get("content_text"),
                "content_excerpt": item.get("content_excerpt"),
            }
            for item in results
        ],
        "citations": [
            {"index": index, "url": item["url"], "title": item.get("title") or item["url"]}
            for index, item in enumerate(results)
        ],
    }

    print(json.dumps({"success": True, "data": response}))


if __name__ == "__main__":
    main()
