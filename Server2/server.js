import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import "dotenv/config";
import fetch from "node-fetch";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const isProd = process.env.NODE_ENV === "production";

const pendingResponses = new Map();
const outgoingTTSRequests = new Map();

let ws;
let wsConnecting = false;

// --- WebSocket Connection ---
function connectWebSocket() {
  ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: "Bearer " + apiKey,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );
  ws.on("open", () => {
    console.log("Connected to OpenAI Realtime WebSocket.");
    wsConnecting = false;
  });
  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
  ws.on("close", (code, reason) => {
    console.warn("WebSocket closed. Code:", code, "Reason:", reason.toString());
    console.log("Reconnecting...");
    if (!wsConnecting) {
      wsConnecting = true;
      setTimeout(connectWebSocket, 1000);
    }
  });
  ws.on("message", handleWebSocketMessage);
}

// --- Cache Helpers ---
function hashKey(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}
function textCachePath(word) {
  const folder = path.join(__dirname, "text-cache");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `${hashKey(word)}.json`);
}
function audioCachePath(text, voice = "nova") {
  const folder = path.join(__dirname, "audio-cache");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `${hashKey(text + voice)}.mp3`);
}

// --- WebSocket Message Handler ---
function handleWebSocketMessage(message) {
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (err) {
    console.error("Parsing message error:", err, "\n", message?.toString());
    return;
  }
  if (data.type === "error") {
    if (data.error.code === "session_expired") {
    }
    ws.close();
    return;
  }
  if (data.type === "response.created") {
    const ctx = (global.outgoingQueue || []).shift();
    if (!ctx) return;
    pendingResponses.set(data.response.id, ctx);
  }
  if (data.type === "response.text.done") {
    const { response_id, text } = data;
    const ctx = pendingResponses.get(response_id);
    if (!ctx) return;
    let word = "", explanation = "", sentence = "";
    try {
      const ai = JSON.parse(text);
      word = ai.word || "";
      explanation = ai.explanation || "";
      sentence = ai.sentence || "";
    } catch (e) {
      word = "error";
      explanation = text;
      sentence = "";
    }
    const payload = { word, explanation, sentence };
    const cachePath = textCachePath(word.trim().toLowerCase());
    fs.writeFileSync(cachePath, JSON.stringify(payload), "utf8");
    ctx.resolve && ctx.resolve(payload);
    ctx.res && ctx.res.json(payload);
    pendingResponses.delete(response_id);
  }
}

// --- Audio TTS Helper ---
async function generateAndCacheAudio(text, voice = "nova") {
  if (!text) return;
  const cachePath = audioCachePath(text, voice);
  if (fs.existsSync(cachePath)) return;
  const key = text + "::" + voice;
  if (outgoingTTSRequests.has(key)) {
    return outgoingTTSRequests.get(key);
  }
  const promise = (async () => {
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: text,
          voice,
          instructions: "",
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }
      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(cachePath);
        response.body.pipe(dest);
        response.body.on("error", reject);
        dest.on("finish", resolve);
        dest.on("error", reject);
      });
    } finally {
      outgoingTTSRequests.delete(key);
    }
  })();
  outgoingTTSRequests.set(key, promise);
  return promise;
}

// --- Core Helper: Get/Fetch Word Data ---
async function getOrFetchWordData(word, { nocache = false } = {}) {
  const trimmed = word.trim().toLowerCase();
  const cachePath = textCachePath(trimmed);
  // Try cache first
  if (!nocache && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      return {
        word: cached.word,
        explanation: cached.explanation,
        sentence: cached.sentence,
      };
    } catch (e) {
      // Corrupt cache, ignore
    }
  }

  // Otherwise, request from OpenAI and wait
  const prompt = `Explain the word "${trimmed}" simply for English learners and give a natural sample sentence using it. Respond in strict JSON: {"word": "...", "explanation": "...", "sentence": "..."}`;
  return new Promise((resolve, reject) => {
    const pendingRequest = { res: null, word, resolve };
    if (!global.outgoingQueue) global.outgoingQueue = [];
    global.outgoingQueue.push(pendingRequest);
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: prompt,
        },
      })
    );
    setTimeout(() => reject(new Error("OpenAI timeout")), 20000);
  });
}

// --- Express Middleware & Routes ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600 * 1000 },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static('public'));

// --- Serve cached audio (waits if not ready) ---
app.get("/api/audio", async (req, res) => {
  const { text, voice = "nova" } = req.query;
  if (!text) return res.status(400).end("Missing text");
  const cachePath = audioCachePath(text, voice);
  if (!fs.existsSync(cachePath)) {
    try {
      await generateAndCacheAudio(text, voice);
    } catch (err) {
      return res.status(500).end("Audio generation failed");
    }
  }
  if (fs.existsSync(cachePath)) {
    res.setHeader("Content-Type", "audio/mpeg");
    fs.createReadStream(cachePath).pipe(res);
  } else {
    res.status(500).end("Audio still not available");
  }
});

// --- /api/define: For browser frontend, session required, supports nocache, triggers audio ---
app.post("/api/define", async (req, res) => {
  if (!req.session) return res.status(403).json({ error: "No session" });
  const { word, nocache } = req.body;
  if (!word || typeof word !== "string" || word.length > 64)
    return res.status(400).json({ error: "Invalid word" });
  try {
    const result = await getOrFetchWordData(word, { nocache });
    res.json(result);
    // Background audio
    generateAndCacheAudio(result.word).catch(() => {});
    // generateAndCacheAudio(result.explanation).catch(() => {});
    // generateAndCacheAudio(result.sentence).catch(() => {});
  } catch (e) {
    res.status(504).json({ error: "OpenAI API failed" });
  }
});

// --- /lookup: For devices, no session, no audio ---
app.post("/lookup", async (req, res) => {
  const { word } = req.body;
  if (!word || typeof word !== "string" || word.length > 64)
    return res.status(400).json({ error: "Invalid word" });
  try {
    const result = await getOrFetchWordData(word);
    res.json({
      word: result.word,
      explanation: result.explanation,
      sample_sentence: result.sentence,
    });
  } catch (e) {
    res.status(504).json({ error: "OpenAI API failed" });
  }
});

// --- Serve static files / SSR ---
if (isProd) {
  app.use(express.static(path.join(__dirname, "dist/client")));
  app.use("*", async (req, res) => {
    const template = fs.readFileSync(
      path.join(__dirname, "dist/client/index.html"),
      "utf-8"
    );
    const { render } = await import(
      path.join(__dirname, "dist/server/entry-server.js")
    );
    const appHtml = render().html;
    const html = template.replace("<!--ssr-outlet-->", appHtml);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      const template = await vite.transformIndexHtml(
        req.originalUrl,
        fs.readFileSync(path.join(__dirname, "index.html"), "utf-8")
      );
      const { render } = await vite.ssrLoadModule(
        path.join(__dirname, "client/entry-server.jsx")
      );
      const appHtml = render().html;
      const html = template.replace("<!--ssr-outlet-->", appHtml);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}

// --- Start OpenAI realtime API ws connection ---
connectWebSocket();

let listen_host = "localhost";
app.listen(port, listen_host, () => {
  console.log(`Server running on http://${listen_host}:${port} (LAN accessible)`);
});
