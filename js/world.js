// ===== Sinh thế giới ngẫu nhiên cho mỗi level =====
import * as THREE from 'three';
import {
  CFG, rand, randInt, chance, pick,
  archetypeForLevel, shrineTierForLevel, shrineColorForTier, shrineStoneForTier,
} from './config.js';
import * as V from './voxel.js';
import { buildAltar, buildAltarIsland, buildEnergyOre, hasEnergyCore, VOX } from './altar.js';

const tileKey = (x, z) => `${x},${z}`;

// Vật cản (w.colliders) có 2 dạng: trụ tròn { r } hoặc đa giác đo từ hình học thật { foot }.
// Hàm này trả về tầm với xa nhất tính từ tâm — dùng cho các phép lọc thô theo khoảng cách.
const colliderReach = (c) => (c.foot ? c.foot.reach : c.r);

// vị trí (x,z) có đủ chỗ trống không chồng lấn vật thể/đảo đã đặt TỪ TRƯỚC không (bỏ qua node liền trước —
// cố ý ở gần để vừa tầm nhảy). boundP/boundI = độ dài w.platforms/w.islands TÍNH ĐẾN TRƯỚC node liền trước,
// nhờ vậy chỉ so với các node từ 2 bước trở lên — chỗ dễ chồng lấn khi đường chuỗi "cuộn" lại do heading xoay tự do.
// Khoảng hở NHỎ NHẤT còn lại quanh vị trí (x,z): >= 0 là đủ chỗ trống, càng âm càng chồng lấn sâu. Tách riêng
// khỏi hasSpaceFor để chỗ nào cần "chọn vị trí ĐỠ chồng lấn nhất" (đảo đích) có con số mà so, thay vì chỉ biết
// đúng/sai rồi đành chấp nhận lần thử cuối cùng dù nó tệ nhất.
function spaceClearance(w, x, z, footR, boundP, boundI) {
  // khoảng hở tối thiểu — chừa đường nhảy/đứng, không dính sát nhau. Đủ rộng hơn kích thước rương gỗ (hw/hd
  // 0.4/0.35) có thể lệch ra tận mép vật thể/đảo, để rương không lấn sang vật/đảo kế bên dù đặt sát mép nhất.
  const buffer = 1.4;
  let min = Infinity;
  for (let i = 0; i < boundP; i++) {
    const p = w.platforms[i];
    const pr = p.foot.reach; // khoảng cách xa nhất tới tâm, đo từ đỉnh thật
    min = Math.min(min, Math.hypot(x - p.x, z - p.z) - (footR + pr + buffer));
  }
  for (let i = 0; i < boundI; i++) {
    const isl = w.islands[i];
    if (isl.decor) continue;   // bậc bệ đá tế đàn — chỉ là mặt đứng trang trí, không chiếm chỗ của chuỗi vật thể
    min = Math.min(min, Math.hypot(x - isl.x, z - isl.z) - (footR + isl.r + buffer));
  }
  return min;
}

function hasSpaceFor(w, x, z, footR, boundP, boundI) {
  return spaceClearance(w, x, z, footR, boundP, boundI) >= 0;
}

export function generateLevel(level, prevArchetype = -1, prevShrineTier = -1) {
  const group = new THREE.Group();
  const world = {
    group,
    tiles: new Map(),      // "x,z" -> độ cao mặt đất đảo khởi đầu
    water: new Map(),      // "x,z" -> độ cao mặt nước (sông/hồ)
    platforms: [],         // vật thể lơ lửng {x,y(top),z,foot(đa giác va chạm),tier,depth,mesh}
    islands: [],           // đảo quái + đảo đích + gò đất {x,z,y(top),r,tier} — mặt tròn nên dùng va chạm tròn
    colliders: [],         // vật cản rắn {x,z,y,h} + hoặc r (trụ tròn) hoặc foot (đa giác đo từ hình học thật)
    coins: [],
    chests: [],
    altars: [],            // tế đàn dựng theo bản thiết kế voxel (altar.js) — game.js chạy hoạt ảnh qua .fx
    monsters: [],
    projectiles: [],
    clouds: [],
    portals: [],
    floaters: [],
    sparkles: [],
    jitters: [],            // đá bay "lắc nhẹ" tại chỗ quanh tế đàn (cấp 6-7)
    orbiters: [],           // đá bay xoay vòng quanh trụ sáng chính, quỹ đạo có thể co giãn (tế đàn cấp 8-9)
    chainPath: [],         // toạ độ các node chuỗi (để né khi đặt cây)
    portal: null,
    goal: null,
    seaY: -1.6,
  };

  // Dạng địa hình đảo khởi đầu + cấp tế đàn truyền tống theo level — xem "Đa dạng hoá đảo khởi đầu" trong
  // config.js. Tách riêng 2 giá trị (không còn khớp 1:1 nhau từ level 46) — buildTerrain đọc world.archetype,
  // buildPortalStructures (gọi từ buildChain) đọc world.shrineTier.
  world.archetype = archetypeForLevel(level, prevArchetype);
  world.shrineTier = shrineTierForLevel(level, prevShrineTier);

  buildTerrain(world);
  buildChain(world, level);   // chuỗi trước — cây cối phải né đường nhảy
  buildIslandDecor(world);
  buildDecor(world);
  return world;
}

// ---------- Nhiễu giá trị 2 tầng ----------
function makeNoise(seed) {
  const hash = (x, z) => {
    const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (x, z, scale) => {
    const gx = x / scale, gz = z / scale;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const v00 = hash(x0, z0), v10 = hash(x0 + 1, z0);
    const v01 = hash(x0, z0 + 1), v11 = hash(x0 + 1, z0 + 1);
    return (v00 * (1 - sx) + v10 * sx) * (1 - sz) + (v01 * (1 - sx) + v11 * sx) * sz;
  };
  return (x, z) => smooth(x, z, 9) * 0.6 + smooth(x, z, 4) * 0.4;
}

// ---------- Trợ giúp dùng chung cho MỌI dạng địa hình (archetype) ----------
// Tách nguyên vẹn từ buildTerrain gốc (không đổi công thức/hằng số) — mỗi archetype tự quyết định có gọi hàm
// nào, theo thứ tự nào, với R/tham số nào. Xem kế hoạch "Đa dạng hoá đảo khởi đầu".

// San phẳng mặt nước — sông/hồ ghép từ nhiều ô carve riêng lẻ nên độ cao lệch nhau theo địa hình gốc, tạo mặt
// nước lởm chởm như bậc thang — lặp nhiều lượt hạ mỗi ô nước xuống bằng ô THẤP NHẤT trong các ô liền kề (đất
// lẫn nước) để mặt nước không bao giờ trồi cao hơn 2 bên, cứ lặp tới khi ổn định (mực nước liền lạc)
function relaxWaterLevels(w) {
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const [k, wy] of w.water) {
      const [x, z] = k.split(',').map(Number);
      let minNeighbor = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = tileKey(x + dx, z + dz);
        if (w.water.has(nk)) minNeighbor = Math.min(minNeighbor, w.water.get(nk));
        else if (w.tiles.has(nk)) minNeighbor = Math.min(minNeighbor, w.tiles.get(nk));
      }
      if (minNeighbor < Infinity && minNeighbor < wy - 0.01) {
        w.water.set(k, minNeighbor);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// Sông uốn lượn — carve từ rìa đảo vào trong, né w.rockTiles (nếu archetype có núi đá)
function carveRiver(w, R) {
  const a0 = rand(0, Math.PI * 2);
  let rx = Math.cos(a0) * R, rz = Math.sin(a0) * R;
  let dir = a0 + Math.PI;
  for (let s = 0; s < R * 2.6; s++) {
    dir += rand(-0.35, 0.35);
    rx += Math.cos(dir) * 0.8;
    rz += Math.sin(dir) * 0.8;
    if (Math.hypot(rx, rz) > R + 2) break;
    const tx = Math.round(rx), tz = Math.round(rz);
    const k = tileKey(tx, tz);
    if (w.tiles.has(k) && !w.water.has(k) && !w.rockTiles?.has(k)) {
      const h = Math.max(1, w.tiles.get(k) - 1);
      w.tiles.set(k, h);
      w.water.set(k, h + 0.55);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = tileKey(tx + dx, tz + dz);
        if (w.tiles.has(nk) && !w.water.has(nk) && !w.rockTiles?.has(nk) && w.tiles.get(nk) > h + 1) {
          w.tiles.set(nk, h + 1);
        }
      }
    }
  }
}

// Hồ nước tròn — carve quanh 1 điểm ngẫu nhiên gần tâm đảo, né w.rockTiles
function carveLake(w, R) {
  const lx = randInt(-Math.floor(R / 2), Math.floor(R / 2));
  const lz = randInt(-Math.floor(R / 2), Math.floor(R / 2));
  const lr = rand(2, 3.8);
  for (const [k, h] of w.tiles) {
    const [x, z] = k.split(',').map(Number);
    if (Math.hypot(x - lx, z - lz) <= lr && h >= 2 && !w.water.has(k) && !w.rockTiles?.has(k)) {
      w.tiles.set(k, h - 1);
      w.water.set(k, h - 0.45);
    }
  }
}

// Đường mòn nhỏ uốn lượn cắt ngang đảo — chỉ đổi màu mặt đất (đất nâu giữa cỏ), không đổi độ cao. Ghi vào
// w.pathTiles (Set) để voxelizeTerrain/classify của archetype tự đọc.
function carvePathTiles(w, R) {
  const pathTiles = w.pathTiles = new Set();
  const pa0 = rand(0, Math.PI * 2), pd0 = R * rand(0.8, 0.98);
  let pxw = Math.cos(pa0) * pd0, pzw = Math.sin(pa0) * pd0;
  let pdir = pa0 + Math.PI + rand(-0.4, 0.4);
  for (let s = 0; s < R * 2.4; s++) {
    pdir += rand(-0.3, 0.3);
    pxw += Math.cos(pdir) * 0.8;
    pzw += Math.sin(pdir) * 0.8;
    if (Math.hypot(pxw, pzw) > R + 2) break;
    const tx = Math.round(pxw), tz = Math.round(pzw);
    pathTiles.add(tileKey(tx, tz));
    if (chance(0.4)) pathTiles.add(tileKey(tx + (chance(0.5) ? 1 : -1), tz));
    if (chance(0.4)) pathTiles.add(tileKey(tx, tz + (chance(0.5) ? 1 : -1)));
  }
  return pathTiles;
}

// Tìm vị trí đặt cổng: đất phẳng (heightRange), không nước, né các vòng tròn chỉ định (avoidCircles — vd núi),
// rồi san phẳng vùng 9x9 quanh đó. Gán vào w.portal và trả về.
function findPortalSpot(w, R, avoidCircles = [], heightRange = [2, 5]) {
  let px = 0, pz = 0, ph = 2;
  for (let attempt = 0; attempt < 80; attempt++) {
    const tx = randInt(-Math.floor(R * 0.45), Math.floor(R * 0.45));
    const tz = randInt(-Math.floor(R * 0.45), Math.floor(R * 0.45));
    const k = tileKey(tx, tz);
    if (!w.tiles.has(k) || w.water.has(k)) continue;
    const h = w.tiles.get(k);
    if (h < heightRange[0] || h > heightRange[1]) continue;
    if (avoidCircles.some((c) => Math.hypot(tx - c.x, tz - c.z) < c.r)) continue;
    px = tx; pz = tz; ph = h;
    break;
  }
  // San phẳng đủ rộng để CẢ tế đàn (bệ bậc thang + vòng cột + vành đá trang trí của cấp cao) đứng trên nền
  // bằng phẳng. Bán kính 4 cũ chỉ vừa cái bệ, nên vành đá của cấp cao lan ra ngoài rồi lơ lửng giữa không khí
  // hoặc cắm vào sườn dốc. Chỗ nào không có đất thì vẫn không có đất — phần đó do buildTierDecor tự loại bỏ.
  const flatR = 6;
  for (let dx = -flatR; dx <= flatR; dx++) {
    for (let dz = -flatR; dz <= flatR; dz++) {
      const k = tileKey(px + dx, pz + dz);
      if (w.tiles.has(k)) {
        w.tiles.set(k, ph);
        w.water.delete(k);
      }
    }
  }
  w.portal = { x: px, y: ph, z: pz };
  return w.portal;
}

// Vật liệu mặt đất mặc định — mỗi archetype có thể override từng key (đổi màu/texture) qua tham số `materials`
// của voxelizeTerrain, ví dụ để retint cho phù hợp địa hình mới, không cần dựng hệ render riêng.
const DEFAULT_TERRAIN_MATERIALS = {
  grass: { color: 0x8fbf7f, texKey: 'grass', tex: { grain: 0.14, border: 0.2 } },
  dirt: { color: 0xa07850, texKey: 'dirt', tex: { grain: 0.16, border: 0.22, speckle: 0.1 } },
  sand: { color: 0xe8d8a8, texKey: 'sand', tex: { grain: 0.1, border: 0.16 } },
  cliff: { color: 0x84888d, texKey: 'stone', tex: { grain: 0.18, border: 0.26, speckle: 0.12 } },
  moss: { color: 0x7f9078, texKey: 'moss', tex: { grain: 0.16, border: 0.22, speckle: 0.1 } },
  path: { color: 0xd4bb92, texKey: 'path', tex: { grain: 0.11, border: 0.18, speckle: 0.05 } },
};

// Dựng toàn bộ khối voxel bề mặt + tường vách bên dưới + mặt nước, từ w.tiles/w.water đã có sẵn.
// `classify(x,z,h,k)` → key vật liệu BỀ MẶT (phải là 1 trong `materials`, vd 'grass'/'cliff'/'snow'...).
// `isWallRock(x,z,k)` → tường bên dưới ô đó có phải "đá/cliff" không (false = 'dirt'). `materials` override
// DEFAULT_TERRAIN_MATERIALS theo key, có thể thêm key MỚI (archetype tự thêm 'snow'/'crust'...).
function voxelizeTerrain(w, { classify, isWallRock, materials = {} }) {
  const specs = { ...DEFAULT_TERRAIN_MATERIALS, ...materials };
  const mats = {};
  const buckets = {};
  for (const [key, spec] of Object.entries(specs)) {
    mats[key] = new THREE.MeshLambertMaterial({ color: spec.color, map: V.makeBlockTexture(spec.texKey, spec.tex) });
    buckets[key] = [];
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  for (const [k, h] of w.tiles) {
    const [x, z] = k.split(',').map(Number);
    const surfKey = classify(x, z, h, k);
    buckets[surfKey].push([x, h - 0.5, z]);
    let minN = h;
    let isEdge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = tileKey(x + dx, z + dz);
      if (!w.tiles.has(nk)) isEdge = true; // giáp biển xung quanh, không phải ô đảo khác
      minN = Math.min(minN, w.tiles.get(nk) ?? 0);
    }
    // viền đảo giáp biển: kéo cột đá xuống ngập hẳn mặt nước, không hở đáy lộ khoảng trống
    const bottomY = isEdge ? Math.floor(w.seaY) - 1 : Math.max(0, minN - 1);
    const wallKey = isWallRock(x, z, k) ? 'cliff' : 'dirt';
    for (let y = h - 1; y >= bottomY; y--) buckets[wallKey].push([x, y - 0.5, z]);
  }

  const addInst = (mat, arr) => {
    if (!arr.length) return;
    const im = new THREE.InstancedMesh(boxGeo, mat, arr.length);
    const m4 = new THREE.Matrix4();
    arr.forEach((p, i) => { m4.setPosition(p[0], p[1], p[2]); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true;
    w.group.add(im);
  };
  for (const key of Object.keys(specs)) addInst(mats[key], buckets[key]);

  // ---- Mặt nước: lấp đầy từ đáy lên mặt, áp khít bờ không hở khe ----
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x5ab8d8, transparent: true, opacity: 0.75 });
  for (const [k, wy] of w.water) {
    const [x, z] = k.split(',').map(Number);
    const groundH = w.tiles.get(k) ?? wy - 0.6;
    const bottom = groundH - 0.06;
    const height = Math.max(0.2, wy - bottom);
    const wm = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1), waterMat);
    wm.position.set(x, bottom + height / 2, z);
    w.group.add(wm);
  }
}

