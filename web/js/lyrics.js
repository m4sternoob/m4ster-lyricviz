/*
 * lyrics.js — everything about lyric text.
 *
 * Lyrics come from LRCLIB (https://lrclib.net), a free community
 * database. No account and no API key are needed, and the API
 * allows cross-origin calls, so the browser can ask it directly.
 *
 * LRCLIB sync is line-by-line. This file adds the word-by-word
 * layer on top: each line is split into words, and the line's
 * time slot is shared across its words by character length, so
 * longer words hold a little longer — the way they are sung.
 */

// Original demo lyrics, written for the built-in demo beat.
// The demo beat runs at 92 BPM and loops every 32 seconds;
// each line below covers two bars (about 5.2 seconds).
const DEMO_LYRICS_TEXT = [
  "[00:00.00] Neon rain on a midnight street",
  "[00:05.22] Every light is calling me",
  "[00:10.43] Heartbeat running with the beat",
  "[00:15.65] This is where I want to be",
  "[00:20.87] Turn it up and let it glow",
  "[00:26.09] Sing the words we all know",
].join("\n");

/** Turn "[mm:ss.xx] text" lines into [{ time, text }] sorted by time. */
function parseLrc(lrcText) {
  const lines = [];
  const stamp = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const rawLine of lrcText.split("\n")) {
    const stamps = [...rawLine.matchAll(stamp)];
    if (stamps.length === 0) continue;

    const text = rawLine.replace(stamp, "").trim();
    for (const match of stamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      lines.push({ time: minutes * 60 + seconds, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Split one lyric line into timed words.
 * lineEnd is the start time of the next line, so the words of
 * this line fill the gap between the two.
 */
function splitLineIntoWords(line, lineEnd) {
  const words = line.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const slot = Math.max(lineEnd - line.time, 0.4);
  const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;

  let cursor = line.time;
  return words.map((word) => {
    const hold = slot * (word.length / totalChars);
    const timed = { word, start: cursor, end: cursor + hold };
    cursor += hold;
    return timed;
  });
}

/** Build the full timed structure the player uses. */
function buildTimedLyrics(lrcText, songDuration) {
  const lines = parseLrc(lrcText);
  return lines.map((line, i) => {
    const next = lines[i + 1];
    const lineEnd = next ? next.time : (songDuration || line.time + 4);
    return { ...line, end: lineEnd, words: splitLineIntoWords(line, lineEnd) };
  });
}

/** Index of the line being sung at `time`, or -1 before the first line. */
function lineIndexAt(timedLines, time) {
  let index = -1;
  for (let i = 0; i < timedLines.length; i++) {
    if (time >= timedLines[i].time) index = i;
    else break;
  }
  return index;
}

/**
 * Search LRCLIB. Returns a short list of results, each with
 * syncedLyrics (LRC text) when the database has a timed version.
 */
async function searchLyrics(trackName, artistName) {
  const params = new URLSearchParams();
  if (trackName) params.set("track_name", trackName);
  if (artistName) params.set("artist_name", artistName);

  const response = await fetch("https://lrclib.net/api/search?" + params, {
    headers: { "Lrclib-Client": "LyricViz/1.0" },
  });
  if (!response.ok) throw new Error("Lyrics search failed: " + response.status);

  const results = await response.json();
  // Timed lyrics first — those are the ones that can light up.
  return results
    .filter((r) => r.plainLyrics || r.syncedLyrics)
    .sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)))
    .slice(0, 6);
}

/** Plain (untimed) lyrics spread evenly across the song, as a fallback. */
function spreadPlainLyrics(plainText, songDuration) {
  const clean = plainText.split("\n").map((l) => l.trim()).filter(Boolean);
  const total = songDuration && songDuration > 10 ? songDuration : clean.length * 4;
  const step = total / Math.max(clean.length, 1);
  return clean
    .map((text, i) => `[${formatStamp(i * step)}] ${text}`)
    .join("\n");
}

function formatStamp(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}
