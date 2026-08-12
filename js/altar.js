// ===== Tế đàn truyền tống — port từ bản thiết kế trong Game assets/teleport-islands/js/three-altars.js =====
// Khác hẳn cách dựng cũ (viên đá xoay tự do quanh vòng tròn): ở đây MỌI khối nằm trên LƯỚI Ô VUÔNG số nguyên,
// nên về bản chất không bao giờ có hai khối chồng lên nhau. Toàn bộ khối gom vào 2 InstancedMesh (1 cho khối
// đá thường, 1 cho khối phát sáng) nên dù cả nghìn khối vẫn chỉ tốn 2 lượt vẽ.
import * as THREE from 'three';
import { makeBlockTexture } from './voxel.js';

// Cạnh 1 ô voxel. Phải là ƯỚC của ô địa hình (1.0) — N ô voxel ăn khít 1 ô đất, nên lưới tế đàn trùng phase
// với lưới đảo và mắt đọc ra là cùng một hệ khối. Bản gốc dùng 0.42 (đứng riêng thì không sao) nhưng đặt vào
// địa hình của game thì mọi mạch đá đều lệch so với mạch đất. 0.25 = giảm 50% so với 0.5 trước đó, vẫn là ước
// số của 1.0 (4 ô voxel/1 ô đất) nên vẫn trùng lưới.
export const VOX = 0.25;

// bảng màu bản gốc: đá sa thạch ấm (cấp thấp) và bản công nghệ xanh lạnh (cấp cao) — vẫn dùng khi KHÔNG có
// thông tin địa hình (archetype null, vd tế đàn trên đảo bay đích) hoặc cho archetype 0 (đảo mặc định gốc).
const PAL_WARM = {
  pale: 0xd6c690, light: 0xbda874, sand: 0xa48b52, sand2: 0x907a48,
  dark: 0x7a6a45, deep: 0x5b5137, seam: 0xe3a91c, shadow: 0x6b6045,
};
const PAL_COLD = {
  pale: 0xb4bec9, light: 0x8f9aa7, sand: 0x76818e, sand2: 0x646f7c,
  dark: 0x525c68, deep: 0x3c454e, seam: 0x20c7ff, shadow: 0x4a535e,
};

// ---------- màu ĐÁ của trụ/bệ tế đàn KHỚP VỚI ĐỊA HÌNH đảo khởi đầu (world.archetype) ----------
// Trước đây màu đá chỉ đổi theo CẤP tế đàn (ấm/lạnh theo lv>=8), không liên quan gì tới mặt đất nó đứng lên —
// tế đàn ấm màu cát vẫn hiện y hệt trên nền tuyết. Giờ suy màu ĐÁ từ đúng tông vật liệu mặt đất của archetype
// đó (xem DEFAULT_TERRAIN_MATERIALS/archetype materials trong world.js). Màu "seam" (mạch rune/viền phát
// sáng) KHÔNG nằm trong diện này — đó là màu của NĂNG LƯỢNG, một nguyên tố cố định biểu thị sức mạnh theo CẤP
// (vàng/xanh lam như bản gốc), không phải chất liệu mặt đất, nên luôn lấy từ PAL_WARM/PAL_COLD.seam bất kể
// archetype gì — xem chỗ gán P.seam trong buildAltar().
const _hsl = new THREE.Color();
function paletteFrom(baseHex) {
  _hsl.set(baseHex);
  const hsl = { h: 0, s: 0, l: 0 };
  _hsl.getHSL(hsl);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const tone = (dl, ds = 0) => new THREE.Color()
    .setHSL(hsl.h, clamp(hsl.s + ds, 0, 1), clamp(hsl.l + dl, 0.04, 0.96))
    .getHex();
  return {
    pale: tone(0.24), light: tone(0.13), sand: tone(0), sand2: tone(-0.07),
    dark: tone(-0.17), deep: tone(-0.29, 0.04), shadow: tone(-0.14, -0.05),
  };
}
// màu đá gốc lấy THẲNG từ vật liệu ĐẤT/ĐÁ TRẦN của archetype đó (cliff/dirt/sand trong materials ở world.js)
// — KHÔNG bao giờ lấy từ cỏ/rêu/tuyết phủ (grass/moss/snow): đó là lớp phủ bề mặt, không phải chất liệu của
// khối đá. Chỉ số khớp CFG.islands.archetypeCount (10 dạng, xem archetypeForLevel trong config.js)
const ARCHETYPE_STONE = [
  null,        // 0 = đảo mặc định gốc → dùng thẳng PAL_WARM, không suy diễn
  0xb5583a,    // 1 Cao nguyên nứt vỡ: cliff đá nung đỏ gạch
  0xf0e0b0,    // 2 Bãi cát & phá nước: sand cát sáng
  0x6b5a42,    // 3 Đầm lầy rêu: dirt đất bùn tối (KHÔNG lấy moss)
  0x8a94a0,    // 4 Cao nguyên tuyết: cliff đá xám (KHÔNG lấy snow — vẻ phủ băng tự ra từ tông sáng/lạnh của palette)
  0xc9a878,    // 5 Sa mạc cồn cát: dirt đất cát sa mạc
  0x3f3a37,    // 6 Miệng núi lửa: cliff đá bazan gần đen
  0x9c7d55,    // 7 Ruộng bậc thang: dirt đất mộc (KHÔNG lấy grass)
  0x7d8480,    // 8 Đồi thông cao nguyên: cliff đá xám (KHÔNG lấy moss)
  0xa8a49a,    // 9 Rừng cột đá vôi: cliff đá vôi xám nhạt
];
function paletteForArchetype(archetype) {
  const base = ARCHETYPE_STONE[archetype];
  return base ? paletteFrom(base) : PAL_WARM;
}
const C = {
  grass: 0x74b843, grassDark: 0x5d9a33, dirt: 0x6b5b46, dirtDark: 0x554839,
  rock: 0x6f6a5e, rockDark: 0x4b473f, techRock: 0x59636e,
  warm: 0xffd24a, warmPale: 0xfff0b8, blue: 0x20c7ff, cyan: 0xa8efff, gold: 0xe3a91c,
};

// ---------- random có seed: mỗi tế đàn dựng lại y hệt nếu cùng seed ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const next = mulberry32(seed >>> 0);
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    // random nguyên [lo,hi] nhưng kéo dần về phía hi khi t tăng — dùng cho "cấp càng cao càng nhiều cột"
    biasedInt: (lo, hi, t) => {
      const k = Math.max(0, Math.min(1, t));
      const r = Math.pow(next(), 1 / (1 + 6 * k * k));
      const span = hi - lo + 1;
      return lo + Math.min(span - 1, Math.floor(r * span));
    },
  };
}
function hashNoise(seed, x, z) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- gom khối ----------
const UNIT_GEO = new THREE.BoxGeometry(1, 1, 1);

