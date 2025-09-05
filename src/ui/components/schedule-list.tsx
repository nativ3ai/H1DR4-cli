import React from "react";
import { Box, Text } from "ink";
import { loadSchedules } from "../../schedule/config";

interface Props {
  isVisible: boolean;
}

export function ScheduleList({ isVisible }: Props): JSX.Element | null {
  if (!isVisible) return null;
  const tasks = loadSchedules();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} marginTop={1}>
      <Text color="cyan" bold>
        Scheduled tasks
      </Text>
      {tasks.length === 0 ? (
        <Text>No tasks scheduled</Text>
      ) : (
        tasks.map((t) => (
          <Text key={t.id}>
            {`${t.id}: ${t.cron} -> ${t.command}${t.type ? ` [${t.type}${t.criteria ? `: ${t.criteria}` : ""}]` : ""}`}
          </Text>
        ))
      )}
    </Box>
  );
}
