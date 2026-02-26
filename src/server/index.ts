import express, { Request, Response } from "express";
import Pusher from "pusher";
import PusherClient from "pusher-js";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

const pusher = new Pusher({
  appId: process.env.APP_ID as string,
  key: process.env.APP_KEY as string,
  secret: process.env.APP_SECRET as string,
  cluster: process.env.APP_CLUSTER as string,
  useTLS: true,
});

const internalClient = new PusherClient(process.env.APP_KEY!, {
  cluster: process.env.APP_CLUSTER!,
});

interface WorkerInfo {
  ip: string;
  totalRequests: number;
  lastJobAt: Date | null;
  lastSeen: Date | null;
}

const workers = new Map<string, WorkerInfo>();
const pendingRequests = new Map<string, (data: any) => void>();

let lastSelectedWorkerId: string | null = null;

// 🔥 Helper: remove worker e corrige lastSelected
function removeWorker(id: string) {
  workers.delete(id);
  if (lastSelectedWorkerId === id) {
    lastSelectedWorkerId = null;
  }
  console.log("❌ Worker removido:", id);
}

// 🔥 Helper: próximo worker sequencial
function getNextSequentialId(): string | null {
  const ids = Array.from(workers.keys());
  if (ids.length === 0) return null;
  if (!lastSelectedWorkerId || !workers.has(lastSelectedWorkerId)) {
    return ids[0];
  }
  const currentIndex = ids.indexOf(lastSelectedWorkerId);
  return ids[(currentIndex + 1) % ids.length];
}

// 🔥 Escuta registros via Pusher
const channel = internalClient.subscribe("workers");
channel.bind("register", (data: any) => {
  if (!workers.has(data.workerId)) {
    workers.set(data.workerId, {
      ip: data.ip,
      totalRequests: 0,
      lastJobAt: null,
      lastSeen: new Date(),
    });
    console.log("✅ Worker registrado via Pusher:", data.workerId, data.ip);
  }
});

// 🔥 Registro via HTTP
app.post("/register", (req: Request, res: Response) => {
  const { workerId, ip } = req.body;

  // Remove qualquer worker com o mesmo IP
  for (const [id, info] of workers.entries()) {
    if (info.ip === ip && id !== workerId) {
      console.log(`⚠️ IP duplicado no registro, removendo worker antigo: ${id}`);
      removeWorker(id);
    }
  }

  workers.set(workerId, {
    ip,
    totalRequests: 0,
    lastJobAt: null,
    lastSeen: new Date(),
  });
  console.log("✅ Worker registrado:", workerId, ip);
  res.sendStatus(200);
});

// 🔥 Resposta do worker (com atualização de IP)
app.post("/worker-response", (req: Request, res: Response) => {
  const { requestId, result, workerId, ip } = req.body;

  if (ip && workerId && workers.has(workerId)) {
    // Remove qualquer outro worker com o mesmo IP
    for (const [id, info] of workers.entries()) {
      if (info.ip === ip && id !== workerId) {
        console.log(`⚠️ IP duplicado na resposta, removendo worker antigo: ${id}`);
        removeWorker(id);
      }
    }
    const w = workers.get(workerId)!;
    w.ip = ip;
    w.lastSeen = new Date();
  }

  if (pendingRequests.has(requestId)) {
    pendingRequests.get(requestId)!(result);
    pendingRequests.delete(requestId);
  }

  res.sendStatus(200);
});

// 💓 Heartbeat
app.post("/heartbeat", (req: Request, res: Response) => {
  const { workerId } = req.body;
  if (workers.has(workerId)) {
    workers.get(workerId)!.lastSeen = new Date();
  }
  res.sendStatus(200);
});

// 📋 Lista workers
app.get("/workers", (req: Request, res: Response) => {
  const nextSequentialId = getNextSequentialId();
  const ids = Array.from(workers.keys());

  const list = ids.map((id) => {
    const w = workers.get(id)!;
    return {
      workerId: id,
      ip: w.ip,
      totalRequests: w.totalRequests,
      lastJobAt: w.lastJobAt,
      lastSeen: w.lastSeen,
      isLastSelected: id === lastSelectedWorkerId,
      isNextSequential: id === nextSequentialId,
    };
  });

  res.json({
    total: list.length,
    lastSelected: lastSelectedWorkerId,
    nextSequential: nextSequentialId,
    workers: list,
  });
});

// 🚀 Endpoint principal
app.post("/execute", async (req: Request, res: Response) => {
  if (workers.size === 0) {
    return res.status(500).json({ error: "Nenhum worker conectado" });
  }

  const body = req.body ?? {};
  const mode = body.mode ?? (req.query.mode as string) ?? "sequential";
  const targetIp = body.targetIp ?? (req.query.targetIp as string);
  const requestId = crypto.randomUUID();
  const workerIds = Array.from(workers.keys());

  let selectedWorkerId: string | null = null;

  if (mode === "ip") {
    if (!targetIp) {
      return res.status(400).json({ error: "Informe targetIp para modo ip" });
    }
    const found = workerIds.find((id) => workers.get(id)!.ip === targetIp);
    if (!found) {
      return res.status(404).json({ error: `Nenhum worker com IP ${targetIp}` });
    }
    selectedWorkerId = found;

  } else if (mode === "random") {
    selectedWorkerId = workerIds[Math.floor(Math.random() * workerIds.length)];

  } else if (mode === "sequential") {
    selectedWorkerId = getNextSequentialId();

  } else {
    return res.status(400).json({ error: "mode inválido. Use: random, sequential ou ip" });
  }

  const workerInfo = workers.get(selectedWorkerId!)!;
  workerInfo.totalRequests += 1;
  workerInfo.lastJobAt = new Date();
  lastSelectedWorkerId = selectedWorkerId;

  console.log(`➡️ [${mode || "sequential"}] Enviando job para: ${selectedWorkerId} (${workerInfo.ip})`);

  const responsePromise = new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
  });

await pusher.trigger("workers", "job", {
  workerId: selectedWorkerId,
  requestId,
  payload: {
    ...body,
    type: body.type ?? (req.query.type as string) ?? "ping",
    data: body.data ?? (req.query.data as string),
  },
});

  const result = await responsePromise;
  return res.json({ result, selectedWorker: selectedWorkerId });
});

// 🔔 Pusher webhook (channel_vacated)
app.post("/pusher/webhook", (req: Request, res: Response) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.name === "channel_vacated" && event.channel === "workers") {
      console.log("⚠️ Canal workers esvaziou — limpando workers");
      workers.clear();
      lastSelectedWorkerId = null;
    }
  }
  res.sendStatus(200);
});

// ⏱️ Remove workers sem heartbeat por +30s
setInterval(() => {
  const now = new Date();
  for (const [id, info] of workers.entries()) {
    const diff = now.getTime() - (info.lastSeen?.getTime() ?? 0);
    if (diff > 30000) {
      removeWorker(id);
    }
  }
}, 20000);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server rodando na porta ${PORT}`);
});