// khối nửa voxel — lăng trụ tam giác cao hết 1 ô (trục Y nguyên vẹn), đáy bị cắt theo đường chéo trên mặt
// phẳng XZ. Dùng để làm mượt viền răng cưa của các bậc bát giác thay vì để nguyên khối vuông lởm chởm —
// cùng kỹ thuật đã kiểm chứng trong bản demo tế đàn bát giác 3 tầng.
function makeWedgeGeometry() {
  const A0 = [-0.5, -0.5, -0.5], B0 = [0.5, -0.5, -0.5], C0 = [-0.5, -0.5, 0.5];
  const A1 = [-0.5, 0.5, -0.5], B1 = [0.5, 0.5, -0.5], C1 = [-0.5, 0.5, 0.5];
  const tris = [
    [A0, B0, C0], [A1, C1, B1],
    [A0, C1, A1], [A0, C0, C1],
    [A0, B1, B0], [A0, A1, B1],
    [B0, C1, C0], [B0, B1, C1],
  ];
  // UV theo từng mặt (2 nắp tam giác chiếu xuống mặt XZ, 2 mặt vuông chiếu theo trục đứng của mặt đó, mặt
  // chéo/cạnh huyền chiếu theo khoảng cách dọc đường chéo) — để texture vân đá phủ đúng tỉ lệ, không méo,
  // và dùng chung được texture với khối vuông thường.
  const faceUV = [
    (p) => [p[0] + 0.5, p[2] + 0.5], (p) => [p[0] + 0.5, p[2] + 0.5],
    (p) => [p[2] + 0.5, p[1] + 0.5], (p) => [p[2] + 0.5, p[1] + 0.5],
    (p) => [p[0] + 0.5, p[1] + 0.5], (p) => [p[0] + 0.5, p[1] + 0.5],
    (p) => [0.5 - p[0], p[1] + 0.5], (p) => [0.5 - p[0], p[1] + 0.5],
  ];
  const pos = new Float32Array(tris.length * 9);
  const uv = new Float32Array(tris.length * 6);
  let i = 0, j = 0;
  tris.forEach((tri, t) => {
    for (const v of tri) {
      pos[i++] = v[0]; pos[i++] = v[1]; pos[i++] = v[2];
      const [u, vv] = faceUV[t](v);
      uv[j++] = u; uv[j++] = vv;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
const WEDGE_GEO = makeWedgeGeometry();
const WEDGE_UP = new THREE.Vector3(0, 1, 0);
const _wedgeDv = new THREE.Vector3();
function wedgeCornerDir(rot) {
  _wedgeDv.set(-1, 0, -1).applyAxisAngle(WEDGE_UP, (rot * Math.PI) / 2);
  return [Math.round(_wedgeDv.x), Math.round(_wedgeDv.z)];
}
// hướng góc chéo (dx,dz) cần lấp -> bước xoay 90° (0-3) tương ứng của khối nửa
const ROT_FOR_DIR = new Map();
for (let r = 0; r < 4; r++) { const [dx, dz] = wedgeCornerDir(r); ROT_FOR_DIR.set(`${dx},${dz}`, r); }

class Vox {
  constructor() { this.solid = []; this.glow = []; this.wedge = []; this.wedgeGlow = []; }
  // x,y,z = GÓC khối tính bằng ô lưới; dx,dy,dz = kích thước tính bằng ô
  add(x, y, z, dx, dy, dz, color, glow) {
    (glow ? this.glow : this.solid).push([x, y, z, dx, dy, dz, color]);
  }
  cube(x, y, z, color, glow) { this.add(x, y, z, 1, 1, 1, color, glow); }
  // lấp góc răng cưa bằng khối nửa voxel tại ô lưới (x,y,z) — cornerDir = hướng góc chéo cần lấp vào (xem
  // ROT_FOR_DIR); color/glow theo đúng khối nguồn cạnh nó để mạch màu không bị đứt đoạn
  wedgeAt(x, y, z, cornerDir, color, glow) {
    (glow ? this.wedgeGlow : this.wedge).push([x, y, z, ROT_FOR_DIR.get(`${cornerDir[0]},${cornerDir[1]}`), color]);
  }
  commit(parent) {
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const made = { solid: null, glow: null };
    for (const [list, isGlow] of [[this.solid, false], [this.glow, true]]) {
      if (!list.length) continue;
      // Khối đá có vân hạt + viền tối giả AO ở cạnh, dùng CHUNG bộ texture với phần còn lại của game
      // (makeBlockTexture). Texture là thang xám gần trắng nên nhân với màu riêng của từng instance vẫn ra
      // đúng màu, chỉ thêm chất liệu. Khối phát sáng để trơn — nó là nguồn sáng, phủ vân lên thành lấm tấm.
      const material = isGlow
        ? new THREE.MeshBasicMaterial({ toneMapped: false })
        : new THREE.MeshLambertMaterial({
          map: makeBlockTexture('altar-stone', { grain: 0.11, border: 0.2, speckle: 0.05, speckleDepth: 0.1 }),
        });
      const im = new THREE.InstancedMesh(UNIT_GEO, material, list.length);
      im.castShadow = !isGlow; im.receiveShadow = !isGlow;
      list.forEach((b, i) => {
        m4.makeScale(b[3] * VOX, b[4] * VOX, b[5] * VOX);
        // Trừ 0.5 ô cho X/Z (KHÔNG trừ Y): ô lưới "x" biểu diễn khối chiếm [x, x+1), nên tâm hình học thật
        // của khối nằm ở x+0.5, không phải x. Một hình khối ĐỐI XỨNG quanh mốc x=0 (bệ tế đàn, mặt cắt cột)
        // vì vậy có TRỌNG TÂM THẬT lệch +0.5 ô so với mốc — trụ sáng/va chạm lại đặt đúng tại mốc x=0, nên
        // luôn lệch khỏi tâm hình nhìn thấy. Trừ 0.5 ở đây đưa mốc x=0 về đúng tâm hình học, khớp với trụ sáng
        // (đặt ở gốc cục bộ) và va chạm cột trụ (dùng thẳng cx,cz làm tâm, xem buildAltar).
        m4.setPosition((b[0] + b[3] / 2 - 0.5) * VOX, (b[1] + b[4] / 2) * VOX, (b[2] + b[5] / 2 - 0.5) * VOX);
        im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setHex(b[6]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      parent.add(im);
      made[isGlow ? 'glow' : 'solid'] = im;
    }
    // khối nửa voxel bo góc — hình học riêng (WEDGE_GEO) nên tách InstancedMesh, nhưng dùng CHUNG texture vân
    // đá với khối vuông để mạch đá không bị đứt đoạn ở chỗ nối.
    for (const [list, isGlow] of [[this.wedge, false], [this.wedgeGlow, true]]) {
      if (!list.length) continue;
      const material = isGlow
        ? new THREE.MeshBasicMaterial({ toneMapped: false })
        : new THREE.MeshLambertMaterial({
          map: makeBlockTexture('altar-stone', { grain: 0.11, border: 0.2, speckle: 0.05, speckleDepth: 0.1 }),
        });
      const im = new THREE.InstancedMesh(WEDGE_GEO, material, list.length);
      im.castShadow = !isGlow; im.receiveShadow = !isGlow;
      const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(VOX, VOX, VOX);
      list.forEach(([x, y, z, rot, color], i) => {
        q.setFromAxisAngle(WEDGE_UP, (rot * Math.PI) / 2);
        p.set(x * VOX, (y + 0.5) * VOX, z * VOX);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setHex(color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      parent.add(im);
    }
    return made;
  }
}

// các ô lưới nằm trong đĩa bán kính r (cache lại theo r)
const discCache = new Map();
function disc(r) {
  const key = r.toFixed(2);
  if (discCache.has(key)) return discCache.get(key);
  const cells = [], n = Math.ceil(r);
  for (let x = -n; x <= n; x++) {
    for (let z = -n; z <= n; z++) {
      if (Math.hypot(x, z) <= r + 0.001) cells.push([x, z]);
    }
  }
  discCache.set(key, cells);
  return cells;
}

// khoảng cách kiểu bát giác đều (8 cạnh) trên lưới vuông: max(Chebyshev, Manhattan quy đổi) — cùng công thức
// đã kiểm chứng bằng bản demo tế đàn bát giác 3 tầng. CHỈ dùng cho bệ tế đàn (buildPlatform bên dưới);
// disc()/Euclidean ở trên vẫn giữ nguyên cho đảo bay tròn (buildAltarIsland) và những chỗ khác.
function octDist(x, z) {
  return Math.max(Math.abs(x), Math.abs(z), (Math.abs(x) + Math.abs(z)) / 1.42);
}
const octDiscCache = new Map();
function octDisc(r) {
  const key = r.toFixed(2);
  if (octDiscCache.has(key)) return octDiscCache.get(key);
  const cells = [], n = Math.ceil(r);
  for (let x = -n; x <= n; x++) {
    for (let z = -n; z <= n; z++) {
      if (octDist(x, z) <= r + 0.001) cells.push([x, z]);
    }
  }
  octDiscCache.set(key, cells);
  return cells;
}
// điểm nằm ĐÚNG trên viền bát giác theo hướng góc a, cách tâm r — dùng để bo vòng rune/viền vàng bám sát hình
// bát giác thật thay vì vòng tròn (nếu không, ở các góc chéo điểm sẽ rơi lọt ra ngoài mép bệ)
function octBoundaryPoint(a, r) {
  const dx = Math.cos(a), dz = Math.sin(a);
  const s = r / octDist(dx, dz);
  return [dx * s, dz * s];
}

// ---------- bệ tế đàn: bát giác lưới bậc thang (8 cạnh) ----------
// Ô cách tâm d (đo theo khoảng cách bát giác) có chiều cao h = ceil((1 - d/(Pv+0.5)) * tiers) → bậc thang tự
// nhiên, không cần tính vành. Mỗi bậc là 1 vòng bát giác cắt trên lưới vuông nên viền chéo tự nhiên bị răng
// cưa — làm mượt bằng khối nửa voxel (wedgeAt), chỉ lấp ô nằm GIỮA 2 khối chéo nhau đang thực có (không suy
// diễn/chèn ra ngoài viền bát giác thật), áp dụng cho MỌI tầng bậc — cùng kỹ thuật đã kiểm chứng ở bản demo.
function buildPlatform(vox, level, Pv, tiers, P, rng, cold) {
  const cells = octDisc(Pv);
  const naturalH = (d) => Math.max(1, Math.ceil((1 - d / (Pv + 0.5)) * tiers));
  // Lõi phát sáng ở tâm HẠ XUỐNG bằng vành đá ngay bên ngoài nó, thay vì nhô lên thành đỉnh của hình nón bậc
  // thang. Mặt bệ vì thế phẳng ở giữa, không có bậc lẻ chỉ để đội cái lõi sáng lên cao.
  const coreR = Math.max(1, Math.floor(level / 4));
  const coreH = naturalH(coreR + 1);
  const glowColor = cold ? C.cyan : C.warmPale;
  const inCoreAt = (x, z) => octDist(x, z) <= coreR + 0.001;
  const heightAt = (x, z) => (inCoreAt(x, z) ? coreH : naturalH(octDist(x, z)));
  const topColorAt = (x, z) => (inCoreAt(x, z) ? glowColor : ((x + z) % 2 === 0 ? P.pale : P.light));

  const maxRadAt = new Map();   // chiều cao -> khoảng cách xa nhất còn giữ chiều cao đó (để suy ra mặt bậc)
  let topY = 1;
  for (const c of cells) {
    const h = heightAt(c[0], c[1]);
    for (let y = 1; y <= h; y++) {
      // mặt trên: lõi thì phát sáng, ngoài lõi lát so le 2 tông
      if (y === h) vox.cube(c[0], y, c[1], topColorAt(c[0], c[1]), inCoreAt(c[0], c[1]));
      else vox.cube(c[0], y, c[1], P.sand);
    }
    maxRadAt.set(h, Math.max(maxRadAt.get(h) ?? 0, octDist(c[0], c[1])));
    if (h > topY) topY = h;
  }

  // làm mượt viền răng cưa của MỌI tầng bậc bằng khối nửa voxel
  for (let y = 1; y <= topY; y++) {
    const footprint = new Set();
    for (const c of cells) if (heightAt(c[0], c[1]) >= y) footprint.add(`${c[0]},${c[1]}`);
    const wedgeInfo = new Map();
    for (const key of footprint) {
      const [ax, az] = key.split(',').map(Number);
      const h = heightAt(ax, az);
      const color = h === y ? topColorAt(ax, az) : P.sand;
      const glow = h === y && inCoreAt(ax, az);
      for (const dx of [-1, 1]) {
        for (const dz of [-1, 1]) {
          const dKey = `${ax + dx},${az + dz}`;
          if (!footprint.has(dKey)) continue;
          const eKey = `${ax + dx},${az}`, nKey = `${ax},${az + dz}`;
          if (!footprint.has(eKey) && !wedgeInfo.has(eKey)) wedgeInfo.set(eKey, { dir: [-dx, dz], color, glow });
          if (!footprint.has(nKey) && !wedgeInfo.has(nKey)) wedgeInfo.set(nKey, { dir: [dx, -dz], color, glow });
        }
      }
    }
    for (const [key, { dir, color, glow }] of wedgeInfo) {
      const [wx, wz] = key.split(',').map(Number);
      vox.wedgeAt(wx, y, wz, dir, color, glow);
    }
  }

  // mặt bậc thật của từng ô — dùng cho rune chìm, để rune nằm ĐÚNG mặt bậc kể cả ở vùng lõi đã hạ thấp
  const surfaceAt = heightAt;

  // vòng rune chìm quanh mép các bậc + 4 tia rune chạy ra mép (từ cấp 3) — vòng bám theo VIỀN BÁT GIÁC thật
  if (level >= 3) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
      const [bx, bz] = octBoundaryPoint(a, Pv * 0.66);
      const rx = Math.round(bx), rz = Math.round(bz);
      vox.cube(rx, surfaceAt(rx, rz), rz, P.seam, true);
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let s = 2; s <= Pv; s++) {
        if (s % 2 !== 0) continue;
        const px = dx * s, pz = dz * s;
        vox.cube(px, surfaceAt(px, pz), pz, P.seam, true);
      }
    }
  }

  // viền vàng quanh bậc dưới cùng (từ cấp 4): MỘT lần rút thăm dùng chung cho cả màu lẫn glow — trước đây bốc
  // 2 lần độc lập nên có thể ra tổ hợp sai (màu đá sand2 xỉn nhưng lại gán vật liệu phát sáng không đổ bóng,
  // hoặc màu vàng seam nhưng lại KHÔNG phát sáng) → khối trông nhờ nhờ, không giống đá cũng chẳng giống đá
  // năng lượng vàng. Giờ vàng luôn đi kèm phát sáng, sand2 luôn là đá thường có vân/đổ bóng. Vòng bám theo
  // VIỀN BÁT GIÁC thật thay vì vòng tròn.
  if (level >= 4) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      const [bx, bz] = octBoundaryPoint(a, Pv);
      const gx = Math.round(bx), gz = Math.round(bz);
      const isGold = rng.chance(0.5);
      vox.cube(gx, 1, gz, isGold ? P.seam : P.sand2, isGold);
    }
  }

  // Mặt đứng đi lên được suy từ CHIỀU CAO THẬT đã dựng (không tính lại bằng công thức) — vùng lõi đã bị hạ
  // thấp nên công thức gốc không còn khớp hình khối nữa.
  const steps = [...maxRadAt.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, maxD]) => ({ h, r: (maxD + 0.5) * VOX, y: h * VOX }));

  return { topY, coreH, steps };
}

// ---------- trụ đá ----------
// phiến 3x3: 4 khối góc + khe lõm hình chữ thập ở giữa
function plate(vox, cx, y, cz, pal, P) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const corner = dx !== 0 && dz !== 0;
      const c = corner ? pal[(dx < 0 ? 0 : 1) + (dz < 0 ? 0 : 2)]
        : (dx === 0 && dz === 0 ? P.dark : P.shadow);
      vox.cube(cx + dx, y, cz + dz, c);
    }
  }
}

