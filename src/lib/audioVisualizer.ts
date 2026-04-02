/**
 * Audio-reactive visualizer engine (Winamp/Milkdrop-style)
 * Renders audio-driven visuals to an OffscreenCanvas or regular canvas.
 */

export type VisualizerPreset =
  | 'plasma-wave'
  | 'spectrum-bars'
  | 'radial-burst'
  | 'waveform-landscape'
  | 'particle-nebula'
  | 'tunnel-flight'
  | 'kaleidoscope'
  | 'ocean-pulse'
  | 'emoji-rain'
  | 'emoji-vortex'
  | 'eq-classic'
  | 'oscilloscope'
  | 'smiley-bounce'
  | 'fire-inferno'
  | 'explosion-burst'
  | 'laser-beams'
  | 'cartoon-pop'
  | 'halloween'
  | 'christmas'
  | 'easter'
  | 'summer-vibes'
  | 'winter-frost'
  | 'matrix-rain'
  | 'disco-ball'
  | 'northern-lights'
  | 'retro-grid'
  | 'retro-grid-2'
  | 'retro-grid-3'
  | 'retro-grid-4'
  | 'retro-grid-5'
  | 'dna-helix'
  | 'starburst'
  | 'glitch-wave'
  | 'pixel-matrix'
  | 'pixel-matrix-idle'
  | 'retro-arcade'
  | 'retro-arcade-idle';

export type AudioInputSource = 'microphone' | 'system-audio' | 'audio-interface';

export const PRESET_LABELS: Record<VisualizerPreset, string> = {
  'plasma-wave': '🌊 Plasma Wave',
  'spectrum-bars': '📊 Spectrum Bars',
  'radial-burst': '💥 Radial Burst',
  'waveform-landscape': '🏔️ Waveform Landscape',
  'particle-nebula': '🌌 Particle Nebula',
  'tunnel-flight': '🕳️ Tunnel Flight',
  'kaleidoscope': '🔮 Kaleidoscope',
  'ocean-pulse': '🌀 Ocean Pulse',
  'emoji-rain': '🎉 Emoji Rain',
  'emoji-vortex': '😎 Emoji Vortex',
  'eq-classic': '🎚️ Classic EQ',
  'oscilloscope': '📈 Oscilloscope',
  'smiley-bounce': '😄 Smiley Bounce',
  'fire-inferno': '🔥 Fire Inferno',
  'explosion-burst': '💣 Explosions',
  'laser-beams': '⚡ Laser Beams',
  'cartoon-pop': '💫 Cartoon Pop',
  'halloween': '🎃 Halloween',
  'christmas': '🎄 Christmas',
  'easter': '🐰 Easter',
  'summer-vibes': '☀️ Summer Vibes',
  'winter-frost': '❄️ Winter Frost',
  'matrix-rain': '🟢 Matrix Rain',
  'disco-ball': '🪩 Disco Ball',
  'northern-lights': '🌌 Northern Lights',
  'retro-grid': '📐 Retro Grid',
  'retro-grid-2': '📐 Retro EQ Bass',
  'retro-grid-3': '📐 Retro EQ Treble',
  'retro-grid-4': '📐 Retro EQ Full',
  'retro-grid-5': '📐 Retro Neon Pulse',
  'dna-helix': '🧬 DNA Helix',
  'starburst': '⭐ Starburst',
  'glitch-wave': '📺 Glitch Wave',
  'pixel-matrix': '🟩 Pixel Matrix',
  'pixel-matrix-idle': '🟩 Pixel Matrix (Idle)',
  'retro-arcade': '👾 Retro Arcade',
  'retro-arcade-idle': '👾 Retro Arcade (Idle)',
};

export const INPUT_LABELS: Record<AudioInputSource, string> = {
  'microphone': '🎤 Microphone',
  'system-audio': '🔊 System Audio (Loopback)',
  'audio-interface': '🎛️ Audio Interface',
};

