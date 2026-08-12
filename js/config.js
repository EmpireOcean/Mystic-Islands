// ===== Toàn bộ thông số game — đồng bộ với game-config.md =====

export const CFG = {
  // TẠM THỜI để test: level 1 → tế đàn/đảo đích cấp 0, level 2 → cấp 1, ..., level 10 → cấp 9 — đi liền mạch
  // 10 level là thấy hết 10 cấp, không cần chờ 5 level/cấp như bình thường (xem shrineTierForLevel). TẮT lại
  // (false) khi test xong — KHÔNG mang theo khi phát hành, lúc đó cấp lại đi theo nhịp 5 level/cấp như thiết kế.
  testMode: {
    sequentialTiers: false,
  },

  player: {
    maxHp: 10,
    fistDmg: 1,
    speed: 4.6,
    jumpV: 8.5,
    gravity: 20,
    regenSec: 2,      // hồi máu tự động: mỗi 2 giây...
    regenAmount: 1,   // ...hồi 1 máu (nếu chưa đầy)
  },

  shop: {
    armor: { price: 50, dur: 50, reduce: 1, maxDur: 100 }, // giảm 1 sát thương, -1 độ bền mỗi lần đỡ; mua thêm khi đã có thì CỘNG DỒN +dur độ bền, tối đa maxDur
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
    distMin: 2.6,        // khoảng cách gần nhất giữa 2 vật thể (mọi level)
    distMax: 3.4,         // khoảng cách xa nhất giữa 2 vật thể — GIỮ NGUYÊN tới distRampStartLevel
    distRampStartLevel: 15,  // từ level này khoảng cách trần bắt đầu nới rộng dần — KHÔNG nhảy đột ngột nữa
    distRampEndLevel: 45,    // tới level này đạt đúng distMaxFar, nới ĐỀU (nội suy tuyến tính) qua từng level ở giữa
    distMaxFar: 3.55,      // khoảng cách trần cuối cùng — giảm nhẹ so với bản cũ (3.7, đã rất sát tầm nhảy tối đa
                            // của nhân vật) để bớt khó khi cộng dồn với quái + va chạm chưa hoàn thiện tuyệt đối
  },

  islands: {
    archetypeCount: 10,      // tổng số dạng địa hình đảo khởi đầu (0 = đảo hiện tại, 1-9 = dạng mới)
    guidedArchetypes: 9,     // số dạng đi theo thứ tự cố định trong giai đoạn dẫn dắt đầu game (0..8) —
                             // archetype 9 (phức tạp nhất) CHỪA lại, chỉ xuất hiện khi bước vào giai đoạn random
    levelsPerArchetype: 5,   // mỗi dạng kéo dài đúng 5 level trong giai đoạn dẫn dắt
    fixedLevels: 45,         // guidedArchetypes * levelsPerArchetype — từ level này+1 trở đi là random hoàn toàn
  },

  // tế đàn truyền tống — dựng theo tham khảo "10 cấp độ voxel style": nền đá nhiều lớp + 2-6 cột trụ (kể cả
  // gãy/đổ, SỐ LƯỢNG NGẪU NHIÊN MỖI LEVEL, không phụ thuộc cấp) + tinh thể khối nổi trên đỉnh cột từ 1 cấp nào
  // đó + đá bay quanh tế đàn xuất hiện từ cấp 6, đổi kiểu chuyển động qua từng cấp (xem buildPortalStructures).
  shrine: {
    pillarCountMin: 2, pillarCountMax: 6,  // số cột trụ (kể cả gãy/đổ) — random mỗi level, KHÔNG tăng theo cấp
    innerR: 3.2,
    portalScaleTier1: 1.1, portalScaleTier9: 1.3, // cổng phóng to dần, đạt tối đa ở tier 9
    // Bệ đá BẬC THANG thật, có từ cấp 0 (ảnh mẫu cấp 1 đã có bậc rõ ràng). Mỗi bậc là một vành đá cao dần vào
    // trong; bậc trên cùng là chỗ người chơi hồi sinh. daisStepH đủ thấp để bước lên/xuống không gây sát thương
    // rơi và không cản tầm nhìn.
    daisSteps: 3, daisStepH: 0.24, daisOuterR: 2.75,
    // Cấp nào dựng bệ theo ĐA GIÁC 8 CẠNH thay vì vành tròn — tế đàn cấp cao càng thêm chi tiết thì vành tròn
    // càng phải nở rộng ra mới chứa nổi, nhìn loãng và mất dáng công trình. Đang thử ở cấp 7-8 (level 8-9).
    octagonTiers: [7, 8],
    daisFromTier: 2, daisLayersMax: 4,      // vành đá trang trí lan thêm ra ngoài chân bệ, tăng dần theo cấp
    crystalFromTier: 3,                     // tinh thể khối nổi trên đỉnh cột (không đổ) bắt đầu xuất hiện
    // 2 đầu dải màu nội suy (xem shrineColorForTier). Vàng phải ĐẬM, không dùng tông kem nhạt: trụ sáng đứng
    // trước nền trời xanh sáng, màu nhạt sẽ bị nền nuốt thành dải xám trắng thay vì ra sắc vàng như ảnh mẫu.
    colorGoldHex: 0xffb43c, colorCrystalHex: 0x7fd8e8,
    beamShiftFromTier: 6,                   // trụ sáng chính giữ vàng ấm tới hết cấp này, rồi ngả xanh dần tới cấp 9
    jitterTiers: [6, 7],                    // đá bay "lắc nhẹ" tại chỗ (lên/xuống HOẶC trái/phải), đúng 2 cấp này
    jitterCount: { 6: 5, 7: 7 },
    jitterAmp: 0.35, jitterHeight: 2.6,
    orbitFromTier: 8,                       // từ cấp này đá bay đổi sang XOAY VÒNG quanh trụ sáng chính
    orbitPulseFromTier: 9,                  // + co giãn (mở rộng/thu hẹp) quỹ đạo theo chu kỳ chậm, chỉ từ cấp này
    orbitHeight: 2.8, orbitRingGap: 0.55, orbitPulseAmp: 0.5,
    // Cấp orbitPulseFromTier (9): MỌI vòng dùng CHUNG bán kính này thay vì mỗi vòng một bán kính như cấp 8 —
    // đúng yêu cầu "kích cỡ đá to nhỏ giữa các vòng khác nhau rõ rệt nhưng phạm vi vòng tròn xoay và di động
    // thì như nhau" (các vòng chỉ khác nhau ở cỡ đá, chiều xoay và độ cao).
    orbitPulseR: 1.3,
  },

  monsters: {
    startLevel: 10,     // từ level này quái CÓ THỂ ngẫu nhiên xuất hiện (chưa chắc chắn, còn tùy chance)
    denseLevel: 20,     // từ level này xuất hiện thường xuyên hơn hẳn
    firstAt: 10,         // sớm nhất là sau vật thể thứ 10 trong chuỗi
    everySparse: 15,     // khoảng cách vật thể giữa 2 lượt random đảo quái — giai đoạn thưa (10–19)
    everyDense: 6,        // khoảng cách vật thể giữa 2 lượt random đảo quái — giai đoạn dày (20 trở đi)
    chanceSparse: 0.4,   // xác suất thực sự xuất hiện mỗi lượt random — giai đoạn thưa
    chanceDense: 0.7,     // xác suất thực sự xuất hiện mỗi lượt random — giai đoạn dày
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

// random trong [0,max] — nếu trùng giá trị level TRƯỚC thì thử lại đúng 1 lần (né 2 level liên tiếp giống hệt
// nhau mà không lặp vô hạn — trùng lần thứ 2 vẫn chấp nhận, xác suất cực thấp và vô hại)
function randomDifferentFrom(max, prev) {
  const v = randInt(0, max);
  return v === prev ? randInt(0, max) : v;
}

// Dạng địa hình đảo khởi đầu theo level — mục "Đa dạng hoá đảo khởi đầu": level 1-45 đi theo thứ tự cố định
// 0..8 (mỗi dạng 5 level, xem CFG.islands), từ level 46 chọn ngẫu nhiên trong toàn bộ 0-9 (bao gồm cả dạng 9,
// dạng phức tạp nhất, vốn không xuất hiện trong giai đoạn dẫn dắt để dành làm "bất ngờ" ở giai đoạn random).
export function archetypeForLevel(level, prevArchetype) {
  if (CFG.testMode.sequentialTiers) return Math.min(level - 1, CFG.islands.archetypeCount - 1);
  const { guidedArchetypes, levelsPerArchetype, fixedLevels, archetypeCount } = CFG.islands;
  if (level > fixedLevels) return randomDifferentFrom(archetypeCount - 1, prevArchetype);
  const block = Math.floor((level - 1) / levelsPerArchetype);
  return Math.min(block, guidedArchetypes - 1);
}

// Cấp độ tế đàn truyền tống theo level — khớp 1:1 với archetype trong giai đoạn dẫn dắt (level 1-45, đúng yêu
// cầu "đổi địa hình = tế đàn phức tạp hơn"), nhưng từ level 46 chọn ngẫu nhiên ĐỘC LẬP với archetype địa hình.
export function shrineTierForLevel(level, prevShrineTier) {
  if (CFG.testMode.sequentialTiers) return Math.min(level - 1, 9);
  const { guidedArchetypes, levelsPerArchetype, fixedLevels, archetypeCount } = CFG.islands;
  if (level > fixedLevels) return randomDifferentFrom(archetypeCount - 1, prevShrineTier);
  const block = Math.floor((level - 1) / levelsPerArchetype);
  return Math.min(block, guidedArchetypes - 1);
}

// Màu trụ sáng chính theo cấp — giữ NGUYÊN vàng ấm (colorGoldHex) tới hết beamShiftFromTier (6), rồi nội suy
// dần sang xanh pha lê (colorCrystalHex), đạt màu xanh trọn vẹn ở cấp cao nhất (9). Tinh thể trên cột đã dùng
// màu này từ sớm hơn (crystalFromTier=3) nên vẫn xanh dù trụ sáng chính lúc đó còn vàng — đúng tham khảo
// (LVL4-7 vẫn sáng vàng nhưng đã điểm xuyết tinh thể xanh, chỉ LVL8-10 trụ sáng mới chuyển hẳn sang xanh).
export function lerpHex(hexA, hexB, t) {
  const k = Math.max(0, Math.min(1, t));
  const ch = (h, s) => (h >> s) & 255;
  const mix = (s) => Math.round(ch(hexA, s) + (ch(hexB, s) - ch(hexA, s)) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function shrineColorForTier(tier) {
  const S = CFG.shrine;
  return lerpHex(S.colorGoldHex, S.colorCrystalHex, (tier - S.beamShiftFromTier) / (9 - S.beamShiftFromTier));
}

// Bảng màu ĐÁ của tế đàn theo cấp. Ảnh mẫu: cấp thấp là đá khaki ám rêu (không phải kem/be sáng như bản trước
// — tông kem làm tế đàn trông như bê tông mới), từ cấp 8 đá chuyển hẳn sang xám xanh lạnh kiểu công trình
// năng lượng. main/alt xen kẽ cho mặt đá lốm đốm, dark dùng cho mặt bên và chi tiết chìm.
export function shrineStoneForTier(tier) {
  const t = (tier - 6) / 3; // cấp 6 bắt đầu ngả lạnh, cấp 9 lạnh hẳn
  return {
    main: lerpHex(0x8f8b6e, 0x6f7d8c, t),
    alt: lerpHex(0x7c7860, 0x5e6b79, t),
    dark: lerpHex(0x666352, 0x4c5764, t),
  };
}