// Vành 5x5 vát 4 góc — dùng làm CHÂN ĐẾ dưới cùng và ĐẦU TRỤ loe ra của trụ cao nhất. Rộng hơn thân trụ
// (3x3) một ô mỗi bên nên trụ có bệ đỡ rõ ràng thay vì cắm thẳng xuống đất.
function flare(vox, cx, y, cz, edgeColor, faceColor) {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      // ĐỦ cả 4 góc — vát góc làm chân đế trông như bị khuyết một miếng chứ không ra dáng bệ đá
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      vox.cube(cx + dx, y, cz + dz, edge ? edgeColor : faceColor);
    }
  }
}

// 1 tầng thân trụ: 4 thanh vuông ở góc, khe lõm ở giữa.
// core = {corner, from, to, color}: lõi năng lượng chạy dọc ĐÚNG MỘT trong 4 góc — tức chiếm 1/4 thân trụ,
// thay chỗ thanh đá ở góc đó. Đây chính là kiểu "ánh sáng chỉ bao đúng khối của nó" trong bản thiết kế.
function shaftLayer(vox, cx, y, cz, cols, P, bandColor, glow, core) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const corner = dx !== 0 && dz !== 0;
      if (!corner) { vox.cube(cx + dx, y, cz + dz, P.shadow); continue; }
      const idx = (dx < 0 ? 0 : 1) + (dz < 0 ? 0 : 2);
      if (core && core.corner === idx && y >= core.from && y <= core.to) {
        vox.cube(cx + dx, y, cz + dz, core.color, true);
      } else {
        vox.cube(cx + dx, y, cz + dz, bandColor || cols[idx], !!glow);
      }
    }
  }
}

