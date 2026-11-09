/*
 * app.js — wires the page together.
 *
 * Three audio sources, one lyric clock:
 *   demo — a small synth beat generated in code (no audio file)
 *   file — a local audio file, played by the page itself
 *   live — Spotify (or anything) playing outside the page; the
 *          page listens through shared system/tab audio or the
 *          microphone and runs a sync timer for the lyrics
 *
 * Whichever source is active, the lyric engine only needs two
 * things: the current time in seconds, and an analyser node
 * for the visualizer.
 */

// ---------- State ----------

const LOOP_SECONDS = 31.3; // demo beat length: 48 beats at 92 BPM

const state = {
  source: "demo",
  playing: false,
  timedLines: [],
  currentLine: -2,
  offset: 0,               // lyric timing nudge, in seconds
  duration: LOOP_SECONDS,  // total length used by the seek bar
  liveStartedAt: 0,        // Date.now() when the live timer last started
  liveElapsed: 0,          // live timer seconds banked before pausing
  songDurationHint: 0,     // duration from a lyrics search result
};

// ---------- Page elements ----------

const el = (id) => document.getElementById(id);
const stageHint = el("stageHint");
const trackLabel = el("trackLabel");
const linePrev = el("linePrev");
const lineCurrent = el("lineCurrent");
const lineNext = el("lineNext");
const playBtn = el("playBtn");
const seekBar = el("seekBar");
const timeNow = el("timeNow");
const timeTotal = el("timeTotal");

// ---------- Audio plumbing ----------

let audioCtx = null;
let demoAnalyser = null;
let demoGain = null;
let fileAnalyser = null;
let liveAnalyser = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function makeAnalyser() {
  const analyser = ensureAudioContext().createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.78;
  return analyser;
}

function activeAnalyser() {
  if (state.source === "demo") return demoAnalyser;
  if (state.source === "file") return fileAnalyser;
  return liveAnalyser;
}

// ---------- Demo beat ----------
// A tiny synthesized loop — kick, hats, clap, a bass line and
// soft pads, scheduled ahead of time the way real audio apps do.
// Chords: Am — F — C — G, one bar each, the loop is 12 bars.

const BPM = 92;
const BEAT = 60 / BPM;
const demo = {
  timer: null,
  nextNoteTime: 0,
  step: 0,          // 16th-note counter inside the loop
  startedAt: 0,     // ctx time the current play run began
  banked: 0,        // seconds banked before pausing
};

const BASS_ROOTS = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1
const PAD_CHORDS = [
  [220, 261.63, 329.63],  // Am
  [174.61, 220, 261.63],  // F
  [196, 261.63, 329.63],  // C (G in the bass)
  [196, 246.94, 293.66],  // G
];

function demoStart() {
  const ctx = ensureAudioContext();
  if (!demoAnalyser) {
    demoGain = ctx.createGain();
    demoGain.gain.value = 0.8;
    demoAnalyser = makeAnalyser();
    demoGain.connect(demoAnalyser);
    demoAnalyser.connect(ctx.destination);
  }
  demo.startedAt = ctx.currentTime + 0.06 - demo.banked;
  demo.nextNoteTime = ctx.currentTime + 0.06;
  // Re-align the step counter with the banked position.
  demo.step = Math.floor(demo.banked / (BEAT / 4)) % 192;
  demo.timer = setInterval(scheduleDemo, 40);
}

function demoStop() {
  clearInterval(demo.timer);
  demo.timer = null;
  demo.banked = demoTime();
}

function demoTime() {
  if (!audioCtx) return demo.banked;
  if (state.playing && state.source === "demo") {
    return (audioCtx.currentTime - demo.startedAt) % LOOP_SECONDS;
  }
  return demo.banked % LOOP_SECONDS;
}

function demoSeek(seconds) {
  demo.banked = seconds;
  if (state.playing && state.source === "demo") {
    clearInterval(demo.timer);
    demoStart();
  }
}

function scheduleDemo() {
  const ctx = audioCtx;
  while (demo.nextNoteTime < ctx.currentTime + 0.14) {
    playStep(demo.step, demo.nextNoteTime);
    demo.nextNoteTime += BEAT / 4; // 16th notes
    demo.step = (demo.step + 1) % 192; // 12 bars of 16 steps
  }
}

