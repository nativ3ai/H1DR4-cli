import { useState, useEffect } from 'react';
import axios from 'axios';
import { Message } from './useChat';

interface Job {
  id: string;
  instanceId: string;
}

export function useJobs(headers: Record<string, string>, addMessage: (id: string, msg: Message) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const interval = setInterval(async () => {
      for (const job of jobs) {
        try {
          const res = await axios.get(`/status/${job.id}`, { headers });
          if (res.data.status === 'complete') {
            res.data.result?.forEach((e: any) =>
              addMessage(job.instanceId, { role: e.type === 'assistant' ? 'assistant' : 'assistant', content: e.content })
            );
            setJobs(jobs.filter(j => j.id !== job.id));
            if (Notification.permission === 'granted') {
              new Notification('Task complete');
            }
          } else if (res.data.status === 'error') {
            addMessage(job.instanceId, { role: 'assistant', content: res.data.error });
            setJobs(jobs.filter(j => j.id !== job.id));
          }
        } catch (err) {
          console.error(err);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [jobs, headers]);

  const trackJob = (id: string, instanceId: string) => {
    setJobs(prev => [...prev, { id, instanceId }]);
  };

  return { trackJob };
}