function rollCore(level, rng, H, base) {
  const p = level >= 8 ? 0.8 : level >= 5 ? 0.5 : 0;
  if (!rng.chance(p)) return null;
  return {
    corner: rng.int(0, 3),
    from: base + rng.int(0, Math.max(0, Math.floor(H / 3))),
    to: base + H - 1,
    color: level >= 8 ? C.blue : 0x53ccff,
  };
}

// Trả về chiều cao trụ tính bằng ô (để world.js dựng vùng va chạm).
function buildPillar(vox, cx, cz, H, level, P, rng, broken, lamps, tallest) {
  const cols = [P.sand, P.pale, P.dark, P.light];
  // chân đế: vành loe 5x5 dưới cùng, rồi tới phiến 3x3, rồi mới tới thân trụ
  flare(vox, cx, 1, cz, P.deep, P.dark);
  plate(vox, cx, 2, cz, [P.dark, P.sand2, P.shadow, P.light], P);
  const base = 3;   // tầng lưới đầu tiên của THÂN trụ

  if (broken) {
    const Hb = Math.max(1, Math.round(H * rng.range(0.3, 0.6)));
    const bcore = rollCore(level, rng, Hb, base);
    for (let y = base; y < base + Hb; y++) shaftLayer(vox, cx, y, cz, cols, P, null, false, bcore);
    // mặt gãy: khuyết 1-2 góc ở tầng trên cùng
    const corners = rng.shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1]]);
    for (let k = 0; k < rng.int(1, 2); k++) vox.cube(cx + corners[k][0], base + Hb, cz + corners[k][1], P.sand2);
    if (rng.chance(0.6)) vox.cube(cx + corners[0][0], base + Hb + 1, cz + corners[0][1], P.pale);
    // mảnh vỡ rơi quanh chân
    for (let k = 0; k < rng.int(1, 3); k++) {
      vox.cube(cx + rng.int(-3, 3), 1, cz + rng.int(-3, 3), rng.chance(0.5) ? P.sand2 : P.dark);
    }
    return base + Hb + 1;
  }

  const band = base + Math.floor(H / 2), core = rollCore(level, rng, H, base);
  for (let y = base; y < base + H; y++) {
    if (y === band) shaftLayer(vox, cx, y, cz, cols, P, P.seam, true, core);   // đai chỉ vàng
    else shaftLayer(vox, cx, y, cz, cols, P, null, false, core);
  }
  let y = base + H;
  plate(vox, cx, y, cz, [P.sand2, P.light, P.dark, P.sand], P); y++;   // cổ đầu dẹp
  plate(vox, cx, y, cz, [P.sand2, P.pale, P.dark, P.light], P); y++;   // đầu cột
  // TRỤ CAO NHẤT của tế đàn đội thêm một tầng đầu trụ loe ra + chóp, thành điểm nhấn của cả cụm
  if (tallest) {
    flare(vox, cx, y, cz, P.sand2, P.pale); y++;
    plate(vox, cx, y, cz, [P.dark, P.sand2, P.shadow, P.light], P); y++;
  }

  if (level >= 5) {
    vox.cube(cx, y, cz, level >= 8 ? C.blue : 0x53ccff, true); y++;
    vox.cube(cx, y, cz, C.cyan, true);
    lamps.push({ x: cx, y, z: cz });
    y++;
  }
  return y;
}

