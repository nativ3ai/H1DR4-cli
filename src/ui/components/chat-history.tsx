import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { ChatEntry } from "../../agent/h1dr4-agent";
import { DiffRenderer } from "./diff-renderer";
import { MarkdownRenderer } from "../utils/markdown-renderer";

interface ChatHistoryProps {
  entries: ChatEntry[];
  isConfirmationActive?: boolean;
}

const MAX_TOOL_CONTENT_CHARS = 320;
const MAX_TOOL_CONTENT_LINES = 6;

// Memoized ChatEntry component to prevent unnecessary re-renders
const MemoizedChatEntry = React.memo(
  ({ entry, index }: { entry: ChatEntry; index: number }) => {
    const spinnerFrames = ["/", "-", "\\", "|"];
    const [spinnerIndex, setSpinnerIndex] = useState(0);

    useEffect(() => {
      if (!entry.isStreaming) return;
      const interval = setInterval(() => {
        setSpinnerIndex((prev) => (prev + 1) % spinnerFrames.length);
      }, 250);
      return () => clearInterval(interval);
    }, [entry.isStreaming]);
    const renderDiff = (diffContent: string, filename?: string) => {
      return (
        <DiffRenderer
          diffContent={diffContent}
          filename={filename}
          terminalWidth={80}
        />
      );
    };

    const renderFileContent = (content: string) => {
      const lines = content.split("\n");

      // Calculate minimum indentation like DiffRenderer does
      let baseIndentation = Infinity;
      for (const line of lines) {
        if (line.trim() === "") continue;
        const firstCharIndex = line.search(/\S/);
        const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex;
        baseIndentation = Math.min(baseIndentation, currentIndent);
      }
      if (!isFinite(baseIndentation)) {
        baseIndentation = 0;
      }

      return lines.map((line, index) => {
        const displayContent = line.substring(baseIndentation);
        return (
          <Text key={index} color="gray">
            {displayContent}
          </Text>
        );
      });
    };

    const ImageRenderer = ({ data }: { data: string }) => {
      const [image, setImage] = useState<string>("Loading image...");
      useEffect(() => {
        const base64 = data.split(",")[1];
        const buffer = Buffer.from(base64, "base64");

        (async () => {
          try {
            const { default: terminalImage } = await import("terminal-image");
            const img = await terminalImage.buffer(buffer);
            setImage(img);
          } catch {
            setImage("Error displaying image");
          }
        })();
      }, [data]);
      return <Text>{image}</Text>;
    };

    const clampContent = (content: string) => {
      if (!content) return content;
      const lines = content.split("\n");
      let trimmed = lines.slice(0, MAX_TOOL_CONTENT_LINES).join("\n");
      if (lines.length > MAX_TOOL_CONTENT_LINES) {
        trimmed = `${trimmed}\n… (+${lines.length - MAX_TOOL_CONTENT_LINES} more lines)`;
      }
      if (trimmed.length > MAX_TOOL_CONTENT_CHARS) {
        trimmed = `${trimmed.slice(0, MAX_TOOL_CONTENT_CHARS)}… (+${
          trimmed.length - MAX_TOOL_CONTENT_CHARS
        } chars)`;
      }
      return trimmed;
    };

    const summarizeLiveSearch = (content: string) => {
      try {
        const parsed = JSON.parse(content);
        const results = parsed?.results ?? [];
        const query = parsed?.query ? ` for "${parsed.query}"` : "";
        const top = results
          .slice(0, 3)
          .map((result: any, idx: number) => {
            const title = result?.title || result?.url || "Result";
            const url = result?.url ? ` — ${result.url}` : "";
            return `${idx + 1}. ${title}${url}`;
          })
          .join(" | ");
        return `Found ${results.length} results${query}${
          top ? `: ${top}` : ""
        }`;
      } catch {
        return clampContent(content);
      }
    };

    switch (entry.type) {
      case "user":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box>
              <Text color="gray">
                {">"} {entry.content}
              </Text>
            </Box>
          </Box>
        );

      case "assistant":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box flexDirection="row" alignItems="flex-start">
              <Text color="white">⏺ </Text>
              <Box flexDirection="column" flexGrow={1}>
                {entry.toolCalls ? (
                  // If there are tool calls, just show plain text
                  <Text color="white">{entry.content.trim()}</Text>
                ) : (
                  // If no tool calls, render as markdown
                  <MarkdownRenderer content={entry.content.trim()} />
                )}
                {entry.isStreaming && (
                  <Text color="cyan">{spinnerFrames[spinnerIndex]}</Text>
                )}
              </Box>
            </Box>
          </Box>
        );

      case "tool_call":
      case "tool_result":
        const getToolActionName = (toolName: string) => {
          // Handle MCP tools with mcp__servername__toolname format
          if (toolName.startsWith("mcp__")) {
            const parts = toolName.split("__");
            if (parts.length >= 3) {
              const serverName = parts[1];
              const actualToolName = parts.slice(2).join("__");
              return `${serverName.charAt(0).toUpperCase() + serverName.slice(1)}(${actualToolName.replace(/_/g, " ")})`;
            }
          }

          switch (toolName) {
            case "view_file":
              return "Read";
            case "str_replace_editor":
              return "Update";
            case "create_file":
              return "Create";
            case "bash":
              return "Bash";
            case "search":
              return "Search";
            case "live_search":
              return "Web Search";
            case "create_todo_list":
              return "Created Todo";
            case "update_todo_list":
              return "Updated Todo";
            default:
              return "Tool";
          }
        };

        const toolName = entry.toolCall?.function?.name || "unknown";
        const actionName = getToolActionName(toolName);

        const getFilePath = (toolCall: any) => {
          if (toolCall?.function?.arguments) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (toolCall.function.name === "search") {
                return args.query;
              }
              if (toolCall.function.name === "live_search") {
                return args.query;
              }
              return args.path || args.file_path || args.command || "";
            } catch {
              return "";
            }
          }
          return "";
        };

        const filePath = getFilePath(entry.toolCall);
        const isExecuting = entry.type === "tool_call" || !entry.toolResult;
        
        // Format JSON content for better readability
        const formatToolContent = (content: string, toolName: string) => {
          if (toolName === "live_search") {
            return summarizeLiveSearch(content);
          }
          if (toolName.startsWith("mcp__")) {
            try {
              // Try to parse as JSON and format it
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                // For arrays, show a summary instead of full JSON
                return `Found ${parsed.length} items`;
              } else if (typeof parsed === "object") {
                // For objects, show a formatted version
                return clampContent(JSON.stringify(parsed, null, 2));
              }
            } catch {
              // If not JSON, return as is
              return clampContent(content);
            }
          }
          return clampContent(content);
        };
        const shouldShowDiff =
          entry.toolCall?.function?.name === "str_replace_editor" &&
          entry.toolResult?.success &&
          entry.content.includes("Updated") &&
          entry.content.includes("---") &&
          entry.content.includes("+++");

        const shouldShowFileContent =
          (entry.toolCall?.function?.name === "view_file" ||
            entry.toolCall?.function?.name === "create_file") &&
          entry.toolResult?.success &&
          !shouldShowDiff;

        const isImageContent = entry.content.trim().startsWith("data:image");

        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box>
              <Text color="magenta">⏺</Text>
              <Text color="white">
                {" "}
                {filePath ? `${actionName}(${filePath})` : actionName}
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              {isExecuting ? (
                <Text color="cyan">⎿ Executing...</Text>
              ) : shouldShowFileContent ? (
                <Box flexDirection="column">
                  <Text color="gray">⎿ File contents:</Text>
                  <Box marginLeft={2} flexDirection="column">
                    {renderFileContent(entry.content)}
                  </Box>
                </Box>
              ) : isImageContent ? (
                <Box flexDirection="column">
                  <Text color="gray">⎿</Text>
                  <ImageRenderer data={entry.content.trim()} />
                </Box>
              ) : shouldShowDiff ? (
                // For diff results, show only the summary line, not the raw content
                <Text color="gray">⎿ {entry.content.split("\n")[0]}</Text>
              ) : (
                <Text color="gray">⎿ {formatToolContent(entry.content, toolName)}</Text>
              )}
            </Box>
            {shouldShowDiff && !isExecuting && (
              <Box marginLeft={4} flexDirection="column">
                {renderDiff(entry.content, filePath)}
              </Box>
            )}
          </Box>
        );

      default:
        return null;
    }
  }
);

MemoizedChatEntry.displayName = "MemoizedChatEntry";

export function ChatHistory({
  entries,
  isConfirmationActive = false,
}: ChatHistoryProps) {
  // Filter out tool_call entries with "Executing..." when confirmation is active
  const filteredEntries = isConfirmationActive
    ? entries.filter(
        (entry) =>
          !(entry.type === "tool_call" && entry.content === "Executing...")
      )
    : entries;

  return (
    <Box flexDirection="column">
      {filteredEntries.slice(-20).map((entry, index) => (
        <MemoizedChatEntry
          key={`${entry.timestamp.getTime()}-${index}`}
          entry={entry}
          index={index}
        />
      ))}
    </Box>
  );
}
