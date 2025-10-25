import { H1dr4Agent, ChatEntry } from '../src/agent/h1dr4-agent';
import { v4 as uuidv4 } from 'uuid';

interface Job {
  status: 'pending' | 'complete' | 'error';
  result?: ChatEntry[];
  error?: string;
}

const jobs = new Map<string, Job>();

export function enqueue(agent: H1dr4Agent, message: string): string {
  const id = uuidv4();
  jobs.set(id, { status: 'pending' });
  agent
    .processUserMessage(message)
    .then(entries => {
      jobs.set(id, { status: 'complete', result: entries });
    })
    .catch(err => {
      jobs.set(id, { status: 'error', error: err.message });
    });
  return id;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