// ---------- dựng cả tế đàn ----------
// opts: { level 1-10, pillars (đảo đích = false), seed, archetype: dạng địa hình đảo (world.archetype,
// 0-9, xem config.js) để suy màu ĐÁ khớp mặt đất — null/undefined thì lùi về màu theo cấp (cũ) }
// Trả về: group (đặt sao cho y=0 là mặt đất dưới chân bệ), topY (mặt bậc trên cùng, đơn vị thế giới),
// steps [{r,y}] để world.js đăng ký mặt đứng đi lên được, colliders trụ, và fx để game.js chạy hoạt ảnh.
export function buildAltar({ level = 1, pillars = true, seed = 1, exitAngle = null, archetype = null } = {}) {
  const lv = Math.max(1, Math.min(10, level));
  const rng = makeRng(seed);
  // "cold" vẫn CHỈ chi phối hiệu ứng phép thuật rời (cột sáng/vòng năng lượng/hạt sáng/lõi trụ bên dưới) —
  // đó là sức mạnh của tế đàn theo CẤP, không phải chất liệu đá của nó. Màu ĐÁ (P) tách riêng, khớp môi trường.
  const cold = lv >= 8;
  // Không có archetype (vd tế đàn trên đảo bay đích, không đứng trên mặt đất nào) → lùi về màu theo cấp như cũ.
  // seam LUÔN lấy từ PAL_WARM/PAL_COLD theo cấp — paletteForArchetype() chỉ suy màu ĐÁ, không có seam riêng,
  // vì mạch năng lượng là nguyên tố cố định, không đổi theo môi trường đứng.
  const P = archetype == null
    ? (cold ? PAL_COLD : PAL_WARM)
    : { ...paletteForArchetype(archetype), seam: cold ? PAL_COLD.seam : PAL_WARM.seam };
  const vox = new Vox();
  // outer = thứ world.js đặt vị trí; root = toàn bộ nội dung, hạ xuống 1 ô so với outer. Phải tách 2 lớp:
  // nếu hạ trực tiếp trên outer thì world.js gọi position.set(...) là xoá mất phép hạ đó.
  const outer = new THREE.Group();
  const root = new THREE.Group();
  root.position.y = -VOX;
  outer.add(root);

  const Pv = 3 + Math.round(lv * 0.32);                // bán kính bệ, đơn vị ô
  const tiers = Math.min(4, 1 + Math.floor(lv / 2.6)); // số bậc
  const plat = buildPlatform(vox, lv, Pv, tiers, P, rng, cold);
  const topY = plat.topY;
  const steps = plat.steps;

  const colliders = [], lamps = [];
  let pillarCount = 0, pillarR = 0;
  if (pillars) {
    // tối đa 6 trụ; cấp càng cao càng nhiều trụ nguyên vẹn, tỉ lệ trụ gãy giảm dần
    const bias = (lv - 1) / 9;
    pillarCount = rng.biasedInt(2 + Math.round(2 * bias), 6, bias);
    const pBroken = 0.55 - 0.45 * bias;
    // Bán kính vòng cột CỐ ĐỊNH ở MỌI cấp (yêu cầu người chơi): 3.25 đơn vị thế giới, quy sang ô lưới bằng
    // /VOX cho khớp lưới voxel. Không neo theo cấp/Pv nữa — Pv (bệ) phình tối đa tới 1.5 ở cấp 10 nên 3.25
    // luôn thừa xa để cột không đè lên bậc, kể cả cấp cao nhất.
    const pr = 3.25 / VOX;
    pillarR = pr * VOX;
    // 6 VỊ TRÍ CỐ ĐỊNH cách đều 60° quanh tâm; trụ chỉ mọc NGẪU NHIÊN ở một số trong 6 vị trí đó (rút thăm
    // không lặp) thay vì luôn dàn đều đúng pillarCount trụ quanh trọn vòng tròn — cho dáng đổ nát tự nhiên
    // hơn (từng cụm trụ đứng gần nhau, chỗ khác trống hẳn) thay vì lúc nào cũng đối xứng tăm tắp.
    // exitAngle (nếu có): lệch gốc đúng nửa khoảng cách giữa 2 vị trí (30°) để không vị trí nào rơi thẳng vào
    // hướng lối ra — hướng đó vì vậy luôn nằm giữa 2 vị trí kề nhau, luôn trống, không cần loại trừ vị trí nào.
    const a0 = exitAngle === null ? rng.range(0, Math.PI * 2) : exitAngle - Math.PI / 6;
    const slots = [0, 1, 2, 3, 4, 5].map((k) => a0 + k * (Math.PI / 3));
    const chosenA = rng.shuffle(slots.slice()).slice(0, Math.min(pillarCount, 6));
    // bốc trước thông số từng trụ để biết trụ nào CAO NHẤT — trụ đó mới được đội thêm đầu trụ
    const specs = chosenA.map((a) => ({
      a,
      H: Math.max(3, 3 + Math.round(lv * 0.38) + rng.int(-1, 1)),
      broken: rng.chance(pBroken),
    }));
    let tallestIdx = -1, tallestH = -1;
    specs.forEach((s, i) => { if (!s.broken && s.H > tallestH) { tallestH = s.H; tallestIdx = i; } });
    specs.forEach((s, i) => {
      const cx = Math.round(Math.cos(s.a) * pr), cz = Math.round(Math.sin(s.a) * pr);
      const topCell = buildPillar(vox, cx, cz, s.H, lv, P, rng, s.broken, lamps, i === tallestIdx);
      // thân trụ rộng 3 ô → trụ va chạm bán kính 1.5 ô, quy về đơn vị thế giới. Chân đế loe 5x5 chỉ cao 1 ô
      // nên bước qua được, không tính vào trụ va chạm (giống bệ cột của bản cũ).
      colliders.push({ x: cx * VOX, z: cz * VOX, r: 1.5 * VOX * 0.92, h: topCell * VOX });
    });
  }

  // Khối ở tầng lưới y chiếm khoảng [y, y+1] ô. Bệ bắt đầu từ tầng 1 nên nếu để nguyên, cả tế đàn bị nhấc
  // lên 1 ô so với mặt đất — đã bù bằng root.position.y = -VOX ở trên. Nhờ vậy mặt bậc cao h rơi đúng vào
  // world y = h*VOX, khớp với steps/topY trả về bên dưới.
  vox.commit(root);

  // ---- trụ sáng: 3 lớp hộp lồng nhau, hợp ngôn ngữ khối vuông ----
  const beamY = (topY + 1) * VOX, beamH = 9;
  // giữ lại độ mờ GỐC của từng lớp: lúc nhân vật truyền tống, game.js hạ cường độ cả trụ sáng xuống theo hệ
  // số chung rồi khôi phục, nên phải có mốc gốc để nhân vào
  const beamLayers = [];
  const beamLayer = (w, color, opacity) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, beamH, w),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false })
    );
    m.position.y = beamY + beamH / 2;
    root.add(m);
    beamLayers.push({ mesh: m, base: opacity });
    return m;
  };
  const beam = beamLayer(VOX * (3.4 + lv * 0.22), cold ? C.blue : C.warm, 0.2);
  beamLayer(VOX * (2 + lv * 0.14), cold ? C.cyan : C.gold, 0.42);
  beamLayer(VOX * (1 + lv * 0.06), cold ? 0xe6faff : C.warmPale, 0.92);

  const coreLight = new THREE.PointLight(cold ? C.blue : C.warm, 3.4 + lv * 0.3, 9);
  coreLight.position.y = beamY + 0.6;
  root.add(coreLight);

  // ---- vòng năng lượng: cung khối vuông quay quanh trụ sáng ----
  const rings = [];
  const ringCount = lv < 4 ? 0 : lv < 6 ? 1 : lv < 8 ? 2 : lv < 10 ? 3 : 4;
  const ringGeo = new THREE.BoxGeometry(VOX * 0.8, VOX * 0.8, VOX * 0.8);
  const ringMat = new THREE.MeshBasicMaterial({ color: cold ? C.cyan : C.gold, toneMapped: false });
  for (let i = 0; i < ringCount; i++) {
    const rg = new THREE.Group();
    rg.position.y = beamY + 1.4 + i * 1.05;
    root.add(rg);
    const rad = (Pv * 0.55 + i * 0.9) * VOX, seg = 10 + i * 3, span = 0.72;
    for (let s = 0; s < seg; s++) {
      const sa = (s / seg) * Math.PI * 2 * span;
      const cube = new THREE.Mesh(ringGeo, ringMat);
      cube.position.set(Math.cos(sa) * rad, 0, Math.sin(sa) * rad);
      rg.add(cube);
    }
    rg.userData.speed = (i % 2 ? -0.5 : 0.7) + lv * 0.02;
    rings.push(rg);
  }

  // ---- hạt năng lượng bay lên quanh trụ sáng ----
  const particles = [];
  const pGeo = new THREE.BoxGeometry(VOX * 0.34, VOX * 0.34, VOX * 0.34);
  const pMat = new THREE.MeshBasicMaterial({ color: cold ? C.cyan : C.warmPale, toneMapped: false });
  for (let i = 0; i < 10 + lv * 3; i++) {
    const pa = rng.range(0, Math.PI * 2), prr = (1.2 + rng.next() * Pv) * VOX;
    const particle = new THREE.Mesh(pGeo, pMat);
    particle.position.set(Math.cos(pa) * prr, beamY + rng.range(0, 4), Math.sin(pa) * prr);
    particle.userData = { a: pa, r: prr, y0: beamY, speed: rng.range(0.5, 1.4), top: rng.range(3.5, 6) };
    root.add(particle);
    particles.push(particle);
  }

  // ---- khối phản trọng lực lơ lửng quanh tế đàn (từ cấp 8) ----
  const floaters = [];
  if (lv >= 8) {
    const fGeo = new THREE.BoxGeometry(VOX * 1.6, VOX * 0.7, VOX * 0.8);
    const fMat = new THREE.MeshLambertMaterial({ color: PAL_COLD.sand });   // khối đá — đặc, không trong suốt
    // nụ sáng năng lượng gắn trên mỗi cụm đá lơ lửng — vật liệu RIÊNG (không dùng chung ringMat của vòng năng
    // lượng quanh trụ sáng) để chỉ nụ sáng này hơi trong suốt, không ảnh hưởng tới các vòng năng lượng khác
    const floaterGlowMat = new THREE.MeshBasicMaterial({ color: cold ? C.cyan : C.gold, toneMapped: false, transparent: true, opacity: 0.75 });
    for (let i = 0; i < lv - 5; i++) {
      const fa = (i / (lv - 5)) * Math.PI * 2;
      const fg = new THREE.Group();
      fg.position.set(Math.cos(fa) * (Pv + 5) * VOX, (4 + (i % 2) * 1.6) * VOX + beamY, Math.sin(fa) * (Pv + 5) * VOX);
      fg.add(new THREE.Mesh(fGeo, fMat));
      const glowCube = new THREE.Mesh(ringGeo, floaterGlowMat);
      glowCube.position.y = VOX * 0.7;
      fg.add(glowCube);
      root.add(fg);
      floaters.push(fg);
    }
  }

  for (const p of lamps.slice(0, 4)) {
    const l = new THREE.PointLight(cold ? C.blue : C.warm, 0.9, 3);
    l.position.set(p.x * VOX, p.y * VOX, p.z * VOX);
    root.add(l);
  }

  return {
    group: outer,
    topY: topY * VOX,          // mặt bậc trên cùng — chỗ người chơi hồi sinh
    platformR: Pv * VOX,
    pillarR,                   // bán kính vòng cột trụ — buildChain dùng để đẩy vật thể đầu chuỗi ra ngoài
    steps,
    colliders,
    pillarCount,
    fx: { rings, particles, floaters, beam, beamLayers, coreLight, coreLightBase: coreLight.intensity },
  };
}

