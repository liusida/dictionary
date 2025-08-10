import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import crypto from "crypto";
import "dotenv/config";
import fetch from "node-fetch";
import WebSocket from "ws";

// =========================================================
// Environment & App Setup
// =========================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const isProd = process.env.NODE_ENV === "production";

if (!apiKey) {
  console.warn("[BOOT] Missing OPENAI_API_KEY — server can start but related endpoints will fail.");
}

// ---------------------------------------------------------
// Global State (logs preserved)
// ---------------------------------------------------------
const OpenAIWebsockets = new Map();        // sessionID -> WebSocket
const pendingRequests = new Map();         // request_id -> { resolve, reject, word }
const pendingResponses = new Map();        // response_id -> ctx
const outgoingTTSRequests = new Map();     // audioKey -> inflight Promise
const BeaconStates = new Map();            // sessionID -> { current, next, running }
const CooldownTimers = new Map();          // sessionID -> timeout handle for delayed cooldown

// =========================================================
/** Lightweight logging helpers */
// =========================================================
const log = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
};

// =========================================================
// Cache Helpers
// =========================================================
function hashKey(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function textCachePath(word) {
  const folder = path.join(__dirname, "text-cache");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `${hashKey(word)}.json`);
}

function audioKey(word, type, voice = "nova") {
  const w = String(word || "").trim().toLowerCase();
  const t = String(type || "word").trim().toLowerCase();
  const v = String(voice || "nova").trim().toLowerCase();
  return `${w}||${t}||${v}||v1`;
}

function audioCachePathByKey(key) {
  const folder = path.join(__dirname, "audio-cache-v2");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `${hashKey(key)}.mp3`);
}

// =========================================================
// WebSocket: Connect + Lifecycle
// =========================================================
function connectWebSocket(sessionID) {
  log.info(`Connect websocket for session ${sessionID}.`);
  const ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: "Bearer " + apiKey,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  ws.sessionID = sessionID;
  OpenAIWebsockets.set(sessionID, ws);

  ws.on("open", () => {
    log.info(`Connected to OpenAI Realtime WebSocket for session ${ws.sessionID}.`);
  });

  ws.on("error", (err) => {
    log.error("WebSocket error:", err);
  });

  ws.on("close", (code, reason) => {
    log.warn(
      `WebSocket closed for session ${ws.sessionID}.`,
      "Code:", code, "Reason:", reason?.toString?.() || String(reason)
    );
    OpenAIWebsockets.delete(ws.sessionID);
    // skip auto-reconnect; /prewarm will handle it
  });

  ws.on("message", (message) => handleWebSocketMessage(message, ws));
  return ws;
}

function waitForOpen(ws, timeoutMs = 5000) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onOpen = () => cleanup(resolve);
    const onErr = (err) => cleanup(() => reject(err));
    const onClose = () => cleanup(() => reject(new Error("WS closed before open")));
    const timer = setTimeout(() => cleanup(() => reject(new Error("WS open timeout"))), timeoutMs);

    function cleanup(cb) {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onErr);
      ws.off("close", onClose);
      cb && cb();
    }

    ws.once("open", onOpen);
    ws.once("error", onErr);
    ws.once("close", onClose);
  });
}

async function getOrCreateWebSocket(sessionID, timeoutMs = 5000) {
  let ws = OpenAIWebsockets.get(sessionID);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    ws = connectWebSocket(sessionID); // may be CONNECTING
  }
  if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
    ws = connectWebSocket(sessionID);
  }
  await waitForOpen(ws, timeoutMs);
  return ws;
}

