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
  // đảo khởi đầu/tế đàn truyền tống level TRƯỚC — dùng để né random ra trùng y hệt level liền trước (giai đoạn
  // sau level 45, xem archetypeForLevel/shrineTierForLevel trong config.js). -1 = chưa có (chưa random lần nào)
  prevArchetype: -1,
  prevShrineTier: -1,
  lives: CFG.lives.start,
  armorDur: 0,
  armorWorn: true,   // có thể tháo ra/mặc lại từ túi đồ mà không mất trang bị
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