// ---------- khoáng sản năng lượng rải trên đảo ----------
// Chỉ xuất hiện từ cấp mà trụ tế đàn bắt đầu có lõi năng lượng (xem rollCore) — đảo và tế đàn cùng một mạch
// năng lượng thì mới hợp lý.
export function hasEnergyCore(level) { return level >= 5; }
export function energyColorForLevel(level) { return level >= 8 ? C.blue : 0x53ccff; }

// Đá khoáng: MOUND đá 2 tầng có đỡ chắc (tầng trên luôn nằm trên tầng dưới, không khối nào lơ lửng) + TINH
// THỂ THON nhô hẳn lên khỏi silhouette đá, kèm quầng sáng cộng màu — đọc rõ là "khối khoáng có năng lượng lộ
// ra", khác hẳn bản trước (1 ô đổi màu chìm trong đống khối rời rạc, không ra hình thù gì). Đá bọc ngoài (P)
// khớp màu mặt đất (archetype) như trụ tế đàn; tinh thể năng lượng bên trong (color) LUÔN giữ nguyên màu
// nguyên tố theo cấp, không đổi theo môi trường — đá là đá, khoáng là khoáng, không lẫn vào nhau.
export function buildEnergyOre({ level = 8, seed = 1, archetype = null } = {}) {
  const rng = makeRng(seed);
  const vox = new Vox();
  const g = new THREE.Group();
  const P = archetype == null ? (level >= 8 ? PAL_COLD : PAL_WARM) : paletteForArchetype(archetype);
  const color = energyColorForLevel(level);

  // tầng đáy: chân đế đá 2x2 hoặc 3x2, khuyết nhẹ 1 góc cho đỡ vuông chằn chặn
  const w = rng.int(2, 3), d = 2;
  const skipCorner = rng.chance(0.5) ? [w - 1, d - 1] : null;
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (skipCorner && x === skipCorner[0] && z === skipCorner[1]) continue;
      vox.cube(x, 0, z, rng.chance(0.4) ? P.dark : P.deep);
    }
  }
  const cx = (w - 1) / 2, cz = (d - 1) / 2;
  const cxI = Math.round(cx), czI = Math.round(cz);
  // tầng 2 (tuỳ chọn): 1 ô gần tâm chân đế, chắc chắn có đá đỡ ngay dưới — mound thu nhỏ dần lên, không xoè ngang
  const hasLayer2 = w >= 3 ? rng.chance(0.6) : rng.chance(0.35);
  if (hasLayer2) vox.cube(cxI, 1, czI, rng.chance(0.4) ? P.dark : P.deep);
  const topY = hasLayer2 ? 2 : 1;

  // Khối năng lượng đội trên đỉnh mound: ĐÚNG MỘT ô, không phải cụm khối glow trơn thò dần lên như bản trước
  // (nhiều cụm đá đứng cạnh nhau thì các khối glow liền kề dính lại thành một mảng phẳng lì, không phân biệt
  // được ranh giới). 2 kiểu ngẫu nhiên: 'half' (nửa dưới đá, nửa trên năng lượng) hoặc 'core' (năng lượng lộ
  // ra ở giữa, đá bọc quanh) — cả hai đều có PHẦN ĐÁ CÓ TEXTURE bao quanh nên luôn đọc được ranh giới khối.
  const style = rng.chance(0.5) ? 'half' : 'core';
  const stoneCap = rng.chance(0.4) ? P.dark : P.deep;
  if (style === 'half') {
    vox.add(cxI, topY, czI, 1, 0.5, 1, stoneCap);           // nửa dưới: đá
    vox.add(cxI, topY + 0.5, czI, 1, 0.5, 1, color, true);  // nửa trên: năng lượng
  } else {
    vox.cube(cxI, topY, czI, stoneCap);                                          // khối đá bọc ngoài
    vox.add(cxI + 0.25, topY + 0.25, czI + 0.25, 0.5, 0.5, 0.5, color, true);    // lõi năng lượng lộ ra giữa
  }

  vox.commit(g);

  // quầng sáng cộng màu quanh khối năng lượng — không có quầng thì mạch sáng chỉ như một mảng sơn màu, có
  // quầng mới đọc ra là NGUỒN SÁNG thật (cùng kỹ thuật với khúc sáng trên thân cột)
  const haloY = style === 'half' ? topY + 0.75 : topY + 0.5;
  const halo = new THREE.Mesh(
    new THREE.BoxGeometry(VOX * 1.3, VOX * 0.85, VOX * 1.3),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  // Vox.commit() giờ tự trừ 0.5 ô cho X/Z (xem chú thích ở đó) nên tâm khối 1x1x1 tại chỉ số lưới cxI đã nằm
  // đúng tại cxI*VOX — không cộng thêm +0.5 nữa như trước, nếu không quầng sáng sẽ lệch khỏi khối phát sáng.
  halo.position.set(cxI * VOX, haloY * VOX, czI * VOX);
  g.add(halo);

  // Đưa tâm cụm về gốc toạ độ để đặt thẳng lên mặt đất (đáy đã ở y=0 sẵn). Chân đế chiếm ô lưới 0..w-1 (không
  // đối xứng quanh 0 như bệ tế đàn), tâm hình học thật sau khi Vox.commit trừ 0.5 nằm ở (w-1)/2 — không phải
  // w/2 như trước (đó là công thức của quy ước CŨ, chưa trừ 0.5 ô).
  g.children.forEach((c) => { c.position.x -= ((w - 1) / 2) * VOX; c.position.z -= ((d - 1) / 2) * VOX; });
  g.rotation.y = rng.int(0, 3) * (Math.PI / 2);   // xoay theo bội 90° để lưới vẫn trùng trục với đảo
  return g;
}

