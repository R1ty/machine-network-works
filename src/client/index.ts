import Pusher from "pusher-js";
import dotenv from "dotenv";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

dotenv.config();

const SERVER_URL = process.env.SERVER_URL;
const workerId = crypto.randomUUID();

const pusher = new Pusher(process.env.APP_KEY!, {
  cluster: process.env.APP_CLUSTER!,
});

function getPublicIP(): Promise<string> {
  return new Promise((resolve) => {
    exec("curl -4 ipconfig.io", (error, stdout) => {
      if (error) {
        console.error("❌ Erro ao pegar IP:", error);
        resolve("0.0.0.0");
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// 🔥 Registra o worker via HTTP ao conectar
pusher.connection.bind("connected", async () => {
  const ip = await getPublicIP();

  await fetch(`${SERVER_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId, ip }),
  });

  console.log("🟢 Worker conectado:", workerId, "IP:", ip);
});

// 🔥 Recebe job e responde
const channel = pusher.subscribe("workers");

channel.bind("job", async (data: any) => {
  if (data.workerId !== workerId) return;

  console.log("📦 Processando job:", data.requestId, data.payload);

  let result: any;

  const type = data.payload?.type ?? "ping";
  const payloadData = data.payload?.data ?? "";

  if (type === "ping") {
    try {
      const { stdout } = await execAsync("ping -c 4 google.com.br");
      result = { type: "ping", output: stdout };
    } catch (err: any) {
      result = { type: "ping", error: err.message };
    }

} else if (type === "proxy") {
  try {
    const response = await fetch(
      `${process.env.API_CPF}/api/consulta?cpf=25221816881`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-site",
          "Origin": process.env.API_CPF as string,
          "Sec-Fetch-Mode": "cors",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
          "Accept-Language": "pt-BR,pt;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Sec-Fetch-Dest": "empty",
          "Priority": "u=3, i",
          "X-API-KEY": process.env.TOKEN_CPF as string,
        },
      }
    );

    const text = await response.text();
    result = { type: "proxy", status: response.status, body: text };
  } catch (err: any) {
    result = { type: "proxy", error: err.message };
  }
} else {
  result = { error: `Tipo desconhecido: ${type}` };
}

/*

  try {
      const response = await axios.get(
        "https://apicpf.com/api/consulta",
        {
          params: {
            cpf: data.payload.data
          },
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Sec-Fetch-Site": "same-site",
            "Origin": "https://www.apicpf.com",
            "Sec-Fetch-Mode": "cors",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1/15",
            "Accept-Language": "pt-BR,pt;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "empty",
            "Priority": "u=3, i",
            "X-API-KEY": "3370051f4eaa75bf6dd8f4740f2c8fe346586ff089b858f05bbb8f28fb6e2c56"
          }
        }
      );

      result = { type: "proxy", status: response.status, body: response.data };
    } catch (error) {
      result = { type: "proxy", error: error };
    }

*/



  const ip = await getPublicIP();

  await fetch(`${SERVER_URL}/worker-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: data.requestId, result, workerId, ip }),
  });
});

// Worker — manda heartbeat a cada 15s
setInterval(async () => {
  await fetch(`${SERVER_URL}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId }),
  });
}, 15000);