// ---------- Archetype 0 — đảo khởi đầu hiện tại (không đổi, x3 lần bản trước — có núi vách đứng) ----------
// Ráp lại từ đúng các hằng số/công thức gốc, chỉ gọi qua các hàm dùng chung phía trên — không có seed cố định
// (thuần Math.random()) nên thứ tự gọi không ảnh hưởng gì tới việc "trông giống hệt", chỉ cần giữ nguyên mọi
// hằng số/khoảng random là đủ.
function shapeArchetype0(w) {
  const R = randInt(27, 31);
  w.islandR = R;
  const seed = Math.random() * 1000;
  const noise = makeNoise(seed);

  // đồi thoải
  const bumps = [];
  for (let i = 0; i < randInt(2, 4); i++) {
    const a = rand(0, Math.PI * 2), d = rand(5, R * 0.6);
    bumps.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: rand(2, 3.5), r: rand(4, 7), pow: 1, rock: false });
  }
  // NÚI ĐÁ tự nhiên: 2 đỉnh lệch nhau, gồ ghề bất đối xứng, có mỏm nhô ra
  const ma = rand(0, Math.PI * 2), md = rand(R * 0.3, R * 0.55);
  const peak1 = { x: Math.cos(ma) * md, z: Math.sin(ma) * md, h: rand(6.5, 9), r: rand(5, 7), pow: rand(2.6, 3.4), rock: true };
  const peak2 = {
    x: peak1.x + rand(-3.5, 3.5), z: peak1.z + rand(-3.5, 3.5),
    h: peak1.h * rand(0.5, 0.72), r: peak1.r * 0.7, pow: 2.3, rock: true,
  };
  bumps.push(peak1, peak2);
  w.mountains = [peak1, peak2];
  const roughSeed = seed + 77;
  const rough = makeNoise(roughSeed);
  const ledgeHash = (x, z) => {
    const s = Math.sin(x * 91.3 + z * 47.7 + seed * 13) * 43758.5;
    return s - Math.floor(s);
  };

  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      if (d > R) continue;
      const falloff = 1 - Math.pow(d / R, 2.8);
      let h = (1.4 + noise(x, z) * 3.4) * falloff;
      let mountainPart = 0;
      for (const b of bumps) {
        const bd = Math.hypot(x - b.x, z - b.z);
        if (bd >= b.r) continue;
        let add = b.h * Math.pow(1 - bd / b.r, b.pow) * Math.max(0.4, falloff);
        // núi đá: nhân thêm nhiễu để sườn gồ ghề bất đối xứng, không thành kim tự tháp
        if (b.rock) {
          add *= 0.65 + rough(x * 2.3, z * 2.3) * 0.75;
          if (add > 1.2 && ledgeHash(x, z) > 0.78) add += 1; // mỏm đá nhô ra ngẫu nhiên
          mountainPart += add;
        }
        h += add;
      }
      h = Math.round(h);
      if (h < 1) continue;
      const k = tileKey(x, z);
      w.tiles.set(k, Math.min(h, 13));
      if (mountainPart >= 0.7 || h >= 7) (w.rockTiles ??= new Set()).add(k);
    }
  }

  if (chance(0.55)) carveRiver(w, R);
  if (chance(0.5)) carveLake(w, R);
  relaxWaterLevels(w);
  const pathTiles = chance(0.65) ? carvePathTiles(w, R) : new Set();
  findPortalSpot(w, R, [{ x: peak1.x, z: peak1.z, r: peak1.r + 3 }], [2, 5]);

  const isRock = (k) => w.rockTiles?.has(k);
  const mossHash = (x, z) => {
    const s = Math.sin(x * 53.1 + z * 97.7 + seed * 7) * 43758.5;
    return s - Math.floor(s);
  };
  // nhiễu mượt riêng cho đốm cát rải rác giữa đảo — dùng noise (không phải hash rời rạc) để đốm cát thành từng
  // mảng tự nhiên thay vì lốm đốm từng ô một
  const patchNoise = makeNoise(seed + 133);

  voxelizeTerrain(w, {
    isWallRock: (x, z, k) => isRock(k),
    classify: (x, z, h, k) => {
      const isWater = w.water.has(k);
      const isBeach = h <= 1 && !isWater;
      if (isRock(k) && !isWater) {
        // chân núi thấp lác đác rêu xanh cho tự nhiên
        return h <= 5 && mossHash(x, z) < 0.3 ? 'moss' : 'cliff';
      }
      if (!isWater && !isBeach && h <= 3 && pathTiles.has(k)) {
        // đường mòn chỉ nằm ở đất thấp/chân đồi chân núi — không leo lên cao
        return 'path';
      }
      const isSandPatch = !isWater && !isBeach && patchNoise(x, z) > 0.63; // đốm cát rải rác giữa đảo, không chỉ ở rìa
      return isBeach || isWater || isSandPatch ? 'sand' : 'grass';
    },
  });
}

// ---------- Archetype 1 — Cao Nguyên Nứt Vỡ (Cracked Plateau) ----------
// Đỉnh bằng phẳng (mesa) bị 1 khe núi (canyon) xẻ qua gần tâm, vách 2 bên khe dốc đứng, sông nhỏ chảy dưới đáy
// khe. Khác hẳn archetype 0 (1 núi đá lệch tâm, đảo lượn sóng tự nhiên) — đây là mặt bằng rõ ràng bị chia cắt.
function shapeArchetype1(w) {
  const R = randInt(30, 34);
  w.islandR = R;
  const seed = Math.random() * 1000;
  const noise = makeNoise(seed);
  const plateauH = randInt(5, 7);

  // hướng + độ rộng khe núi xẻ qua gần tâm đảo
  const canyonAngle = rand(0, Math.PI * 2);
  const dirX = Math.cos(canyonAngle), dirZ = Math.sin(canyonAngle);
  const perpX = -dirZ, perpZ = dirX; // pháp tuyến của khe — đo khoảng cách vuông góc từ 1 điểm tới đường tâm khe
  const canyonOffset = rand(-R * 0.15, R * 0.15); // khe lệch chút khỏi tâm đảo cho tự nhiên, không cắt đúng giữa
  const canyonHalfWidth = rand(2.5, 3.5);
  const canyonWallSteep = 2.0; // bề rộng vùng chuyển tiếp (tile) từ đáy khe lên mặt cao nguyên — càng nhỏ càng dốc đứng

  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      if (d > R) continue;
      const falloff = 1 - Math.pow(d / R, 3.2); // rìa đổ dốc nhanh — mặt bằng phẳng rõ, không thoai thoải như archetype0
      let h = plateauH * falloff + noise(x, z) * 1.2 * falloff; // gợn nhẹ, không lượn sóng mạnh

      const perpDist = Math.abs((x * perpX + z * perpZ) - canyonOffset);
      let inCanyonZone = false;
      if (perpDist < canyonHalfWidth) {
        h = Math.max(1, plateauH - 4); // đáy khe thấp hẳn
        inCanyonZone = true;
      } else if (perpDist < canyonHalfWidth + canyonWallSteep) {
        // vách dốc: nội suy tuyến tính từ đáy khe lên mặt cao nguyên trong khoảng ngắn → dốc đứng
        const t = (perpDist - canyonHalfWidth) / canyonWallSteep;
        h = (plateauH - 4) * (1 - t) + h * t;
        inCanyonZone = true;
      }

      h = Math.round(h);
      if (h < 1) continue;
      const k = tileKey(x, z);
      w.tiles.set(k, Math.min(h, 13));
      // vách khe + rìa cao nguyên đều là đá dốc đứng, không phải đất/cỏ thoai thoải
      if (inCanyonZone || h >= plateauH - 1) (w.rockTiles ??= new Set()).add(k);
    }
  }

  // sông nhỏ dưới đáy khe — đi dọc đúng đường tâm khe (không dùng carveRiver dùng chung, vì hàm đó carve từ rìa
  // vào ngẫu nhiên, không đảm bảo nằm đúng trong khe). Bước 0.5 để phủ kín tile liên tục dù hướng khe xiên.
  for (let s = -R * 2; s <= R * 2; s++) {
    const cx = Math.round(dirX * (s * 0.5) + perpX * canyonOffset);
    const cz = Math.round(dirZ * (s * 0.5) + perpZ * canyonOffset);
    const k = tileKey(cx, cz);
    if (w.tiles.has(k) && !w.water.has(k)) {
      const h = w.tiles.get(k);
      if (h <= plateauH - 3) w.water.set(k, h + 0.4); // chỉ chảy đúng đáy khe, không tràn lên vách/mặt cao nguyên
    }
  }
  relaxWaterLevels(w);

  // cổng đặt trên mặt cao nguyên bằng phẳng — heightRange quanh plateauH đã tự loại đáy khe (thấp hơn hẳn)
  findPortalSpot(w, R, [], [plateauH - 1, plateauH + 1]);

  voxelizeTerrain(w, {
    materials: {
      // đá tông đỏ đất nung — đặc trưng cao nguyên nứt vỡ, khác hẳn tông xám đá archetype 0
      cliff: { color: 0xb5583a, texKey: 'stone', tex: { grain: 0.18, border: 0.26, speckle: 0.14 } },
    },
    isWallRock: (x, z, k) => w.rockTiles?.has(k),
    classify: (x, z, h, k) => {
      const isWater = w.water.has(k);
      if (w.rockTiles?.has(k) && !isWater) return 'cliff';
      const isBeach = h <= 1 && !isWater;
      return isBeach || isWater ? 'sand' : 'grass';
    },
  });
}