// =========================================================
// WebSocket: Message Handling
// =========================================================
function handleWebSocketMessage(message, ws) {
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (err) {
    log.error("Parsing message error:", err, "\n", message?.toString());
    return;
  }

  if (data.type === "error") {
    if (data.error?.code === "session_expired") {
      // we could re-establish here if desired
    }
    log.error(data);
    ws.close();
    return;
  }

  // Map response.id (OpenAI) -> original pending request ctx
  if (data.type === "response.created" && data.response?.id) {
    const openaiResponseId = data.response.id;
    const request_id = data.response.metadata?.request_id;
    const ctx = pendingRequests.get(request_id);
    if (ctx) {
      log.info(`> [${pendingRequests.size}] delete ${request_id} because response has been created '${ctx.word}'`);
      pendingRequests.delete(request_id);
      log.info(`>> [${pendingResponses.size}] set ${openaiResponseId} for request ${request_id} '${ctx.word}'`);
      pendingResponses.set(openaiResponseId, ctx);
    } else {
      log.warn("No pending context for request", request_id);
    }
  }

  if (data.type === "response.text.done") {
    const { response_id, text } = data;
    const ctx = pendingResponses.get(response_id);
    if (!ctx) {
      log.warn("No pending context for response", response_id);
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
    log.info(`>> [${pendingResponses.size}] delete ${response_id} after processing it.`);
    pendingResponses.delete(response_id);
  }
}

// =========================================================
// Beacon Queue: currentBeacon + nextBeacon per session
// With delayed cooldown to prevent open/close flapping
// =========================================================
function getBeaconState(sessionID) {
  let s = BeaconStates.get(sessionID);
  if (!s) {
    s = { current: null, next: null, running: false };
    BeaconStates.set(sessionID, s);
  }
  return s;
}

function scheduleBeacon(sessionID, kind, { cooldownDelayMs = 1500 } = {}) {
  const s = getBeaconState(sessionID);

  if (kind === "prewarm") {
    // Cancel any pending delayed cooldown
    const t = CooldownTimers.get(sessionID);
    if (t) {
      clearTimeout(t);
      CooldownTimers.delete(sessionID);
      log.info(`[Beacon] Canceled pending cooldown for ${sessionID} due to prewarm.`);
    }
    s.next = { kind, ts: Date.now() }; // overwrite next slot
    processBeacons(sessionID).catch((e) =>
      log.warn(`Beacon processor error for ${sessionID}:`, e.message)
    );
    return;
  }

  if (kind === "cooldown") {
    // Debounce cooldown: schedule after a short delay; a prewarm within the window cancels it
    const existing = CooldownTimers.get(sessionID);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      CooldownTimers.delete(sessionID);
      const st = getBeaconState(sessionID);
      st.next = { kind: "cooldown", ts: Date.now() };
      log.info(`[Beacon] Enqueuing delayed cooldown for ${sessionID}.`);
      processBeacons(sessionID).catch((e) =>
        log.warn(`Beacon processor error for ${sessionID}:`, e.message)
      );
    }, cooldownDelayMs);

    CooldownTimers.set(sessionID, timer);
    log.info(`[Beacon] Scheduled cooldown in ${cooldownDelayMs}ms for ${sessionID}.`);
    return;
  }

  // Fallback/other kinds
  s.next = { kind, ts: Date.now() };
  processBeacons(sessionID).catch((e) =>
    log.warn(`Beacon processor error for ${sessionID}:`, e.message)
  );
}

async function processBeacons(sessionID) {
  const s = getBeaconState(sessionID);
  if (s.running) return;
  s.running = true;
  try {
    while (true) {
      if (!s.current) {
        if (!s.next) break;
        s.current = s.next;
        s.next = null;
      }

      const b = s.current;
      if (b.kind === "prewarm") {
        try {
          await getOrCreateWebSocket(sessionID);
        } catch (e) {
          log.warn(`prewarm failed for ${sessionID}:`, e.message);
        }
      } else if (b.kind === "cooldown") {
        const ws = OpenAIWebsockets.get(sessionID);
        if (ws) {
          try {
            ws.close(1000, "cooldown");
          } catch (err) {
            log.warn("Cooldown close error:", err.message);
          }
          OpenAIWebsockets.delete(sessionID);
        }
      } else {
        log.warn("Unknown beacon kind:", b.kind);
      }

      // Done with current; allow promotion of any queued next
      s.current = null;
    }
  } finally {
    s.running = false;
  }
}

