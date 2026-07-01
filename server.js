/**
 * JARVIS backend — the only thing standing between your browser and your Gemini key.
 *
 * Why this exists: the Web Speech API and SpeechSynthesis run fine entirely in the
 * browser, but the Gemini API key cannot live in frontend JS (anyone could open
 * devtools and steal it). So the frontend sends transcribed text here, this server
 * calls Gemini with the key from an environment variable, and sends the reply back.
 *
 * SETUP
 * -----
 * 1. cd backend && npm install
 * 2. Copy .env.example to .env and paste in your Gemini key
 *    (free key: https://aistudio.google.com/apikey)
 * 3. npm start
 * 4. Deployed version: set GEMINI_API_KEY and ALLOWED_ORIGIN as environment
 *    variables in your host's dashboard (e.g. Render) instead of a .env file.
 */

import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Lock this down to your deployed frontend URL once you have one.
// Leave as "*" while developing locally.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: ALLOWED_ORIGIN }));

const MODEL = "gemini-2.5-flash";

const SYSTEM_INSTRUCTION =
  "You are JARVIS, a spoken personal AI assistant. You are intelligent, dryly witty, " +
  "and politely composed. Because your replies are read aloud by browser text-to-speech, " +
  "keep them SHORT and conversational — usually one to three sentences. Never use markdown, " +
  "bullet points, or raw URLs; speak naturally as a person would. Address the user as 'sir' " +
  "or 'ma'am' occasionally, sparingly.";

app.post("/api/chat", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: GEMINI_API_KEY is not set." });
  }

  const { history, message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Request must include a 'message' string." });
  }

  const contents = [...(Array.isArray(history) ? history : []), { role: "user", parts: [{ text: message }] }];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        tools: [{ google_search: {} }],
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const message = data?.error?.message || "Gemini API returned an error.";
      return res.status(geminiRes.status).json({ error: message });
    }

    const candidate = data.candidates?.[0];
    const reply =
      candidate?.content?.parts?.map((p) => p.text || "").join("").trim() ||
      "I didn't quite catch a usable answer there, sir. Try rephrasing?";

    // Pull grounding sources, if the model actually searched.
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const seen = new Set();
    const sources = [];
    for (const chunk of chunks) {
      const uri = chunk?.web?.uri;
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        sources.push({ title: chunk.web.title || "source", uri });
      }
    }

    res.json({ reply, sources });
  } catch (err) {
    console.error("JARVIS backend error:", err);
    res.status(500).json({ error: "Something went wrong talking to Gemini." });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`JARVIS backend listening on port ${PORT}`);
});