// ---------- Bộ sinh trường độ cao dùng chung cho các dạng địa hình 2-9 ----------
// Gom đúng phần lặp "quét ô vuông trong bán kính R, cộng nhiễu nền + các gò/đỉnh, vuốt thấp dần ra rìa" mà
// mọi archetype đều cần, để mỗi dạng chỉ còn phải khai báo cái RIÊNG của nó (dáng gò, cách làm tròn độ cao,
// vật liệu bề mặt). Archetype 0 và 1 giữ nguyên code riêng — chúng có thêm mỏm đá/khe nứt đặc thù.
// round: cách làm tròn độ cao (dạng ruộng bậc thang làm tròn theo bội số để ra bậc rõ).
// rockWhen(h, rockPart): ô này có tính là đá không (dùng cho vách/màu đá).
function heightField(w, R, { base, noiseAmp, edgePow, bumps = [], maxH = 13, round = Math.round, rockWhen = null }) {
  const seed = Math.random() * 1000;
  const noise = makeNoise(seed);
  const rough = makeNoise(seed + 77);
  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      if (d > R) continue;
      const falloff = 1 - Math.pow(d / R, edgePow);
      let h = (base + noise(x, z) * noiseAmp) * falloff;
      let rockPart = 0;
      for (const b of bumps) {
        const bd = Math.hypot(x - b.x, z - b.z);
        if (bd >= b.r) continue;
        let add = b.h * Math.pow(1 - bd / b.r, b.pow) * Math.max(0.4, falloff);
        if (b.rock) { add *= 0.65 + rough(x * 2.3, z * 2.3) * 0.75; rockPart += add; }
        h += add;
      }
      h = round(h);
      if (h < 1) continue;
      const k = tileKey(x, z);
      w.tiles.set(k, Math.min(h, maxH));
      if (rockWhen && rockWhen(h, rockPart)) (w.rockTiles ??= new Set()).add(k);
    }
  }
  return { seed, noise, rough };
}

// rải n gò ngẫu nhiên quanh đảo — tham số gọn cho các archetype bên dưới
function scatterBumps(R, n, { hMin, hMax, rMin, rMax, pow = 1, rock = false, dMin = 0, dMax = 0.75 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), d = rand(R * dMin, R * dMax);
    out.push({
      x: Math.cos(a) * d, z: Math.sin(a) * d,
      h: rand(hMin, hMax), r: rand(rMin, rMax), pow, rock,
    });
  }
  return out;
}

// ---------- Archetype 2 — Bãi cát & phá nước: đảo thấp gần mực biển, cát trải rộng, nhiều vũng nước nông ----------
function shapeArchetype2(w) {
  const R = randInt(26, 30); w.islandR = R;
  heightField(w, R, {
    base: 1.2, noiseAmp: 1.5, edgePow: 1.5,
    bumps: scatterBumps(R, randInt(3, 5), { hMin: 1.2, hMax: 2.4, rMin: 5, rMax: 9 }),
  });
  for (let i = 0; i < randInt(2, 4); i++) carveLake(w, R);
  if (chance(0.7)) carveRiver(w, R);
  relaxWaterLevels(w);
  findPortalSpot(w, R, [], [1, 4]);
  voxelizeTerrain(w, {
    isWallRock: () => false,
    classify: (x, z, h, k) => (w.water.has(k) || h <= 2 ? 'sand' : 'grass'),
    materials: {
      sand: { color: 0xf0e0b0, texKey: 'sand', tex: { grain: 0.1, border: 0.16 } },
      grass: { color: 0x9ec98a, texKey: 'grass', tex: { grain: 0.14, border: 0.2 } },
    },
  });
}

// ---------- Archetype 3 — Đầm lầy rêu: đất thấp sũng nước, rêu xanh sẫm, nước đục ----------
function shapeArchetype3(w) {
  const R = randInt(27, 30); w.islandR = R;
  heightField(w, R, {
    base: 1.6, noiseAmp: 2.2, edgePow: 1.9,
    bumps: scatterBumps(R, randInt(4, 7), { hMin: 1.5, hMax: 3, rMin: 3, rMax: 6 }),
  });
  for (let i = 0; i < randInt(3, 5); i++) carveLake(w, R);
  carveRiver(w, R);
  relaxWaterLevels(w);
  findPortalSpot(w, R, [], [2, 5]);
  voxelizeTerrain(w, {
    isWallRock: () => false,
    classify: (x, z, h, k) => (w.water.has(k) ? 'dirt' : h <= 2 ? 'dirt' : 'moss'),
    materials: {
      moss: { color: 0x5f7a55, texKey: 'moss', tex: { grain: 0.18, border: 0.24, speckle: 0.12 } },
      dirt: { color: 0x6b5a42, texKey: 'dirt', tex: { grain: 0.18, border: 0.24, speckle: 0.12 } },
    },
  });
}

// ---------- Archetype 4 — Cao nguyên tuyết: mặt bàn cao, vách dựng đứng, tuyết phủ đỉnh ----------
function shapeArchetype4(w) {
  const R = randInt(25, 28); w.islandR = R;
  heightField(w, R, {
    base: 4.5, noiseAmp: 2, edgePow: 3.6,
    bumps: scatterBumps(R, randInt(2, 4), { hMin: 2.5, hMax: 4.5, rMin: 4, rMax: 7, pow: 1.6, rock: true, dMax: 0.5 }),
    rockWhen: (h) => h >= 8,
  });
  if (chance(0.5)) carveLake(w, R);
  relaxWaterLevels(w);
  findPortalSpot(w, R, [], [3, 8]);
  voxelizeTerrain(w, {
    isWallRock: () => true,
    classify: (x, z, h, k) => (!w.water.has(k) && h >= 5 ? 'snow' : 'cliff'),
    materials: {
      snow: { color: 0xecf2f6, texKey: 'snow', tex: { grain: 0.07, border: 0.13 } },
      cliff: { color: 0x8a94a0, texKey: 'stone', tex: { grain: 0.16, border: 0.24, speckle: 0.1 } },
    },
  });
}

// ---------- Archetype 5 — Sa mạc cồn cát: sóng cát nhấp nhô, khô hạn, không một giọt nước ----------
function shapeArchetype5(w) {
  const R = randInt(28, 32); w.islandR = R;
  heightField(w, R, {
    base: 2.4, noiseAmp: 4.5, edgePow: 2.2,
    bumps: scatterBumps(R, randInt(4, 6), { hMin: 2, hMax: 4, rMin: 6, rMax: 11, pow: 1.3 }),
  });
  findPortalSpot(w, R, [], [2, 7]);
  voxelizeTerrain(w, {
    isWallRock: () => false,
    classify: (x, z, h) => (h >= 7 ? 'sand' : h <= 2 ? 'dirt' : 'sand'),
    materials: {
      sand: { color: 0xe4c68a, texKey: 'sand', tex: { grain: 0.12, border: 0.18 } },
      dirt: { color: 0xc9a878, texKey: 'dirt', tex: { grain: 0.14, border: 0.2, speckle: 0.08 } },
    },
  });
}

// ---------- Archetype 6 — Miệng núi lửa: nón tro cao, lòng chảo lõm ở đỉnh, đá bazan sẫm ----------
function shapeArchetype6(w) {
  const R = randInt(26, 29); w.islandR = R;
  const ca = rand(0, Math.PI * 2), cd = rand(0, R * 0.2);
  const cx = Math.cos(ca) * cd, cz = Math.sin(ca) * cd;
  const craterR = rand(5, 7);
  heightField(w, R, {
    base: 1.8, noiseAmp: 2, edgePow: 2.4,
    bumps: [{ x: cx, z: cz, h: rand(9, 12), r: rand(13, 16), pow: 1.5, rock: true }],
    rockWhen: (h, rockPart) => rockPart > 1 || h >= 6,
  });
  // khoét lòng chảo ở đỉnh nón
  for (const [k, h] of [...w.tiles]) {
    const [x, z] = k.split(',').map(Number);
    const d = Math.hypot(x - cx, z - cz);
    if (d < craterR) {
      const dip = Math.round((1 - d / craterR) * 4);
      w.tiles.set(k, Math.max(2, h - dip));
    }
  }
  findPortalSpot(w, R, [{ x: cx, z: cz, r: craterR + 3 }], [2, 5]);
  voxelizeTerrain(w, {
    isWallRock: () => true,
    classify: (x, z, h, k) => (w.rockTiles?.has(k) ? 'cliff' : h <= 2 ? 'dirt' : 'moss'),
    materials: {
      cliff: { color: 0x3f3a37, texKey: 'stone', tex: { grain: 0.2, border: 0.28, speckle: 0.16 } },
      moss: { color: 0x6a6b52, texKey: 'moss', tex: { grain: 0.18, border: 0.24, speckle: 0.12 } },
      dirt: { color: 0x554b44, texKey: 'dirt', tex: { grain: 0.18, border: 0.26, speckle: 0.14 } },
    },
  });
}

// ---------- Archetype 7 — Ruộng bậc thang: độ cao làm tròn theo bội số 2 nên cả đảo thành từng thềm phẳng ----------
function shapeArchetype7(w) {
  const R = randInt(27, 30); w.islandR = R;
  heightField(w, R, {
    base: 2.6, noiseAmp: 4, edgePow: 2.2,
    bumps: scatterBumps(R, randInt(2, 4), { hMin: 3, hMax: 5, rMin: 7, rMax: 12, pow: 1.2 }),
    round: (h) => Math.round(h / 2) * 2,   // đây mới là thứ tạo ra thềm bậc thang
  });
  if (chance(0.6)) carveRiver(w, R);
  relaxWaterLevels(w);
  const pathTiles = carvePathTiles(w, R);
  findPortalSpot(w, R, [], [2, 8]);
  voxelizeTerrain(w, {
    isWallRock: () => false,
    classify: (x, z, h, k) => (w.water.has(k) ? 'dirt' : pathTiles.has(k) ? 'path' : 'grass'),
    materials: {
      grass: { color: 0x94c07a, texKey: 'grass', tex: { grain: 0.14, border: 0.22 } },
      dirt: { color: 0x9c7d55, texKey: 'dirt', tex: { grain: 0.16, border: 0.22, speckle: 0.1 } },
    },
  });
}

