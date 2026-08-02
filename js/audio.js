// ===== Âm thanh: SFX + nhạc nền tạo bằng WebAudio (không cần file ngoài) =====

export class AudioSys {
  constructor(save) {
    this.save = save;
    this.ctx = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
  }

  // Gọi sau thao tác đầu tiên của người dùng (trình duyệt yêu cầu)
  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this.applyVolumes();
    } catch { /* không có WebAudio */ }
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.musicGain.gain.value = this.save.musicVol * 0.25;
    this.sfxGain.gain.value = this.save.sfxVol * 0.5;
  }

  tone(freq, dur, type = 'sine', vol = 1, when = 0, dest = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  sfx(name) {
    this.ensure();
    if (!this.ctx) return;
    switch (name) {
      case 'click':  this.tone(600, 0.08, 'triangle', 0.5); break;
      case 'jump':   this.tone(340, 0.18, 'sine', 0.5); this.tone(520, 0.14, 'sine', 0.3, 0.05); break;
      case 'coin':   this.tone(920, 0.1, 'triangle', 0.5); this.tone(1240, 0.16, 'triangle', 0.45, 0.07); break;
      case 'hit':    this.tone(180, 0.12, 'square', 0.35); break;
      case 'chest':  this.tone(240, 0.1, 'square', 0.4); this.tone(160, 0.14, 'square', 0.3, 0.06); break;
      case 'break':  this.tone(140, 0.25, 'sawtooth', 0.4); this.tone(880, 0.2, 'triangle', 0.3, 0.1); break;
      case 'hurt':   this.tone(140, 0.3, 'sawtooth', 0.5); break;
      case 'shoot':  this.tone(760, 0.07, 'square', 0.4); this.tone(240, 0.1, 'sawtooth', 0.25, 0.02); break;
      case 'buy':    this.tone(660, 0.1, 'triangle', 0.5); this.tone(990, 0.18, 'triangle', 0.4, 0.08); break;
      case 'deny':   this.tone(200, 0.2, 'square', 0.4); this.tone(150, 0.25, 'square', 0.3, 0.1); break;
      case 'win':    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.45, i * 0.12)); break;
      case 'lose':   [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.45, i * 0.18)); break;
      case 'splash': this.tone(120, 0.5, 'sawtooth', 0.4); this.tone(90, 0.6, 'sine', 0.4, 0.1); break;
      case 'beam':   [440, 554, 659, 880, 1108].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.35, i * 0.08)); break;
    }
  }

  startMusic() {
    this.ensure();
    if (!this.ctx || this.musicTimer) return;
    // Vòng hợp âm nhẹ nhàng kiểu Ghibli: C – Am – F – G
    const chords = [
      [261.6, 329.6, 392.0],
      [220.0, 261.6, 329.6],
      [174.6, 220.0, 261.6],
      [196.0, 246.9, 293.7],
    ];
    let idx = 0;
    const playChord = () => {
      const c = chords[idx % chords.length];
      c.forEach(f => {
        this.tone(f, 3.6, 'sine', 0.16, 0, this.musicGain);
        this.tone(f * 2, 3.6, 'sine', 0.05, 0, this.musicGain);
      });
      // giai điệu điểm xuyết
      if (Math.random() < 0.7) {
        const mel = c[Math.floor(Math.random() * c.length)] * 2;
        this.tone(mel, 0.8, 'triangle', 0.1, Math.random() * 2, this.musicGain);
      }
      idx++;
    };
    playChord();
    this.musicTimer = setInterval(playChord, 3800);
  }

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
}
