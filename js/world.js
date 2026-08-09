// ===== Sinh thế giới ngẫu nhiên cho mỗi level =====
import * as THREE from 'three';
import { CFG, rand, randInt, chance, pick } from './config.js';
import * as V from './voxel.js';

const tileKey = (x, z) => `${x},${z}`;

// vị trí (x,z) có đủ chỗ trống không chồng lấn vật thể/đảo đã đặt TỪ TRƯỚC không (bỏ qua node liền trước —
// cố ý ở gần để vừa tầm nhảy). boundP/boundI = độ dài w.platforms/w.islands TÍNH ĐẾN TRƯỚC node liền trước,
// nhờ vậy chỉ so với các node từ 2 bước trở lên — chỗ dễ chồng lấn khi đường chuỗi "cuộn" lại do heading xoay tự do.
function hasSpaceFor(w, x, z, footR, boundP, boundI) {
  const buffer = 1.0; // khoảng hở tối thiểu, chừa đường nhảy/đứng, không dính sát nhau
  for (let i = 0; i < boundP; i++) {
    const p = w.platforms[i];
    const pr = Math.max(p.hw, p.hd);
    if (Math.hypot(x - p.x, z - p.z) < footR + pr + buffer) return false;
  }
  for (let i = 0; i < boundI; i++) {
    const isl = w.islands[i];
    if (Math.hypot(x - isl.x, z - isl.z) < footR + isl.r + buffer) return false;
  }
  return true;
}