// ---------- Archetype 8 — Đồi thông cao nguyên: nhiều gò tròn nối nhau, cỏ sẫm, một con suối ----------
function shapeArchetype8(w) {
  const R = randInt(28, 31); w.islandR = R;
  heightField(w, R, {
    base: 2.2, noiseAmp: 2.6, edgePow: 2.6,
    bumps: scatterBumps(R, randInt(6, 9), { hMin: 2.5, hMax: 5, rMin: 4, rMax: 8, pow: 1.4 }),
    rockWhen: (h) => h >= 10,
  });
  carveRiver(w, R);
  if (chance(0.4)) carveLake(w, R);
  relaxWaterLevels(w);
  findPortalSpot(w, R, [], [2, 6]);
  voxelizeTerrain(w, {
    isWallRock: (x, z, k) => w.rockTiles?.has(k),
    classify: (x, z, h, k) => (w.water.has(k) ? 'sand' : h >= 9 ? 'cliff' : h <= 1 ? 'sand' : 'moss'),
    materials: {
      moss: { color: 0x6f9464, texKey: 'moss', tex: { grain: 0.16, border: 0.22, speckle: 0.08 } },
      cliff: { color: 0x7d8480, texKey: 'stone', tex: { grain: 0.18, border: 0.26, speckle: 0.12 } },
    },
  });
}

// ---------- Archetype 9 — Rừng cột đá vôi: hàng loạt trụ đá mảnh vót cao mọc lên từ nền cỏ thấp ----------
function shapeArchetype9(w) {
  const R = randInt(27, 30); w.islandR = R;
  heightField(w, R, {
    base: 1.6, noiseAmp: 1.4, edgePow: 2,
    // r nhỏ + pow lớn = trụ mảnh vót nhọn, khác hẳn gò thoải của các dạng khác
    bumps: scatterBumps(R, randInt(7, 11), { hMin: 6, hMax: 11, rMin: 2.2, rMax: 3.6, pow: 3.2, rock: true }),
    rockWhen: (h, rockPart) => rockPart > 0.8,
  });
  if (chance(0.5)) carveLake(w, R);
  relaxWaterLevels(w);
  findPortalSpot(w, R, [], [1, 4]);
  voxelizeTerrain(w, {
    isWallRock: (x, z, k) => w.rockTiles?.has(k),
    classify: (x, z, h, k) => {
      if (w.water.has(k)) return 'sand';
      return w.rockTiles?.has(k) ? 'cliff' : 'grass';
    },
    materials: {
      cliff: { color: 0xa8a49a, texKey: 'stone', tex: { grain: 0.18, border: 0.26, speckle: 0.12 } },
      grass: { color: 0x86b874, texKey: 'grass', tex: { grain: 0.14, border: 0.2 } },
    },
  });
}

// ---------- Điều phối: chọn hàm dựng địa hình theo w.archetype ----------
const TERRAIN_SHAPES = [
  shapeArchetype0, shapeArchetype1, shapeArchetype2, shapeArchetype3, shapeArchetype4,
  shapeArchetype5, shapeArchetype6, shapeArchetype7, shapeArchetype8, shapeArchetype9,
];
function buildTerrain(w) {
  const shape = TERRAIN_SHAPES[w.archetype] ?? TERRAIN_SHAPES[0];
  shape(w);
}

// Khoảng cách trần giữa 2 vật thể liền kề theo level — nội suy TUYẾN TÍNH từ distMax (giữ nguyên tới
// distRampStartLevel) lên distMaxFar (đạt đúng ở distRampEndLevel), thay vì nhảy đột ngột ở 1 mốc duy nhất như
// trước — người chơi không còn gặp cú nhảy xa hẳn ra ngay ranh giới 1 level.
function chainDistMaxFor(level) {
  const c = CFG.chain;
  if (level <= c.distRampStartLevel) return c.distMax;
  if (level >= c.distRampEndLevel) return c.distMaxFar;
  const t = (level - c.distRampStartLevel) / (c.distRampEndLevel - c.distRampStartLevel);
  return c.distMax + (c.distMaxFar - c.distMax) * t;
}

// Tầm nhảy ngang XA NHẤT vật lý thật khi vật thể kế tiếp cao hơn dy so với điểm bật nhảy — thời gian bay tới
// lúc rơi xuống đúng độ cao dy giảm dần khi dy tăng, nên tầm xa cũng giảm theo (khác hẳn nhảy ngang bằng).
// distMax/distMaxFar trong config chỉ đúng ở dy thấp — không hạ trần theo dy thì node vừa xa vừa cao dễ sinh
// ra khoảng cách vượt quá sức nhảy thật, xem CFG.chain.
function maxJumpDistForDy(dy) {
  const { jumpV: vy, gravity: g, speed } = CFG.player;
  const disc = vy * vy - 2 * g * dy;
  if (disc <= 0) return 0; // dy vượt quá đỉnh nhảy — không thể tới
  const t = (vy + Math.sqrt(disc)) / g; // thời điểm rơi xuống đúng cao độ dy (nghiệm sau, toàn bộ thời gian bay)
  return speed * t;
}