function playStep(step, time) {
  const bar = Math.floor(step / 16) % 4;
  const beatInBar = (step % 16) / 4;

  if (step % 16 === 0) padChord(PAD_CHORDS[bar], time);
  if (beatInBar === 0 || beatInBar === 2) kick(time);
  if (beatInBar === 1 || beatInBar === 3) clap(time);
  if (step % 2 === 0) hat(time, false);
  if (step % 16 === 14) hat(time, true);
  if (beatInBar === 0 || beatInBar === 1.5 || beatInBar === 2.5) {
    bassNote(BASS_ROOTS[bar], time);
  }
  if (beatInBar === 0) Visualizer.pulse();
}

function kick(time) {
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
  gain.gain.setValueAtTime(0.9, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
  osc.connect(gain); gain.connect(demoGain);
  osc.start(time); osc.stop(time + 0.26);
}

function hat(time, open) {
  const ctx = audioCtx;
  const src = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass"; filter.frequency.value = 7500;
  const gain = ctx.createGain();
  const len = open ? 0.22 : 0.05;
  gain.gain.setValueAtTime(open ? 0.16 : 0.11, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + len);
  src.connect(filter); filter.connect(gain); gain.connect(demoGain);
  src.start(time); src.stop(time + len + 0.02);
}

function clap(time) {
  const ctx = audioCtx;
  const src = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass"; filter.frequency.value = 1600; filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.32, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  src.connect(filter); filter.connect(gain); gain.connect(demoGain);
  src.start(time); src.stop(time + 0.24);
}

let sharedNoise = null;
function noiseSource() {
  const ctx = audioCtx;
  if (!sharedNoise) {
    sharedNoise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = sharedNoise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  return src;
}

function bassNote(freq, time) {
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq * 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.20, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + BEAT * 0.9);
  osc.connect(gain); gain.connect(demoGain);
  osc.start(time); osc.stop(time + BEAT);
}

function padChord(freqs, time) {
  const ctx = audioCtx;
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const barLen = BEAT * 4;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.045, time + 0.4);
    gain.gain.setValueAtTime(0.045, time + barLen - 0.4);
    gain.gain.linearRampToValueAtTime(0, time + barLen);
    osc.connect(gain); gain.connect(demoGain);
    osc.start(time); osc.stop(time + barLen + 0.02);
  }
}

// ---------- Local file source ----------

const fileAudio = el("fileAudio");
let fileSourceNode = null;

function wireFileAudio() {
  if (fileSourceNode) return;
  const ctx = ensureAudioContext();
  fileAnalyser = makeAnalyser();
  fileSourceNode = ctx.createMediaElementSource(fileAudio);
  fileSourceNode.connect(fileAnalyser);
  fileAnalyser.connect(ctx.destination);
}

el("fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  wireFileAudio();
  fileAudio.src = URL.createObjectURL(file);
  trackLabel.textContent = file.name.replace(/\.[^.]+$/, "");
  stageHint.textContent = "File loaded. Search its lyrics above, then press play.";
});

fileAudio.addEventListener("loadedmetadata", () => {
  if (state.source === "file") state.duration = fileAudio.duration || 0;
});
fileAudio.addEventListener("ended", () => setPlaying(false));

// ---------- Live (Spotify companion) source ----------

let liveStream = null;

async function startLiveShare() {
  try {
    // Sharing a window/tab is how a web page can hear system
    // audio on Windows (Chrome / Edge). A video track is
    // required by the browser API; only the audio is used.
    liveStream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: true,
    });
    connectLiveStream();
    if (liveStream.getAudioTracks().length === 0) {
      stageHint.textContent =
        "That share had no audio. Share again and tick \u201CShare audio\u201D, or use the microphone.";
    } else {
      stageHint.textContent =
        "Listening. Start the song in Spotify, then press play here at the same moment.";
    }
  } catch (err) {
    stageHint.textContent = "Sharing was cancelled. The microphone button also works — play Spotify out loud.";
  }
}

async function startMic() {
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    connectLiveStream();
    stageHint.textContent =
      "Listening on the microphone. Start the song in Spotify, then press play here.";
  } catch (err) {
    stageHint.textContent = "Microphone access was blocked. Allow it in the browser to use live mode.";
  }
}

