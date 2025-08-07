import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import crypto from "crypto";
import "dotenv/config";
import fetch from "node-fetch";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const isProd = process.env.NODE_ENV === "production";

const pendingRequests = new Map();
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

    // const request_id = crypto.randomUUID();
    // pendingRequests.set(request_id, consoleCtx);
    // //send a instruction here:
    // const prompt = `You are a great explainer that explain words for the user. Here are the requiements for later explanation:
    // Now try the first word: 'apple'.
    // `

    // ws.send(
    //   JSON.stringify({
    //     type: "response.create",
    //     response: {
    //       modalities: ["text"],
    //       instructions: prompt,
    //       metadata: { request_id: request_id }
    //     }
    //   })
    // );
    // console.log("Initial instruction sent:", prompt);

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

// Console as a context
// Define a console context with a .res.json method that logs to the console
const consoleCtx = {
  res: {
    json: (payload) => {
      // Print with color or style if you want
      console.log("\x1b[33m[AI Browser Console Response]\x1b[0m", payload);
    }
  }
};

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
    console.error(data);
    ws.close();
    return;
  }
  // This block handles mapping response.id (from OpenAI) to our pending request
  if (data.type === "response.created" && data.response && data.response.id) {
    const openaiResponseId = data.response.id;
    const request_id = data.response.metadata?.request_id;
    const ctx = pendingRequests.get(request_id);
    if (ctx) {
      console.log(`> delete ${request_id} because response has been created '${ctx.word}'`);
      pendingRequests.delete(request_id);
      console.log(`>> set ${openaiResponseId} for request ${request_id} '${ctx.word}'`);
      pendingResponses.set(openaiResponseId, ctx);
    } else {
      console.warn("No pending context for request", request_id);
    }
  }
  // Match by metadata.request_id
  if (data.type === "response.text.done") {
    const { response_id, text } = data;
    const ctx = pendingResponses.get(response_id);
    if (!ctx) {
      console.warn("No pending context for response", response_id);
      return;
    }
    let word = "", region = "", explanation = "", sentence = "";
    try {
      const ai = JSON.parse(text);
      word = ai.word || "";
      region = ai.region || "--";
      explanation = ai.explanation || "";
      sentence = ai.sentence || "";
    } catch (e) {
      word = "error";
      region = "--";
      explanation = text;
      sentence = "";
    }
    const payload = { word, region, explanation, sentence };
    const cachePath = textCachePath(word.trim().toLowerCase());
    fs.writeFileSync(cachePath, JSON.stringify(payload), "utf8");
    ctx.resolve && ctx.resolve(payload);
    ctx.res && ctx.res.json(payload);
    console.log(`>> delete ${response_id} after processing it.`);
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
        region: cached.region || "--",
        explanation: cached.explanation,
        sentence: cached.sentence,
      };
    } catch (e) {
      // Corrupt cache, ignore
    }
  }

  // Otherwise, request from OpenAI and wait
  // const prompt = `Explain the word "${trimmed}" for English learners. Provide a natural example sentence using the word. Also, include a 2-letter regional code for where the word is mostly used (e.g., SG for Singapore, or "--" for globally standard English). Respond only in this strict JSON format: {"word": "...", "region": "..", "explanation": "...", "sentence": "..."}`;
  const prompt = `
Explain the word "${trimmed}" in JSON format:
{"word": "...", "region": "..", "explanation": "...", "sentence": "..."}
Requirement:
  - "word": The dictionary or base form of the word (e.g., "go" for "went", "child" for "children", or same as "word" if already standard).
  - "region": A 2-letter code indicating where the word is mostly used (e.g., "SG" for Singapore, or "--" for globally standard English).
  - "explanation": A clear explanation in the style of Vocabulary.com. Use only simple and familiar words for basic vocabulary, but allow more detailed for the rest.
  - "sentence": A natural example sentence using the word.
Respond ONLY with the strict JSON object, with NO code block, NO backticks, and NO extra content—just the raw JSON.`;
  const request_id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    console.log(`> set ${request_id} for word '${trimmed}'`);
    pendingRequests.set(request_id, { resolve, reject, word: trimmed });
    console.log(`>>> send requset for '${trimmed}'`);
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: prompt,
          metadata: { request_id: request_id }
        }
      })
    );
    setTimeout(() => {
      if (pendingRequests.has(request_id)) {
        console.log(`> deleting ${request_id} due to OpenAI timeout`);
        pendingRequests.delete(request_id);
        reject(new Error("OpenAI timeout"));
      }
    }, 20000);
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
  console.log(`[API] Define called for word: ${word} (nocache: ${nocache})`);
  if (!word || typeof word !== "string" || word.length > 64)
    return res.status(400).json({ error: "Invalid word" });
  try {
    const result = await getOrFetchWordData(word, { nocache });
    console.log(`[API] Result for "${word}":`, result);
    res.json(result);
    // Background audio
    generateAndCacheAudio(result.word).catch(() => { });
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
      region: result.region,
      explanation: result.explanation,
      sample_sentence: result.sentence,
    });
  } catch (e) {
    res.status(504).json({ error: "OpenAI API failed" });
  }
});

// --- Serve static files / SSR ---
if (isProd) {
  // Serve static files, but NOT index.html!
  app.use((req, res, next) => {
    if (req.path === "/" || req.path.endsWith(".html")) return next();
    express.static(path.join(__dirname, "dist/client"))(req, res, next);
  });
  app.use("*", async (req, res) => {
    const template = fs.readFileSync(
      path.join(__dirname, "dist/client/index.html"),
      "utf-8"
    );
    const entryServerFileUrl = pathToFileURL(
      path.join(__dirname, "dist/server/entry-server.js")
    ).href;
    const { render } = await import(entryServerFileUrl);
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
      const entryServerFileUrl = pathToFileURL(
        path.join(__dirname, "client/entry-server.jsx")
      ).href;
      const { render } = await vite.ssrLoadModule(entryServerFileUrl);
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