// ---------- Chuỗi vật thể lơ lửng — bắt đầu ngay cạnh cổng ----------
function buildChain(w, level) {
  const count = chainCountFor(level);
  const { x: px, y: py, z: pz } = w.portal;

  // chọn hướng có địa hình thấp nhất (tránh chuỗi cắm vào đồi/núi)
  let baseAngle = Math.atan2(pz, px);
  if (Math.hypot(px, pz) < 2) baseAngle = rand(0, Math.PI * 2);
  let bestAngle = baseAngle, bestScore = Infinity;
  for (let off = -1.2; off <= 1.2; off += 0.3) {
    const a = baseAngle + off;
    let score = 0;
    for (let d = 3; d <= 18; d++) {
      const th = w.tiles.get(tileKey(Math.round(px + Math.cos(a) * d), Math.round(pz + Math.sin(a) * d)));
      if (th !== undefined) score += Math.max(0, th - py);
    }
    if (score < bestScore) { bestScore = score; bestAngle = a; }
  }
  baseAngle = bestAngle;
  let heading = baseAngle;

  // dựng cổng + vòng cột (chừa lối theo hướng chuỗi) + vật cản
  buildPortalStructures(w, baseAngle);

  // vật thể ĐẦU TIÊN ngay cạnh tế đàn — phải ra ngoài hẳn vòng cột trụ (bán kính do altar.js trả về), cộng
  // thêm 2.6 để nửa bề rộng vật thể (tới 1.7) vẫn không chạm vào cột
  const firstDist = Math.max(4.6, (w.altarClearR ?? 0) + 2.6);
  let cx = px + Math.cos(baseAngle) * firstDist;
  let cz = pz + Math.sin(baseAngle) * firstDist;
  let cy = py + 0.7;

  // 10–19: quái có thể ngẫu nhiên xuất hiện nhưng thưa + xác suất thấp; từ 20: dày hơn + xác suất cao hơn hẳn
  const hasMonsters = level >= CFG.monsters.startLevel;
  const monstersDense = level >= CFG.monsters.denseLevel;
  const monsterEvery = monstersDense ? CFG.monsters.everyDense : CFG.monsters.everySparse;
  const monsterChance = monstersDense ? CFG.monsters.chanceDense : CFG.monsters.chanceSparse;

  let prevCy = py;
  // lenBeforePrev/lenBeforePrevI = độ dài w.platforms/w.islands TÍNH TỪ TRƯỚC KHI node liền trước (i-1) được
  // đặt — dùng làm biên loại trừ khi kiểm tra chồng lấn cho node hiện tại, nhờ vậy chỉ so với node từ 2 bước
  // trở lên, không chặn nhầm node liền kề (vốn CỐ Ý ở gần, vừa tầm nhảy). Cập nhật ở CUỐI mỗi vòng lặp bằng
  // giá trị "độ dài trước khi vòng lặp này thêm gì" — lệch đúng 1 nhịp so với node hiện tại.
  let lenBeforePrev = 0, lenBeforePrevI = 0;
  for (let i = 0; i < count; i++) {
    const lenBeforeThis = w.platforms.length, lenBeforeThisI = w.islands.length;

    if (i > 0) {
      // vị trí node i: xoay hướng tự do quanh cả 360° (trước/sau/ngang đều được) từ node i-1 — khoảng cách/độ
      // cao nhảy (dist/dy) không đổi theo hướng nên đường nhảy giữa 2 vật thể liền kề luôn giữ nguyên tầm nhảy
      // được, bất kể xoay hướng nào. Thử vài hướng nếu vị trí mới chồng lấn vật đã đặt từ 2 bước trở lên trước
      // đó (đường chuỗi cuộn lại) — không tìm được chỗ trống sau vài lần thử thì chấp nhận lần thử cuối, tránh
      // lặp vô hạn.
      const distMax = chainDistMaxFor(level);
      let nextHeading, nextCx, nextCz, nextDy;
      for (let attempt = 0; attempt < 24; attempt++) {
        // 8 lần đầu: hướng ngẫu nhiên quanh heading hiện tại (giữ đường đi tự nhiên như cũ). Vẫn chồng lấn thì
        // chuyển sang quét đều 16 hướng quanh cả 360° — vét gần hết mọi hướng khả dĩ (kể cả khe hở hẹp) trước
        // khi đành chấp nhận lần thử cuối.
        nextHeading = attempt < 8 ? heading + rand(-1.3, 1.3) : (attempt - 8) / 16 * Math.PI * 2;
        nextDy = rand(0.55, 1.15);
        // hạ trần dist theo tầm nhảy vật lý thật ứng với nextDy (nhân 0.9 chừa biên an toàn cho sai số điểm
        // đặt chân) — leo càng cao thì trần càng thấp, tránh sinh khoảng cách vượt sức nhảy (xem maxJumpDistForDy)
        const distCap = Math.min(distMax, maxJumpDistForDy(nextDy) * 0.9);
        const dist = rand(CFG.chain.distMin, Math.max(CFG.chain.distMin, distCap));
        nextCx = cx + Math.cos(nextHeading) * dist;
        nextCz = cz + Math.sin(nextHeading) * dist;
        // 1.7: ước lượng an toàn cho kích thước vật thể LỚN NHẤT có thể được chọn ngẫu nhiên ở node này (hộp
        // diêm — objMatchbox — hw thật 1.6, sau khi xoay yaw ngẫu nhiên AABB bao có thể tới 1.69, xem voxel.js)
        // — chưa biết trước sẽ chọn vật nào nên phải ước lượng theo vật to nhất đã xoay, tránh chồng lấn y hệt
        // lỗi bán kính đảo quái đã sửa trước đó
        if (hasSpaceFor(w, nextCx, nextCz, 1.7, lenBeforePrev, lenBeforePrevI)) break;
      }
      heading = nextHeading;
      cx = nextCx; cz = nextCz; cy += nextDy;
    }

    // đoạn bay ngang đảo: vật thể thấp (nhảy được từ mặt đất), tránh cắm sâu vào địa hình
    const groundH = w.tiles.get(tileKey(Math.round(cx), Math.round(cz)));
    let shallow = false;
    if (groundH !== undefined) {
      if (cy < groundH + 0.7) cy = groundH + 0.7;
      shallow = (cy - groundH) < 1.8; // gần đất → chỉ dùng đồ vật đáy nông
    } else if (cy - prevCy > 1.15) {
      cy = prevCy + 1.1; // ngoài đảo: đảm bảo luôn trong tầm nhảy từ vật thể trước
    }
    prevCy = cy;

    const tier = Math.max(1, Math.round(cy - py));
    w.chainPath.push({ x: cx, z: cz });
    // i < count - 1: không cho đảo quái rơi đúng vào vật thể cuối cùng — vị trí ngay trước khi bước lên đảo đích
    const isMonsterNode = hasMonsters && i >= CFG.monsters.firstAt && i < count - 1 &&
      (i - CFG.monsters.firstAt) % monsterEvery === 0 && chance(monsterChance);

    if (isMonsterNode) {
      // đảo quái to: đặt tâm lùi sâu để mép đảo cách vật thể trước ~2 đơn vị
      const ir = rand(5.5, 6.5);
      let icx = cx + Math.cos(heading) * (ir - 1.0);
      let icz = cz + Math.sin(heading) * (ir - 1.0);
      // đảo to (bán kính va chạm tới r*1.3, xem buildMonsterIsland — mặt cỏ tràn ra ngoài đế đá) dễ chồng lên
      // vật thể/đảo đã đặt từ trước nếu đường chuỗi cuộn lại — thử vài hướng ngẫu nhiên trước, không được thì
      // quét đều quanh cả 360°
      let fits = hasSpaceFor(w, icx, icz, ir * 1.3, lenBeforePrev, lenBeforePrevI);
      for (let attempt = 0; attempt < 21 && !fits; attempt++) {
        heading = attempt < 5 ? baseAngle + rand(-2.5, 2.5) : (attempt - 5) / 16 * Math.PI * 2;
        icx = cx + Math.cos(heading) * (ir - 1.0);
        icz = cz + Math.sin(heading) * (ir - 1.0);
        fits = hasSpaceFor(w, icx, icz, ir * 1.3, lenBeforePrev, lenBeforePrevI);
      }
      // đảo quá to để chồng khít vào bất kỳ hướng nào quanh đây — KHÔNG cố nhét ép (dễ vượt tầm nhảy hoặc vẫn
      // chồng lấn), bỏ qua đảo quái ở node này, rơi xuống nhánh đặt vật thể thường (nhỏ, dễ tìm chỗ) bên dưới
      if (fits) {
        buildMonsterIsland(w, icx, cy, icz, tier, ir);
        lenBeforePrev = lenBeforeThis; lenBeforePrevI = lenBeforeThisI;
        // node tiếp theo xuất phát từ mép xa của đảo
        cx = icx + Math.cos(heading) * (ir + rand(2.2, 2.8));
        cz = icz + Math.sin(heading) * (ir + rand(2.2, 2.8));
        cy += rand(0.3, 0.7);
        continue;
      }
    }

    const obj = V.buildFloatingObject(shallow);
    // góc xoay quanh trục đứng random RIÊNG từng vật + nghiêng nhẹ 0–10°
    const yaw = rand(0, Math.PI * 2);
    const tiltA = rand(0, 0.17), tiltDir = rand(0, Math.PI * 2);
    obj.group.rotation.set(Math.cos(tiltDir) * tiltA, yaw, Math.sin(tiltDir) * tiltA);
    obj.group.position.set(cx, cy, cz);
    w.group.add(obj.group);
    // VÙNG VA CHẠM ĐO TỪ HÌNH HỌC THẬT (xem V.measureFootprint) — thay cho công thức lượng giác tính tay cũ,
    // vốn chỉ tính theo yaw và bỏ sót hoàn toàn phần nghiêng tiltA/tiltDir, khiến MỌI vật thể đều lệch ít nhiều.
    // Vật tròn → lục giác (6 cạnh bám sát mặt tròn); vật khối hộp → bao lồi tự cho ra đúng HÌNH CHỮ NHẬT/VUÔNG
    // khớp tuyệt đối, còn vật ghép nhiều khối (vd hộp diêm có ngăn kéo thò ra) được tối đa 8 cạnh để ôm sát
    // hình chữ L thay vì phình thành một hộp chữ nhật to trùm cả khoảng trống.
    const foot = V.measureFootprint(obj.group, obj.round ? 6 : 8, cx, cz);
    const plat = { x: cx, y: cy, z: cz, foot, tier, depth: obj.depth || 1.2, mesh: obj.group };
    w.platforms.push(plat);

    if (i > 0) {
      // rải xu/rương trang trí theo kích thước danh nghĩa của vật (hw/hd) — chỉ để chọn CHỖ ĐẶT cho đẹp,
      // không liên quan tới vùng va chạm (đã đo riêng ở trên)
      const hw = obj.hw, hd = obj.hd;
      const roll = Math.random();
      if (roll < 0.4) {
        const coin = V.buildCoin();
        coin.position.set(cx + rand(-hw * 0.35, hw * 0.35), cy + 0.45, cz + rand(-hd * 0.35, hd * 0.35));
        w.group.add(coin);
        w.coins.push({ mesh: coin, x: coin.position.x, y: coin.position.y, z: coin.position.z, taken: false, value: 1 });
      } else if (roll < 0.6) {
        const ch = V.buildChest();
        // chỉ 20% cho phép rương rơi gần tâm (có thể chắn đúng điểm hạ cánh, đòi nhảy đôi để vượt qua) —
        // 80% còn lại đẩy ra rìa vật thể, không chắn đường nhảy chính
        let ox, oz;
        if (chance(0.2)) {
          ox = rand(-hw * 0.35, hw * 0.35); oz = rand(-hd * 0.35, hd * 0.35);
        } else {
          const edgeA = rand(0, Math.PI * 2);
          ox = Math.cos(edgeA) * hw * rand(0.55, 1);
          oz = Math.sin(edgeA) * hd * rand(0.55, 1);
        }
        const chYaw = rand(0, Math.PI * 2);
        ch.position.set(cx + ox, cy, cz + oz);
        ch.rotation.y = chYaw;
        w.group.add(ch);
        // rương là khối hộp CÓ XOAY — đo hình chữ nhật xoay theo đúng góc của nó, không dùng hộp bao thô
        w.chests.push({
          mesh: ch, hp: CFG.chest.hp, broken: false,
          x: cx + ox, y: cy, z: cz + oz, top: cy + 0.62,
          foot: V.measureFootprint(ch, 8, cx + ox, cz + oz),
        });
      }
    }

    lenBeforePrev = lenBeforeThis; lenBeforePrevI = lenBeforeThisI;
  }

  // ---- Đảo đích: đặt tâm cách vật thể cuối đúng BÁN KÍNH ĐẢO + một khoảng nhảy thật, để MÉP đảo (chỗ người
  // chơi tiếp đất) nằm trong tầm nhảy. Trước đây tâm chỉ cách 0.8 trong khi bán kính đảo tới 3.5-4.7, nên vật
  // thể cuối bị chôn hẳn trong lòng đảo đích: người chơi đứng lọt thỏm giữa đảo, không nhảy lên được. ----
  const goalR = goalIslandRadius(w.shrineTier ?? 0);
  const goalGap = rand(2.2, 2.7);   // khoảng hở từ tâm vật thể cuối tới MÉP đảo — trong tầm nhảy
  // Khác các node giữa chuỗi (cố ý cho phép sát nhau), đảo đích chỉ được miễn trừ ĐÚNG vật thể cuối — điểm bật
  // nhảy lên đảo. Mọi vật thể/đảo còn lại đều phải né, tránh cảnh vật thể lơ lửng cắm xuyên qua đảo đích khi
  // đường chuỗi cuộn ngược lại gần cuối.
  const goalBoundP = Math.max(0, w.platforms.length - 1);
  // Quét hướng và GIỮ LẠI vị trí thoáng nhất: ưu tiên đi thẳng tiếp hướng chuỗi, không được thì lệch ngẫu
  // nhiên, cuối cùng quét đều quanh 360°. Thoát ngay khi gặp chỗ đủ trống; nếu không hướng nào đủ trống thì
  // dùng hướng ÍT chồng lấn nhất — trước đây dùng đại lần thử cuối nên thỉnh thoảng vẫn có vật thể lọt vào đảo.
  let goalHeading = heading, gx = cx, gz = cz, best = -Infinity;
  // Chuỗi dài (level cao) có thể cuộn lại quanh node cuối khiến MỌI hướng ở khoảng cách gốc đều chật — khi đó
  // nới dần khoảng nhảy ra thêm chút một. Xa nhất là 2.7+0.9=3.6 tính từ TÂM vật thể cuối tới mép đảo, vẫn dưới
  // tầm nhảy ngang tối đa của nhân vật (~3.9 với jumpV/gravity/speed hiện tại) nên luôn nhảy sang được.
  outer:
  for (const extra of [0, 0.3, 0.6, 0.9]) {
    const dist = goalR + goalGap + extra;
    for (let attempt = 0; attempt < 38; attempt++) {
      const a = attempt === 0 ? heading
        : attempt < 6 ? heading + rand(-1.4, 1.4)
        : ((attempt - 6) / 32) * Math.PI * 2;
      const tx = cx + Math.cos(a) * dist, tz = cz + Math.sin(a) * dist;
      const clear = spaceClearance(w, tx, tz, goalR, goalBoundP, w.islands.length);
      if (clear > best) { best = clear; goalHeading = a; gx = tx; gz = tz; }
      if (clear >= 0) break outer;
    }
  }
  buildGoalIsland(w, gx, cy, gz, goalHeading);
}

// Bán kính mặt đứng của đảo đích theo cấp — dùng CHUNG cho cả lúc dựng đảo lẫn lúc tính chỗ đặt trong chuỗi,
// để hai nơi không bao giờ lệch nhau (trước đây buildChain gán cứng 3.5 trong khi đảo thật to tới 4.7).
function goalIslandRadius(tier) {
  return 3.5 + tier * 0.13;
}

function chainCountFor(level) {
  const c = CFG.chain;
  if (level <= 1) return c.base;
  const early = Math.min(level, c.phaseLevel - 1) - 1;
  const late = Math.max(0, level - (c.phaseLevel - 1));
  return c.base + early * c.incEarly + late * c.incLate;
}

