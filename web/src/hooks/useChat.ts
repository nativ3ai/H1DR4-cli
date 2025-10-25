import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAccount } from 'wagmi';
import { useJobs } from './useJobs';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function useChat(grokKey?: string | null) {
  const { address } = useAccount();
  const [instances, setInstances] = useState<string[]>(() => {
    const stored = localStorage.getItem('instances');
    return stored ? JSON.parse(stored) : [];
  });
  const [current, setCurrent] = useState<string>(() => {
    const stored = localStorage.getItem('currentInstance');
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem('currentInstance', id);
    return id;
  });
  const [messages, setMessages] = useState<Record<string, Message[]>>(() => {
    const stored = localStorage.getItem('messages');
    return stored ? JSON.parse(stored) : {};
  });

  useEffect(() => {
    localStorage.setItem('instances', JSON.stringify(instances));
  }, [instances]);
  useEffect(() => {
    localStorage.setItem('currentInstance', current);
  }, [current]);
  useEffect(() => {
    localStorage.setItem('messages', JSON.stringify(messages));
  }, [messages]);

  const headers: Record<string, string> = grokKey
    ? { 'x-grok-key': grokKey }
    : address
    ? { 'x-wallet-address': address }
    : {};

  const { trackJob } = useJobs(headers, (id, msg) => {
    setMessages(prev => ({ ...prev, [id]: [...(prev[id] || []), msg] }));
  });

  function createInstance() {
    const id = crypto.randomUUID();
    setInstances(prev => [...prev, id]);
    setMessages(prev => ({ ...prev, [id]: [] }));
    setCurrent(id);
  }

  function addMessage(id: string, msg: Message) {
    setMessages(prev => ({ ...prev, [id]: [...(prev[id] || []), msg] }));
  }

  async function sendMessage(content: string, background = false) {
    addMessage(current, { role: 'user', content });
    const res = await axios.post(
      '/chat',
      { message: content, instanceId: current, background },
      { headers }
    );
    if (res.data.jobId) {
      trackJob(res.data.jobId, current);
    } else if (res.data.entries) {
      res.data.entries.forEach((e: any) =>
        addMessage(current, { role: 'assistant', content: e.content })
      );
    }
  }

  return { instances, current, setCurrent, createInstance, messages, sendMessage };
}
