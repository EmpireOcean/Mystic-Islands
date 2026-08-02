// ===== Lưu trữ cục bộ (localStorage) =====
import { CFG } from './config.js';

const KEY = 'mystic-islands-save-v1';

const DEFAULTS = () => ({
  name: '',
  charIndex: 0,
  gold: 0,
  diamonds: 0,
  level: 1,          // level đang chơi
  maxLevel: 1,       // level cao nhất từng đạt — cơ sở xếp hạng
  lives: CFG.lives.start,
  armorDur: 0,
  swordDur: 0,
  hasGun: false,
  ammo: 0,
  orbPoints: 0,
  musicVol: 0.5,
  sfxVol: 0.8,
});

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    return Object.assign(DEFAULTS(), JSON.parse(raw));
  } catch {
    return DEFAULTS();
  }
}

export function persist(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* bộ nhớ đầy / chặn cookie */ }
}