// ---------- Trang trí theo cấp (w.shrineTier, 0-9) — DÙNG CHUNG cho cả tế đàn khởi đầu (buildPortalStructures)
// LẪN đảo đích (buildGoalIsland), để 2 nơi tiến hoá ĐỒNG BỘ theo cùng 1 cấp. Gồm: bệ đá nhiều lớp (số lớp tăng
// theo cấp), cột trụ 2-6 (random mỗi level, không phụ thuộc cấp; random gãy/đổ; cột nguyên vẹn random CÓ/KHÔNG
// đầu cột to kiểu Ai Cập cổ đại; từ crystalFromTier thêm khối tinh thể lơ lửng trên đỉnh), và đá bay quanh —
// lắc nhẹ tại chỗ (cấp 6-7) rồi đổi sang xoay vòng quanh trụ sáng (cấp 8-9, cấp 9 thêm co giãn quỹ đạo chậm).
// origin: {x,y,z} tâm (vòng sáng). avoidAngle: hướng cần né khi rải cột trụ (lối ra chuỗi ở tế đàn khởi đầu /
// hướng người chơi tiến vào ở đảo đích). opts.innerR: bán kính vòng cột trụ. opts.daisBaseR/daisStep: bán kính
// lớp bệ đá đầu tiên/mức tăng mỗi lớp — mỗi nơi tự truyền vào cho vừa quy mô riêng (tế đàn theo portalScale,
// đảo đích cố định nhỏ hơn để không tràn ra mép đảo). ----------
function buildTierDecor(w, origin, tier, avoidAngle, opts = {}) {
  const S = CFG.shrine;
  const { x: ox, y: oy, z: oz } = origin;
  const innerR = opts.innerR ?? S.innerR;
  const daisBaseR = opts.daisBaseR ?? 1.5;
  const daisStep = opts.daisStep ?? 0.5;
  const color = shrineColorForTier(tier);
  const stonePalette = shrineStoneForTier(tier);
  // độ cao mặt bậc mà cột trụ đứng lên (bậc ngoài cùng của bệ) — 0 nếu nơi này không có bệ bậc thang
  const pillarBaseY = oy + (opts.pillarStepY ?? 0);

  const pushColumnCollider = (col, cx, cz, ry) => {
    w.colliders.push({ x: cx, z: cz, r: col.userData.hitR, y: pillarBaseY, h: col.userData.hitH });
    const f = col.userData.fallen;
    if (f) {
      const wx = cx + f.x * Math.cos(ry) + f.z * Math.sin(ry);
      const wz = cz - f.x * Math.sin(ry) + f.z * Math.cos(ry);
      w.colliders.push({ x: wx, z: wz, foot: V.measureFootprint(f.mesh, 8, wx, wz), y: pillarBaseY, h: f.h });
    }
  };

  // ---- cấp daisFromTier(2)+: bệ đá nhiều lớp, số lớp tăng dần theo cấp — chỉ trang trí, KHÔNG đổi độ cao
  // spawn/chuỗi vật thể (buildPortalStructures chạy sau khi w.portal đã chốt và buildChain đã dùng để tính vị
  // trí node đầu tiên) ----
  if (tier >= S.daisFromTier) {
    const layers = Math.min(1 + Math.floor((tier - S.daisFromTier) / 2), S.daisLayersMax);
    for (let i = 0; i < layers; i++) {
      const r = daisBaseR + i * daisStep;
      const dais = V.buildDaisRing(r, i % 2 === 0 ? stonePalette.alt : stonePalette.dark, opts.keepStone, opts.sides);
      dais.position.set(ox, oy + 0.02 - i * 0.001, oz);
      w.group.add(dais);
    }
  }

  // ---- cột trụ: số lượng random 2-6 MỖI LEVEL (không phụ thuộc cấp), rải quanh tâm né avoidAngle. Mỗi cột:
  // random nguyên vẹn/rạn/đổ (đa số nguyên vẹn); cột nguyên vẹn random CÓ/KHÔNG đầu cột to kiểu Ai Cập cổ đại.
  // Từ crystalFromTier: cột không đổ thêm 1 khối tinh thể lơ lửng trên đỉnh (luôn màu xanh pha lê thật, không
  // theo màu trụ sáng chính — trụ sáng còn vàng ở các cấp này, đúng tham khảo). ----
  // opts.pillars === false: đảo đích KHÔNG có cột trụ nào (đúng thiết kế tham khảo — đảo đích chỉ có bệ đá,
  // trụ sáng và đá bay), chỉ tế đàn khởi đầu mới dựng cột.
  if (opts.pillars !== false) {
    const pillarCount = randInt(S.pillarCountMin, S.pillarCountMax);
    // Chia đều trên CUNG CÒN LẠI sau khi trừ quạt lối ra (±exitGap quanh avoidAngle) — trước đây rải đều quanh
    // 360° rồi bỏ qua cột nào rơi trúng lối ra, nên bốc trúng 2 cột mà 1 cột rơi vào quạt đó thì tế đàn chỉ còn
    // 1 cột, phá vỡ đúng khoảng 2-6 đã bốc. Nhiễu ±0.12 nhỏ hơn hẳn exitGap nên cột không lấn vào lối ra.
    const exitGap = 0.55;
    const pillarSpan = Math.PI * 2 - exitGap * 2;
    // Khối điểm xuyết phát sáng trên thân cột: vàng ở các cấp giữa, đổi sang xanh pha lê ở cấp cao — đúng ảnh
    // tham khảo (LVL4-7 vạch vàng, LVL8-10 chuyển hẳn xanh).
    const accentColor = tier < S.crystalFromTier ? null
      : tier >= S.beamShiftFromTier ? S.colorCrystalHex : 0xffd27f;
    for (let i = 0; i < pillarCount; i++) {
      const a = avoidAngle + exitGap + pillarSpan * ((i + 0.5) / pillarCount) + rand(-0.12, 0.12);
      const cx = ox + Math.cos(a) * innerR, cz = oz + Math.sin(a) * innerR;
      const roll = Math.random();
      const state = roll < 0.6 ? 0 : roll < 0.85 ? 1 : 2;
      const capital = state === 0 && chance(0.5);
      const crystalColor = tier >= S.crystalFromTier && state !== 2 ? S.colorCrystalHex : null;
      const col = V.buildColumn(state, { crystalColor, capital, accentColor, stonePalette });
      col.position.set(cx, pillarBaseY, cz);
      const ry = -a + Math.PI / 2;
      col.rotation.y = ry;
      w.group.add(col);
      pushColumnCollider(col, cx, cz, ry);
    }
  }

  // ---- đá bay quanh, từ cấp 6. Cấp 6-7: lắc nhẹ tại chỗ (lên/xuống HOẶC trái/phải trong phạm vi nhỏ, mỗi
  // viên tự chọn 1 trục). Từ cấp 8: đổi hẳn sang XOAY VÒNG quanh trụ sáng chính (1-2 vòng ở cấp 8, ngược chiều
  // nhau nếu 2 vòng, kích cỡ đá khác nhau rõ giữa các vòng); cấp 9 thêm 2-3 vòng và quỹ đạo co giãn theo chu kỳ
  // chậm (thi thoảng phình ra rồi thu lại) — biên độ co giãn GIỐNG NHAU ở mọi vòng, chỉ bán kính/kích cỡ đá
  // khác nhau. ----
  if (S.jitterTiers.includes(tier)) {
    const n = S.jitterCount[tier];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), d = rand(innerR * 0.7, innerR * 1.3);
      const rock = V.buildOrbitRune(color, 1, stonePalette.dark);
      const bx = ox + Math.cos(a) * d, by = oy + S.jitterHeight + rand(-0.4, 0.4), bz = oz + Math.sin(a) * d;
      rock.position.set(bx, by, bz);
      rock.rotation.y = rand(0, Math.PI * 2);
      w.group.add(rock);
      w.jitters.push({
        mesh: rock, base: { x: bx, y: by, z: bz }, axis: pick(['y', 'x', 'z']),
        amp: S.jitterAmp * rand(0.7, 1.15), speed: rand(0.5, 0.9), phase: rand(0, Math.PI * 2),
      });
    }
  } else if (tier >= S.orbitFromTier) {
    const pulse = tier >= S.orbitPulseFromTier;
    const ringCount = pulse ? (chance(0.5) ? 2 : 3) : (chance(0.5) ? 1 : 2);
    // Nhịp phình/thu quỹ đạo bốc MỘT LẦN cho cả tế đàn rồi dùng chung cho MỌI viên đá: nếu để mỗi viên một
    // pha riêng, các viên trong cùng vòng sẽ ở bán kính khác nhau nên vòng tròn méo thành đám lộn xộn thay vì
    // nở ra/thu vào NGUYÊN VÒNG như yêu cầu.
    const pulseSpeed = rand(0.08, 0.15), pulsePhase = rand(0, Math.PI * 2);
    for (let r = 0; r < ringCount; r++) {
      // cấp 8: mỗi vòng một bán kính (vòng to vòng nhỏ). Cấp 9: MỌI vòng chung đúng 1 bán kính, chỉ khác nhau
      // ở cỡ đá/chiều xoay/độ cao — xem CFG.shrine.orbitPulseR.
      const baseR = pulse ? S.orbitPulseR : 0.9 + r * S.orbitRingGap;
      const scale = 0.7 + r * 0.35; // kích cỡ đá khác nhau rõ rệt giữa các vòng
      const n = 5 + r * 2;
      const dir = r % 2 === 0 ? 1 : -1;
      const y = oy + S.orbitHeight + r * 0.3;
      // tốc độ xoay bốc theo VÒNG (không theo từng viên) — mỗi viên một tốc độ thì đội hình vòng tròn sẽ loãng
      // dần rồi tan ra sau vài chục giây
      const speed = dir * rand(0.18, 0.28);
      for (let i = 0; i < n; i++) {
        const angle0 = (i / n) * Math.PI * 2;
        const rune = V.buildOrbitRune(color, scale, stonePalette.dark);
        rune.position.set(ox + Math.cos(angle0) * baseR, y, oz + Math.sin(angle0) * baseR);
        w.group.add(rune);
        w.orbiters.push({
          mesh: rune, cx: ox, cz: oz, y,
          baseR, angle: angle0, speed,
          pulseAmp: pulse ? S.orbitPulseAmp : 0, pulseSpeed, pulsePhase,
        });
      }
    }
  }
}

// ---------- Tế đàn truyền tống khởi đầu — dựng bằng bản thiết kế voxel trong altar.js ----------
function buildPortalStructures(w, chainAngle) {
  const tier = w.shrineTier ?? 0;
  const { x: px, y: ph, z: pz } = w.portal;

  // KHÔNG xoay cụm tế đàn: lưới voxel của nó phải trùng trục với lưới voxel của đảo. Lối ra cho chuỗi vật thể
  // xử lý bằng cách chọn góc rải cột (exitAngle) chứ không phải xoay cả khối.
  const altar = buildAltar({
    level: tier + 1, pillars: true, exitAngle: chainAngle,
    seed: Math.floor(Math.random() * 1e9), archetype: w.archetype,
  });
  altar.group.position.set(px, ph, pz);
  w.group.add(altar.group);
  w.altars.push(altar);

  for (const c of altar.colliders) {
    w.colliders.push({ x: px + c.x, z: pz + c.z, r: c.r, y: ph, h: c.h });
  }
  // từng bậc của bệ thành mặt đứng đi lên được; người chơi hồi sinh trên bậc trên cùng
  for (const st of altar.steps) w.islands.push({ x: px, z: pz, y: ph + st.y, r: st.r, tier: 999, decor: true });
  w.portalTopY = ph + altar.topY;
  // buildChain đọc để đặt vật thể ĐẦU chuỗi ra ngoài hẳn vòng cột — cột của bản thiết kế mới dày 3 ô nên
  // khoảng cách cố định 4.6 cũ khiến chúng lấn sát vật thể đầu tiên
  w.altarClearR = altar.pillarR;
}

// ---------- (cũ) tế đàn dựng tay — giữ lại cho tham chiếu, hiện KHÔNG còn được gọi ----------
function buildPortalStructuresLegacy(w, chainAngle) {
  const S = CFG.shrine;
  const tier = w.shrineTier ?? 0;
  const { x: px, y: ph, z: pz } = w.portal;
  const color = shrineColorForTier(tier);

  // ---- cổng, phóng to dần theo cấp, màu chuyển dần vàng ấm → xanh pha lê từ cấp beamShiftFromTier. glowRatio:
  // tỉ lệ khối đá vành ngoài đổi thành khối phát sáng, tăng dần từ cấp 6 — "mạch năng lượng" của các cấp cao ----
  const portalScale = tier >= 9 ? S.portalScaleTier9 : tier >= 1 ? S.portalScaleTier1 : 1;
  const sides = S.octagonTiers.includes(tier) ? 8 : 0;
  const portal = V.buildPortal(color, portalScale, {
    glowRatio: Math.max(0, tier - 5) * 0.075,
    stone: shrineStoneForTier(tier),
    steps: S.daisSteps, stepH: S.daisStepH, outerR: S.daisOuterR,
    sides,
  });
  portal.position.set(px, ph, pz);
  w.group.add(portal);
  w.portals.push(portal);
  registerDaisSteps(w, portal, px, ph, pz);
  // người chơi hồi sinh trên MẶT BẬC TRÊN CÙNG, không phải mặt đất dưới chân bệ (nếu không sẽ đứng lún trong đá)
  w.portalTopY = ph + portal.userData.topY;

  // Cột trụ đứng HẲN NGOÀI vành đá, chân cắm xuống đất (pillarStepY = 0) — trước đây đặt trên mặt bậc ngoài
  // cùng nên chân cột đè lên chính vành đá, che mất mép bậc. Vành đá trang trí của các cấp cao thì lan ra
  // phía NGOÀI vòng cột để không đâm vào chân cột.
  const daisR = portal.userData.steps[0].r;
  buildTierDecor(w, { x: px, y: ph, z: pz }, tier, chainAngle, {
    innerR: daisR + 1.1,
    pillarStepY: 0,
    daisBaseR: daisR + 1.85, daisStep: 0.42 * portalScale,
    sides,
    // Loại bỏ viên đá nào KHÔNG nằm trên nền phẳng ngang bằng tế đàn: ô đó không có đất (ra ngoài mép đảo) hoặc
    // cao/thấp hơn (sườn dốc, mỏm đá). Trước đây vành đá cấp cao cứ thế lan ra rồi lơ lửng ngoài rìa đảo.
    keepStone: (lx, lz) => {
      const h = w.tiles.get(tileKey(Math.round(px + lx), Math.round(pz + lz)));
      return h !== undefined && Math.abs(h - ph) < 0.01;
    },
  });
}

// Đăng ký từng bậc của bệ đá thành MẶT ĐỨNG hình tròn trong w.islands — supportAt (game.js) chọn mặt cao nhất
// mà chân người chơi nằm trong bán kính, nên các vành đồng tâm cao dần vào trong tự thành bậc thang đi lên
// được. decor:true để spaceClearance bỏ qua khi xếp chuỗi vật thể (bệ nằm ngay chỗ xuất phát, tính vào sẽ đẩy
// node đầu tiên ra xa vô lý); tier 999 để không bị tính thành mốc sát thương rơi.
function registerDaisSteps(w, portal, x, y, z) {
  for (const st of portal.userData.steps || []) {
    w.islands.push({ x, z, y: y + st.y, r: st.r, tier: 999, decor: true });
  }
}

