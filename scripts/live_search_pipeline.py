import asyncio
import json
import sys
import time
from typing import Any, Dict, List
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode
from scrapegraphai.graphs import SmartScraperGraph


async def crawl_urls(
    urls: List[str],
    concurrency: int,
    per_domain_delay_ms: int,
    timeout_ms: int,
    max_content_bytes: int,
) -> List[Dict[str, Any]]:
    semaphore = asyncio.Semaphore(concurrency)
    domain_last_access: Dict[str, float] = {}
    domain_lock = asyncio.Lock()

    async def wait_for_domain(domain: str) -> None:
        async with domain_lock:
            last_access = domain_last_access.get(domain, 0.0)
            now = time.monotonic()
            delay = per_domain_delay_ms / 1000.0
            if now - last_access < delay:
                await asyncio.sleep(delay - (now - last_access))
            domain_last_access[domain] = time.monotonic()

    async def crawl(url: str) -> Dict[str, Any]:
        parsed = urlparse(url)
        domain = parsed.netloc
        await wait_for_domain(domain)

        async with semaphore:
            config = CrawlerRunConfig(
                max_depth=1,
                page_timeout=timeout_ms,
                cache_mode=CacheMode.BYPASS,
                exclude_tags=["script", "style", "nav", "footer", "noscript"],
                respect_robots_txt=True,
            )
            async with AsyncWebCrawler() as crawler:
                result = await crawler.arun(url, config=config)

            content = getattr(result, "markdown", None) or getattr(
                result, "cleaned_text", None
            ) or getattr(result, "text", None)
            if content and len(content.encode("utf-8")) > max_content_bytes:
                content = content.encode("utf-8")[:max_content_bytes].decode(
                    "utf-8", errors="ignore"
                )

            metadata = getattr(result, "metadata", {}) or {}
            title = metadata.get("title") or metadata.get("page_title")
            headings = metadata.get("headings")
            return {
                "url": url,
                "title": title,
                "content": content,
                "headings": headings,
            }

    tasks = [crawl(url) for url in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    cleaned: List[Dict[str, Any]] = []
    for item in results:
        if isinstance(item, Exception):
            continue
        cleaned.append(item)
    return cleaned


def build_summary(
    query: str,
    crawled: List[Dict[str, Any]],
    ollama_host: str,
    ollama_model: str,
    include_citations: bool,
) -> Dict[str, Any]:
    sources_list = []
    combined_html_parts = ["<html><body>"]
    for index, source in enumerate(crawled, start=1):
        url = source.get("url")
        title = source.get("title") or f"Source {index}"
        content = source.get("content") or ""
        sources_list.append({"url": url, "title": title})
        combined_html_parts.append(f"<h2>[{index}] {title}</h2>")
        combined_html_parts.append(f"<p>{content}</p>")
    combined_html_parts.append("</body></html>")
    combined_html = "\n".join(combined_html_parts)

    citation_instruction = ""
    if include_citations:
        citation_instruction = (
            "Include citations like [1], [2] in the answer and key points that "
            "map to the numbered sources list below.\n"
        )

    prompt = (
        "You are a research assistant. Using the provided content, return JSON with keys: "
        '"answer" (string), "key_points" (array of strings), "sources" (array of {url,title}), '
        '"confidence" (string). '
        f"{citation_instruction}"
        f"User query: {query}\n"
        f"Sources list: {json.dumps(sources_list)}"
    )

    graph = SmartScraperGraph(
        prompt=prompt,
        source=combined_html,
        config={
            "llm": {
                "model": ollama_model,
                "temperature": 0,
                "base_url": ollama_host,
            },
            "verbose": False,
        },
    )

    result = graph.run()
    if isinstance(result, str):
        return json.loads(result)
    return result


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    query = payload.get("query", "")
    urls = payload.get("urls", [])
    concurrency = payload.get("concurrency", 2)
    per_domain_delay_ms = payload.get("per_domain_delay_ms", 1000)
    timeout_ms = payload.get("timeout_ms", 45000)
    max_content_bytes = payload.get("max_content_bytes", 2 * 1024 * 1024)
    ollama_host = payload.get("ollama_host", "http://127.0.0.1:11434")
    ollama_model = payload.get("ollama_model", "llama3")
    include_citations = payload.get("include_citations", True)

    crawled = asyncio.run(
        crawl_urls(
            urls,
            concurrency=concurrency,
            per_domain_delay_ms=per_domain_delay_ms,
            timeout_ms=timeout_ms,
            max_content_bytes=max_content_bytes,
        )
    )

    if not crawled:
        output = {
            "answer": "No content could be crawled.",
            "key_points": [],
            "sources": [{"url": url} for url in urls],
            "confidence": "low",
            "raw_sources": [],
        }
        print(json.dumps(output))
        return

    summary = build_summary(
        query, crawled, ollama_host, ollama_model, include_citations
    )
    summary["raw_sources"] = crawled
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
