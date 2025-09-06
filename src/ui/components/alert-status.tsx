import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import fs from "fs";
import path from "path";
import os from "os";

const EVENTS_FILE = path.join(os.homedir(), ".h1dr4", "alert-events.json");

export function AlertStatus() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => {
      try {
        const events = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
        setCount(events.length);
      } catch {
        setCount(0);
      }
    };
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, []);

  if (count === 0) return null;

  return (
    <Box marginLeft={1}>
      <Text color="red">⚠ alerts: {count} </Text>
    </Box>
  );
}