// ---------- Cây cối, hoa cỏ trên đảo (né đường nhảy và cổng) ----------
function buildIslandDecor(w) {
  const { x: px, z: pz } = w.portal;
  // né TOÀN BỘ đường nhảy — vật thể lơ lửng không chồng lấn cây cối
  const nearChain = (x, z) => {
    for (const p of w.chainPath) {
      if (Math.hypot(x - p.x, z - p.z) < 2.6) return true;
    }
    return false;
  };
  const openTiles = [...w.tiles.entries()].filter(([k, h]) => {
    if (h < 2 || w.water.has(k)) return false;
    const [x, z] = k.split(',').map(Number);
    if (Math.hypot(x - px, z - pz) < 5.5) return false;
    return !nearChain(x, z);
  });
  if (!openTiles.length) return;
  const tileAt = (k) => k.split(',').map(Number);

  // ---- khoáng sản năng lượng: từ cấp mà trụ tế đàn có lõi năng lượng, đảo cũng lộ ra mạch khoáng cùng màu.
  // Rải quanh tế đàn (trong bán kính 16 ô) để đọc ra là mạch năng lượng toả ra từ chính tế đàn. ----
  const shrineLevel = (w.shrineTier ?? 0) + 1;
  if (hasEnergyCore(shrineLevel)) {
    const nearShrine = openTiles.filter(([k]) => {
      const [x, z] = tileAt(k);
      return Math.hypot(x - px, z - pz) < 16;
    });
    const pool = nearShrine.length >= 4 ? nearShrine : openTiles;
    // Né các cụm đá khoáng ĐÃ ĐẶT trước đó — trước không kiểm tra gì nên 2 cụm random ra 2 ô đất liền kề
    // (cách nhau 1 đơn vị) dễ dính sát/lồng vào nhau, nhìn thành một khối đặc không phân biệt được cụm nào
    // với cụm nào. 2.2 đơn vị đủ chừa khoảng hở rõ giữa 2 cụm (mỗi cụm rộng tối đa ~0.75 sau khi giảm 50%).
    const placed = [];
    const target = randInt(3, 5) + Math.floor(shrineLevel / 3);
    for (let i = 0; i < target; i++) {
      let x, z, h, tries = 0, ok;
      do {
        const [k2, h2] = pick(pool);
        [x, z] = tileAt(k2);
        h = h2;
        ok = !placed.some((p) => Math.hypot(p.x - x, p.z - z) < 2.2);
        tries++;
      } while (!ok && tries < 12);
      if (!ok) continue;   // hết lượt thử, bỏ qua cụm này
      placed.push({ x, z });
      const ore = buildEnergyOre({ level: shrineLevel, seed: Math.floor(Math.random() * 1e9), archetype: w.archetype });
      // bám đúng ô lưới đất (toạ độ nguyên) để lưới khoáng trùng trục với lưới đảo
      ore.position.set(x, h, z);
      w.group.add(ore);
    }
  }

  // cụm cây — xen cây cổ thụ tán rộng với cây vừa
  for (let c = 0; c < randInt(5, 8); c++) {
    const [ck] = pick(openTiles);
    const [cx, cz] = tileAt(ck);
    const clusterR = rand(2.5, 5);
    const density = randInt(3, 8);
    const hasBig = chance(0.55);
    for (let i = 0; i < density; i++) {
      const tx = Math.round(cx + rand(-clusterR, clusterR));
      const tz = Math.round(cz + rand(-clusterR, clusterR));
      const k = tileKey(tx, tz);
      if (!w.tiles.has(k) || w.water.has(k) || nearChain(tx, tz)) continue;
      if (Math.hypot(tx - px, tz - pz) < 5.5) continue;
      const big = hasBig && i === 0;
      const sc = big ? rand(0.8, 1.1) : rand(0.55, 1.25);
      const t = big ? V.buildBigTree(sc) : V.buildTree(sc);
      const wx = tx + rand(-0.3, 0.3), wz = tz + rand(-0.3, 0.3);
      t.position.set(wx, w.tiles.get(k), wz);
      t.rotation.y = rand(0, Math.PI * 2);
      w.group.add(t);
      // thân cây là vật rắn — thân là khối hộp vuông nên dùng va chạm HÌNH VUÔNG đo từ chính khối thân
      w.colliders.push({
        x: wx, z: wz, y: w.tiles.get(k), h: (big ? 5 : 3) * sc,
        foot: V.measureFootprint(t.userData.trunkMesh, 4, wx, wz),
      });
    }
  }

  // mảng hoa
  for (let c = 0; c < randInt(4, 6); c++) {
    const [ck] = pick(openTiles);
    const [cx, cz] = tileAt(ck);
    for (let i = 0; i < randInt(5, 9); i++) {
      const tx = Math.round(cx + rand(-2, 2)), tz = Math.round(cz + rand(-2, 2));
      const k = tileKey(tx, tz);
      if (!w.tiles.has(k) || w.water.has(k)) continue;
      const f = V.buildFlower();
      f.position.set(tx + rand(-0.4, 0.4), w.tiles.get(k), tz + rand(-0.4, 0.4));
      w.group.add(f);
    }
  }

  // cỏ, đá, bụi rậm rải rác — tăng mật độ tổng thể + cỏ chiếm tỉ lệ cao nhất trong 3 loại (nhiều hơn hẳn hoa)
  for (let i = 0; i < 65; i++) {
    const [k, h] = pick(openTiles);
    const [x, z] = tileAt(k);
    const roll = Math.random();
    const isRockDeco = roll >= 0.65 && roll < 0.83;
    const d = roll < 0.65 ? V.buildGrassTuft() : isRockDeco ? V.buildRock() : V.buildBush();
    const wx = x + rand(-0.4, 0.4), wz = z + rand(-0.4, 0.4);
    d.position.set(wx, h, wz);
    w.group.add(d);
    // tảng đá là vật rắn — cụm khối hộp, dùng va chạm hình chữ nhật xoay đúng góc của cụm
    if (isRockDeco) {
      w.colliders.push({ x: wx, z: wz, y: h, h: d.userData.hitH, foot: V.measureFootprint(d, 8, wx, wz) });
    }
  }

  // ---- Vật nuôi trang trí: 2–3 con (thỏ/chó/mèo/gà random) đi/nhảy loanh quanh ----
  w.animals = [];
  // thỏ giữ kiểu nhảy cong đặc trưng (hopH/hopSec); chó/mèo/gà đi bộ thật — chân dính đất, không có cung nhảy,
  // di chuyển từng bước nhỏ liên tục theo walkSpeed/runSpeed thay vì "dịch chuyển" thẳng từ điểm này sang điểm khác
  const animalKinds = [
    { type: 'rabbit', build: V.buildRabbit, hopH: 0.45, hopSec: 0.55 },
    { type: 'dog', build: V.buildDog, walkSpeed: 1.1 },
    { type: 'cat', build: V.buildCat, walkSpeed: 1.0 },
    { type: 'chicken', build: V.buildChicken, walkSpeed: 0.65, runSpeed: 2.6 },
  ];
  for (let i = 0; i < randInt(2, 3); i++) {
    const [k, h] = pick(openTiles);
    const [x, z] = tileAt(k);
    const kind = pick(animalKinds);
    const rb = kind.build();
    rb.position.set(x, h, z);
    rb.rotation.y = rand(0, Math.PI * 2);
    w.group.add(rb);
    w.animals.push({
      mesh: rb, type: kind.type, state: 'idle', timer: rand(0.5, 2), from: null, to: null,
      hopT: 0, hopH: kind.hopH, hopSec: kind.hopSec, walkSpeed: kind.walkSpeed, runSpeed: kind.runSpeed,
      dir: 0, walkT: 0, peckT: 0, sitting: false, justSat: false, running: false,
    });
  }
}

