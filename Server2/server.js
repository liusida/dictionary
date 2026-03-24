import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import crypto from "crypto";
import https from "node:https";
import "dotenv/config";
import fetch from "node-fetch";

// =========================================================
// Environment & App Setup
// =========================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const defineModel = process.env.DEFINE_MODEL || "gpt-4o-mini";
const isProd = process.env.NODE_ENV === "production";

if (!apiKey) {
  console.warn("[BOOT] Missing OPENAI_API_KEY — server can start but related endpoints will fail.");
}

// ---------------------------------------------------------
// Global State (logs preserved)
// ---------------------------------------------------------
const outgoingTTSRequests = new Map(); // audioKey -> inflight Promise

/** Shared agent so node-fetch reuses TCP/TLS to api.openai.com between requests. */
const openaiHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 64,
  maxFreeSockets: 10,
});

/** JSON Schema for Chat Completions structured outputs (strict). */
const DICTIONARY_ENTRY_JSON_SCHEMA = {
  type: "object",
  properties: {
    word: {
      type: "string",
      description: "Dictionary or base form (e.g. go for went, child for children).",
    },
    region: {
      type: "string",
      description: '2-letter region code (e.g. SG) or "--" for global English.',
    },
    explanation: {
      type: "string",
      description: "Clear Vocabulary.com-style explanation; simple words for basic vocabulary.",
    },
    sentence: {
      type: "string",
      description: "Natural example sentence using the word.",
    },
  },
  required: ["word", "region", "explanation", "sentence"],
  additionalProperties: false,
};

const DEFINE_SYSTEM_PROMPT = `You are a concise English learner's dictionary.
For the user's target word or phrase, fill every JSON field.
- word: dictionary or base form.
- region: 2-letter code where the word is mainly used, or "--" for standard global English.
- explanation: clear, friendly; simpler vocabulary for basic words.
- sentence: one natural example using the word.
Stay on the target only; do not discuss other words or meta commentary.`;

const DEFINE_FETCH_TIMEOUT_MS = 20_000;

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
// Core OpenAI: dictionary definitions (Chat Completions + structured outputs)
// =========================================================
async function fetchDefinitionStructured(trimmed) {
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const t0 = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFINE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      agent: openaiHttpsAgent,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: defineModel,
        messages: [
          { role: "system", content: DEFINE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Target word or phrase (explain only this):\n"${trimmed}"\n\nRespond with the JSON object matching the schema.`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dictionary_entry",
            strict: true,
            schema: DICTIONARY_ENTRY_JSON_SCHEMA,
          },
        },
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      log.error("Chat completions error:", res.status, bodyText.slice(0, 500));
      throw new Error(`OpenAI chat completions failed: ${res.status}`);
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new Error("Invalid JSON from OpenAI");
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      log.error("Unexpected completions shape:", bodyText.slice(0, 400));
      throw new Error("Empty model content");
    }

    const parsed = JSON.parse(content);
    const ms = Math.round(performance.now() - t0);
    log.info(
      `[define-timing] openai_chat_completions ok=true ms=${ms} word='${trimmed}' model=${defineModel}`
    );
    return parsed;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    log.warn(
      `[define-timing] openai_chat_completions ok=false ms=${ms} word='${trimmed}' model=${defineModel}`,
      err?.message || err
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function getOrFetchWordData(word, { nocache = false } = {}) {
  const trimmed = word.trim().toLowerCase();
  const cachePath = textCachePath(trimmed);

  // 1) Try cache first
  if (!nocache && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      log.info(`Text-cache hit for '${trimmed}'.`);
      return {
        word: trimmed,
        region: cached.region || "--",
        explanation: cached.explanation,
        sentence: cached.sentence,
      };
    } catch (e) {
      log.warn(`The cache file for '${trimmed}' is corrupted, ignoring the cache. ${cachePath}`);
    }
  }

  // 2) Chat Completions + structured outputs
  log.info(`>>> fetch definition (structured) for '${trimmed}' model=${defineModel}`);
  const ai = await fetchDefinitionStructured(trimmed);

  let region = typeof ai.region === "string" && ai.region.trim() ? ai.region.trim() : "--";
  let explanation = typeof ai.explanation === "string" ? ai.explanation : "";
  let sentence = typeof ai.sentence === "string" ? ai.sentence : "";

  if (!sentence.trim()) {
    sentence = `No example sentence is available yet for "${trimmed}".`;
  }

  const payload = { word: trimmed, region, explanation, sentence };
  fs.writeFileSync(cachePath, JSON.stringify(payload), "utf8");
  return payload;
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
        agent: openaiHttpsAgent,
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
async function ensureAndStreamAudio({ wordInput, typeInput = "word" }, res) {
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
    const stat = fs.statSync(cachePath);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", stat.size);
    return fs.createReadStream(cachePath).pipe(res);
  }

  // Cache miss — decide text
  let textToSpeak;
  if (type === "word") {
    textToSpeak = word;
  } else {
    try {
      const data = await getOrFetchWordData(word);
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
    const stat = fs.statSync(cachePath);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", stat.size);
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
    const result = await getOrFetchWordData(word, { nocache });
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
  return ensureAndStreamAudio({ wordInput: req.body?.word, typeInput: req.body?.type }, res);
});

// --- GET /api/audio/stream?word=&type=
app.get("/api/audio/stream", async (req, res) => {
  return ensureAndStreamAudio({ wordInput: req.query?.word, typeInput: req.query?.type }, res);
});

// --- /lookup: For IoT devices ---
app.post("/lookup", async (req, res) => {
  // TODO: still have bug.
  log.info(`/lookup from session ${req.sessionID}`);
  const { word } = req.body || {};
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
