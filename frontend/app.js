/**
 * JARVIS frontend logic.
 * - Web Speech API (SpeechRecognition) for speech-to-text
 * - Web Audio API (AnalyserNode) purely to drive the orb's amplitude reactivity
 * - SpeechSynthesis for text-to-speech
 * - fetch() to your backend for the actual Gemini brain
 *
 * State machine: idle -> listening -> thinking -> speaking -> idle
 */

const STORAGE_KEY = "jarvis_backend_url";

const els = {
  body: document.body,
  coreButton: document.getElementById("coreButton"),
  statusLabel: document.getElementById("statusLabel"),
  statusSub: document.getElementById("statusSub"),
  log: document.getElementById("log"),
  logEmpty: document.getElementById("logEmpty"),
  clearBtn: document.getElementById("clearBtn"),
  clock: document.getElementById("clock"),
  setupOverlay: document.getElementById("setupOverlay"),
  backendInput: document.getElementById("backendInput"),
  backendSave: document.getElementById("backendSave"),
};

let backendUrl = localStorage.getItem(STORAGE_KEY) || "";
let history = []; // Gemini-style {role, parts:[{text}]} turns
let recognition = null;
let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;
let state = "idle"; // idle | listening | thinking | speaking

// ---------- Clock ----------

function tickClock() {
  const now = new Date();
  els.clock.textContent = now.toTimeString().slice(0, 8);
}
tickClock();
setInterval(tickClock, 1000);

// ---------- Setup overlay (backend URL) ----------

function showSetup() {
  els.backendInput.value = backendUrl;
  els.setupOverlay.classList.remove("hidden");
}
function hideSetup() {
  els.setupOverlay.classList.add("hidden");
}

if (!backendUrl) {
  showSetup();
} else {
  hideSetup();
}

els.backendSave.addEventListener("click", () => {
  const val = els.backendInput.value.trim().replace(/\/$/, "");
  if (!val) return;
  backendUrl = val;
  localStorage.setItem(STORAGE_KEY, backendUrl);
  hideSetup();
});

// ---------- State machine ----------

function setState(next, subtext) {
  state = next;
  els.body.dataset.state = next;
  const labels = {
    idle: "TAP TO SPEAK",
    listening: "LISTENING",
    thinking: "THINKING",
    speaking: "SPEAKING",
  };
  els.statusLabel.textContent = labels[next] || next.toUpperCase();
  els.statusSub.textContent = subtext || "";
}

setState("idle", "JARVIS is idle");

// ---------- Transcript log ----------

function addLogEntry(who, text, sources) {
  els.logEmpty.style.display = "none";
  const entry = document.createElement("div");
  entry.className = `log-entry ${who}`;
  const whoLabel = who === "user" ? "YOU" : "JARVIS";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const whoEl = document.createElement("span");
  whoEl.className = "who";
  whoEl.textContent = whoLabel;

  entry.appendChild(whoEl);
  entry.appendChild(bubble);

  if (sources && sources.length) {
    const src = document.createElement("div");
    src.className = "sources";
    src.innerHTML = sources
      .slice(0, 3)
      .map((s) => `<a href="${s.uri}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`)
      .join(" &middot; ");
    entry.appendChild(src);
  }

  els.log.appendChild(entry);
  els.log.scrollTop = els.log.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

els.clearBtn.addEventListener("click", () => {
  history = [];
  els.log.innerHTML = "";
  els.log.appendChild(els.logEmpty);
  els.logEmpty.style.display = "block";
});

// ---------- Mic amplitude (purely visual, feeds --amp CSS var on body) ----------

async function startAmplitudeLoop() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    function loop() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const amp = Math.min(1, rms * 4); // scale up for visibility
      els.body.style.setProperty("--amp", amp.toFixed(3));
      rafId = requestAnimationFrame(loop);
    }
    loop();
  } catch (err) {
    console.warn("Mic amplitude visualization unavailable:", err);
  }
}

function stopAmplitudeLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  els.body.style.setProperty("--amp", 0);
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}

// ---------- Speech recognition (ears) ----------

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

function canUseSpeechRecognition() {
  return !!SpeechRecognitionImpl;
}

function startListening() {
  if (!canUseSpeechRecognition()) {
    setState("idle", "Speech recognition isn't supported in this browser. Try Chrome.");
    return;
  }
  if (!backendUrl) {
    showSetup();
    return;
  }

  recognition = new SpeechRecognitionImpl();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  setState("listening", "Speak now...");
  startAmplitudeLoop();

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      handleUserUtterance(transcript);
    } else {
      setState("idle", "Didn't catch that. Tap to try again.");
    }
  };

  recognition.onerror = (event) => {
    stopAmplitudeLoop();
    if (event.error === "no-speech") {
      setState("idle", "No speech detected. Tap to try again.");
    } else if (event.error === "not-allowed" || event.error === "permission-denied") {
      setState("idle", "Microphone access was denied.");
    } else {
      setState("idle", `Mic error: ${event.error}`);
    }
  };

  recognition.onend = () => {
    stopAmplitudeLoop();
    if (state === "listening") {
      setState("idle", "JARVIS is idle");
    }
  };

  recognition.start();
}

function stopListening() {
  if (recognition) recognition.stop();
  stopAmplitudeLoop();
}

// ---------- Brain call (backend -> Gemini) ----------

async function handleUserUtterance(text) {
  addLogEntry("user", text);
  setState("thinking", "Consulting the brain...");

  try {
    const res = await fetch(`${backendUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, message: text }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Backend returned ${res.status}`);
    }

    history.push({ role: "user", parts: [{ text }] });
    history.push({ role: "model", parts: [{ text: data.reply }] });

    addLogEntry("jarvis", data.reply, data.sources);
    speak(data.reply);
  } catch (err) {
    console.error(err);
    const msg = "I ran into a problem reaching the backend. Check the connection and try again.";
    addLogEntry("jarvis", msg);
    setState("idle", err.message || msg);
  }
}

// ---------- Speech synthesis (mouth) ----------

function speak(text) {
  if (!("speechSynthesis" in window)) {
    setState("idle", "JARVIS is idle (speech synthesis unsupported here)");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 0.95;

  setState("speaking", text);

  utterance.onend = () => setState("idle", "JARVIS is idle");
  utterance.onerror = () => setState("idle", "JARVIS is idle");

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ---------- Core button ----------

els.coreButton.addEventListener("click", () => {
  if (state === "idle") {
    startListening();
  } else if (state === "listening") {
    stopListening();
  } else if (state === "speaking") {
    window.speechSynthesis.cancel();
    setState("idle", "JARVIS is idle");
  }
  // no-op while "thinking" — let the request resolve
});

if (!canUseSpeechRecognition()) {
  setState("idle", "This browser doesn't support the Web Speech API. Try Chrome on desktop or Android.");
}
