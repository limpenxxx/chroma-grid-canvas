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
  | 'ocean-pulse';

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
  private particles: { x: number; y: number; vx: number; vy: number; life: number; hue: number }[] = [];

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
        // getDisplayMedia with audio for system/loopback
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
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
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

  /** Get available audio input devices */
  static async getInputDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  /** Get current average energy (0-1) */
  private getEnergy(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
    return (sum / this.freqData.length / 255) * this._sensitivity;
  }

  /** Get bass energy (0-1) */
  private getBass(): number {
    if (!this.analyser) return 0;
    const bassRange = Math.floor(this.freqData.length * 0.1);
    let sum = 0;
    for (let i = 0; i < bassRange; i++) sum += this.freqData[i];
    return Math.min(1, (sum / bassRange / 255) * this._sensitivity * 1.5);
  }

  /** Get treble energy (0-1) */
  private getTreble(): number {
    if (!this.analyser) return 0;
    const start = Math.floor(this.freqData.length * 0.6);
    let sum = 0, count = 0;
    for (let i = start; i < this.freqData.length; i++) { sum += this.freqData[i]; count++; }
    return Math.min(1, (sum / count / 255) * this._sensitivity * 1.2);
  }

  /** Render one frame to the provided canvas context */
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this._isRunning || !this.analyser) {
      // Idle pattern
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

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    const energy = this.getEnergy();
    const bass = this.getBass();
    const treble = this.getTreble();
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
    }
  }

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
      // Mirror
      const grad = ctx.createLinearGradient(0, h / 2 - barH / 2, 0, h / 2 + barH / 2);
      grad.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.9)`);
      grad.addColorStop(0.5, `hsla(${hue}, 80%, 45%, 1)`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 60%, 0.9)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * barW + 1, h / 2 - barH / 2, barW - 2, barH);
      // Glow
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
    // Center pulse
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
    // Draw multiple waveform layers
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
    // Spawn particles on bass hits
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
    // Update & draw particles
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
      const offset = (t * 50 + r * 20) % (Math.min(w, h) * 0.6);
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
    // Deep ocean-like ripples
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

  destroy() {
    this.stop();
    this.particles = [];
  }
}