export class AudioVisualizerEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freqData: Uint8Array = new Uint8Array(0);
  private timeData: Uint8Array = new Uint8Array(0);
  private _isRunning = false;
  private _preset: VisualizerPreset = 'plasma-wave';
  private _sensitivity = 1.0;
  private _colorShift = 0;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; hue: number; size?: number }[] = [];
  private emojis: { x: number; y: number; vx: number; vy: number; life: number; emoji: string; size: number; rot: number; rotV: number }[] = [];
  private matrixDrops: { x: number; y: number; speed: number; chars: string[] }[] = [];
  private static EMOJI_POOL = ['🔥','💥','⚡','🎵','🎶','✨','💫','🌟','❤️','💜','💙','🧡','💚','🎸','🥁','🎤','🎹','🎷','🎺','🪩','👾','🤖','😎','🤯','🥳','🪐','🌈','🦄','👽','💀','🎃','🍕','🌶️','💎','🫧'];
  private static HALLOWEEN_EMOJIS = ['🎃','👻','💀','🦇','🕷️','🕸️','🧟','🧛','⚰️','🌙','🖤','😱','🍬','🧙','☠️'];
  private static CHRISTMAS_EMOJIS = ['🎄','🎅','⭐','🎁','❄️','☃️','🦌','🔔','🕯️','🤶','🎀','🧦','🌟','❤️','💚'];
  private static EASTER_EMOJIS = ['🐰','🥚','🐣','🌷','🌸','🦋','🐤','🌼','🎀','🐇','💐','🌈','☀️','🍫','✨'];
  private static SMILEY_POOL = ['😀','😄','😁','😆','🤣','😂','🙂','😉','😎','🤩','🥳','😍','🤪','😜','🤗','😊','🥰','😇'];

  get isRunning() { return this._isRunning; }
  get preset() { return this._preset; }
  set preset(p: VisualizerPreset) { this._preset = p; }
  set sensitivity(s: number) { this._sensitivity = Math.max(0.1, Math.min(3, s)); }
  set colorShift(c: number) { this._colorShift = c; }

  async start(inputSource: AudioInputSource, deviceId?: string): Promise<void> {
    this.stop();
    try {
      let stream: MediaStream;
      if (inputSource === 'system-audio') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: false,
        } as any);
      } else {
        const constraints: MediaStreamConstraints = {
          audio: deviceId
            ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      this.stream = stream;
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.source = this.audioCtx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      this.timeData = new Uint8Array(this.analyser.fftSize) as Uint8Array<ArrayBuffer>;
      this._isRunning = true;
    } catch (err) {
      console.error('Audio input error:', err);
      throw err;
    }
  }

  stop(): void {
    this._isRunning = false;
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
  }

  static async getInputDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  private getEnergy(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData as any);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
    return (sum / this.freqData.length / 255) * this._sensitivity;
  }

  private getBass(): number {
    if (!this.analyser) return 0;
    const bassRange = Math.floor(this.freqData.length * 0.1);
    let sum = 0;
    for (let i = 0; i < bassRange; i++) sum += this.freqData[i];
    return Math.min(1, (sum / bassRange / 255) * this._sensitivity * 1.5);
  }

  private getTreble(): number {
    if (!this.analyser) return 0;
    const start = Math.floor(this.freqData.length * 0.6);
    let sum = 0, count = 0;
    for (let i = start; i < this.freqData.length; i++) { sum += this.freqData[i]; count++; }
    return Math.min(1, (sum / count / 255) * this._sensitivity * 1.2);
  }

  private getMid(): number {
    if (!this.analyser) return 0;
    const start = Math.floor(this.freqData.length * 0.1);
    const end = Math.floor(this.freqData.length * 0.6);
    let sum = 0, count = 0;
    for (let i = start; i < end; i++) { sum += this.freqData[i]; count++; }
    return Math.min(1, (sum / count / 255) * this._sensitivity * 1.3);
  }

  // Idle presets that render without audio
  private static IDLE_PRESETS: Set<VisualizerPreset> = new Set(['pixel-matrix-idle', 'retro-arcade-idle']);

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this._isRunning || !this.analyser) {
      // Idle presets render their own animation without audio
      if (AudioVisualizerEngine.IDLE_PRESETS.has(this._preset)) {
        const t = Date.now() / 1000;
        switch (this._preset) {
          case 'pixel-matrix-idle': this.renderPixelMatrix(ctx, w, h, 0, 0, 0, 0, t); break;
          case 'retro-arcade-idle': this.renderRetroArcade(ctx, w, h, 0, 0, 0, 0, t); break;
        }
        return;
      }
      const t = Date.now() / 3000;
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 3; i++) {
        const gx = (Math.sin(t + i * 2) * 0.5 + 0.5) * w;
        const gy = (Math.cos(t * 0.6 + i) * 0.5 + 0.5) * h;
        const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 100);
        grad.addColorStop(0, `hsla(${(t * 40 + i * 120) % 360}, 60%, 30%, 0.15)`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      return;
    }

    this.analyser.getByteFrequencyData(this.freqData as any);
    this.analyser.getByteTimeDomainData(this.timeData as any);
    const energy = this.getEnergy();
    const bass = this.getBass();
    const treble = this.getTreble();
    const mid = this.getMid();
    const t = Date.now() / 1000;

    switch (this._preset) {
      case 'plasma-wave': this.renderPlasma(ctx, w, h, energy, bass, treble, t); break;
      case 'spectrum-bars': this.renderSpectrum(ctx, w, h, energy, bass, t); break;
      case 'radial-burst': this.renderRadial(ctx, w, h, energy, bass, treble, t); break;
      case 'waveform-landscape': this.renderLandscape(ctx, w, h, energy, bass, t); break;
      case 'particle-nebula': this.renderNebula(ctx, w, h, energy, bass, treble, t); break;
      case 'tunnel-flight': this.renderTunnel(ctx, w, h, energy, bass, treble, t); break;
      case 'kaleidoscope': this.renderKaleidoscope(ctx, w, h, energy, bass, treble, t); break;
      case 'ocean-pulse': this.renderOcean(ctx, w, h, energy, bass, treble, t); break;
      case 'emoji-rain': this.renderEmojiRain(ctx, w, h, energy, bass, treble, t); break;
      case 'emoji-vortex': this.renderEmojiVortex(ctx, w, h, energy, bass, treble, t); break;
      case 'eq-classic': this.renderEQClassic(ctx, w, h, energy, bass, mid, treble, t); break;
      case 'oscilloscope': this.renderOscilloscope(ctx, w, h, energy, bass, t); break;
      case 'smiley-bounce': this.renderSmileyBounce(ctx, w, h, energy, bass, treble, t); break;
      case 'fire-inferno': this.renderFire(ctx, w, h, energy, bass, t); break;
      case 'explosion-burst': this.renderExplosions(ctx, w, h, energy, bass, treble, t); break;
      case 'laser-beams': this.renderLasers(ctx, w, h, energy, bass, treble, t); break;
      case 'cartoon-pop': this.renderCartoonPop(ctx, w, h, energy, bass, treble, t); break;
      case 'halloween': this.renderThemedEmojis(ctx, w, h, energy, bass, treble, t, AudioVisualizerEngine.HALLOWEEN_EMOJIS, 270, 20); break;
      case 'christmas': this.renderThemedEmojis(ctx, w, h, energy, bass, treble, t, AudioVisualizerEngine.CHRISTMAS_EMOJIS, 120, 0); break;
      case 'easter': this.renderThemedEmojis(ctx, w, h, energy, bass, treble, t, AudioVisualizerEngine.EASTER_EMOJIS, 300, 50); break;
      case 'summer-vibes': this.renderSummer(ctx, w, h, energy, bass, treble, t); break;
      case 'winter-frost': this.renderWinter(ctx, w, h, energy, bass, treble, t); break;
      case 'matrix-rain': this.renderMatrix(ctx, w, h, energy, bass, t); break;
      case 'disco-ball': this.renderDisco(ctx, w, h, energy, bass, treble, t); break;
      case 'northern-lights': this.renderAurora(ctx, w, h, energy, bass, treble, t); break;
      case 'retro-grid': this.renderRetroGrid(ctx, w, h, energy, bass, t); break;
      case 'retro-grid-2': this.renderRetroGrid2(ctx, w, h, energy, bass, mid, treble, t); break;
      case 'retro-grid-3': this.renderRetroGrid3(ctx, w, h, energy, bass, mid, treble, t); break;
      case 'retro-grid-4': this.renderRetroGrid4(ctx, w, h, energy, bass, mid, treble, t); break;
      case 'retro-grid-5': this.renderRetroGrid5(ctx, w, h, energy, bass, mid, treble, t); break;
      case 'dna-helix': this.renderDNA(ctx, w, h, energy, bass, treble, t); break;
      case 'starburst': this.renderStarburst(ctx, w, h, energy, bass, treble, t); break;
      case 'glitch-wave': this.renderGlitch(ctx, w, h, energy, bass, treble, t); break;
    }
  }

  // ── Original presets ──

  private renderPlasma(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    const step = 8;
    for (let x = 0; x < w; x += step) {
      for (let y = 0; y < h; y += step) {
        const nx = x / w, ny = y / h;
        const v1 = Math.sin(nx * 6 + t * 2 + bass * 4);
        const v2 = Math.sin(ny * 8 - t * 1.5 + energy * 3);
        const v3 = Math.sin((nx + ny) * 5 + t + treble * 5);
        const v = (v1 + v2 + v3) / 3;
        const hue = (v * 120 + t * 30 + this._colorShift) % 360;
        const light = 20 + energy * 40 + v * 15;
        ctx.fillStyle = `hsl(${hue}, 80%, ${light}%)`;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  private renderSpectrum(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, t: number) {
    ctx.fillStyle = `rgba(0,0,0,0.85)`;
    ctx.fillRect(0, 0, w, h);
    const barCount = 64;
    const barW = w / barCount;
    const step = Math.floor(this.freqData.length / barCount);
    for (let i = 0; i < barCount; i++) {
      const val = this.freqData[i * step] / 255 * this._sensitivity;
      const barH = val * h * 0.9;
      const hue = (i / barCount * 300 + t * 20 + this._colorShift) % 360;
      const grad = ctx.createLinearGradient(0, h / 2 - barH / 2, 0, h / 2 + barH / 2);
      grad.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.9)`);
      grad.addColorStop(0.5, `hsla(${hue}, 80%, 45%, 1)`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 60%, 0.9)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * barW + 1, h / 2 - barH / 2, barW - 2, barH);
      ctx.shadowColor = `hsl(${hue}, 90%, 60%)`;
      ctx.shadowBlur = bass * 20;
      ctx.fillRect(i * barW + 1, h / 2 - barH / 2, barW - 2, barH);
      ctx.shadowBlur = 0;
    }
  }

  private renderRadial(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = `rgba(0,0,0,0.15)`;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const rays = 128;
    const step = Math.floor(this.freqData.length / rays);
    for (let i = 0; i < rays; i++) {
      const angle = (i / rays) * Math.PI * 2 + t * 0.3;
      const val = (this.freqData[i * step] / 255) * this._sensitivity;
      const len = val * Math.min(w, h) * 0.45 + 20;
      const hue = (i / rays * 360 + t * 40 + this._colorShift) % 360;
      ctx.strokeStyle = `hsla(${hue}, 85%, ${40 + val * 30}%, ${0.5 + val * 0.5})`;
      ctx.lineWidth = 1.5 + bass * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * 20, cy + Math.sin(angle) * 20);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }
    const pulseR = 15 + bass * 60;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
    grad.addColorStop(0, `hsla(${(t * 60 + this._colorShift) % 360}, 80%, 60%, 0.8)`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderLandscape(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, t: number) {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, w, h);
    const layers = 5;
    for (let l = 0; l < layers; l++) {
      const yBase = h * 0.3 + l * (h * 0.12);
      const alpha = 1 - l * 0.15;
      const hue = (l * 50 + t * 20 + this._colorShift) % 360;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        const idx = Math.floor((x / w) * this.timeData.length);
        const sample = (this.timeData[idx] / 128 - 1) * this._sensitivity;
        const y = yBase + sample * 80 * (1 + bass) + Math.sin(x / 40 + t + l) * 10;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 70%, ${25 + l * 5}%, ${alpha * 0.7})`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 80%, 55%, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private renderNebula(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,5,0.1)';
    ctx.fillRect(0, 0, w, h);
    if (bass > 0.4 && this.particles.length < 200) {
      for (let i = 0; i < Math.floor(bass * 8); i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + bass * 3;
        this.particles.push({
          x: w / 2 + (Math.random() - 0.5) * 50,
          y: h / 2 + (Math.random() - 0.5) * 50,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          hue: (t * 40 + Math.random() * 60 + this._colorShift) % 360,
        });
      }
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.008;
      p.vx *= 0.995;
      p.vy *= 0.995;
      const size = p.life * 6 + energy * 4;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
      grad.addColorStop(0, `hsla(${p.hue}, 80%, 60%, ${p.life * 0.8})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private renderTunnel(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const rings = 20;
    for (let r = rings; r >= 1; r--) {
      const progress = r / rings;
      const radius = progress * Math.min(w, h) * 0.6 * (1 + bass * 0.3);
      const freqIdx = Math.floor(progress * this.freqData.length * 0.5);
      const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
      const hue = (r * 18 + t * 30 + this._colorShift) % 360;
      ctx.strokeStyle = `hsla(${hue}, 80%, ${30 + val * 40}%, ${0.3 + val * 0.5})`;
      ctx.lineWidth = 1 + val * 3;
      ctx.beginPath();
      const sides = 6;
      for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2 + t * 0.2 + r * 0.1;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  private renderKaleidoscope(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const segments = 12;
    for (let s = 0; s < segments; s++) {
      const baseAngle = (s / segments) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(baseAngle + t * 0.1);
      if (s % 2 === 1) ctx.scale(1, -1);
      const points = 32;
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const freqIdx = Math.floor((i / points) * this.freqData.length * 0.3);
        const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
        const r = 30 + i * 8 + val * 60;
        const a = (i / points) * (Math.PI * 2 / segments);
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      const hue = (s * 30 + t * 25 + this._colorShift) % 360;
      ctx.strokeStyle = `hsla(${hue}, 80%, ${45 + energy * 25}%, ${0.4 + bass * 0.4})`;
      ctx.lineWidth = 1 + bass * 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderOcean(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    const step = 6;
    for (let x = 0; x < w; x += step) {
      for (let y = 0; y < h; y += step) {
        const nx = x / w, ny = y / h;
        const cx = 0.5, cy = 0.5;
        const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
        const freqIdx = Math.floor(dist * this.freqData.length * 0.4);
        const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
        const wave = Math.sin(dist * 20 - t * 3 + val * 4 + bass * 6);
        const hue = (200 + wave * 40 + dist * 60 + this._colorShift) % 360;
        const light = 10 + wave * 15 + val * 25 + bass * 15;
        ctx.fillStyle = `hsl(${hue}, 70%, ${Math.max(5, light)}%)`;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  private renderEmojiRain(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, w, h);
    const pool = AudioVisualizerEngine.EMOJI_POOL;
    if (bass > 0.3 && this.emojis.length < 150) {
      const count = Math.floor(bass * 6) + 1;
      for (let i = 0; i < count; i++) {
        this.emojis.push({
          x: Math.random() * w, y: -30,
          vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 3 + energy * 4,
          life: 1, emoji: pool[Math.floor(Math.random() * pool.length)],
          size: 20 + Math.random() * 30 + bass * 20,
          rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.15,
        });
      }
    }
    this.emojis = this.emojis.filter(e => e.life > 0);
    this.emojis.forEach(e => {
      e.x += e.vx; e.y += e.vy; e.rot += e.rotV; e.life -= 0.006;
      if (e.y > h + 50) e.life = 0;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot);
      ctx.globalAlpha = Math.min(1, e.life * 2);
      ctx.font = `${Math.floor(e.size)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.emoji, 0, 0); ctx.restore();
    });
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
    grad.addColorStop(0, `hsla(${(t * 50 + this._colorShift) % 360}, 70%, 20%, ${bass * 0.3})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  }

  private renderEmojiVortex(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const pool = AudioVisualizerEngine.EMOJI_POOL;
    if (energy > 0.15 && this.emojis.length < 180) {
      const count = Math.floor(energy * 4) + 1;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + bass * 5;
        this.emojis.push({
          x: cx + (Math.random() - 0.5) * 30, y: cy + (Math.random() - 0.5) * 30,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 1, emoji: pool[Math.floor(Math.random() * pool.length)],
          size: 16 + Math.random() * 24 + bass * 15, rot: 0, rotV: (Math.random() - 0.5) * 0.2,
        });
      }
    }
    this.emojis = this.emojis.filter(e => e.life > 0);
    this.emojis.forEach(e => {
      const dx = e.x - cx, dy = e.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) + 0.03 + treble * 0.05;
      const outSpeed = 0.5 + energy * 2;
      e.vx = Math.cos(ang) * (dist * 0.02 + outSpeed);
      e.vy = Math.sin(ang) * (dist * 0.02 + outSpeed);
      e.x += e.vx; e.y += e.vy; e.rot += e.rotV; e.life -= 0.005;
      if (e.x < -50 || e.x > w + 50 || e.y < -50 || e.y > h + 50) e.life = 0;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot);
      ctx.globalAlpha = Math.min(1, e.life * 1.5);
      ctx.font = `${Math.floor(e.size)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.emoji, 0, 0); ctx.restore();
    });
  }

  // ── NEW PRESETS ──

  private renderEQClassic(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, mid: number, treble: number, t: number) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    // Draw green LED-style EQ bars
    const bands = 32;
    const barW = (w - 40) / bands;
    const maxLeds = 20;
    const ledH = (h - 40) / maxLeds;
    const step = Math.floor(this.freqData.length / bands);
    for (let i = 0; i < bands; i++) {
      const val = this.freqData[i * step] / 255 * this._sensitivity;
      const litLeds = Math.floor(val * maxLeds);
      for (let j = 0; j < maxLeds; j++) {
        const x = 20 + i * barW;
        const y = h - 20 - (j + 1) * ledH;
        const isLit = j < litLeds;
        const pct = j / maxLeds;
        const hue = pct < 0.6 ? 120 : pct < 0.85 ? 60 : 0; // green → yellow → red
        ctx.fillStyle = isLit ? `hsla(${hue}, 90%, 50%, 0.95)` : `hsla(${hue}, 30%, 10%, 0.3)`;
        ctx.fillRect(x + 1, y + 1, barW - 2, ledH - 2);
        if (isLit) {
          ctx.shadowColor = `hsl(${hue}, 90%, 50%)`;
          ctx.shadowBlur = 4;
          ctx.fillRect(x + 1, y + 1, barW - 2, ledH - 2);
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  private renderOscilloscope(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, t: number) {
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);
    // Grid
    ctx.strokeStyle = 'rgba(0,255,100,0.08)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += w / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += h / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    // Waveform
    ctx.strokeStyle = `hsla(120, 100%, ${50 + energy * 30}%, 0.9)`;
    ctx.lineWidth = 2 + bass * 2;
    ctx.shadowColor = '#00ff66';
    ctx.shadowBlur = 8 + bass * 12;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const idx = Math.floor((x / w) * this.timeData.length);
      const sample = (this.timeData[idx] / 128 - 1) * this._sensitivity;
      const y = h / 2 + sample * h * 0.4;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private renderSmileyBounce(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, w, h);
    const pool = AudioVisualizerEngine.SMILEY_POOL;
    if (bass > 0.35 && this.emojis.length < 80) {
      for (let i = 0; i < Math.floor(bass * 4); i++) {
        this.emojis.push({
          x: Math.random() * w, y: h + 20,
          vx: (Math.random() - 0.5) * 4, vy: -(3 + Math.random() * 6 + bass * 8),
          life: 1, emoji: pool[Math.floor(Math.random() * pool.length)],
          size: 30 + Math.random() * 40 + bass * 20,
          rot: 0, rotV: (Math.random() - 0.5) * 0.3,
        });
      }
    }
    this.emojis = this.emojis.filter(e => e.life > 0);
    this.emojis.forEach(e => {
      e.vy += 0.15; // gravity
      e.x += e.vx; e.y += e.vy; e.rot += e.rotV; e.life -= 0.008;
      if (e.y > h + 60) e.life = 0;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot);
      ctx.globalAlpha = Math.min(1, e.life * 2);
      ctx.font = `${Math.floor(e.size)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.emoji, 0, 0); ctx.restore();
    });
  }

  private renderFire(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, w, h);
    // Spawn fire particles from bottom
    if (this.particles.length < 300) {
      for (let i = 0; i < 3 + Math.floor(energy * 8); i++) {
        this.particles.push({
          x: Math.random() * w, y: h + 5,
          vx: (Math.random() - 0.5) * 2, vy: -(1 + Math.random() * 4 + bass * 6),
          life: 1, hue: Math.random() * 60, // red-yellow range
          size: 3 + Math.random() * 8 + bass * 6,
        });
      }
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => {
      p.x += p.vx + Math.sin(t * 3 + p.y * 0.05) * 0.5;
      p.y += p.vy;
      p.life -= 0.015;
      p.vx *= 0.99;
      const size = (p.size || 4) * p.life;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
      const hue = p.hue + (1 - p.life) * 30; // shift to yellow as it rises
      grad.addColorStop(0, `hsla(${hue}, 100%, ${50 + p.life * 30}%, ${p.life * 0.9})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private renderExplosions(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, w, h);
    // Spawn explosion on bass hit
    if (bass > 0.5 && this.particles.length < 250) {
      const cx = Math.random() * w, cy = Math.random() * h;
      const count = 15 + Math.floor(bass * 20);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 8 + bass * 5;
        this.particles.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 1, hue: (Math.random() * 60 + 10 + this._colorShift) % 360,
          size: 2 + Math.random() * 5,
        });
      }
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.96; p.vy *= 0.96;
      p.vy += 0.1; // gravity
      p.life -= 0.02;
      const size = (p.size || 3) * (0.5 + p.life * 0.5);
      ctx.fillStyle = `hsla(${p.hue}, 100%, ${40 + p.life * 40}%, ${p.life})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private renderLasers(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, h);
    const beamCount = 8 + Math.floor(energy * 12);
    const cx = w / 2, cy = 0;
    for (let i = 0; i < beamCount; i++) {
      const freqIdx = Math.floor((i / beamCount) * this.freqData.length * 0.5);
      const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
      if (val < 0.1) continue;
      const angle = (i / beamCount) * Math.PI + Math.sin(t * 2 + i * 0.5) * 0.3 + bass * 0.2;
      const len = val * Math.max(w, h);
      const hue = (i * 30 + t * 60 + this._colorShift) % 360;
      ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${val * 0.8})`;
      ctx.lineWidth = 1 + val * 3;
      ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
      ctx.shadowBlur = 10 + val * 15;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  private renderCartoonPop(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);
    const words = ['POW!', 'BAM!', 'ZAP!', 'BOOM!', 'WHAM!', 'CRACK!', 'POP!', '💥', '⚡', '✨'];
    if (bass > 0.45 && this.emojis.length < 30) {
      this.emojis.push({
        x: Math.random() * w * 0.8 + w * 0.1, y: Math.random() * h * 0.8 + h * 0.1,
        vx: 0, vy: 0, life: 1,
        emoji: words[Math.floor(Math.random() * words.length)],
        size: 30 + bass * 50, rot: (Math.random() - 0.5) * 0.5, rotV: 0,
      });
    }
    this.emojis = this.emojis.filter(e => e.life > 0);
    this.emojis.forEach(e => {
      e.life -= 0.025;
      const scale = 0.5 + e.life * 0.5;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot); ctx.scale(scale, scale);
      ctx.globalAlpha = Math.min(1, e.life * 3);
      // Star burst background
      const burstR = e.size * 1.5;
      const hue = (t * 100 + e.x) % 360;
      ctx.fillStyle = `hsla(${hue}, 90%, 55%, ${e.life * 0.6})`;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? burstR : burstR * 0.5;
        i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      // Text
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(e.size)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(e.emoji, 0, 0);
      ctx.fillText(e.emoji, 0, 0);
      ctx.restore();
    });
  }

  private renderThemedEmojis(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number, pool: string[], bgHue: number, bgLightBase: number) {
    // Themed background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, `hsla(${bgHue}, 30%, ${bgLightBase + 3}%, 0.15)`);
    bgGrad.addColorStop(1, `hsla(${bgHue}, 40%, ${bgLightBase}%, 0.15)`);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, w, h);

    if (bass > 0.25 && this.emojis.length < 120) {
      const count = Math.floor(bass * 5) + 1;
      for (let i = 0; i < count; i++) {
        this.emojis.push({
          x: Math.random() * w, y: -30,
          vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3 + energy * 3,
          life: 1, emoji: pool[Math.floor(Math.random() * pool.length)],
          size: 24 + Math.random() * 36 + bass * 15,
          rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.1,
        });
      }
    }
    this.emojis = this.emojis.filter(e => e.life > 0);
    this.emojis.forEach(e => {
      e.x += e.vx; e.y += e.vy; e.rot += e.rotV; e.life -= 0.005;
      if (e.y > h + 50) e.life = 0;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot);
      ctx.globalAlpha = Math.min(1, e.life * 2);
      ctx.font = `${Math.floor(e.size)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.emoji, 0, 0); ctx.restore();
    });
  }

  private renderSummer(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    // Warm gradient bg
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `hsla(30, 80%, ${15 + energy * 10}%, 0.15)`);
    grad.addColorStop(1, `hsla(200, 60%, ${8 + bass * 5}%, 0.15)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, w, h);
    const summerEmojis = ['☀️','🌴','🏖️','🍹','🌊','🐚','🏄','🍉','🌺','🦩','🕶️','🍍','🌻','⛱️','🐠'];
    this.renderThemedEmojis(ctx, w, h, energy, bass, treble, t, summerEmojis, 35, 12);
  }

  private renderWinter(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(5,5,15,0.1)';
    ctx.fillRect(0, 0, w, h);
    // Snowflakes
    if (this.emojis.length < 100) {
      this.emojis.push({
        x: Math.random() * w, y: -10,
        vx: (Math.random() - 0.5) * 1 + Math.sin(t + Math.random() * 10) * 0.5,
        vy: 0.3 + Math.random() * 1.5,
        life: 1, emoji: Math.random() > 0.5 ? '❄️' : '✨',
        size: 12 + Math.random() * 24, rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.02,
      });
    }
    // Bass spawn bigger ones
    if (bass > 0.3 && this.emojis.length < 150) {
      const winterEmojis = ['❄️','⛄','🌨️','🏔️','🎿','🧊','☃️','🥶'];
      for (let i = 0; i < Math.floor(bass * 3); i++) {
        this.emojis.push({
          x: Math.random() * w, y: -20,
          vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 3,
          life: 1, emoji: winterEmojis[Math.floor(Math.random() * winterEmojis.length)],
          size: 28 + bass * 20, rot: 0, rotV: (Math.random() - 0.5) * 0.1,
        });
      }
    }
    this.emojis = this.emojis.filter(e => e.life > 0);
    this.emojis.forEach(e => {
      e.x += e.vx; e.y += e.vy; e.rot += e.rotV; e.life -= 0.003;
      if (e.y > h + 30) e.life = 0;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot);
      ctx.globalAlpha = Math.min(1, e.life * 2);
      ctx.font = `${Math.floor(e.size)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.emoji, 0, 0); ctx.restore();
    });
    // Blue glow
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
    bgGrad.addColorStop(0, `hsla(210, 60%, 30%, ${bass * 0.15})`);
    bgGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, w, h);
  }

  private renderMatrix(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);
    const colW = 14;
    const cols = Math.floor(w / colW);
    if (this.matrixDrops.length === 0) {
      for (let i = 0; i < cols; i++) {
        this.matrixDrops.push({
          x: i * colW, y: Math.random() * h,
          speed: 2 + Math.random() * 4,
          chars: Array.from({ length: 20 }, () => String.fromCharCode(0x30A0 + Math.random() * 96)),
        });
      }
    }
    ctx.font = '12px monospace';
    this.matrixDrops.forEach(drop => {
      drop.y += drop.speed * (1 + energy * 2);
      if (drop.y > h + 200) { drop.y = -200; drop.speed = 2 + Math.random() * 4; }
      drop.chars.forEach((ch, i) => {
        const cy = drop.y - i * 14;
        if (cy < 0 || cy > h) return;
        const alpha = i === 0 ? 1 : Math.max(0, 1 - i * 0.06);
        const lightness = i === 0 ? 80 : 45;
        ctx.fillStyle = `hsla(120, 100%, ${lightness}%, ${alpha})`;
        if (i === 0) { ctx.shadowColor = '#00ff44'; ctx.shadowBlur = 8; }
        ctx.fillText(Math.random() > 0.95 ? String.fromCharCode(0x30A0 + Math.random() * 96) : ch, drop.x, cy);
        if (i === 0) ctx.shadowBlur = 0;
      });
    });
  }

  private renderDisco(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    // Disco ball reflections
    const reflections = 20 + Math.floor(energy * 30);
    for (let i = 0; i < reflections; i++) {
      const freqIdx = Math.floor((i / reflections) * this.freqData.length * 0.5);
      const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
      if (val < 0.15) continue;
      const angle = (i / reflections) * Math.PI * 2 + t * 0.5;
      const dist = 30 + val * Math.min(w, h) * 0.5;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist;
      const size = 3 + val * 15;
      const hue = (i * 25 + t * 80) % 360;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, size);
      grad.addColorStop(0, `hsla(${hue}, 80%, 70%, ${val})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center ball
    const ballR = 15 + bass * 10;
    ctx.fillStyle = `hsla(0, 0%, 80%, 0.6)`;
    ctx.beginPath();
    ctx.arc(cx, cy, ballR, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderAurora(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,2,8,0.08)';
    ctx.fillRect(0, 0, w, h);
    const layers = 6;
    for (let l = 0; l < layers; l++) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 3) {
        const nx = x / w;
        const freqIdx = Math.floor(nx * this.freqData.length * 0.3 + l * 20);
        const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
        const yBase = h * (0.2 + l * 0.1);
        const wave = Math.sin(nx * 4 + t * (0.5 + l * 0.1) + l * 2) * 40 * (1 + val);
        ctx.lineTo(x, yBase + wave);
      }
      ctx.lineTo(w, h); ctx.closePath();
      const hue = (120 + l * 40 + t * 10 + this._colorShift) % 360;
      ctx.fillStyle = `hsla(${hue}, 70%, ${25 + energy * 20}%, ${0.15 + bass * 0.1})`;
      ctx.fill();
    }
  }

  private renderRetroGrid(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, t: number) {
    // ── Sunset gradient: orange top → deep purple bottom ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#ff8c00');
    bgGrad.addColorStop(0.4, '#cc3a00');
    bgGrad.addColorStop(0.7, '#6a0d83');
    bgGrad.addColorStop(1, '#1a0030');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.45;
    const mid = this.freqData.length > 0 ? Array.from(this.freqData.slice(Math.floor(this.freqData.length * 0.15), Math.floor(this.freqData.length * 0.5))).reduce((a, b) => a + b, 0) / (this.freqData.length * 0.35) / 255 * this._sensitivity : 0;

    // ── Neon green oscilloscope behind the sun ──
    ctx.save();
    ctx.strokeStyle = `hsla(120, 100%, 55%, ${0.5 + energy * 0.5})`;
    ctx.lineWidth = 3 + bass * 4;
    ctx.shadowColor = 'hsl(120, 100%, 50%)';
    ctx.shadowBlur = 15 + bass * 20;
    ctx.beginPath();
    const waveLen = this.timeData.length || 128;
    for (let i = 0; i < waveLen; i++) {
      const x = (i / waveLen) * w;
      const sample = (this.timeData[i] || 128) / 128 - 1;
      const y = horizon + sample * h * 0.25 * this._sensitivity;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 6 + bass * 6;
    ctx.shadowBlur = 30 + bass * 30;
    ctx.stroke();
    ctx.restore();

    // ── Sun – deep RED, reactive to bass ──
    const baseSunR = Math.min(w, h) * 0.12;
    const sunR = baseSunR + bass * baseSunR * 0.8 + energy * baseSunR * 0.3;
    const sunHue = 0 + bass * 8;
    const sunLum = 35 + mid * 10;
    const sunGrad = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, sunR * 1.5);
    sunGrad.addColorStop(0, `hsla(${sunHue}, 100%, ${sunLum + 15}%, 1)`);
    sunGrad.addColorStop(0.3, `hsla(${sunHue}, 95%, ${sunLum}%, 0.9)`);
    sunGrad.addColorStop(0.6, `hsla(${sunHue - 5}, 85%, ${sunLum - 10}%, 0.5)`);
    sunGrad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.shadowColor = `hsl(${sunHue}, 100%, 45%)`;
    ctx.shadowBlur = 30 + bass * 50;
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(w / 2, horizon, sunR * 1.3, 0, Math.PI * 2); ctx.fill();
    const coreGrad = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, sunR * 0.4);
    coreGrad.addColorStop(0, `hsla(${sunHue + 10}, 100%, 70%, 1)`);
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.arc(w / 2, horizon, sunR * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // ── Synthwave grid (perspective floor) ──
    const hLines = 18;
    for (let i = 0; i < hLines; i++) {
      const p = (i / hLines + t * 0.1) % 1;
      const y = horizon + (p * p) * (h - horizon);
      const alpha = p * (0.4 + bass * 0.6);
      ctx.strokeStyle = `hsla(${290 + this._colorShift}, 80%, 50%, ${alpha})`;
      ctx.lineWidth = 1 + bass * p * 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const vLines = 24;
    for (let i = 0; i < vLines; i++) {
      const nx = i / (vLines - 1);
      const topX = nx * w;
      const botX = (nx - 0.5) * w * 3 + w / 2;
      ctx.strokeStyle = `hsla(${290 + this._colorShift}, 80%, 50%, 0.35)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(topX, horizon); ctx.lineTo(botX, h); ctx.stroke();
    }
  }


  // ── Retro Grid 2: Bass EQ — bass-reactive EQ bars behind the grid ──
  private renderRetroGrid2(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, mid: number, treble: number, t: number) {
    ctx.fillStyle = '#0a0015';
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.5;

    // EQ bars in background — bass-reactive only
    const barCount = 32;
    const barW = w / barCount;
    const bassRange = Math.floor(this.freqData.length * 0.15);
    const step = Math.max(1, Math.floor(bassRange / barCount));
    for (let i = 0; i < barCount; i++) {
      const val = (this.freqData[i * step] || 0) / 255 * this._sensitivity;
      const barH = val * horizon * 0.9;
      const hue = (300 + i * 3 + this._colorShift) % 360;
      const grad = ctx.createLinearGradient(0, horizon - barH, 0, horizon);
      grad.addColorStop(0, `hsla(${hue}, 90%, 60%, ${0.6 + val * 0.4})`);
      grad.addColorStop(1, `hsla(${hue}, 80%, 30%, 0.1)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * barW + 1, horizon - barH, barW - 2, barH);
      // Glow on strong hits
      if (val > 0.6) {
        ctx.shadowColor = `hsl(${hue}, 90%, 60%)`;
        ctx.shadowBlur = val * 15;
        ctx.fillRect(i * barW + 1, horizon - barH, barW - 2, barH);
        ctx.shadowBlur = 0;
      }
    }

    // Synthwave grid (perspective floor)
    const hLines = 15;
    for (let i = 0; i < hLines; i++) {
      const p = (i / hLines + t * 0.1) % 1;
      const y = horizon + (p * p) * (h - horizon);
      const alpha = p * (0.5 + bass * 0.5);
      ctx.strokeStyle = `hsla(${300 + this._colorShift}, 80%, 50%, ${alpha})`;
      ctx.lineWidth = 1 + bass * p * 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const vLines = 20;
    for (let i = 0; i < vLines; i++) {
      const nx = i / (vLines - 1);
      ctx.strokeStyle = `hsla(${300 + this._colorShift}, 80%, 50%, 0.3)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(nx * w, horizon); ctx.lineTo((nx - 0.5) * w * 3 + w / 2, h); ctx.stroke();
    }

    // Sun pulsing with bass
    const sunR = 35 + bass * 40;
    const sunGrad = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, sunR);
    sunGrad.addColorStop(0, `hsla(40, 100%, 60%, ${0.7 + bass * 0.3})`);
    sunGrad.addColorStop(0.5, `hsla(350, 90%, 50%, 0.6)`);
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(w / 2, horizon, sunR, 0, Math.PI * 2); ctx.fill();
  }

  // ── Retro Grid 3: Treble EQ — treble/high-reactive vertical EQ ──
  private renderRetroGrid3(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, mid: number, treble: number, t: number) {
    ctx.fillStyle = '#0a0015';
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.5;

    // Treble-reactive EQ bars rising from top
    const barCount = 48;
    const barW = w / barCount;
    const trebleStart = Math.floor(this.freqData.length * 0.5);
    const trebleLen = this.freqData.length - trebleStart;
    const step = Math.max(1, Math.floor(trebleLen / barCount));
    for (let i = 0; i < barCount; i++) {
      const val = (this.freqData[trebleStart + i * step] || 0) / 255 * this._sensitivity;
      const barH = val * horizon * 0.7;
      const hue = (180 + i * 4 + this._colorShift) % 360;
      ctx.fillStyle = `hsla(${hue}, 90%, 55%, ${0.3 + val * 0.6})`;
      ctx.fillRect(i * barW + 1, 0, barW - 2, barH);
      // Mirror reflection below horizon
      ctx.fillStyle = `hsla(${hue}, 90%, 55%, ${0.1 + val * 0.2})`;
      ctx.fillRect(i * barW + 1, horizon, barW - 2, barH * 0.4);
    }

    // Sparkle lines on treble hits
    if (treble > 0.5) {
      const sparkles = Math.floor(treble * 12);
      for (let s = 0; s < sparkles; s++) {
        const sx = Math.random() * w;
        const sy = Math.random() * horizon * 0.8;
        ctx.strokeStyle = `hsla(${(180 + this._colorShift) % 360}, 90%, 80%, ${0.4 + Math.random() * 0.4})`;
        ctx.lineWidth = 0.5;
        const len = 5 + Math.random() * 15;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + len, sy); ctx.stroke();
      }
    }

    // Grid
    const hLines = 15;
    for (let i = 0; i < hLines; i++) {
      const p = (i / hLines + t * 0.08) % 1;
      const y = horizon + (p * p) * (h - horizon);
      ctx.strokeStyle = `hsla(${200 + this._colorShift}, 80%, 50%, ${p * 0.6})`;
      ctx.lineWidth = 0.8 + treble * p;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const vLines = 20;
    for (let i = 0; i < vLines; i++) {
      const nx = i / (vLines - 1);
      ctx.strokeStyle = `hsla(${200 + this._colorShift}, 80%, 50%, 0.3)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(nx * w, horizon); ctx.lineTo((nx - 0.5) * w * 3 + w / 2, h); ctx.stroke();
    }

    // Sun — cooler cyan tint, treble shimmer
    const sunR = 35 + treble * 25;
    const sunGrad = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, sunR);
    sunGrad.addColorStop(0, `hsla(190, 100%, 70%, ${0.7 + treble * 0.3})`);
    sunGrad.addColorStop(0.5, `hsla(260, 80%, 50%, 0.5)`);
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(w / 2, horizon, sunR, 0, Math.PI * 2); ctx.fill();
  }

  // ── Retro Grid 4: Full EQ — bass+mid+treble with mirrored EQ ──
  private renderRetroGrid4(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, mid: number, treble: number, t: number) {
    ctx.fillStyle = '#06000f';
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.45;

    // Full-spectrum mirrored EQ behind grid
    const barCount = 64;
    const barW = w / barCount;
    const step = Math.max(1, Math.floor(this.freqData.length / barCount));
    for (let i = 0; i < barCount; i++) {
      const val = (this.freqData[i * step] || 0) / 255 * this._sensitivity;
      const barH = val * horizon * 0.85;
      const freqPos = i / barCount;
      // Color: bass=magenta, mid=orange, treble=cyan
      const hue = freqPos < 0.2 ? 300 : freqPos < 0.6 ? 30 : 180;
      const sat = 85;
      const light = 40 + val * 25;

      // Upward bars
      const grad = ctx.createLinearGradient(0, horizon - barH, 0, horizon);
      grad.addColorStop(0, `hsla(${(hue + this._colorShift) % 360}, ${sat}%, ${light}%, ${0.7 + val * 0.3})`);
      grad.addColorStop(1, `hsla(${(hue + this._colorShift) % 360}, ${sat}%, 20%, 0.05)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * barW + 0.5, horizon - barH, barW - 1, barH);

      // Downward reflection (dimmer)
      const refGrad = ctx.createLinearGradient(0, horizon, 0, horizon + barH * 0.5);
      refGrad.addColorStop(0, `hsla(${(hue + this._colorShift) % 360}, ${sat}%, ${light}%, 0.25)`);
      refGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = refGrad;
      ctx.fillRect(i * barW + 0.5, horizon, barW - 1, barH * 0.5);
    }

    // Grid with energy-reactive brightness
    const hLines = 18;
    for (let i = 0; i < hLines; i++) {
      const p = (i / hLines + t * 0.12) % 1;
      const y = horizon + (p * p) * (h - horizon);
      const lineEnergy = bass * 0.5 + mid * 0.3 + treble * 0.2;
      ctx.strokeStyle = `hsla(${(280 + this._colorShift) % 360}, 80%, 50%, ${p * (0.3 + lineEnergy * 0.5)})`;
      ctx.lineWidth = 1 + lineEnergy * p * 3;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const vLines = 24;
    for (let i = 0; i < vLines; i++) {
      const nx = i / (vLines - 1);
      ctx.strokeStyle = `hsla(${(280 + this._colorShift) % 360}, 80%, 50%, ${0.2 + energy * 0.3})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(nx * w, horizon); ctx.lineTo((nx - 0.5) * w * 3 + w / 2, h); ctx.stroke();
    }

    // Sun — multi-colored reacting to all bands
    const sunR = 30 + bass * 25 + treble * 15;
    const sunGrad = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, sunR);
    sunGrad.addColorStop(0, `hsla(50, 100%, 65%, ${0.8 + energy * 0.2})`);
    sunGrad.addColorStop(0.4, `hsla(${(330 + this._colorShift) % 360}, 90%, 50%, 0.6)`);
    sunGrad.addColorStop(0.7, `hsla(${(270 + this._colorShift) % 360}, 80%, 40%, 0.3)`);
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(w / 2, horizon, sunR, 0, Math.PI * 2); ctx.fill();
  }

  // ── Retro Grid 5: Neon Pulse — bass shakes grid, treble sparks neon lines ──
  private renderRetroGrid5(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, mid: number, treble: number, t: number) {
    ctx.fillStyle = '#050012';
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.5;
    const bassShake = bass > 0.5 ? (Math.random() - 0.5) * bass * 6 : 0;

    // Neon mountain silhouette — bass reactive
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    const peaks = 12;
    for (let i = 0; i <= peaks; i++) {
      const px = (i / peaks) * w;
      const peakH = (Math.sin(i * 1.7 + 0.5) * 0.5 + 0.5) * horizon * 0.35 * (0.7 + bass * 0.6);
      const py = horizon - peakH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineTo(w, horizon);
    ctx.closePath();
    ctx.fillStyle = `hsla(${(280 + this._colorShift) % 360}, 60%, 8%, 0.9)`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${(300 + this._colorShift) % 360}, 90%, 60%, ${0.5 + bass * 0.5})`;
    ctx.lineWidth = 1.5 + bass * 2;
    ctx.stroke();

    // Grid with bass-shake offset
    const hLines = 15;
    for (let i = 0; i < hLines; i++) {
      const p = (i / hLines + t * 0.1) % 1;
      const y = horizon + (p * p) * (h - horizon) + bassShake;
      ctx.strokeStyle = `hsla(${(300 + this._colorShift) % 360}, 80%, 50%, ${p * 0.7})`;
      ctx.lineWidth = 1 + bass * p * 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const vLines = 20;
    for (let i = 0; i < vLines; i++) {
      const nx = i / (vLines - 1);
      ctx.strokeStyle = `hsla(${(300 + this._colorShift) % 360}, 80%, 50%, 0.35)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(nx * w, horizon + bassShake); ctx.lineTo((nx - 0.5) * w * 3 + w / 2, h); ctx.stroke();
    }

    // Neon laser lines on treble hits
    if (treble > 0.3) {
      const lineCount = Math.floor(treble * 6);
      for (let i = 0; i < lineCount; i++) {
        const ly = Math.random() * horizon * 0.8;
        const hue = (180 + Math.random() * 60 + this._colorShift) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.3 + treble * 0.6})`;
        ctx.lineWidth = 0.5 + treble;
        ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // Stars twinkling with treble
    const starCount = 30 + Math.floor(treble * 40);
    for (let i = 0; i < starCount; i++) {
      const sx = (Math.sin(i * 127.1 + t * 0.1) * 0.5 + 0.5) * w;
      const sy = (Math.cos(i * 311.7 + t * 0.05) * 0.5 + 0.5) * horizon * 0.8;
      const bright = (Math.sin(t * 3 + i * 2.3) * 0.5 + 0.5) * (0.3 + treble * 0.7);
      ctx.fillStyle = `rgba(255,255,255,${bright})`;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    // Sun — bass pulse
    const sunR = 40 + bass * 30;
    const sunGrad = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, sunR);
    sunGrad.addColorStop(0, `hsla(40, 100%, 60%, ${0.8 + bass * 0.2})`);
    sunGrad.addColorStop(0.4, `hsla(350, 90%, 50%, 0.6)`);
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(w / 2, horizon, sunR, 0, Math.PI * 2); ctx.fill();
  }

  private renderDNA(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,8,0.15)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const points = 60;
    for (let i = 0; i < points; i++) {
      const p = i / points;
      const y = p * h;
      const freqIdx = Math.floor(p * this.freqData.length * 0.4);
      const val = (this.freqData[freqIdx] || 0) / 255 * this._sensitivity;
      const twist = p * 8 + t * 2;
      const radius = 40 + val * 80;
      const x1 = cx + Math.sin(twist) * radius;
      const x2 = cx - Math.sin(twist) * radius;
      const hue1 = (p * 180 + t * 30 + this._colorShift) % 360;
      const hue2 = (hue1 + 180) % 360;
      // Strand 1
      ctx.fillStyle = `hsla(${hue1}, 80%, ${40 + val * 30}%, 0.8)`;
      ctx.beginPath(); ctx.arc(x1, y, 3 + val * 4, 0, Math.PI * 2); ctx.fill();
      // Strand 2
      ctx.fillStyle = `hsla(${hue2}, 80%, ${40 + val * 30}%, 0.8)`;
      ctx.beginPath(); ctx.arc(x2, y, 3 + val * 4, 0, Math.PI * 2); ctx.fill();
      // Connect rungs
      if (i % 3 === 0) {
        ctx.strokeStyle = `hsla(0, 0%, 60%, ${0.2 + val * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      }
    }
  }

  private renderStarburst(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);
    // Spawn bursts on bass
    if (bass > 0.4 && this.particles.length < 200) {
      const cx = Math.random() * w, cy = Math.random() * h;
      const points = 8 + Math.floor(bass * 8);
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        const speed = 3 + bass * 8;
        this.particles.push({
          x: cx, y: cy,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          life: 1, hue: (t * 50 + Math.random() * 60 + this._colorShift) % 360,
          size: 2 + Math.random() * 3,
        });
      }
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.97; p.vy *= 0.97;
      p.life -= 0.015;
      // Draw with trail
      ctx.strokeStyle = `hsla(${p.hue}, 90%, 60%, ${p.life * 0.8})`;
      ctx.lineWidth = (p.size || 2) * p.life;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
      ctx.stroke();
      ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${p.life})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.size || 2) * p.life, 0, Math.PI * 2); ctx.fill();
    });
  }

  private renderGlitch(ctx: CanvasRenderingContext2D, w: number, h: number, energy: number, bass: number, treble: number, t: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, w, h);
    // Horizontal scan lines
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.1 + Math.sin(y * 0.1 + t * 10) * 0.05})`;
      ctx.fillRect(0, y, w, 1);
    }
    // Glitch bars on bass
    if (bass > 0.3) {
      const bars = Math.floor(bass * 8) + 1;
      for (let i = 0; i < bars; i++) {
        const y = Math.random() * h;
        const barH = 2 + Math.random() * 20;
        const offsetX = (Math.random() - 0.5) * 30 * bass;
        const hue = (Math.random() * 360) | 0;
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${0.3 + bass * 0.5})`;
        ctx.fillRect(offsetX, y, w, barH);
      }
    }
    // Waveform with glitch offset
    const offset = bass > 0.4 ? (Math.random() - 0.5) * 20 : 0;
    ctx.strokeStyle = `hsla(${(t * 60) % 360}, 90%, 60%, 0.8)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const idx = Math.floor((x / w) * this.timeData.length);
      const sample = (this.timeData[idx] / 128 - 1) * this._sensitivity;
      const y = h / 2 + sample * h * 0.3 + offset;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // RGB split on bass hit
    if (bass > 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,0,0,0.3)`;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.floor((x / w) * this.timeData.length);
        const sample = (this.timeData[idx] / 128 - 1) * this._sensitivity;
        const y = h / 2 + sample * h * 0.3 + offset - 3;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(0,0,255,0.3)`;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = Math.floor((x / w) * this.timeData.length);
        const sample = (this.timeData[idx] / 128 - 1) * this._sensitivity;
        const y = h / 2 + sample * h * 0.3 + offset + 3;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  destroy() {
    this.stop();
    this.particles = [];
    this.emojis = [];
    this.matrixDrops = [];
  }
}