export function generateLevel(level) {
  const group = new THREE.Group();
  const world = {
    group,
    tiles: new Map(),      // "x,z" -> độ cao mặt đất đảo khởi đầu
    water: new Map(),      // "x,z" -> độ cao mặt nước (sông/hồ)
    platforms: [],         // vật thể lơ lửng {x,y(top),z,hw,hd,tier,mesh}
    islands: [],           // đảo quái + đảo đích + gò đất {x,z,y(top),r,tier}
    colliders: [],         // vật cản rắn hình trụ {x,z,r,y,h} (cột đá...)
    coins: [],
    chests: [],
    monsters: [],
    projectiles: [],
    clouds: [],
    portals: [],
    floaters: [],
    sparkles: [],
    chainPath: [],         // toạ độ các node chuỗi (để né khi đặt cây)
    portal: null,
    goal: null,
    seaY: -1.6,
  };

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

// ---------- Địa hình đảo khởi đầu (x3 lần bản trước — có núi vách đứng) ----------
function buildTerrain(w) {
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

  // ---- Sông uốn lượn ----
  if (chance(0.55)) {
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
      // né núi đá — sông không được cắt xuyên/hiện lên trên núi
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

  // ---- Hồ nước ----
  if (chance(0.5)) {
    const lx = randInt(-Math.floor(R / 2), Math.floor(R / 2));
    const lz = randInt(-Math.floor(R / 2), Math.floor(R / 2));
    const lr = rand(2, 3.8);
    for (const [k, h] of w.tiles) {
      const [x, z] = k.split(',').map(Number);
      // né núi đá — hồ không được hiện lên trên núi
      if (Math.hypot(x - lx, z - lz) <= lr && h >= 2 && !w.water.has(k) && !w.rockTiles?.has(k)) {
        w.tiles.set(k, h - 1);
        w.water.set(k, h - 0.45);
      }
    }
  }

  // ---- San phẳng mặt nước: sông/hồ ghép từ nhiều ô carve riêng lẻ nên độ cao lệch nhau theo địa hình gốc,
  // tạo mặt nước lởm chởm như bậc thang — lặp nhiều lượt hạ mỗi ô nước xuống bằng ô THẤP NHẤT trong các ô liền
  // kề (đất lẫn nước) để mặt nước không bao giờ trồi cao hơn 2 bên, cứ lặp tới khi ổn định (mực nước liền lạc)
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

  // ---- Đường mòn nhỏ uốn lượn cắt ngang đảo — chỉ đổi màu mặt đất (đất nâu giữa cỏ), không đổi độ cao ----
  const pathTiles = new Set();
  if (chance(0.65)) {
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
      if (chance(0.4)) pathTiles.add(tileKey(tx + (chance(0.5) ? 1 : -1), tz)); // bề ngang lồi lõm tự nhiên
      if (chance(0.4)) pathTiles.add(tileKey(tx, tz + (chance(0.5) ? 1 : -1)));
    }
  }

  // ---- Chọn vị trí cổng: đất phẳng, xa núi, không nước ----
  let px = 0, pz = 0, ph = 2;
  for (let attempt = 0; attempt < 80; attempt++) {
    const tx = randInt(-Math.floor(R * 0.45), Math.floor(R * 0.45));
    const tz = randInt(-Math.floor(R * 0.45), Math.floor(R * 0.45));
    const k = tileKey(tx, tz);
    if (!w.tiles.has(k) || w.water.has(k)) continue;
    const h = w.tiles.get(k);
    if (h < 2 || h > 5) continue;
    if (Math.hypot(tx - peak1.x, tz - peak1.z) < peak1.r + 3) continue;
    px = tx; pz = tz; ph = h;
    break;
  }
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const k = tileKey(px + dx, pz + dz);
      if (w.tiles.has(k)) {
        w.tiles.set(k, ph);
        w.water.delete(k);
      }
    }
  }
  w.portal = { x: px, y: ph, z: pz };

  // ---- Dựng khối — texture pixel + viền tối giả AO trên mỗi mặt khối ----
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x8fbf7f, map: V.makeBlockTexture('grass', { grain: 0.14, border: 0.2 }) });
  const dirtMat = new THREE.MeshLambertMaterial({ color: 0xa07850, map: V.makeBlockTexture('dirt', { grain: 0.16, border: 0.22, speckle: 0.1 }) });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xe8d8a8, map: V.makeBlockTexture('sand', { grain: 0.1, border: 0.16 }) });
  const cliffMat = new THREE.MeshLambertMaterial({ color: 0x84888d, map: V.makeBlockTexture('stone', { grain: 0.18, border: 0.26, speckle: 0.12 }) });
  const mossMat = new THREE.MeshLambertMaterial({ color: 0x7f9078, map: V.makeBlockTexture('moss', { grain: 0.16, border: 0.22, speckle: 0.1 }) });
  // đường mòn: đất khô đằm nện, nhạt hơn, KHÁC màu với dirtMat (đó là cát ướt/đất lộ dưới vách, chỉ hợp ở rìa/dưới mực nước)
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xd4bb92, map: V.makeBlockTexture('path', { grain: 0.11, border: 0.18, speckle: 0.05 }) });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const grass = [], dirt = [], sand = [], cliff = [], moss = [], path = [];

  const isRock = (k) => w.rockTiles?.has(k);
  const mossHash = (x, z) => {
    const s = Math.sin(x * 53.1 + z * 97.7 + seed * 7) * 43758.5;
    return s - Math.floor(s);
  };
  // nhiễu mượt riêng cho đốm cát rải rác giữa đảo — dùng noise (không phải hash rời rạc) để đốm cát thành từng
  // mảng tự nhiên thay vì lốm đốm từng ô một
  const patchNoise = makeNoise(seed + 133);

  for (const [k, h] of w.tiles) {
    const [x, z] = k.split(',').map(Number);
    const isWater = w.water.has(k);
    const isBeach = h <= 1 && !isWater;
    if (isRock(k) && !isWater) {
      // chân núi thấp lác đác rêu xanh cho tự nhiên
      (h <= 5 && mossHash(x, z) < 0.3 ? moss : cliff).push([x, h - 0.5, z]);
    } else if (!isWater && !isBeach && h <= 3 && pathTiles.has(k)) {
      // đường mòn chỉ nằm ở đất thấp/chân đồi chân núi — không leo lên cao (mắt lưới cao hơn rơi xuống nhánh cỏ/cát bên dưới)
      path.push([x, h - 0.5, z]); // đường mòn đất khô — tách riêng khỏi dirtMat (cát ướt)
    } else {
      const isSandPatch = !isWater && !isBeach && patchNoise(x, z) > 0.63; // đốm cát rải rác giữa đảo, không chỉ ở rìa
      (isBeach || isWater || isSandPatch ? sand : grass).push([x, h - 0.5, z]);
    }
    let minN = h;
    let isEdge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = tileKey(x + dx, z + dz);
      if (!w.tiles.has(nk)) isEdge = true; // giáp biển xung quanh, không phải ô đảo khác
      minN = Math.min(minN, w.tiles.get(nk) ?? 0);
    }
    // viền đảo giáp biển: kéo cột đá xuống ngập hẳn mặt nước, không hở đáy lộ khoảng trống
    const bottomY = isEdge ? Math.floor(w.seaY) - 1 : Math.max(0, minN - 1);
    for (let y = h - 1; y >= bottomY; y--) {
      (isRock(k) ? cliff : dirt).push([x, y - 0.5, z]);
    }
  }

  const addInst = (mat, arr) => {
    if (!arr.length) return;
    const im = new THREE.InstancedMesh(boxGeo, mat, arr.length);
    const m4 = new THREE.Matrix4();
    arr.forEach((p, i) => { m4.setPosition(p[0], p[1], p[2]); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true;
    w.group.add(im);
  };
  addInst(grassMat, grass);
  addInst(dirtMat, dirt);
  addInst(sandMat, sand);
  addInst(cliffMat, cliff);
  addInst(mossMat, moss);
  addInst(pathMat, path);

  // ---- Mặt nước: lấp đầy từ đáy lên mặt, áp khít bờ không hở khe ----
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x5ab8d8, transparent: true, opacity: 0.75 });
  for (const [k, wy] of w.water) {
    const [x, z] = k.split(',').map(Number);
    const groundH = w.tiles.get(k) ?? wy - 0.6;
    const bottom = groundH - 0.06;          // chớm sâu vào nền để không lộ khe
    const height = Math.max(0.2, wy - bottom);
    const wm = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1), waterMat);
    wm.position.set(x, bottom + height / 2, z);
    w.group.add(wm);
  }
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

  // vật thể ĐẦU TIÊN ngay cạnh vòng sáng — ngoài vòng cột một chút
  let cx = px + Math.cos(baseAngle) * 4.6;
  let cz = pz + Math.sin(baseAngle) * 4.6;
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
      const distMax = level >= CFG.chain.distFarLevel ? CFG.chain.distMaxFar : CFG.chain.distMax;
      let nextHeading, nextCx, nextCz, nextDy;
      for (let attempt = 0; attempt < 24; attempt++) {
        // 8 lần đầu: hướng ngẫu nhiên quanh heading hiện tại (giữ đường đi tự nhiên như cũ). Vẫn chồng lấn thì
        // chuyển sang quét đều 16 hướng quanh cả 360° — vét gần hết mọi hướng khả dĩ (kể cả khe hở hẹp) trước
        // khi đành chấp nhận lần thử cuối.
        nextHeading = attempt < 8 ? heading + rand(-1.3, 1.3) : (attempt - 8) / 16 * Math.PI * 2;
        const dist = rand(CFG.chain.distMin, distMax);
        nextDy = rand(0.55, 1.15);
        nextCx = cx + Math.cos(nextHeading) * dist;
        nextCz = cz + Math.sin(nextHeading) * dist;
        if (hasSpaceFor(w, nextCx, nextCz, 1.6, lenBeforePrev, lenBeforePrevI)) break;
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
    // AABB bao khối đã xoay
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const hw = obj.hw * c + obj.hd * s;
    const hd = obj.hw * s + obj.hd * c;
    const plat = { x: cx, y: cy, z: cz, hw, hd, tier, depth: obj.depth || 1.2, mesh: obj.group };
    w.platforms.push(plat);

    if (i > 0) {
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
        ch.position.set(cx + ox, cy, cz + oz);
        ch.rotation.y = rand(0, Math.PI * 2);
        w.group.add(ch);
        w.chests.push({
          mesh: ch, hp: CFG.chest.hp, broken: false,
          x: cx + ox, y: cy, z: cz + oz, hw: 0.4, hd: 0.35, top: cy + 0.62,
        });
      }
    }

    lenBeforePrev = lenBeforeThis; lenBeforePrevI = lenBeforeThisI;
  }

  // đảo đích (bán kính 3.5) cũng có thể chồng lên vật thể/đảo đặt từ trước nếu đường chuỗi cuộn lại tới sát
  // cuối — thử vài hướng quanh node cuối tới khi tìm được chỗ trống, không tìm được thì chấp nhận lần thử cuối
  let goalHeading = heading;
  for (let attempt = 0; attempt < 21 && !hasSpaceFor(w, cx + Math.cos(goalHeading) * 0.8, cz + Math.sin(goalHeading) * 0.8, 3.5, lenBeforePrev, lenBeforePrevI); attempt++) {
    goalHeading = attempt < 5 ? heading + rand(-1.3, 1.3) : (attempt - 5) / 16 * Math.PI * 2;
  }
  buildGoalIsland(w, cx + Math.cos(goalHeading) * 0.8, cy, cz + Math.sin(goalHeading) * 0.8, goalHeading);
}

