// ===== Âm thanh: SFX + nhạc nền tạo bằng WebAudio (không cần file ngoài) =====

// Giai điệu "Winter" — lấy trực tiếp từ 21 nốt đầu của file MIDI giai điệu người dùng cung cấp
// (1_melody_filtered.mid, track đơn âm, không đoán mò cao độ như đợt trước) — đúng cao độ thật (F Phrygian:
// F–Gb–Ab–Bb–C–Db–Eb, khớp với thang F minor pentatonic đã dùng cho hợp âm Winter). Chỉ đổi NHỊP: nhóm nốt
// nối liền nhau trong bản gốc (khoảng lặng ~0) → giữ cách nhau NGẮN (0.45s); chỗ có khoảng lặng thật trong
// bản gốc (nốt "rời") → giãn ra XA hẳn (2.2s) — làm chậm hẳn toàn bộ xuống nhưng vẫn giữ đúng cấu trúc câu
// nhạc gốc (8 cụm câu ngắn, phân cách bằng những quãng nghỉ dài).
// [tần số Hz, thời điểm bắt đầu tính từ đầu câu (giây), độ ngân (giây)]
const WINTER_MELODY = [
  [174.6, 0.00, 1.6], [277.2, 0.45, 1.6], [349.2, 0.90, 1.6],                            // F3-C#4-F4
  [138.6, 3.10, 1.6], [415.3, 3.55, 1.6], [349.2, 4.00, 1.6], [261.6, 4.45, 1.6], [174.6, 4.90, 1.6], // C#3-G#4-F4-C4-F3
  [207.7, 7.10, 1.6],                                                                    // G#3
  [622.3, 9.30, 1.6], [523.3, 9.75, 1.6],                                                 // D#5-C5
  [523.3, 11.95, 1.6], [523.3, 12.40, 1.6],                                               // C5-C5
  [311.1, 14.60, 1.6],                                                                    // D#4
  [622.3, 16.80, 1.6], [523.3, 17.25, 1.6], [466.2, 17.70, 1.6], [311.1, 18.15, 1.6],     // D#5-C5-A#4-D#4
  [392.0, 20.35, 1.6], [466.2, 20.80, 1.6], [523.3, 21.25, 1.6],                          // G4-A#4-C5
];

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

  // phát một câu giai điệu cố định (mảng [freq, when, dur]) — dùng cho WINTER_MELODY
  playMelodyPhrase(notes) {
    if (!this.ctx) return;
    for (const [freq, when, dur] of notes) {
      this.tone(freq, dur, 'sine', 0.17, when, this.musicGain);
      this.tone(freq * 2, dur, 'sine', 0.05, when, this.musicGain); // bè quãng 8 nhẹ, đồng bộ phong cách các theme khác
    }
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
    // Vòng hợp âm nhẹ nhàng kiểu Ghibli: C – Am – F – G — mỗi ~5 lượt qua hết vòng, thỉnh thoảng chen
    // hợp âm biến tấu (thay Am/F) và giai điệu điểm xuyết đổi hình thái (nốt lẻ / 2 nốt / chuông rải /
    // im lặng) thay vì luôn lặp y hệt cùng 1 kiểu, để nghe lâu không bị đều đều nhàm tai
    const mainChords = [
      [261.6, 329.6, 392.0],   // C
      [220.0, 261.6, 329.6],   // Am
      [174.6, 220.0, 261.6],   // F
      [196.0, 246.9, 293.7],   // G
    ];
    const mainAlt = [null, [293.7, 349.2, 440.0], [164.8, 196.0, 246.9], null]; // biến tấu thay cho Am/F

    // Vòng hợp âm "Winter" — lấy cảm hứng từ bản nhạc tham khảo của người dùng: dò cao độ thô trên file
    // cho thấy các nốt ngân dài/lặp lại nhiều nhất suốt bài đúng khớp thang F minor pentatonic (F–Ab–Bb–C–Eb),
    // không phải chép lại giai điệu gốc mà chỉ giữ đúng 5 nốt màu sắc đó, dựng thành hợp âm quartal/sus
    // (mọi nốt đều nằm trong đúng 5 nốt trên) để ra chất trầm ấm, chậm rãi kiểu mùa đông — xen kẽ với vòng
    // hợp âm chính để thử nghe cả hai màu sắc
    const winterChords = [
      [174.6, 207.7, 261.6],   // Fm (F–Ab–C)
      [233.1, 311.1, 349.2],   // Bbsus (Bb–Eb–F)
      [207.7, 261.6, 311.1],   // Ab (Ab–C–Eb)
      [261.6, 311.1, 349.2],   // Csus, no5 (C–Eb–F)
    ];
    const winterAlt = [null, null, null, null];

    let idx = 0, bar = 0, muteCalls = 0;
    const playChord = () => {
      // cứ mỗi 3 vòng lặp (bar) lại đổi hẳn sang bộ hợp âm kia — xen kẽ chính/Winter để nghe thử cả hai
      const useWinter = Math.floor(bar / 3) % 2 === 1;
      const chords = useWinter ? winterChords : mainChords;
      const altChords = useWinter ? winterAlt : mainAlt;
      const slot = idx % chords.length;
      // vừa bước vào khối Winter (bar đầu tiên của mỗi 3-bar Winter) — phát câu giai điệu thật 1 lần, đồng
      // thời NGƯNG hẳn nốt hợp âm đệm + điểm xuyết ngẫu nhiên trong suốt thời lượng câu nhạc (~23s ≈ 6 lượt
      // playChord kế tiếp) để không có nốt nào khác đánh đè/phá vào giai điệu đang chạy
      if (useWinter && slot === 0 && bar % 6 === 3) {
        this.playMelodyPhrase(WINTER_MELODY);
        muteCalls = 6;
      }
      idx++;
      if (slot === chords.length - 1) bar++;
      if (muteCalls > 0) { muteCalls--; return; }

      const alt = altChords[slot];
      const useAlt = alt && bar % 5 === 3 && Math.random() < 0.5;
      const c = useAlt ? alt : chords[slot];
      const breathe = 1 + (Math.random() - 0.5) * 0.25; // hơi thở nhẹ về âm lượng, tránh y hệt tuyệt đối
      c.forEach(f => {
        this.tone(f, 3.6, 'sine', 0.16 * breathe, 0, this.musicGain);
        this.tone(f * 2, 3.6, 'sine', 0.05 * breathe, 0, this.musicGain);
      });
      // giai điệu điểm xuyết — đổi hình thái mỗi lượt thay vì luôn 1 nốt lẻ giống nhau. LUÔN vào sau nốt hợp
      // âm chính ít nhất 0.5s (không bao giờ bắt đầu ở when=0 trùng lúc nốt chính vừa đánh xuống) để tai kịp
      // nghe rõ nốt chính trước khi nốt phụ chen vào, tránh cảm giác đánh chồng lên nhau ngay lập tức
      const roll = Math.random();
      if (roll < 0.15) {
        // im lặng — để tai nghỉ một nhịp
      } else if (roll < 0.45) {
        const mel = c[Math.floor(Math.random() * c.length)] * 2;
        this.tone(mel, 0.8, 'triangle', 0.22, 0.5 + Math.random() * 1.5, this.musicGain);
      } else if (roll < 0.7) {
        // 2 nốt nối tiếp thay vì 1 nốt lẻ
        const notes = [...c].sort(() => Math.random() - 0.5).slice(0, 2).map(f => f * 2);
        notes.forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.19, 0.6 + i * 0.35, this.musicGain));
      } else if (roll < 0.9) {
        // chuông rải cả hợp âm đi lên — điểm nhấn thưa, tạo cảm giác có "câu nhạc" thay vì đều đều
        c.forEach((f, i) => this.tone(f * 2, 0.5, 'sine', 0.16, 0.5 + i * 0.22, this.musicGain));
      } else if (roll < 0.95) {
        // câu 4 âm tiết (5%, hiếm) — rải hợp âm đi lên rồi vọt thêm 1 nốt gốc cao vượt lên hẳn
        const run4 = [c[0] * 2, c[1] * 2, c[2] * 2, c[0] * 4];
        run4.forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.15, 0.5 + i * 0.18, this.musicGain));
      } else {
        // câu 5 âm tiết (5%, hiếm nhất) — rải lên rồi rớt xuống lại, thành một câu nhạc trọn vẹn hơn
        const run5 = [c[0] * 2, c[1] * 2, c[2] * 2, c[1] * 2, c[0] * 2];
        run5.forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.14, 0.5 + i * 0.16, this.musicGain));
      }
    };
    playChord();
    this.musicTimer = setInterval(playChord, 3800);
  }

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
}