// ---------- Đảo quái: to hơn, có địa hình gò/đá/bụi ----------
function buildMonsterIsland(w, x, y, z, tier, r) {
  const g = new THREE.Group();
  // Đặt nhóm vào đúng vị trí thế giới NGAY TỪ ĐẦU — mọi phép đo vùng va chạm bên dưới (đá, cây...) nhờ vậy đọc
  // được toạ độ thế giới thật. Nếu để cuối hàm mới đặt, số đo sẽ còn là toạ độ cục bộ và lệch đúng bằng khoảng
  // cách từ gốc toạ độ tới đảo.
  g.position.set(x, y, z);
  w.group.add(g);
  // đế đá voxel + viền cỏ phủ lớp trên cùng (không dùng khối trụ tròn nữa)
  const base = V.buildRockBase(r * 0.9, 4.2, 0xa89a8a, 0x9dc98a);
  base.position.y = -1.0;
  g.add(base);

  // địa hình: 2–3 gò đất thấp có thể trèo lên (thêm vào islands để đứng được) — cụm khối vuông nhỏ, không dùng khối trụ tròn
  for (let i = 0; i < randInt(2, 3); i++) {
    const a = rand(0, Math.PI * 2), d = rand(r * 0.25, r * 0.6);
    const mr = rand(1.0, 1.7), mh = 0.5;
    const mx0 = Math.cos(a) * d, mz0 = Math.sin(a) * d;
    const moundC = pick([0x9dc98a, 0xa8d494]);
    const cell = 0.85;
    const steps = Math.round(mr / cell) + 1;
    // dựng riêng thành 1 nhóm để đo trực tiếp từ hình học thật — trước đây tính tay bằng công thức
    // (mr + cell*1.3*√2/2) hụt mất phần khối LỆCH KHỎI TÂM Ô LƯỚI (rotation.y ngẫu nhiên làm góc khối xa
    // tâm gò hơn cả công thức tính), khiến va chạm đăng ký NHỎ HƠN gò thật — mắt thấy đất mà vẫn rơi hụt/kẹt
    // ở mép, chứ không phải va chạm to hơn gò. Đo bao lồi thật loại bỏ hoàn toàn sai số này.
    const moundGroup = new THREE.Group();
    for (let bx = -steps; bx <= steps; bx++) {
      for (let bz = -steps; bz <= steps; bz++) {
        const lx = bx * cell, lz = bz * cell;
        if (Math.hypot(lx, lz) > mr) continue;
        const bl = V.box(cell * rand(1.05, 1.3), mh * rand(0.8, 1.2), cell * rand(1.05, 1.3), moundC);
        bl.position.set(lx, mh / 2, lz);
        bl.rotation.y = rand(-0.08, 0.08);
        moundGroup.add(bl);
      }
    }
    moundGroup.position.set(mx0, 0, mz0);
    g.add(moundGroup);
    const moundR = V.measureFootprint(moundGroup, 12, x + mx0, z + mz0).reach;
    w.islands.push({ x: x + mx0, z: z + mz0, y: y + mh, r: moundR, tier });
  }
  // đá, bụi, cỏ — đá có va chạm
  for (let i = 0; i < randInt(3, 5); i++) {
    const a = rand(0, Math.PI * 2), d = rand(0.5, r * 0.75);
    const roll = Math.random();
    const isRockDeco = roll < 0.4;
    const deco = isRockDeco ? V.buildRock() : roll < 0.7 ? V.buildBush() : V.buildGrassTuft();
    const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
    deco.position.set(lx, 0, lz);
    g.add(deco);
    if (isRockDeco) {
      w.colliders.push({
        x: x + lx, z: z + lz, y, h: deco.userData.hitH,
        foot: V.measureFootprint(deco, 8, x + lx, z + lz),
      });
    }
  }
  if (chance(0.5)) {
    const sc = rand(0.5, 0.8);
    const t = V.buildTree(sc);
    const a = rand(0, Math.PI * 2);
    const lx = Math.cos(a) * r * 0.6, lz = Math.sin(a) * r * 0.6;
    t.position.set(lx, 0, lz);
    g.add(t);
    w.colliders.push({
      x: x + lx, z: z + lz, y, h: 3 * sc,
      foot: V.measureFootprint(t.userData.trunkMesh, 4, x + lx, z + lz),
    });
  }
  // Bán kính mặt đứng của đảo = số đo THẬT của lớp cỏ trên cùng (buildRockBase tự tính từ chính các khối nó
  // vừa dựng, xem userData.topR) — thay cho hệ số nhân ước lượng trước đây (1.3 rồi 1.1 rồi 1.25, đều là đoán).
  const islandR = base.userData.topR;
  // giữ lại ĐÚNG tham chiếu object vừa push — quái dùng chung tham chiếu này (thay vì tạo object {x,z,y,r} mới
  // với cùng giá trị) để game.js xác thực được "người chơi đang đứng lên ĐÚNG đảo này" bằng so sánh tham chiếu
  // qua supportAt(), không phải chỉ dựa vào khoảng cách + khung độ cao (xem playerOnIsland trong game.js)
  const islandRef = { x, z, y, r: islandR, tier };
  w.islands.push(islandRef);

  const n = randInt(1, 3);
  // quái tầm xa luôn phải đi cùng ít nhất 1 quái cận chiến (không đủ chỗ nếu n=1) — random rồi xáo trộn thứ tự
  const rangedCount = n >= 2 && chance(0.4) ? randInt(1, n - 1) : 0;
  const kinds = [];
  for (let i = 0; i < n; i++) kinds.push(i < rangedCount ? 'ranged' : 'melee');
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const placedMonsters = [];
  for (let i = 0; i < n; i++) {
    const isRanged = kinds[i] === 'ranged';
    // né chỗ đã có đá/cây (va chạm) và né các quái vừa đặt trước đó — không để spawn đè/kẹt cứng ngay từ đầu
    let mx, mz, attempts = 0;
    do {
      const a = rand(0, Math.PI * 2), rr = rand(0.5, r - 1.2);
      mx = x + Math.cos(a) * rr; mz = z + Math.sin(a) * rr;
      attempts++;
    } while (
      attempts < 14 &&
      (w.colliders.some((c) => Math.hypot(mx - c.x, mz - c.z) < colliderReach(c) + 0.7) ||
       placedMonsters.some((p) => Math.hypot(mx - p.x, mz - p.z) < 1.2))
    );
    placedMonsters.push({ x: mx, z: mz });
    let mesh, hp;
    if (isRanged) {
      mesh = V.buildMonsterRanged(randInt(0, CFG.monsters.rangedTypes - 1));
      hp = CFG.monsters.rangedHp;
    } else {
      mesh = V.buildMonsterMelee(randInt(0, CFG.monsters.meleeTypes - 1));
      hp = CFG.monsters.meleeHp;
    }
    mesh.position.set(mx, y, mz);
    w.group.add(mesh);
    // thanh máu lơ lửng trên đầu (billboard, chỉ hiện khi mất máu hoặc người chơi tới gần)
    const hpBar = new THREE.Group();
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.65, depthWrite: false }));
    const hpFg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x6ad86a, transparent: true, opacity: 0.95, depthWrite: false }));
    hpFg.position.z = 0.005;
    hpBar.add(hpBg, hpFg);
    hpBar.visible = false;
    w.group.add(hpBar);
    w.monsters.push({
      kind: isRanged ? 'ranged' : 'melee',
      mesh, hp, maxHp: hp, dead: false,
      // dùng ĐÚNG tham chiếu islandRef (không tạo object mới) — xem chú thích tại chỗ push ở trên
      island: islandRef,
      mode: 'hide',
      hpBar, hpFg,
      atkCd: 0, burstLeft: 0, burstCd: 0, idleCd: rand(2, 5),
      wanderA: rand(0, Math.PI * 2), flashT: 0, attackAnim: 0, recoilT: 0,
      attackWindup: 0, attackPending: false, attackHit: false, animT: rand(0, 10), moving: false,
      // mỗi con có bán kính/tốc độ/chiều lang thang riêng — tránh nhiều quái đi vòng tròn giống hệt nhau
      wanderRFrac: rand(0.4, 0.85), wanderSpd: rand(0.5, 0.95), wanderDir: chance(0.5) ? 1 : -1,
      edgeTarget: null,
      stuckT: 0, escapeSweep: rand(0, Math.PI * 2), hopT: 0,
    });
  }
}

// ---------- Đảo đích: vòng sáng TRẮNG lớn + kho báu — tiến hoá theo w.shrineTier ĐỒNG BỘ với tế đàn khởi đầu
// (bệ đá nhiều lớp, cột trụ, đá bay quanh — xem buildTierDecor). Vòng sáng CHÍNH giữ nguyên màu trắng ở mọi cấp
// (giữ đúng ý nghĩa "đây là đích", khác hẳn màu vàng→xanh của tế đàn khởi đầu) — chỉ cột trụ/tinh thể/đá bay
// đổi màu theo cấp như tế đàn. ----------
// heading = hướng bay từ vật thể cuối cùng tới đảo — rương quay mặt đón người chơi
function buildGoalIsland(w, x, y, z, heading) {
  const tier = w.shrineTier ?? 0;
  const level = tier + 1;
  const seed = Math.floor(Math.random() * 1e9);
  const g = new THREE.Group();

  // Đảo bay voxel của bản thiết kế: mặt cỏ/đất/đá theo lớp, đá vụn lơ lửng, mạch sáng dưới đáy ở cấp 9-10.
  // radiusCells chọn theo goalIslandRadius để vùng va chạm (đã dùng khi xếp chuỗi) khớp hình khối nhìn thấy.
  const r = goalIslandRadius(tier);
  const island = buildAltarIsland({ level, seed, radiusCells: Math.round(r / VOX - 0.5) });
  // mặt trên của đảo nằm ở lớp lưới y=0 → cao đúng 1 ô; hạ xuống để mặt đó trùng y=0 của cả cụm
  island.group.position.y = -island.topY;
  g.add(island.group);

  // Tế đàn trên đảo đích: KHÔNG có cột trụ, chỉ bệ + trụ sáng + vòng năng lượng
  const altar = buildAltar({ level, pillars: false, seed: seed ^ 0x5f5f });
  g.add(altar.group);
  w.altars.push(altar);
  for (const st of altar.steps) w.islands.push({ x, z, y: y + st.y, r: st.r, tier: 999, decor: true });

  // kho báu đặt lùi về phía sau tâm vòng sáng một chút (chừa khoảng trống phía trước cho người chơi),
  // mặt mở nắp quay đón hướng người chơi bay tới — tiến thẳng theo quán tính là đi vào giữa vòng tròn, gặp ngay mặt trước rương
  const faceX = -Math.cos(heading), faceZ = -Math.sin(heading);
  const chestBack = altar.platformR + 0.9;   // đặt hẳn ngoài bệ, trên mặt cỏ
  const chestLocalX = -faceX * chestBack, chestLocalZ = -faceZ * chestBack;
  const chest = V.buildTreasureChest();
  chest.scale.setScalar(2);
  chest.position.set(chestLocalX, 0, chestLocalZ);
  chest.rotation.y = Math.atan2(faceX, faceZ);
  g.add(chest);
  if (chest.userData.sparkle) w.sparkles.push(chest.userData.sparkle);

  // khoáng sản năng lượng trên vành cỏ quanh bệ — cùng mạch với lõi năng lượng của tế đàn. Né các cụm đã đặt
  // trước đó (xem chú thích tương tự ở buildIslandDecor) để không dính lại thành một khối đặc.
  if (hasEnergyCore(level)) {
    const orePlaced = [];
    for (let i = 0; i < randInt(2, 4); i++) {
      let ox, oz, tries = 0, ok;
      do {
        const a = rand(0, Math.PI * 2), d = rand(altar.platformR + 0.8, r - 0.8);
        ox = Math.round(Math.cos(a) * d * 2) / 2;   // làm tròn về ô lưới 0.5 để trùng trục với lưới voxel của đảo
        oz = Math.round(Math.sin(a) * d * 2) / 2;
        ok = !orePlaced.some((p) => Math.hypot(p.x - ox, p.z - oz) < 2.0);
        tries++;
      } while (!ok && tries < 12);
      if (!ok) continue;
      orePlaced.push({ x: ox, z: oz });
      const ore = buildEnergyOre({ level, seed: Math.floor(Math.random() * 1e9) });
      ore.position.set(ox, 0, oz);
      g.add(ore);
    }
  }

  g.position.set(x, y, z);
  w.group.add(g);

  // r = bán kính mặt cỏ người chơi đứng lên
  w.islands.push({ x, z, y, r, tier: 999 });
  // Rương đích KHÔNG cần va chạm rắn — khác rương thường (phải đánh vỡ mới lấy được), rương đích tự động
  // nhận thưởng theo khoảng cách (xem updateGoal: hypot(pl.pos, chestX/Z) < 1.7). Nắp rương bật ngửa lên cao
  // khiến hình khối thật vươn xa tới ~2.56 đơn vị — NẾU có va chạm rắn, ở một số hướng người chơi sẽ bị chặn
  // vật lý TRƯỚC KHI vào được vùng bán kính 1.7 để kích hoạt nhận thưởng, không bao giờ claim được từ hướng đó.
  const chestWorldX = x + chestLocalX, chestWorldZ = z + chestLocalZ;
  // điểm bay lên = ĐÚNG TÂM vòng sáng (x, z của cả đảo) — chuẩn nhất vì vòng sáng luôn đặt tại đây
  w.goal = {
    x, y, z, chest, claimed: false,
    chestX: chestWorldX, chestZ: chestWorldZ,
    frontX: x, frontZ: z,
  };
}

// ---------- Trang trí: biển, 3 lớp cảnh, mây, vật trôi nổi ----------
function buildDecor(w) {
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ color: 0x6ec3dc, transparent: true, opacity: 0.9 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = w.seaY;
  w.group.add(sea);

  // LỚP GIỮA: đảo bay đế thon, lơ lửng ở nhiều độ cao
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2), d = rand(48, 130);
    const sizeScale = rand(0.7, 1.6);
    const isl = V.buildDecorIsland(sizeScale);
    // độ cao lơ lửng tỉ lệ theo kích thước đảo — đảo nhỏ không bay cao vống lên so với mặt biển
    isl.position.set(Math.cos(a) * d, w.seaY + rand(0.4, 2.2) * sizeScale, Math.sin(a) * d);
    isl.rotation.y = rand(0, Math.PI * 2);
    w.group.add(isl);
  }

  // LỚP XA: núi mờ
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = rand(180, 270);
    const m = V.buildFarMountain();
    m.position.set(Math.cos(a) * d, w.seaY - 2, Math.sin(a) * d);
    w.group.add(m);
  }

  // vật thể lơ lửng trang trí
  for (let i = 0; i < 9; i++) {
    const a = rand(0, Math.PI * 2), d = rand(40, 95);
    const obj = V.buildFloatingObject();
    obj.group.position.set(Math.cos(a) * d, rand(6, 24), Math.sin(a) * d);
    obj.group.rotation.y = rand(0, Math.PI * 2);
    obj.group.scale.setScalar(rand(1.2, 2.2));
    obj.group.userData.bobPhase = rand(0, Math.PI * 2);
    obj.group.userData.baseY = obj.group.position.y;
    w.group.add(obj.group);
    w.floaters.push(obj.group);
  }

  // mây trôi
  for (let i = 0; i < 14; i++) {
    const c = V.buildCloud();
    c.position.set(rand(-140, 140), rand(12, 38), rand(-140, 140));
    c.userData.speed = rand(0.3, 0.9);
    w.group.add(c);
    w.clouds.push(c);
  }

  // ---- Cá voi ngoài khơi: thỉnh thoảng trồi lên phun nước rồi lặn xuống, không thường xuyên ----
  const whale = V.buildWhale();
  const spout = V.buildSpout();
  spout.position.set(0, 0.6, 1.4); // ngay trên lỗ thở
  whale.add(spout);
  whale.position.set(rand(24, 60), w.seaY - 3, 0);
  whale.visible = false;
  w.group.add(whale);
  w.whale = { mesh: whale, spout, state: 'hidden', t: 0, timer: rand(10, 22), baseY: w.seaY };
}