function chainCountFor(level) {
  const c = CFG.chain;
  if (level <= 1) return c.base;
  const early = Math.min(level, c.phaseLevel - 1) - 1;
  const late = Math.max(0, level - (c.phaseLevel - 1));
  return c.base + early * c.incEarly + late * c.incLate;
}

// ---------- Cổng + vòng cột (có va chạm, chừa lối ra chuỗi) ----------
function buildPortalStructures(w, chainAngle) {
  const { x: px, y: ph, z: pz } = w.portal;
  const portal = V.buildPortal(0x7fd8e8, 1);
  portal.position.set(px, ph, pz);
  w.group.add(portal);
  w.portals.push(portal);

  const nCols = 6;
  for (let i = 0; i < nCols; i++) {
    const a = (i / nCols) * Math.PI * 2 + 0.3;
    // chừa lối đi theo hướng chuỗi vật thể
    let diff = a - chainAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < 0.55) continue;
    const cx = px + Math.cos(a) * 3.2, cz = pz + Math.sin(a) * 3.2;
    const col = V.buildColumn(randInt(0, 2));
    col.position.set(cx, ph, cz);
    const ry = -a + Math.PI / 2;
    col.rotation.y = ry;
    w.group.add(col);
    // cột là vật rắn — không đi xuyên được
    w.colliders.push({ x: cx, z: cz, r: 0.55, y: ph, h: col.userData.hitH });
    // phần thân cột gãy đổ nằm ngang cũng chặn (đổi tọa độ cục bộ → thế giới theo góc xoay)
    const f = col.userData.fallen;
    if (f) {
      const wx = cx + f.x * Math.cos(ry) + f.z * Math.sin(ry);
      const wz = cz - f.x * Math.sin(ry) + f.z * Math.cos(ry);
      w.colliders.push({ x: wx, z: wz, r: f.r, y: ph, h: f.h });
    }
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
      // thân cây là vật rắn
      w.colliders.push({ x: wx, z: wz, r: (big ? 0.5 : 0.28) * sc, y: w.tiles.get(k), h: (big ? 5 : 3) * sc });
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
    // tảng đá là vật rắn
    if (isRockDeco) w.colliders.push({ x: wx, z: wz, r: d.userData.hitR, y: h, h: d.userData.hitH });
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
    for (let bx = -steps; bx <= steps; bx++) {
      for (let bz = -steps; bz <= steps; bz++) {
        const lx = bx * cell, lz = bz * cell;
        if (Math.hypot(lx, lz) > mr) continue;
        const bl = V.box(cell * rand(1.05, 1.3), mh * rand(0.8, 1.2), cell * rand(1.05, 1.3), moundC);
        bl.position.set(mx0 + lx, mh / 2, mz0 + lz);
        bl.rotation.y = rand(-0.08, 0.08);
        g.add(bl);
      }
    }
    // bán kính va chạm nới thêm chút để phủ hết khối to nhất tràn ra mép gò
    w.islands.push({ x: x + mx0, z: z + mz0, y: y + mh, r: mr + 0.55, tier });
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
    if (isRockDeco) w.colliders.push({ x: x + lx, z: z + lz, r: deco.userData.hitR, y, h: deco.userData.hitH });
  }
  if (chance(0.5)) {
    const sc = rand(0.5, 0.8);
    const t = V.buildTree(sc);
    const a = rand(0, Math.PI * 2);
    const lx = Math.cos(a) * r * 0.6, lz = Math.sin(a) * r * 0.6;
    t.position.set(lx, 0, lz);
    g.add(t);
    w.colliders.push({ x: x + lx, z: z + lz, r: 0.28 * sc, y, h: 3 * sc });
  }
  g.position.set(x, y, z);
  w.group.add(g);
  // bán kính va chạm nới rộng hơn bán kính đế đá thật — mặt cỏ trên cùng (buildRockBase) tràn mép ra ngoài
  // đế đá một khoảng, nếu va chạm khít đúng bán kính đế thì đi tới mép cỏ nhìn thấy sẽ bị rơi hụt chân
  w.islands.push({ x, z, y, r: r * 1.3, tier });

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
      (w.colliders.some((c) => Math.hypot(mx - c.x, mz - c.z) < c.r + 0.7) ||
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
      island: { x, z, y, r },
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

// ---------- Đảo đích: vòng sáng TRẮNG lớn + kho báu ----------
// heading = hướng bay từ vật thể cuối cùng tới đảo — rương quay mặt đón người chơi
function buildGoalIsland(w, x, y, z, heading) {
  const r = 3.5;
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.5, 16),
    new THREE.MeshLambertMaterial({ color: 0xa8c98a }));
  top.position.y = -0.25;
  const under = V.buildRockBase(r * 0.88, 3.3, 0xb0a090);
  under.position.y = -0.9;
  top.castShadow = true; top.receiveShadow = true;
  g.add(top, under);

  // vòng sáng trắng đặt ĐÚNG TÂM bệ đá — hiệu ứng bay lên xuất phát từ đây
  const portal = V.buildPortal(0xffffff, 1.9);
  portal.position.y = 0;
  g.add(portal);
  w.portals.push(portal);

  // kho báu đặt lùi về phía sau tâm vòng sáng một chút (chừa khoảng trống phía trước cho người chơi),
  // mặt mở nắp quay đón hướng người chơi bay tới — tiến thẳng theo quán tính là đi vào giữa vòng tròn, gặp ngay mặt trước rương
  const faceX = -Math.cos(heading), faceZ = -Math.sin(heading);
  const chestBack = 2.0; // lùi rương ra xa hướng người chơi tới
  const chestLocalX = -faceX * chestBack, chestLocalZ = -faceZ * chestBack;
  const chest = V.buildTreasureChest();
  chest.scale.setScalar(2);
  chest.position.set(chestLocalX, 0.16, chestLocalZ); // đặt trên mâm đá, lùi về sau tâm
  chest.rotation.y = Math.atan2(faceX, faceZ);
  g.add(chest);
  if (chest.userData.sparkle) w.sparkles.push(chest.userData.sparkle);

  g.position.set(x, y, z);
  w.group.add(g);
  w.islands.push({ x, z, y, r, tier: 999 });
  // rương to là vật rắn — không đi xuyên qua được (collider theo đúng vị trí + kích thước mới, thu nhỏ tương ứng scale 2/3)
  const chestWorldX = x + chestLocalX, chestWorldZ = z + chestLocalZ;
  w.colliders.push({ x: chestWorldX, z: chestWorldZ, r: 1.15, y, h: 1.5 });
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