// =========================================================
// Core OpenAI Helpers (definitions + audio)
// =========================================================
async function getOrFetchWordData(word, ws, { nocache = false } = {}) {
  const trimmed = word.trim().toLowerCase();
  const cachePath = textCachePath(trimmed);

  // 1) Try cache first
  if (!nocache && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      log.info(`Text-cache hit for '${trimmed}'.`);
      return {
        word: cached.word,
        region: cached.region || "--",
        explanation: cached.explanation,
        sentence: cached.sentence,
      };
    } catch (e) {
      log.warn(`The cache file for '${trimmed}' is corrupted, ignoring the cache. ${cachePath}`);
    }
  }

  // 2) Otherwise, call OpenAI via realtime WS
  const prompt = `
Okay, forget all previous words in our conversation, if any. We are now turning to a new word.
Now, explain this word/phrase "${trimmed}" in JSON format:
{"word": "...", "region": "..", "explanation": "...", "sentence": "..."}
Requirement:
  - "word": The dictionary or base form of the word (e.g., "go" for "went", "child" for "children", or same as "word" if already standard).
  - "region": A 2-letter code indicating where the word is mostly used (e.g., "SG" for Singapore, or "--" for globally standard English).
  - "explanation": A clear explanation in the style of Vocabulary.com. Use only simple and familiar words for basic vocabulary, but allow more detailed for the rest.
  - "sentence": A natural example sentence using the word.
Respond ONLY with the strict JSON object, with NO code block, NO backticks, and NO extra content—just the raw JSON.`;

  const request_id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    log.info(`> [${pendingRequests.size}] set ${request_id} for word '${trimmed}'`);
    pendingRequests.set(request_id, { resolve, reject, word: trimmed });

    log.info(`>>> send request for '${trimmed}' for session ${ws.sessionID}`);
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: prompt,
          metadata: { request_id },
        },
      })
    );

    setTimeout(() => {
      if (pendingRequests.has(request_id)) {
        log.info(`> [${pendingRequests.size}] deleting ${request_id} due to OpenAI timeout`);
        pendingRequests.delete(request_id);
        reject(new Error("OpenAI timeout"));
      }
    }, 20000);
  });
}

async function generateAndCacheAudio({ key, text, voice = "nova" }) {
  if (!text) return;
  const cachePath = audioCachePathByKey(key);
  if (fs.existsSync(cachePath)) return;

  if (outgoingTTSRequests.has(key)) return outgoingTTSRequests.get(key);
  log.info(`OpenAI API call for generating audio '${text.slice(0, 20)}'`);

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

      if (!response.ok || !response.body) throw new Error(`TTS failed: ${response.statusText}`);

      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(cachePath);
        log.info(`audio generated '${text.slice(0, 20)}'`);
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

function invalidateExplanationAndSample(word, voice = "nova") {
  const w = String(word || "").trim().toLowerCase();
  for (const t of ["explanation", "sample"]) {
    const key = audioKey(w, t, voice);
    const p = audioCachePathByKey(key);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        log.info(`Audio cache invalidated: ${key}`);
      }
    } catch (e) {
      log.warn(`Failed to remove audio cache ${p}:`, e.message);
    }
  }
}

// =========================================================
// Express: Middleware
// =========================================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600 * 1000 },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// =========================================================
// Express: Shared Audio Handler
// =========================================================
async function ensureAndStreamAudio({ wordInput, typeInput = "word", sessionID }, res) {
  // Validate
  if (!wordInput || typeof wordInput !== "string" || wordInput.length > 64) {
    return res.status(400).end("Invalid word");
  }
  const word = wordInput.trim().toLowerCase();
  const type = String(typeInput).trim().toLowerCase();
  if (!["word", "explanation", "sample"].includes(type)) {
    return res.status(400).end("Invalid type");
  }

  const voice = "nova";
  const key = audioKey(word, type, voice);
  const cachePath = audioCachePathByKey(key);

  // Serve from cache if present
  if (fs.existsSync(cachePath)) {
    log.info(`Audio-cache hit for key '${key}'`);
    res.setHeader("Content-Type", "audio/mpeg");
    return fs.createReadStream(cachePath).pipe(res);
  }

  // Cache miss — decide text
  let textToSpeak;
  if (type === "word") {
    textToSpeak = word;
  } else {
    try {
      const ws = await getOrCreateWebSocket(sessionID);
      const data = await getOrFetchWordData(word, ws);
      textToSpeak = type === "explanation" ? (data.explanation || word) : (data.sentence || word);
    } catch {
      return res.status(503).end("Definition unavailable");
    }
  }

  // Generate then stream
  try {
    await generateAndCacheAudio({ key, text: textToSpeak, voice });
  } catch {
    return res.status(500).end("Audio generation failed");
  }

  if (fs.existsSync(cachePath)) {
    res.setHeader("Content-Type", "audio/mpeg");
    fs.createReadStream(cachePath).pipe(res);
  } else {
    res.status(500).end("Audio still not available");
  }
}

