import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { H1dr4Agent } from '../src/agent/h1dr4-agent';
import { hasAccess } from './auth';
import { enqueue, getJob } from './jobs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const inst = (req.header('x-instance-id') || 'default');
      const dest = path.join(__dirname, '..', 'uploads', inst);
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
});

const agents = new Map<string, H1dr4Agent>();

// Authentication middleware
app.use(async (req, res, next) => {
  const userKey = req.header('x-grok-key');
  if (userKey) {
    (req as any).grokKey = userKey;
    (req as any).limited = true;
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
  let { message, instanceId, background } = req.body as { message?: string; instanceId?: string; background?: boolean };
  if (!message) return res.status(400).json({ error: 'Missing message' });
  instanceId = instanceId || uuidv4();
  try {
    let agent = agents.get(instanceId);
    if (!agent) {
      agent = new H1dr4Agent((req as any).grokKey, undefined, undefined, undefined, {
        enableOsint: !(req as any).limited,
        enableReasoning: !(req as any).limited,
      });
      agents.set(instanceId, agent);
    }
    if (background) {
      const jobId = enqueue(agent, message);
      return res.json({ jobId, instanceId });
    }
    const entries = await agent.processUserMessage(message);
    res.json({ entries, instanceId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ path: req.file.path });
});

app.get('/status/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

app.use(express.static(path.join(__dirname, '..', 'web', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