// ---------- đảo bay voxel (dùng cho đảo đích) ----------
// Trả về group + bán kính mặt đứng thật, để world.js khớp vùng va chạm với hình khối nhìn thấy.
export function buildAltarIsland({ level = 1, seed = 1, radiusCells = 0 } = {}) {
  const lv = Math.max(1, Math.min(10, level));
  const rng = makeRng(seed ^ 0x9e37);
  const vox = new Vox();
  const root = new THREE.Group();
  const Rv = radiusCells || 9 + Math.round(lv * 0.55);
  const cells = disc(Rv);
  const depth = new Map();

  // Lượng tử hoá độ sâu theo Ô LỚN 4x4 (căn đúng lưới gộp siêu ô bên dưới): mỗi ô lớn dùng
  // CHUNG một giá trị độ sâu, thay vì băm ngẫu nhiên riêng từng ô nhỏ — nếu không, hầu như
  // không có 2 ô cạnh nhau nào trùng độ sâu tuyệt đối, khiến bước gộp 2x2/4x4 phía dưới không
  // bao giờ khớp và không hình thành được khối lớn thật sự.
  const DEPTH_TILE = 4;
  const tileDepthCache = new Map();
  const tileDepthByIndex = (tx, tz) => {
    const tkey = `${tx},${tz}`;
    let v = tileDepthCache.get(tkey);
    if (v === undefined) {
      const ccx = tx * DEPTH_TILE + (DEPTH_TILE - 1) / 2, ccz = tz * DEPTH_TILE + (DEPTH_TILE - 1) / 2;
      const d = Math.hypot(ccx, ccz);
      const k = Math.max(0, 1 - d / (Rv + 1));
      const n = hashNoise(seed + 23, tx, tz);
      v = Math.max(1, Math.round((2 + Rv * 0.62) * Math.pow(k, 0.55) + n * 1.8));
      tileDepthCache.set(tkey, v);
    }
    return v;
  };
  const tileDepthAt = (cx, cz) => tileDepthByIndex(Math.floor(cx / DEPTH_TILE), Math.floor(cz / DEPTH_TILE));
  for (const c of cells) {
    depth.set(`${c[0]},${c[1]}`, tileDepthAt(c[0], c[1]));
  }
  const depthAt = (x, z) => depth.get(`${x},${z}`) ?? 0;

  const bare = lv >= 10;
  const grassy = lv <= 7 ? 1 : lv === 8 ? 0.62 : 0.28;
  for (const c of cells) {
    let top;
    if (bare) top = C.techRock;
    else if (hashNoise(seed + 5, c[0], c[1]) < grassy) {
      top = hashNoise(seed + 9, c[0], c[1]) < 0.24 ? C.grassDark : C.grass;
    } else top = lv >= 8 ? C.techRock : C.dirt;
    vox.cube(c[0], 0, c[1], top);   // mặt cỏ giữ NGUYÊN từng ô — cỏ/đất lốm đốm là chủ đích, không gộp
  }

  // ---- vỏ đá bên dưới đảo: RỖNG bên trong như bản gốc — ô nào có ĐỦ CẢ 4 hàng xóm cùng sâu (hoặc sâu hơn)
  // thì bị chính các hàng xóm đó che khuất hoàn toàn từ mọi góc nhìn bên ngoài, dựng vỏ ở đó chỉ tổ tốn khối vô
  // ích, nên bỏ qua — vỏ chỉ thật sự cần dựng ở dải RÌA, nơi có ít nhất 1 hàng xóm nông hơn (hoặc không có
  // hàng xóm — mép đảo) để lộ mặt cắt. Trong dải rìa đó, đa số vẫn là khối 1x1 như bản gốc; CHỈ MỘT SỐ ô được
  // RÚT THĂM nâng cấp lên khối to gấp 4 lần (2x2) hoặc 16 lần (4x4) để đỡ vụn mà vẫn xen kẽ to/nhỏ.
  const cellSet = new Set(cells.map((c) => `${c[0]},${c[1]}`));
  // Ô LỚN lân cận có thật sự thuộc đảo không — PHẢI tra qua cellSet, không suy luận từ công thức độ sâu
  // (tileDepthByIndex vẫn trả một số dù toạ độ nằm hẳn ngoài đĩa bán kính Rv). Bug cũ: coi mọi ô lớn lân cận
  // là "có che khuất" bất kể trong hay ngoài đảo, nên các ô sát MÉP đảo — đúng chỗ vỏ phải bám chắc vào mặt
  // trên nhất — lại bị tưởng nhầm có hàng xóm che, hụt mất vài tầng trên cùng, tạo khe hở lửng giữa cỏ và vỏ.
  const tileInIslandCache = new Map();
  const tileInIsland = (tx, tz) => {
    const key = `${tx},${tz}`;
    let v = tileInIslandCache.get(key);
    if (v === undefined) {
      v = false;
      outer: for (let dx = 0; dx < DEPTH_TILE; dx++) {
        for (let dz = 0; dz < DEPTH_TILE; dz++) {
          if (cellSet.has(`${tx * DEPTH_TILE + dx},${tz * DEPTH_TILE + dz}`)) { v = true; break outer; }
        }
      }
      tileInIslandCache.set(key, v);
    }
    return v;
  };
  const tileDepthSafe = (tx, tz) => (tileInIsland(tx, tz) ? tileDepthByIndex(tx, tz) : 0);
  const nbAt = (x, z) => {
    const tx = Math.floor(x / DEPTH_TILE), tz = Math.floor(z / DEPTH_TILE);
    return Math.min(
      tileDepthSafe(tx + 1, tz), tileDepthSafe(tx - 1, tz),
      tileDepthSafe(tx, tz + 1), tileDepthSafe(tx, tz - 1)
    );
  };
  const doneUnder = new Set();
  const MERGE_CHANCE = { 4: 0.16, 2: 0.32 };
  // gộp nhiều LỚP liên tiếp cùng dải vật liệu (đất/đá) thành khối cao ngẫu nhiên 1-3 ô, phủ cả mặt cắt size×size.
  // exposedTop = -1-nb0: ô mép đảo thật (nb0=0, nhờ tileInIsland ở trên) luôn xây tới sát y=-1, bám thẳng vào
  // mặt cỏ, không hở; ô nội địa bị hàng xóm che (nb0 lớn) thì lùi mặt trên vào sâu hơn hoặc bỏ hẳn (rỗng).
  const underRun = (cx0, cz0, size, D0, nb0) => {
    const exposedTop = -1 - nb0;
    let y = -D0;
    while (y <= exposedTop) {
      const dirtBand = y >= -2;
      let maxRun = 1;
      while (y + maxRun <= exposedTop && (y + maxRun >= -2) === dirtBand) maxRun++;
      const runH = Math.min(maxRun, rng.int(1, 3));
      const mat = dirtBand
        ? (hashNoise(seed + 31, cx0 + y, cz0) < 0.32 ? C.dirtDark : C.dirt)
        : (hashNoise(seed + 41, cx0, cz0 + y) < 0.38 ? C.rockDark : C.rock);
      vox.add(cx0, y, cz0, size, runH, size, mat);
      y += runH;
    }
  };
  for (const superSize of [4, 2, 1]) {
    for (const c of cells) {
      const [cx0, cz0] = c;
      // chỉ xét các góc SIÊU Ô căn đúng theo lưới superSize — tránh dựng nhiều siêu ô chồng lấn nhau
      if (((cx0 % superSize) + superSize) % superSize !== 0) continue;
      if (((cz0 % superSize) + superSize) % superSize !== 0) continue;
      const key0 = `${cx0},${cz0}`;
      if (doneUnder.has(key0)) continue;
      // rút thăm CÓ SEED cho khối to, để cùng seed luôn dựng ra y hệt nhau; superSize=1 không rút thăm — luôn nhận
      if (superSize !== 1 && hashNoise(seed + 83, cx0, cz0) >= MERGE_CHANCE[superSize]) continue;
      const D0 = depthAt(cx0, cz0), nb0 = nbAt(cx0, cz0);
      // toàn bộ ô trong siêu ô phải: tồn tại trên đảo, chưa xử lý, và CÙNG độ sâu với ô góc (nb0 tự động
      // trùng nhau trong cả nhóm vì superSize luôn chia hết DEPTH_TILE nên nhóm không bao giờ vắt qua 2 ô lớn)
      let ok = true;
      const members = [key0];
      outer:
      for (let dx = 0; dx < superSize; dx++) {
        for (let dz = 0; dz < superSize; dz++) {
          if (dx === 0 && dz === 0) continue;
          const kx = cx0 + dx, kz = cz0 + dz, k = `${kx},${kz}`;
          if (!cellSet.has(k) || doneUnder.has(k) || depthAt(kx, kz) !== D0) { ok = false; break outer; }
          members.push(k);
        }
      }
      if (!ok) continue;
      members.forEach((k) => doneUnder.add(k));
      underRun(cx0, cz0, superSize, D0, nb0);
    }
  }

  // mạch năng lượng phát sáng ở đáy đảo (cấp 9-10)
  if (lv >= 9) {
    for (const c of cells) {
      if (hashNoise(seed + 77, c[0], c[1]) > 0.06) continue;
      const yy = -1 - Math.floor(hashNoise(seed + 79, c[0], c[1]) * 3);
      if (-yy <= depthAt(c[0], c[1])) vox.cube(c[0], yy, c[1], C.blue, true);
    }
  }

  // đá vụn lơ lửng quanh đảo
  for (let i = 0; i < 2 + Math.floor(lv / 2); i++) {
    const a = rng.range(0, Math.PI * 2), rr = Rv * rng.range(0.9, 1.3);
    const s = rng.int(1, 2);
    vox.add(
      Math.round(Math.cos(a) * rr), -Math.round(rng.range(Rv * 0.5, Rv * 0.95)), Math.round(Math.sin(a) * rr),
      s, s, s, rng.chance(0.5) ? C.rock : C.rockDark
    );
  }

  vox.commit(root);
  // mặt trên nằm ở lớp y=0 của lưới → cao 1 ô; bán kính mặt đứng = Rv ô (mép ngoài cùng của lớp mặt)
  return { group: root, topR: (Rv + 0.5) * VOX, topY: VOX };
}
