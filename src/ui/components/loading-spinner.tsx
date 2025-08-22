import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { formatTokenCount } from "../../utils/token-counter";
import { tokenEventEmitter } from "../../utils/token-events";

interface LoadingSpinnerProps {
  isActive: boolean;
}

const loadingTexts = [
  "Thinking...",
  "Computing...",
  "Analyzing...",
  "Processing...",
  "Calculating...",
  "Interfacing...",
  "Optimizing...",
  "Synthesizing...",
  "Decrypting...",
  "Calibrating...",
  "Bootstrapping...",
  "Synchronizing...",
  "Compiling...",
  "Downloading...",
];

export function LoadingSpinner({ isActive }: LoadingSpinnerProps) {
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);

  useEffect(() => {
    if (isActive) {
      setLoadingTextIndex(Math.floor(Math.random() * loadingTexts.length));
    }
  }, [isActive]);

  useEffect(() => {
    const handler = (count: number) => {
      setTokenCount(count);
    };
    tokenEventEmitter.on("update", handler);
    return () => {
      tokenEventEmitter.off("update", handler);
    };
  }, []);

  if (!isActive) return null;

  return (
    <Box marginTop={1}>
      <Text color="cyan">⏳ {loadingTexts[loadingTextIndex]} </Text>
      <Text color="gray">
        (↑ {formatTokenCount(tokenCount)} tokens · esc to interrupt)
      </Text>
    </Box>
  );
}
