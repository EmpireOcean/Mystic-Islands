// ===== Toàn bộ thông số game — đồng bộ với game-config.md =====

export const CFG = {
  player: {
    maxHp: 10,
    fistDmg: 1,
    speed: 4.6,
    jumpV: 8.5,
    gravity: 20,
    regenSec: 1,      // hồi máu tự động: mỗi 1 giây...
    regenAmount: 1,   // ...hồi 1 máu (nếu chưa đầy)
  },

  shop: {
    armor: { price: 50, dur: 50, reduce: 1 },        // giảm 1 sát thương, -1 độ bền mỗi lần đỡ
    sword: { price: 10, dmg: 2, dur: 20, durHit: 2 },// -2 độ bền mỗi lần chém trúng
    gun:   { price: 80, dmg: 3 },                    // giá tự đặt: 80 vàng
    ammo:  { price: 2 },
    orb:   { price: 5, points: 100 },                // 5 kim cương / 100 điểm bảo hộ
  },

  chest: { hp: 5, goldMin: 1, goldMax: 2 },

  chain: {
    base: 5,          // số vật thể level 1
    incEarly: 2,      // tăng thêm mỗi level (2–49) — tự đặt: 2
    phaseLevel: 50,   // mốc chuyển giai đoạn
    incLate: 1,       // tăng thêm mỗi level từ mốc trở đi
  },

  monsters: {
    startLevel: 20,
    firstAt: 10,      // random đảo quái sau vật thể thứ 10
    every: 10,        // mỗi 10 vật thể
    chance: 0.65,
    meleeTypes: 5,
    rangedTypes: 2,
    meleeHp: 50, meleeDmg: 1,
    rangedHp: 15, rangedDmg: 0,
    burstMin: 3, burstMax: 5,
    goldMin: 0, goldMax: 2,   // vàng rơi khi giết quái — tự đặt: 0–2
  },

  goal: { goldMin: 1, goldMax: 5, diamond: 1 },

  leaderboard: {
    rows: 5,
    fakeLevelMin: 5, fakeLevelMax: 80,
    fakeGoldMin: 50, fakeGoldMax: 2000,
    fakeDiaMin: 0, fakeDiaMax: 20,
  },

  lives: { start: 1, per: 10, add: 1, max: 5 },      // tự đặt: khởi đầu 1, tối đa 5
};

// Sát thương rơi theo tầng (KHÔNG có bảo hộ) — game-config.md mục 3
export function fallDamage(tier) {
  if (tier >= 10) return 9999;  // tử vong ngay
  if (tier === 9) return 5;
  if (tier === 8) return 4;
  if (tier === 7) return 3;
  if (tier === 6) return 2;
  return 1;                     // tầng 5 trở xuống
}

// Điểm bảo hộ bị trừ theo tầng (CÓ quả cầu) — mục 4: -10 mỗi tầng thấp hơn
export function orbLoss(tier) {
  if (tier >= 10) return 100;
  return Math.max(20, tier * 10); // tầng 9: 90, tầng 8: 80, ... sàn 20
}

// Số vật thể lơ lửng theo level — mục 6
export function chainCount(level) {
  const c = CFG.chain;
  if (level <= 1) return c.base;
  const early = Math.min(level, c.phaseLevel - 1) - 1;
  const late = Math.max(0, level - (c.phaseLevel - 1));
  return c.base + early * c.incEarly + late * c.incLate;
}

// ===== Tiện ích ngẫu nhiên =====
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
