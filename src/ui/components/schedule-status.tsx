import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { loadSchedules } from "../../schedule/config";

export function ScheduleStatus(): JSX.Element {
  const [count, setCount] = useState(() => loadSchedules().length);

  useEffect(() => {
    const id = setInterval(() => {
      try {
        setCount(loadSchedules().length);
      } catch {
        // ignore
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <Text color="green">⏰ {count}</Text>;
}
