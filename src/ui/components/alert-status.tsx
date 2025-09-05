import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { loadAlerts } from "../../schedule/alerts";

function countAlerts(): number {
  try {
    const alerts = loadAlerts();
    let total = 0;
    for (const msgs of Object.values(alerts)) {
      total += msgs.filter(
        (m) => !m.startsWith("ERROR:") && !m.startsWith("NO MATCH:")
      ).length;
    }
    return total;
  } catch {
    return 0;
  }
}

export function AlertStatus(): JSX.Element {
  const [count, setCount] = useState(() => countAlerts());

  useEffect(() => {
    const id = setInterval(() => {
      setCount(countAlerts());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <Text color="red">🚨 {count}</Text>;
}

export default AlertStatus;