// =========================================================
// Express: Routes (JSON APIs)
// =========================================================
app.post("/api/define", async (req, res) => {
  log.info(`API call from user session: ${req.sessionID}.`);
  if (!req.session) return res.status(403).json({ error: "No session" });
  const { word, nocache } = req.body || {};
  log.info(`[API] Define called for word: ${word} (nocache: ${nocache})`);
  if (!word || typeof word !== "string" || word.length > 64)
    return res.status(400).json({ error: "Invalid word" });
  try {
    const ws = await getOrCreateWebSocket(req.sessionID);
    const result = await getOrFetchWordData(word, ws, { nocache });
    log.info(`[API] Result for "${word}":`, result);
    res.json(result);
    if (nocache) {
      invalidateExplanationAndSample(result.word);
    }
    // Background audio cache for word
    generateAndCacheAudio({ key: audioKey(result.word, "word"), text: result.word }).catch(() => { });
  } catch (e) {
    res.status(504).json({ error: "OpenAI API failed" });
  }
});

// --- POST /api/audio (body: { word, type })
app.post("/api/audio", async (req, res) => {
  return ensureAndStreamAudio(
    { wordInput: req.body?.word, typeInput: req.body?.type, sessionID: req.sessionID },
    res
  );
});

// --- GET /api/audio/stream?word=&type=
app.get("/api/audio/stream", async (req, res) => {
  return ensureAndStreamAudio(
    { wordInput: req.query?.word, typeInput: req.query?.type, sessionID: req.sessionID },
    res
  );
});

// --- /lookup: For IoT devices ---
app.post("/lookup", async (req, res) => {
  // TODO: still have bug.
  log.info(`/lookup from session ${req.sessionID}`);
  const ws = await getOrCreateWebSocket(req.sessionID);
  const { word } = req.body || {};
  if (!word || typeof word !== "string" || word.length > 64)
    return res.status(400).json({ error: "Invalid word" });
  try {
    const result = await getOrFetchWordData(word, ws);
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

// Beaconized lifecycle endpoints (non-blocking; 202)
app.post("/api/prewarm", (req, res) => {
  log.info("prewarm (queued)");
  scheduleBeacon(req.sessionID, "prewarm");
  log.info(`Current OpenAIWebsockets size: ${OpenAIWebsockets.size}`);
  res.status(202).json({ ok: true, queued: "prewarm" });
});

app.post("/api/cooldown", (req, res) => {
  log.info("cooldown (queued, delayed)");
  // Optional: allow custom delay via query/body, default 1500ms
  const delay = Number(req.query?.delay ?? req.body?.delay ?? 5000) || 5000;
  scheduleBeacon(req.sessionID, "cooldown", { cooldownDelayMs: delay });
  log.info(`Current OpenAIWebsockets size: ${OpenAIWebsockets.size}`);
  res.status(202).json({ ok: true, queued: "cooldown", delayMs: delay });
});

// =========================================================
// SSR & Static
// =========================================================
if (isProd) {
  // Serve static files, but NOT index.html!
  app.use((req, res, next) => {
    if (req.path === "/" || req.path.endsWith(".html")) return next();
    express.static(path.join(__dirname, "dist/client"))(req, res, next);
  });
  app.get("/", async (req, res) => {
    log.info(`Page visit from session: ${req.sessionID}.`);
    await getOrCreateWebSocket(req.sessionID); // ensure WS ready for the session
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
  app.get("/", async (req, res, next) => {
    log.info(`Page visit from session: ${req.sessionID}.`);
    await getOrCreateWebSocket(req.sessionID); // ensure WS ready for the session
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

// =========================================================
// 404 & Server Start
// =========================================================
app.use((req, res) => {
  res.status(404).send("Not Found");
});

let listen_host = "localhost";
app.listen(port, listen_host, () => {
  log.info(`====== Server running on http://${listen_host}:${port} (LAN accessible) ======`);
});
