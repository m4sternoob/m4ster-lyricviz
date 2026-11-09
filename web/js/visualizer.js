/*
 * visualizer.js — the canvas stage.
 *
 * Three original drawing modes, all driven by the same audio
 * bands (bass / mid / treble) read from a Web Audio analyser:
 *
 *   constellation — the words of the current lyric line become
 *                   stars, joined by thin lines. Word positions
 *                   come from the page itself, so the canvas and
 *                   the lyrics stay in perfect step.
 *   aura          — soft colour blobs that breathe with the bass.
 *   orbit         — a circular spectrum ring around the centre.
 *
 *   poly          — a lightweight low-poly mesh: flat-shaded
 *                   triangles only, no gradients or shadows, so
 *                   it stays fast on any GPU.
 *
 * When no live audio is connected, a gentle simulated pulse is
 * used so the stage never sits dead.
 *
 * Performance rules (120 fps target):
 *   - Glow is drawn from pre-rendered sprites, never from a
 *     gradient created inside the frame loop.
 *   - The base wash gradient is cached and rebuilt on resize only.
 *   - An adaptive quality governor watches the frame time and
 *     trades render resolution (never the look) to hold the
 *     frame rate on weaker hardware.
 */

const Visualizer = {
  canvas: null,
  ctx: null,
  mode: "constellation",
  analyser: null,
  freqData: null,

  // Smoothed band levels, 0..1. Smoothing keeps motion fluid
  // instead of jittery at high frame rates.
  bass: 0, mid: 0, treble: 0, level: 0,
  kick: 0,               // beat pulse, decays every frame
  lastBeatAt: 0,

  stars: [],             // background starfield
  blobs: [],             // aura mode blobs
  wordPoints: [],        // [{x, y, sung, now}] from the lyrics DOM

  sprites: {},           // pre-rendered glow sprites, by colour name
  wash: null,            // cached background gradient
  polyMesh: null,        // low-poly mode topology, built on resize

  // Frame-rate tracking + adaptive quality.
  fps: 0,
  frameEma: 16,          // smoothed frame time in ms
  lastFrameAt: 0,
  quality: 1,            // render scale, 0.5..1 (governor-controlled)
  framesSinceCheck: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());

    // A fixed starfield — positions are fractions of the screen
    // so they survive resizes without reshuffling.
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        x: Math.random(), y: Math.random(),
        r: Math.random() * 1.4 + 0.4,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const blobColours = ["cyan", "indigo", "pink", "sky", "violet"];
    this.blobs = blobColours.map((colour, i) => ({
      colour,
      angle: (i / blobColours.length) * Math.PI * 2,
      orbit: 0.16 + (i % 3) * 0.07,
      size: 0.34 + (i % 2) * 0.10,
      speed: 0.11 + i * 0.023,
    }));

    // Glow sprites are rendered once, here — the frame loop only
    // ever stamps them with drawImage, which the GPU composites.
    this.sprites = {
      cyan: this.makeGlowSprite("#22d3ee"),
      indigo: this.makeGlowSprite("#818cf8"),
      pink: this.makeGlowSprite("#e879f9"),
      sky: this.makeGlowSprite("#38bdf8"),
      violet: this.makeGlowSprite("#6366f1"),
      white: this.makeGlowSprite("#ffffff"),
    };

    requestAnimationFrame((t) => this.draw(t));
  },

  /** One soft radial glow, baked to an offscreen canvas. */
  makeGlowSprite(colour) {
    const size = 128;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const c = off.getContext("2d");
    const glow = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, colour);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    c.globalAlpha = 0.55;
    c.fillStyle = glow;
    c.fillRect(0, 0, size, size);
    return off;
  },

  /** Stamp a cached glow sprite centred at (x, y). */
  drawGlow(x, y, radius, sprite, alpha) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Cache the base wash — rebuilt here, never in the frame loop.
    const h = window.innerHeight;
    this.wash = this.ctx.createLinearGradient(0, 0, 0, h);
    this.wash.addColorStop(0, "#0b0e14");
    this.wash.addColorStop(1, "#131126");

    this.buildPolyMesh();
  },

  // Low-poly topology: a jittered grid plus its triangle list.
  // Built once per resize; the frame loop only moves the points.
  buildPolyMesh() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cols = Math.max(10, Math.round(w / 110));
    const rows = Math.max(7, Math.round(h / 110));
    const points = [];

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const edge = r === 0 || c === 0 || r === rows || c === cols;
        points.push({
          x: (c / cols) * w + (edge ? 0 : (Math.random() - 0.5) * 46),
          y: (r / rows) * h + (edge ? 0 : (Math.random() - 0.5) * 46),
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    const triangles = [];
    const at = (r, c) => r * (cols + 1) + c;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        triangles.push([at(r, c), at(r, c + 1), at(r + 1, c)]);
        triangles.push([at(r, c + 1), at(r + 1, c + 1), at(r + 1, c)]);
      }
    }
    this.polyMesh = { points, triangles };
  },

  setMode(mode) { this.mode = mode; },

  /** Connect (or disconnect, with null) a Web Audio analyser. */
  setAnalyser(analyser) {
    this.analyser = analyser;
    this.freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  },

  /** Called by the demo beat scheduler on every kick drum hit. */
  pulse() { this.kick = 1; },

  /** Word positions for constellation mode, in CSS pixels. */
  setWordPoints(points) { this.wordPoints = points; },

  // Read the analyser and update the smoothed band levels.
  readBands(now) {
    let bass = 0, mid = 0, treble = 0;

    if (this.analyser && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);
      const avg = (from, to) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += this.freqData[i];
        return sum / ((to - from) * 255);
      };
      bass = avg(2, 40);
      mid = avg(40, 220);
      treble = avg(220, 520);
    } else {
      // Simulated pulse — a slow breathing level plus the kick.
      const t = now / 1000;
      bass = 0.28 + 0.16 * Math.sin(t * 2.1) + this.kick * 0.5;
      mid = 0.22 + 0.14 * Math.sin(t * 3.3 + 1.2);
      treble = 0.16 + 0.12 * Math.sin(t * 5.1 + 2.6);
    }

    // Beat detection: a sharp bass rise fires one pulse.
    if (bass - this.bass > 0.16 && now - this.lastBeatAt > 240) {
      this.kick = 1;
      this.lastBeatAt = now;
    }

    const ease = 0.22;
    this.bass += (bass - this.bass) * ease;
    this.mid += (mid - this.mid) * ease;
    this.treble += (treble - this.treble) * ease;
    this.level = (this.bass + this.mid + this.treble) / 3;
    this.kick *= 0.94;
  },

  draw(now) {
    requestAnimationFrame((t) => this.draw(t));
    this.trackFrame(now);
    this.readBands(now);

    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;

    ctx.clearRect(0, 0, w, h);

    // Base wash — deep ink with a hint of indigo at the bottom.
    ctx.fillStyle = this.wash;
    ctx.fillRect(0, 0, w, h);

    if (this.mode === "poly") {
      this.drawPoly(now, w, h);
      return;
    }

    this.drawStarfield(now, w, h);

    if (this.mode === "aura") this.drawAura(now, w, h);
    else if (this.mode === "orbit") this.drawOrbit(now, w, h);
    else this.drawConstellation(now, w, h);
  },

  // Measure the real frame rate and govern quality: if frames
  // run long, lower the render scale a step (the picture stays
  // the same, only the backing resolution drops); if there is
  // headroom again, step back up. Checked every 90 frames so it
  // settles instead of hunting.
  trackFrame(now) {
    if (this.lastFrameAt) {
      const dt = now - this.lastFrameAt;
      if (dt > 0 && dt < 100) {
        this.frameEma += (dt - this.frameEma) * 0.05;
        this.fps = Math.round(1000 / this.frameEma);
      }
    }
    this.lastFrameAt = now;

    if (++this.framesSinceCheck < 90) return;
    this.framesSinceCheck = 0;

    if (this.frameEma > 10.5 && this.quality > 0.55) {
      this.quality = Math.max(0.55, this.quality - 0.15);
      this.resize();
    } else if (this.frameEma < 7.5 && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.15);
      this.resize();
    }
  },

  drawStarfield(now, w, h) {
    const { ctx } = this;
    for (const star of this.stars) {
      const twinkle = 0.35 + 0.3 * Math.sin(now / 900 + star.phase);
      ctx.globalAlpha = Math.max(twinkle, 0.06) * (0.5 + this.treble * 0.7);
      ctx.fillStyle = "#dbeafe";
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawAura(now, w, h) {
    const { ctx } = this;
    const cx = w / 2, cy = h / 2;

    ctx.globalCompositeOperation = "lighter";
    for (const blob of this.blobs) {
      const a = blob.angle + now / 1000 * blob.speed;
      const x = cx + Math.cos(a) * w * blob.orbit;
      const y = cy + Math.sin(a * 1.3) * h * blob.orbit * 0.7;
      const radius = Math.min(w, h) * blob.size * (0.75 + this.bass * 0.7);
      this.drawGlow(x, y, radius, this.sprites[blob.colour], 0.6);
    }
    ctx.globalCompositeOperation = "source-over";
  },

  drawOrbit(now, w, h) {
    const { ctx } = this;
    const cx = w / 2, cy = h * 0.44;
    const base = Math.min(w, h) * 0.21 * (1 + this.kick * 0.05);

    // Spectrum bars arranged in a circle.
    const bars = 72;
    for (let i = 0; i < bars; i++) {
      let v;
      if (this.freqData) {
        v = this.freqData[Math.floor((i / bars) * 300)] / 255;
      } else {
        v = 0.25 + 0.55 * Math.abs(Math.sin(now / 480 + i * 0.55)) * (0.4 + this.level);
      }
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const len = 12 + v * Math.min(w, h) * 0.16;
      const x1 = cx + Math.cos(angle) * base;
      const y1 = cy + Math.sin(angle) * base;
      const x2 = cx + Math.cos(angle) * (base + len);
      const y2 = cy + Math.sin(angle) * (base + len);

      ctx.strokeStyle = i % 3 === 0 ? "#22d3ee" : "#818cf8";
      ctx.globalAlpha = 0.35 + v * 0.6;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Inner glass disc.
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.arc(cx, cy, base - 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
  },

  drawConstellation(now, w, h) {
    const { ctx } = this;
    const points = this.wordPoints;

    // Soft nebula behind the words, breathing with the level —
    // a cached glow sprite, not a per-frame gradient.
    const cx = w / 2, cy = h * 0.44;
    const radius = Math.min(w, h) * (0.46 + this.bass * 0.12);
    this.drawGlow(cx, cy, radius, this.sprites.indigo, 0.34);

    if (points.length < 2) return;

    // Join the words with thin lines — the constellation itself.
    ctx.strokeStyle = "rgba(186,230,253,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // A star on every word. Sung stars burn brighter; the word
    // being sung right now gets a halo that pulses with the kick.
    for (const p of points) {
      const baseR = p.now ? 4.2 : p.sung ? 3 : 2;
      const r = baseR * (p.now ? 1 + this.kick * 0.5 : 1);

      if (p.now || p.sung) {
        this.drawGlow(p.x, p.y, r * 5,
          p.now ? this.sprites.cyan : this.sprites.white,
          p.now ? 0.85 : 0.5);
      }

      ctx.fillStyle = p.sung || p.now ? "#ffffff" : "rgba(219,234,254,0.55)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // Low-poly mode: flat-shaded triangles only — no gradients,
  // no shadows, no blur. Each point ripples with the audio
  // bands; each triangle takes a flat palette colour whose
  // brightness follows the treble. A few hundred plain fills
  // per frame is about the cheapest good-looking draw there is.
  drawPoly(now, w, h) {
    const { ctx } = this;
    const mesh = this.polyMesh;
    if (!mesh) return;

    const t = now / 1000;
    const palette = ["#164e63", "#1e3a5f", "#312e81", "#155e75", "#3730a3", "#0e7490"];
    const lift = 10 + this.bass * 34;

    // Move the points: two sine waves mixed, scaled by the bass.
    const moved = mesh.points.map((p) => ({
      x: p.x,
      y: p.y + Math.sin(t * 1.4 + p.phase + p.x * 0.004) * lift
             + Math.cos(t * 0.9 + p.y * 0.005) * lift * 0.4,
    }));

    mesh.triangles.forEach((tri, i) => {
      const [a, b, c] = tri.map((idx) => moved[idx]);
      // Brightness shimmer per triangle, from treble + position.
      const shimmer = 0.55 + this.treble * 0.8
        + 0.25 * Math.sin(t * 2 + i * 1.7);
      ctx.globalAlpha = Math.min(Math.max(shimmer, 0.25), 1);
      ctx.fillStyle = palette[i % palette.length];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // A soft centre glow so lyrics stay the focus — one sprite.
    this.drawGlow(w / 2, h * 0.44, Math.min(w, h) * 0.4,
      this.sprites.indigo, 0.22 + this.kick * 0.12);
  },
};