function connectLiveStream() {
  const ctx = ensureAudioContext();
  liveAnalyser = makeAnalyser();
  const source = ctx.createMediaStreamSource(liveStream);
  source.connect(liveAnalyser); // listen only — never played back
  Visualizer.setAnalyser(liveAnalyser);
}

el("liveBtn").addEventListener("click", startLiveShare);
el("micBtn").addEventListener("click", startMic);

// ---------- Play / pause, one switch for all sources ----------

function currentTime() {
  if (state.source === "demo") return demoTime();
  if (state.source === "file") return fileAudio.currentTime || 0;
  if (state.playing) return state.liveElapsed + (Date.now() - state.liveStartedAt) / 1000;
  return state.liveElapsed;
}

function seekTo(seconds) {
  if (state.source === "demo") demoSeek(seconds);
  else if (state.source === "file") fileAudio.currentTime = seconds;
  else {
    state.liveElapsed = seconds;
    if (state.playing) state.liveStartedAt = Date.now();
  }
}

function setPlaying(want) {
  if (want) ensureAudioContext();

  if (state.source === "demo") {
    if (want && !state.playing) demoStart();
    if (!want && state.playing) demoStop();
  } else if (state.source === "file") {
    if (want) { wireFileAudio(); fileAudio.play(); }
    else fileAudio.pause();
  } else {
    if (want && !state.playing) state.liveStartedAt = Date.now();
    if (!want && state.playing) {
      state.liveElapsed += (Date.now() - state.liveStartedAt) / 1000;
    }
  }

  state.playing = want;
  playBtn.textContent = want ? "❚❚" : "▶";
  Visualizer.setAnalyser(activeAnalyser());
}

playBtn.addEventListener("click", () => setPlaying(!state.playing));
seekBar.addEventListener("input", () => {
  if (state.duration > 0) seekTo((seekBar.value / 100) * state.duration);
});

// ---------- Source and mode pickers ----------

function setSource(source) {
  if (state.playing) setPlaying(false);
  state.source = source;

  document.querySelectorAll("#sourcePicker .seg").forEach((b) =>
    b.classList.toggle("active", b.dataset.source === source));
  el("filePickLabel").hidden = source !== "file";
  el("liveBtn").hidden = source !== "live";
  el("micBtn").hidden = source !== "live";

  if (source === "demo") {
    state.duration = LOOP_SECONDS;
    loadLyrics(DEMO_LYRICS_TEXT, LOOP_SECONDS);
    trackLabel.textContent = "Demo Beat — original loop, lyrics built in";
    stageHint.textContent = "Tip: in Constellation mode the words of the current line join up like stars.";
  } else if (source === "file") {
    state.duration = fileAudio.duration || state.songDurationHint || 0;
    stageHint.textContent = "Choose an audio file, search its lyrics above, then press play.";
  } else {
    state.duration = state.songDurationHint || 0;
    state.liveElapsed = 0;
    stageHint.textContent = "Share Spotify audio, load the song's lyrics, then press play in step with Spotify.";
  }
  state.currentLine = -2;
  Visualizer.setAnalyser(activeAnalyser());
}

document.querySelectorAll("#sourcePicker .seg").forEach((btn) =>
  btn.addEventListener("click", () => setSource(btn.dataset.source)));

document.querySelectorAll("#modePicker .seg").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll("#modePicker .seg").forEach((b) =>
      b.classList.toggle("active", b === btn));
    Visualizer.setMode(btn.dataset.mode);
  }));

// ---------- Lyrics loading and search ----------

function loadLyrics(lrcText, durationHint) {
  state.timedLines = buildTimedLyrics(lrcText, durationHint || state.duration);
  state.currentLine = -2;
  if (durationHint) {
    state.songDurationHint = durationHint;
    if (state.source !== "demo") state.duration = durationHint;
  }
}

