# LyricViz

A lyric visualizer for Windows and the browser. Play a song and watch
synced lyrics light up word by word over audio-reactive visuals, in an
iOS-style liquid-glass interface.

No account, no sign-in, no install required — open `index.html` through
any static host (or a local server) in Chrome or Edge.

**Live (web):** https://m4ster-lyricviz.vercel.app

**Desktop downloads (v1.0.1):**

- Windows (.exe installer): https://github.com/m4sternoob/m4ster-lyricviz/releases/download/v1.0.1/LyricViz_1.0.1_x64-setup.exe
- macOS (.dmg, Apple Silicon): https://github.com/m4sternoob/m4ster-lyricviz/releases/download/v1.0.1/LyricViz_1.0.1_aarch64.dmg

The same download buttons, with the version on each button, are in the
web app's control sheet.

## Visual styles

- **Constellation** — the words of the current line become stars and
  join up with thin lines as they are sung.
- **Aura** — soft colour fields that breathe with the bass.
- **Orbit** — a circular spectrum ring driven by the live audio.
- **Poly** — a lightweight low-poly mesh: flat-shaded triangles
  only, no gradients or shadows.

## Performance

The visualizer targets 120 fps and renders on the GPU compositor:

- Glow effects are pre-rendered sprites stamped with `drawImage`;
  no gradient is created inside the frame loop.
- Gradients that do exist (the background wash) are cached and
  rebuilt on resize only.
- Word positions for the constellation are measured once per line,
  not per frame.
- An adaptive quality governor watches the real frame time and
  trades backing resolution — never the look — to hold the frame
  rate on weaker hardware. The top bar shows the live fps.

## Audio sources

- **Demo Beat** — a short loop synthesized in code with the Web Audio
  API (kick, hats, clap, bass, pads). Built-in original lyrics show
  the full effect with zero setup.
- **Local File** — any audio file on the device. The page plays it and
  analyses it in real time.
- **Spotify / Live** — a companion mode. Share the Spotify window or
  tab with audio (Chrome/Edge on Windows), or use the microphone, and
  the page listens locally while a sync timer drives the lyrics.
  Audio is analysed on-device and never recorded or uploaded.

## Lyrics

Lyrics are fetched from [LRCLIB](https://lrclib.net), a free community
database that needs no API key. Line-level sync from LRCLIB is refined
in `js/lyrics.js` into word-by-word timing, weighted by word length.

You can also paste your own LRC lyrics (Custom lyrics) and nudge the
timing with the −/+ 0.5s offset controls if a track drifts.

## Run it (web)

Any static server pointed at the `web/` folder works, for example:

```bash
npx serve web
# or
python3 -m http.server 8000 --directory web
```

Then open the printed address. Live audio sharing requires HTTPS or
`localhost`, which the commands above provide.

Install as an app: in Edge or Chrome, use "Install LyricViz" from the
address-bar / menu once the page is open (PWA manifest included).

## Desktop apps (Windows + macOS)

The same web UI ships as a native app through Tauri (`src-tauri/`).
Pushing a version tag (`v*`) runs the `Build desktop release`
workflow, which builds both platforms and publishes them on that
tag's GitHub release:

- **Windows** — `LyricViz_1.0.1_x64-setup.exe` (NSIS installer, x64;
  the WebView2 bootstrapper is embedded in the installer rather
  than downloaded during setup)
- **macOS** — `LyricViz_1.0.1_aarch64.dmg`, Apple Silicon only. A
  native ARM build is smaller and faster than a universal one, and
  current Macs are all Apple Silicon.

The release profile is tuned for the native builds: full
optimization, link-time optimization, and stripped symbols.

Both builds are unsigned. On Windows, choose "More info" → "Run
anyway" if SmartScreen asks; on macOS, right-click the app and
choose Open on first launch to get past Gatekeeper.

Note: inside the desktop WebView, the Local File and Demo sources work
fully; the Spotify share-audio flow depends on WebView capture
support and is best in Chrome/Edge on Windows.

## Structure

```
web/index.html        page layout — top bar, lyric stage, control sheet
web/css/style.css     liquid-glass design system and layout
web/js/lyrics.js      LRC parsing, word timing, LRCLIB search
web/js/visualizer.js  canvas stage — constellation, aura, orbit, poly
web/js/app.js         audio sources, demo synth, playback clock, UI wiring
src-tauri/            Tauri desktop shell (Rust) and bundle config
.github/workflows/    release workflow — Windows .exe + macOS .dmg on v* tags
```

Interface conventions: decorative animations are off by default (the
Animations toggle in the top bar turns them on and the choice is
remembered), the logo returns to the home state, open panels close on
an outside click or Escape, and separators use a glowing gradient in
the app's own theme colours.

## Notes

- Per-syllable sources are not available from LRCLIB; word timing is
  an even, length-weighted split of each line's time slot.
- Spotify cannot be controlled from a web page, so in Live mode you
  press play here in step with Spotify. The offset buttons fix drift.
