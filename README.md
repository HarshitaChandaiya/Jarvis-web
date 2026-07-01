# JARVIS — Web Edition

Your desktop JARVIS (Gemini + Whisper + pyttsx3), rebuilt to run live in a browser.

**How it works:**
- **Frontend** (`/frontend`) — a static site. Your browser's built-in Web Speech API
  listens to you (ears) and SpeechSynthesis reads replies back (mouth). No server
  needed for audio.
- **Backend** (`/backend`) — a tiny Express server. It holds your Gemini API key and
  is the only thing that talks to Google. The frontend never sees your key.

You need to deploy **both** pieces. Two free-tier-friendly hosts:
- Backend → **Render** (free web service)
- Frontend → **Netlify** (you already have an account/site there)

---

## 1. Get a Gemini API key

Free from https://aistudio.google.com/apikey — same one your desktop version uses.

## 2. Deploy the backend (Render)

1. Push this whole `jarvis-web` folder to a new GitHub repo.
2. Go to https://render.com → **New +** → **Web Service** → connect your repo.
3. Settings:
   - **Root directory:** `backend`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Under **Environment**, add:
   - `GEMINI_API_KEY` = your key from step 1
   - `ALLOWED_ORIGIN` = `*` for now (you'll tighten this in step 4)
5. Deploy. Render gives you a URL like `https://jarvis-backend-xxxx.onrender.com`.
   Visit `<that-url>/health` — you should see `{"status":"ok"}`.

Note: Render's free tier sleeps after inactivity, so the first request after a
while takes ~30-50s to wake up. Fine for a portfolio demo, worth knowing.

## 3. Deploy the frontend (Netlify)

1. Go to https://app.netlify.com → **Add new site** → **Deploy manually**, and
   drag in the `frontend` folder (or connect the GitHub repo and set
   **Base directory** to `frontend`, with no build command needed — it's static).
2. Netlify gives you a URL like `https://your-jarvis.netlify.app`.
3. Open it. On first load you'll be asked for your backend URL — paste the
   Render URL from step 2. It's saved in your browser's local storage.

## 4. Lock down CORS (recommended)

Back in Render, set `ALLOWED_ORIGIN` to your actual Netlify URL
(e.g. `https://your-jarvis.netlify.app`) instead of `*`, so only your frontend
can call your backend. Redeploy the backend for it to take effect.

## 5. Try it

Open your Netlify URL in **Chrome** (Web Speech API support elsewhere is patchy —
Safari and Firefox don't reliably support it). Tap the core, speak, and JARVIS
should transcribe, think, and reply out loud.

---

## Local development

```bash
# backend
cd backend
cp .env.example .env    # paste your key in
npm install
npm start                # runs on http://localhost:3001

# frontend — just open frontend/index.html in Chrome,
# or serve it: npx serve frontend
# When prompted for a backend URL, use http://localhost:3001
```

## Known limitations (good to know, not necessarily to fix)

- **Browser support:** Web Speech API is Chrome/Edge only in practice. Consider
  showing a note for other browsers (already built in — the app detects this).
- **Render cold starts:** first request after idle can be slow. A paid tier or
  a cron ping removes this.
- **No auth:** anyone with your backend URL can rack up Gemini API calls on your
  key. Fine for a personal demo; add a simple shared-secret header if you share
  the link widely.
