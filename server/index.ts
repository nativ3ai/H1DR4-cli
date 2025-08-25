import express from 'express';
import dotenv from 'dotenv';
import { H1dr4Agent } from '../src/agent/h1dr4-agent';
import { hasAccess } from './auth';

dotenv.config();

const app = express();
app.use(express.json());

// Authentication middleware
app.use(async (req, res, next) => {
  const userKey = req.header('x-grok-key');
  if (userKey) {
    (req as any).grokKey = userKey;
    return next();
  }
  const address = req.header('x-wallet-address');
  if (!address) return res.status(401).json({ error: 'Wallet address required' });
  try {
    const allowed = await hasAccess(address);
    if (!allowed) return res.status(403).json({ error: 'Access denied' });
    (req as any).grokKey = process.env.GROK_API_KEY;
    next();
  } catch {
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/chat', async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) return res.status(400).json({ error: 'Missing message' });
  try {
    const agent = new H1dr4Agent((req as any).grokKey);
    const entries = await agent.processUserMessage(message);
    res.json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
