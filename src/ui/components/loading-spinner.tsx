import React, { useEffect, useRef } from "react";
import { Box, Text, render } from "ink";
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
  const tokenCountRef = useRef(0);
  const rendererRef = useRef<any>(null);
  const loadingTextRef = useRef<string>(loadingTexts[0]);

  const update = () => {
    if (rendererRef.current) {
      rendererRef.current.rerender(
        <Box marginTop={1}>
          <Text color="cyan">⏳ {loadingTextRef.current} </Text>
          <Text color="gray">
            (↑ {formatTokenCount(tokenCountRef.current)} tokens · esc to interrupt)
          </Text>
        </Box>
      );
    }
  };

  useEffect(() => {
    const handler = (count: number) => {
      tokenCountRef.current = count;
      update();
    };
    tokenEventEmitter.on("update", handler);
    return () => {
      tokenEventEmitter.off("update", handler);
    };
  }, []);

  useEffect(() => {
    if (isActive) {
      loadingTextRef.current =
        loadingTexts[Math.floor(Math.random() * loadingTexts.length)];
      rendererRef.current = render(
        <Box marginTop={1}>
          <Text color="cyan">⏳ {loadingTextRef.current} </Text>
          <Text color="gray">
            (↑ {formatTokenCount(tokenCountRef.current)} tokens · esc to interrupt)
          </Text>
        </Box>
      );
    } else {
      rendererRef.current?.unmount();
      rendererRef.current = null;
    }
    return () => {
      rendererRef.current?.unmount();
      rendererRef.current = null;
    };
  }, [isActive]);

  return null;
}