el("searchBtn").addEventListener("click", async () => {
  const track = el("trackInput").value.trim();
  const artist = el("artistInput").value.trim();
  if (!track && !artist) {
    stageHint.textContent = "Type a track name (artist helps) and search.";
    return;
  }
  stageHint.textContent = "Searching LRCLIB…";
  try {
    const results = await searchLyrics(track, artist);
    showResults(results);
    stageHint.textContent = results.length
      ? "Pick the closest match — check the duration against your track."
      : "No lyrics found for that. Try the Custom lyrics button and paste an LRC.";
  } catch (err) {
    stageHint.textContent = "Lyrics search failed — check your connection and try again.";
  }
});

function showResults(results) {
  const box = el("resultsBox");
  box.innerHTML = "";
  el("resultsRow").hidden = results.length === 0;

  for (const r of results) {
    const btn = document.createElement("button");
    btn.className = "result-item";
    const mins = Math.floor((r.duration || 0) / 60);
    const secs = String(Math.floor((r.duration || 0) % 60)).padStart(2, "0");
    btn.innerHTML =
      `<span>${escapeHtml(r.trackName)} — ${escapeHtml(r.artistName)}</span>` +
      (r.syncedLyrics
        ? `<span class="meta">${mins}:${secs} · synced ✓</span>`
        : `<span class="no-sync">${mins}:${secs} · not synced</span>`);
    btn.addEventListener("click", () => {
      if (r.syncedLyrics) loadLyrics(r.syncedLyrics, r.duration);
      else loadLyrics(spreadPlainLyrics(r.plainLyrics, r.duration), r.duration);
      trackLabel.textContent = `${r.trackName} — ${r.artistName}`;
      el("resultsRow").hidden = true;
      stageHint.textContent = r.syncedLyrics
        ? "Synced lyrics loaded. Press play in step with the song."
        : "This one has no timed version — lyrics were spread across the track as a best effort.";
      seekTo(0);
    });
    box.appendChild(btn);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// Custom lyrics — paste any LRC.
el("customToggle").addEventListener("click", () => {
  el("customRow").hidden = !el("customRow").hidden;
});
el("customLoad").addEventListener("click", () => {
  const text = el("customLyrics").value.trim();
  if (!text) return;
  loadLyrics(text, state.duration);
  trackLabel.textContent = "Custom lyrics";
  el("customRow").hidden = true;
  stageHint.textContent = "Your lyrics are loaded. Use the −/+ 0.5s buttons if they drift.";
});

// Lyric offset nudge.
el("offsetMinus").addEventListener("click", () => bumpOffset(-0.5));
el("offsetPlus").addEventListener("click", () => bumpOffset(0.5));
function bumpOffset(delta) {
  state.offset = Math.round((state.offset + delta) * 10) / 10;
  el("offsetValue").textContent =
    (state.offset > 0 ? "+" : "") + state.offset.toFixed(1) + "s";
}

// Clicking the empty stage closes any open sheet panels.
document.querySelector(".stage-wrap").addEventListener("click", () => {
  el("resultsRow").hidden = true;
  el("customRow").hidden = true;
});

// ---------- Lyric rendering ----------

function renderLine(index) {
  const lines = state.timedLines;
  linePrev.textContent = index > 0 ? lines[index - 1].text : " ";
  lineNext.textContent =
    index >= 0 && index < lines.length - 1 ? lines[index + 1].text : " ";

  lineCurrent.innerHTML = "";
  if (index < 0 || !lines[index]) {
    lineCurrent.textContent = state.playing ? "♪" : "Press play — lyrics light up here, word by word";
    Visualizer.setWordPoints([]);
    return;
  }
  for (const timed of lines[index].words) {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = timed.word;
    span.dataset.start = timed.start;
    span.dataset.end = timed.end;
    lineCurrent.appendChild(span);
    lineCurrent.appendChild(document.createTextNode(" "));
  }
}

// Word centres for the constellation are measured once per
// line (and again on resize) — reading layout every frame
// would force the browser to recalculate it 120 times a second.
let wordCentres = [];
let wordCentresDirty = true;
window.addEventListener("resize", () => { wordCentresDirty = true; });

function updateLyrics(now) {
  const lyricTime = now + state.offset;
  const index = lineIndexAt(state.timedLines, lyricTime);
  if (index !== state.currentLine) {
    state.currentLine = index;
    renderLine(index);
    wordCentresDirty = true;
  }

  const spans = lineCurrent.querySelectorAll(".word");

  if (wordCentresDirty) {
    wordCentres = [...spans].map((span) => {
      const rect = span.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    wordCentresDirty = false;
  }

  // Mark each word sung / now, and pair it with its cached
  // centre so the constellation stars sit on the words.
  const points = [];
  spans.forEach((span, i) => {
    const start = Number(span.dataset.start);
    const end = Number(span.dataset.end);
    const sung = lyricTime >= end;
    const nowWord = lyricTime >= start && lyricTime < end;
    if (span._sung !== sung || span._now !== nowWord) {
      span._sung = sung;
      span._now = nowWord;
      span.classList.toggle("sung", sung || nowWord);
      span.classList.toggle("now", nowWord);
    }
    if (wordCentres[i]) points.push({ ...wordCentres[i], sung, now: nowWord });
  });
  if (Visualizer.mode === "constellation") Visualizer.setWordPoints(points);
}

// ---------- Main loop ----------

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function tick() {
  requestAnimationFrame(tick);
  const now = currentTime();

  updateLyrics(now);

  timeNow.textContent = formatTime(now);
  timeTotal.textContent = formatTime(state.duration);
  if (state.duration > 0 && document.activeElement !== seekBar) {
    seekBar.value = Math.min((now / state.duration) * 100, 100);
  }

  // Live timer and demo loop both end at the known duration.
  if (state.playing && state.duration > 0 && now >= state.duration) {
    if (state.source === "live") setPlaying(false);
    // The demo loops on its own; the file element fires "ended".
  }
}

// ---------- Panels: outside click and Escape close them ----------

function closePanels() {
  el("resultsRow").hidden = true;
  el("customRow").hidden = true;
}
document.addEventListener("click", (event) => {
  if (!event.target.closest("#sheet") && !event.target.closest(".bar")) closePanels();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanels();
});

// ---------- Animations master toggle (off by default) ----------

const animToggle = el("animToggle");
function applyAnimations(on) {
  document.body.classList.toggle("anim-on", on);
  animToggle.textContent = on ? "Animations on" : "Animations off";
  animToggle.setAttribute("aria-pressed", String(on));
  localStorage.setItem("m4ster.lyricviz.animations", on ? "on" : "off");
}
animToggle.addEventListener("click", () =>
  applyAnimations(!document.body.classList.contains("anim-on")));
applyAnimations(localStorage.getItem("m4ster.lyricviz.animations") === "on");

// ---------- Back to top (bottom-left) ----------
// The page itself is one screen tall; the control sheet is what
// scrolls, so the button watches the sheet and scrolls it home.

const sheetEl = el("sheet");
const jumpTop = el("jumpTop");
sheetEl.addEventListener("scroll", () => {
  jumpTop.hidden = sheetEl.scrollTop < 120;
});
jumpTop.addEventListener("click", () => {
  const smooth = document.body.classList.contains("anim-on");
  sheetEl.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
});

// ---------- Chrome: fullscreen, frost, logo ----------

el("fullscreenBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

const frostRange = el("frostRange");
function applyFrost(value) {
  document.documentElement.style.setProperty("--frost", value);
  localStorage.setItem("m4ster.lyricviz.frost", value);
}
frostRange.addEventListener("input", () => applyFrost(frostRange.value));
const savedFrost = localStorage.getItem("m4ster.lyricviz.frost");
if (savedFrost) {
  frostRange.value = savedFrost;
  applyFrost(savedFrost);
}

// Logo goes home: demo source, constellation mode, panels closed.
el("logoHome").addEventListener("click", (event) => {
  event.preventDefault();
  el("resultsRow").hidden = true;
  el("customRow").hidden = true;
  document.querySelector('#modePicker .seg[data-mode="constellation"]').click();
  setSource("demo");
  el("sheet").scrollTop = 0;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- Boot ----------

Visualizer.init(el("stage"));
loadLyrics(DEMO_LYRICS_TEXT, LOOP_SECONDS);
tick();

// Live frame-rate readout in the top bar, refreshed twice a second.
setInterval(() => {
  el("fpsMeter").textContent = Visualizer.fps > 0 ? Visualizer.fps + " fps" : "— fps";
}, 500);
