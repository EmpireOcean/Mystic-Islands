// ===== Dựng mô hình voxel từ các khối hộp =====
import * as THREE from 'three';
import { rand, randInt, pick, chance } from './config.js';

// ===== Texture pixel 16x16 dùng chung — vân hạt + viền tối giả AO ở cạnh khối =====
// Một tấm texture cho cả nghìn khối instance nên chi phí gần như bằng 0.
const texCache = new Map();
export function makeBlockTexture(key, { grain = 0.12, border = 0.22, speckle = 0.06, speckleDepth = 0.12 } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const S = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i) * 31;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 1 - grain / 2 + rnd() * grain;          // vân hạt
      if (rnd() < speckle) v -= speckleDepth;          // đốm sẫm rải rác
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (edge === 0) v *= 1 - border;                 // viền ngoài tối — AO giữa các khối
      else if (edge === 1) v *= 1 - border * 0.45;     // chuyển tiếp mềm
      const c = Math.round(255 * Math.min(1, v));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  texCache.set(key, tex);
  return tex;
}

// vân nhẹ dùng chung cho MỌI khối hộp/trụ trong game (nhân vật, bụi cây, rương, quái...) — tinh tế hơn vân địa
// hình vì khối ở đây thường nhỏ, tránh trông rối; texture cache theo màu nên chi phí gần như bằng 0
const objTexCache = new Map();
function objTexFor(color) {
  const key = typeof color === 'number' ? color.toString(16) : String(color);
  if (!objTexCache.has(key)) {
    objTexCache.set(key, makeBlockTexture('obj-' + key, { grain: 0.08, border: 0.14, speckle: 0.03 }));
  }
  return objTexCache.get(key);
}

// ===== Texture riêng cho vỏ cây (vân dọc) và tán lá (đốm nhiều tầng) — CÙNG quy ước "hệ số sáng gần trắng"
// như makeBlockTexture (an toàn, đã kiểm chứng đúng màu khi nhân với material.color trong shader), chỉ khác
// noise pattern để rõ/đậm hơn hẳn texture khối thường (objTexFor) — thân/tán cây có kết cấu rõ kiểu voxel
const barkTexCache = new Map();
function barkTexFor(color) {
  const key = typeof color === 'number' ? color.toString(16) : String(color);
  if (barkTexCache.has(key)) return barkTexCache.get(key);
  const S = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i) * 53;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const streakCols = new Set();
  while (streakCols.size < 3) streakCols.add(Math.floor(rnd() * S)); // vài cột vân dọc tối cố định — như vân gỗ/vỏ cây thật
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = streakCols.has(x) ? 0.68 + rnd() * 0.14 : 0.9 + rnd() * 0.14;
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (edge === 0) v *= 0.78;
      const c = Math.round(255 * Math.min(1, v));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // cho phép UV lệch/lặp > 1 (tileUV bên dưới dùng để giữ mật độ hạt cố định)
  barkTexCache.set(key, tex);
  return tex;
}

// tile mật độ hạt CỐ ĐỊNH theo đơn vị thế giới (1 đơn vị = 1 lượt lặp texture), thay vì luôn kéo giãn đúng 1
// lượt texture cho MỌI khối bất kể to nhỏ (khối nhỏ trước đây bị "co giãn" nhìn mịn/nhỏ hơn hẳn khối to) —
// đồng thời lệch điểm bắt đầu ngẫu nhiên để các khối cùng kích thước không lặp lại y hệt cùng một góc texture
function tileUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const ox = rand(0, 1), oy = rand(0, 1);
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // thứ tự mặt của BoxGeometry: +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faces[f];
    for (let v = 0; v < 4; v++) {
      const idx = f * 4 + v;
      uv.setXY(idx, uv.getX(idx) * su + ox, uv.getY(idx) * sv + oy);
    }
  }
  uv.needsUpdate = true;
}

function barkBox(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  tileUV(geo, w, h, d);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, map: barkTexFor(color) }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function leafTexFor(color) {
  const key = typeof color === 'number' ? color.toString(16) : String(color);
  // makeBlockTexture tự cache theo key nên không cần Map riêng ở đây
  const tex = makeBlockTexture('leaf-' + key, { grain: 0.16, border: 0.2, speckle: 0.4, speckleDepth: 0.22 });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function leafBox(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  tileUV(geo, w, h, d);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, map: leafTexFor(color) }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, map: objTexFor(color), ...opts })
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rTop, rBot, h, color, seg = 10, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, seg),
    new THREE.MeshLambertMaterial({ color, map: objTexFor(color), ...opts })
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ===== ĐO VÙNG VA CHẠM TRỰC TIẾP TỪ HÌNH HỌC ĐÃ DỰNG =====
// Duyệt TOÀN BỘ đỉnh của mọi mesh con (kể cả InstancedMesh) sau khi đã áp dụng đầy đủ mọi phép biến đổi thật
// (xoay yaw + nghiêng + scale + vị trí), nên kết quả luôn khớp CHÍNH XÁC hình khối người chơi nhìn thấy —
// không còn phụ thuộc việc tính tay bằng lượng giác cho từng kiểu xoay (nguồn gốc mọi lỗi va chạm lệch trước đây).
//
// Mỗi vật được bao bởi giao của `sides` nửa mặt phẳng, pháp tuyến chia đều quanh trục đứng bắt đầu từ baseAngle:
//   sides = 4, baseAngle = yaw  → hình chữ nhật/vuông XOAY THEO vật (khít tuyệt đối với vật khối hộp)
//   sides = 6, baseAngle = yaw  → lục giác (dùng cho vật tròn — bám sát đường tròn hơn hẳn hình chữ nhật bao ngoài)
// Vì mỗi khoảng cách dists[k] lấy đúng bằng hình chiếu XA NHẤT của đỉnh thật lên pháp tuyến k, đa giác thu được
// là đa giác NHỎ NHẤT có bộ pháp tuyến đó mà vẫn bao trọn vật — không thừa, và tuyệt đối không thiếu.
//
// Trả về { normals:[{x,z}], dists:[số] } trong TOẠ ĐỘ THẾ GIỚI. Quy ước: điểm p nằm TRONG đa giác khi và chỉ khi
// dot(p - (cx,cz), normals[k]) <= dists[k] với MỌI k.
const _mv = new THREE.Vector3();
const _mmA = new THREE.Matrix4();
const _mmB = new THREE.Matrix4();

function eachVertexXZ(root, fn) {
  // Cập nhật ma trận của CHUỖI TỔ TIÊN trước (root có thể là mesh con nằm sâu trong nhóm vừa dựng, lúc này
  // ma trận thế giới của cha/ông chưa được tính) rồi mới cập nhật cả nhánh con của root — nếu bỏ bước này,
  // toạ độ đo được sẽ thiếu phép xoay/dời của nhóm cha và vùng va chạm lại lệch đúng kiểu lỗi cũ.
  const chain = [];
  for (let o = root; o; o = o.parent) chain.push(o);
  for (let i = chain.length - 1; i >= 0; i--) {
    const o = chain[i];
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o.parent) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    else o.matrixWorld.copy(o.matrix);
  }
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const pos = o.geometry?.attributes?.position;
    // bỏ qua hiệu ứng trang trí không phải vật cản (hạt lấp lánh, ánh sáng...) — chúng không có mặt để đứng lên
    if (!pos || o.userData?.noCollide) return;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _mmA);
        _mmB.multiplyMatrices(o.matrixWorld, _mmA);
        for (let v = 0; v < pos.count; v++) { _mv.fromBufferAttribute(pos, v).applyMatrix4(_mmB); fn(_mv.x, _mv.z, _mv.y); }
      }
    } else if (o.isMesh) {
      for (let v = 0; v < pos.count; v++) { _mv.fromBufferAttribute(pos, v).applyMatrix4(o.matrixWorld); fn(_mv.x, _mv.z, _mv.y); }
    }
  });
}

// Bao lồi (convex hull) của tập điểm mặt bằng — thuật toán Andrew monotone chain.
// Đây là ĐA GIÁC LỒI NHỎ NHẤT chứa toàn bộ hình khối: không thể khít hơn nữa mà vẫn bao trọn.
function convexHullXZ(pts) {
  const P = [];
  for (let i = 0; i < pts.length; i += 2) P.push({ x: pts[i], z: pts[i + 1] });
  P.sort((u, v) => (u.x - v.x) || (u.z - v.z));
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

// Rút gọn đa giác lồi xuống tối đa `maxSides` cạnh mà VẪN BAO TRỌN hình cũ: mỗi bước bỏ đi một cạnh và kéo dài
// hai cạnh kề cho tới khi chúng cắt nhau; luôn chọn cạnh mà việc bỏ nó làm phình ra ít diện tích nhất.
function simplifyHull(h, maxSides) {
  const inter = (a1, a2, b1, b2) => { // giao điểm của đường thẳng a1a2 và b1b2
    const dax = a2.x - a1.x, daz = a2.z - a1.z, dbx = b2.x - b1.x, dbz = b2.z - b1.z;
    const det = dax * dbz - daz * dbx;
    if (Math.abs(det) < 1e-9) return null; // song song — không rút gọn được ở đây
    const t = ((b1.x - a1.x) * dbz - (b1.z - a1.z) * dbx) / det;
    return { x: a1.x + dax * t, z: a1.z + daz * t };
  };
  while (h.length > maxSides) {
    let bestI = -1, bestAdd = Infinity, bestP = null;
    for (let i = 0; i < h.length; i++) {
      const n = h.length;
      const p0 = h[(i - 1 + n) % n], p1 = h[i], p2 = h[(i + 1) % n], p3 = h[(i + 2) % n];
      const q = inter(p0, p1, p2, p3);
      if (!q) continue;
      const add = Math.abs((p1.x - q.x) * (p2.z - q.z) - (p2.x - q.x) * (p1.z - q.z)) / 2;
      if (add < bestAdd) { bestAdd = add; bestI = i; bestP = q; }
    }
    if (bestI < 0) break;
    const n = h.length;
    const next = (bestI + 1) % n;
    h[bestI] = bestP;
    h.splice(next, 1);
    if (next === 0) h.push(h.shift()); // giữ đúng thứ tự vòng sau khi xoá phần tử đầu
  }
  return h;
}

// ĐO VÙNG VA CHẠM: bao lồi của hình khối THẬT, rút gọn tối đa `maxSides` cạnh, trả về dạng nửa mặt phẳng.
// Khối hộp cho ra đúng 4 cạnh → va chạm là HÌNH CHỮ NHẬT/VUÔNG khớp tuyệt đối với khối hộp đó.
// Vật tròn cho ra đa giác đều theo `maxSides` (vd 6 → lục giác) bao sát mặt tròn.
export function measureFootprint(root, maxSides = 8, cx = 0, cz = 0) {
  let h = convexHullXZ(collectXZ(root));
  if (h.length < 3) return { normals: [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }], dists: [0, 0, 0, 0], reach: 0 };
  h = simplifyHull(h, maxSides);

  // tâm hình để xác định chiều "ra ngoài" của pháp tuyến từng cạnh
  let mx = 0, mz = 0;
  for (const p of h) { mx += p.x; mz += p.z; }
  mx /= h.length; mz /= h.length;

  const normals = [], dists = [];
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    let nx = b.z - a.z, nz = -(b.x - a.x);           // pháp tuyến của cạnh
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    if ((mx - a.x) * nx + (mz - a.z) * nz > 0) { nx = -nx; nz = -nz; } // luôn hướng RA NGOÀI
    normals.push({ x: nx, z: nz });
    dists.push((a.x - cx) * nx + (a.z - cz) * nz);
  }
  let reach = 0;
  for (const p of h) { const d = Math.hypot(p.x - cx, p.z - cz); if (d > reach) reach = d; }
  return { normals, dists, reach };
}

function collectXZ(root) {
  const pts = [];
  eachVertexXZ(root, (x, z) => { pts.push(x, z); });
  return pts;
}

// đỉnh cao nhất đo từ hình học thật (bỏ qua hiệu ứng trang trí) — cho chiều cao khối va chạm
export function measureTopY(root) {
  let top = -Infinity;
  eachVertexXZ(root, (x, z, y) => { if (y > top) top = y; });
  return isFinite(top) ? top : 0;
}

// ===== Nhân vật — 4 mẫu khác biệt rõ (tỉ lệ, mũ/tóc, hoa văn, phụ kiện), khớp vai/khuỷu/hông =====
export const CHAR_SKINS = [
  { name: 'Fern', skin: 0xf2c9a1, shirt: 0x7fb069, sleeve: 0x6da058, pants: 0x5a6e8c, shoe: 0x40506a, hair: 0x4a3628,
    scaleW: 1.0, scaleH: 1.0, style: 'mien' },   // nón lá rơm + túi đeo chéo + hoa văn lá
  { name: 'Wolf', skin: 0xe8b98a, shirt: 0x8a4f42, sleeve: 0x74423a, pants: 0x4a4a5a, shoe: 0x36363f, hair: 0x555a60,
    scaleW: 1.22, scaleH: 1.06, style: 'soi' },  // vạm vỡ + mũ trùm tai sói + khăn choàng đỏ
  { name: 'Rabbit', skin: 0xf7d7bc, shirt: 0xc98bb5, sleeve: 0xb779a3, pants: 0x8c6e5a, shoe: 0x6a5244, hair: 0xe0d0b0,
    scaleW: 0.88, scaleH: 0.9, style: 'tho' },   // nhỏ nhắn + bờm tai thỏ + ba lô + áo kẻ sọc
  { name: 'Bear', skin: 0xd9a878, shirt: 0x5a8cae, sleeve: 0x4a7a9a, pants: 0x3c5a2e, shoe: 0x2c4220, hair: 0x6e4a28,
    scaleW: 1.32, scaleH: 1.12, style: 'gau' },  // to cao + mũ tai gấu + áo gi-lê cúc đồng
];

export function buildCharacter(i) {
  const s = CHAR_SKINS[i % CHAR_SKINS.length];
  const g = new THREE.Group();

  // chân: khớp hông — đùi / bắp chân / giày
  const makeLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.14, 0.5, 0);
    const thigh = box(0.2, 0.26, 0.24, s.pants); thigh.position.y = -0.13;
    const calf = box(0.17, 0.22, 0.2, s.pants); calf.position.y = -0.37;
    const shoe = box(0.2, 0.12, 0.3, s.shoe); shoe.position.set(0, -0.54, 0.03);
    leg.add(thigh, calf, shoe);
    return leg;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);

  const body = box(0.55, 0.55, 0.32, s.shirt); body.position.y = 0.78;
  const belt = box(0.56, 0.08, 0.33, s.shoe); belt.position.y = 0.52;

  // tay 2 khớp: vai (arm) → khuỷu (fore) → bàn tay + ổ cắm vũ khí
  const makeArm = (side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.02, 0);
    const upper = box(0.16, 0.3, 0.2, s.sleeve); upper.position.y = -0.15;
    const fore = new THREE.Group();
    fore.position.y = -0.3;                    // khớp khuỷu tay
    const foreM = box(0.14, 0.24, 0.17, s.skin); foreM.position.y = -0.12;
    const hand = box(0.15, 0.13, 0.16, s.skin); hand.position.y = -0.28;
    const socket = new THREE.Group();          // vũ khí gắn vào đây — luôn giữ góc cố định với cẳng tay
    socket.position.y = -0.3;
    fore.add(foreM, hand, socket);
    arm.add(upper, fore);
    arm.userData = { fore, socket };
    return arm;
  };
  const armL = makeArm(-1), armR = makeArm(1);

  // đầu: mọi chi tiết mặt/mũ/tóc/tai gắn LÀM CON của head để khi xoay đầu (ngắm súng) cả cụm xoay theo liền khối,
  // không bị tách rời khỏi khối đầu — tọa độ các chi tiết dưới đây đã quy về hệ tọa độ cục bộ của head (trừ 1.28)
  const head = box(0.42, 0.4, 0.4, s.skin); head.position.y = 1.28;
  const eyeL = box(0.06, 0.07, 0.02, 0x222222); eyeL.position.set(-0.1, 0.02, 0.21);
  const eyeR = box(0.06, 0.07, 0.02, 0x222222); eyeR.position.set(0.1, 0.02, 0.21);
  const mouth = box(0.1, 0.03, 0.02, 0xa8705a); mouth.position.set(0, -0.11, 0.21);
  head.add(eyeL, eyeR, mouth);
  g.add(legL, legR, body, belt, armL, armR, head);

  // ===== nét riêng từng mẫu =====
  // mũ/tóc/tai/khăn riêng của từng mẫu là ĐẶC TRƯNG DUY NHẤT để nhận diện nhân vật — không ẩn đi khi mặc
  // giáp nữa. Giáp (armorGroup bên dưới) bỏ hẳn phần mũ giáp che đầu, chỉ còn ngực/vai/gối/cổ giáp thấp hơn
  // cằm, nên không còn khối nào chồng lên mũ/tóc/tai để phải ẩn. hideWithArmor giờ chỉ giữ lại phụ kiện
  // vùng NGỰC/VAI thực sự đè lên tấm giáp ngực (ví dụ khăn choàng), không đụng tới bất cứ gì trên đầu.
  const hideWithArmor = [];
  if (s.style === 'mien') {
    const hair = box(0.46, 0.14, 0.44, s.hair); hair.position.y = 0.22;
    const brim = cyl(0.55, 0.55, 0.06, 0xd9c28a, 10); brim.position.y = 0.27;
    const cone = cyl(0.02, 0.4, 0.28, 0xe8d49a, 10); cone.position.y = 0.42;   // nón lá
    head.add(hair, brim, cone);
    const strap = box(0.08, 0.5, 0.34, 0x8a5a2e); strap.position.set(0, 0.85, 0); strap.rotation.z = 0.6; // dây túi chéo
    const bag = box(0.22, 0.26, 0.12, 0x8a5a2e); bag.position.set(-0.3, 0.6, -0.2);
    for (let k = 0; k < 3; k++) { // hoa văn lá trên áo
      const leaf = box(0.07, 0.1, 0.02, 0x4f7a40);
      leaf.position.set(-0.12 + k * 0.12, 0.8 - (k % 2) * 0.12, 0.17);
      g.add(leaf);
    }
    g.add(strap, bag);
  } else if (s.style === 'soi') {
    const hood = box(0.5, 0.2, 0.46, s.hair); hood.position.y = 0.24;         // mũ trùm
    const hoodB = box(0.5, 0.34, 0.14, s.hair); hoodB.position.set(0, 0.06, -0.2);
    const earL = box(0.1, 0.22, 0.08, s.hair); earL.position.set(-0.18, 0.44, 0); earL.rotation.z = 0.2; // tai sói
    const earR = box(0.1, 0.22, 0.08, s.hair); earR.position.set(0.18, 0.44, 0); earR.rotation.z = -0.2;
    const earTipL = box(0.06, 0.08, 0.05, 0xd8dade); earTipL.position.set(-0.2, 0.57, 0);
    const earTipR = box(0.06, 0.08, 0.05, 0xd8dade); earTipR.position.set(0.2, 0.57, 0);
    const scar = box(0.03, 0.12, 0.02, 0xb08a6a); scar.position.set(0.14, 0.04, 0.212); scar.rotation.z = 0.4; // sẹo má
    head.add(hood, hoodB, earL, earR, earTipL, earTipR, scar);
    const scarf = box(0.5, 0.14, 0.4, 0xc9505a); scarf.position.y = 1.06;      // khăn choàng đỏ — quàng vai, không theo đầu xoay
    const scarfTail = box(0.14, 0.34, 0.06, 0xc9505a); scarfTail.position.set(0.16, 0.84, -0.2); scarfTail.rotation.x = 0.25;
    g.add(scarf, scarfTail);
    hideWithArmor.push(scarf, scarfTail); // nằm ngay vùng cổ giáp/viền ngực — vẫn phải ẩn để tránh chồng mesh
  } else if (s.style === 'tho') {
    const band = box(0.46, 0.1, 0.44, 0xfefefe); band.position.y = 0.22;        // bờm tai thỏ
    const rEarL = box(0.09, 0.34, 0.06, 0xfefefe); rEarL.position.set(-0.13, 0.44, 0); rEarL.rotation.z = 0.12;
    const rEarR = box(0.09, 0.34, 0.06, 0xfefefe); rEarR.position.set(0.13, 0.44, 0); rEarR.rotation.z = -0.12;
    const inL = box(0.04, 0.24, 0.03, 0xf2a5b5); inL.position.set(-0.13, 0.44, 0.03); inL.rotation.z = 0.12;
    const inR = box(0.04, 0.24, 0.03, 0xf2a5b5); inR.position.set(0.13, 0.44, 0.03); inR.rotation.z = -0.12;
    head.add(band, rEarL, rEarR, inL, inR);
    for (let k = 0; k < 2; k++) { // áo kẻ sọc ngang
      const stripe = box(0.56, 0.07, 0.33, 0xfefefe);
      stripe.position.y = 0.68 + k * 0.18;
      g.add(stripe);
    }
    const pack = box(0.34, 0.36, 0.16, 0xd9a83c); pack.position.set(0, 0.85, -0.26);  // ba lô
    const packLid = box(0.34, 0.12, 0.18, 0xc4922e); packLid.position.set(0, 1.06, -0.26);
    g.add(pack, packLid);
  } else {
    const cap = box(0.48, 0.16, 0.46, s.hair); cap.position.y = 0.24;          // mũ tai gấu tròn
    const bEarL = cyl(0.09, 0.09, 0.06, s.hair, 8); bEarL.rotation.x = Math.PI / 2; bEarL.position.set(-0.2, 0.38, 0);
    const bEarR = cyl(0.09, 0.09, 0.06, s.hair, 8); bEarR.rotation.x = Math.PI / 2; bEarR.position.set(0.2, 0.38, 0);
    head.add(cap, bEarL, bEarR);
    const vestL = box(0.16, 0.5, 0.35, 0x3c5a2e); vestL.position.set(-0.2, 0.78, 0.01);   // gi-lê
    const vestR = box(0.16, 0.5, 0.35, 0x3c5a2e); vestR.position.set(0.2, 0.78, 0.01);
    const btn1 = cyl(0.03, 0.03, 0.03, 0xd9a83c, 6); btn1.rotation.x = Math.PI / 2; btn1.position.set(-0.2, 0.88, 0.19);
    const btn2 = cyl(0.03, 0.03, 0.03, 0xd9a83c, 6); btn2.rotation.x = Math.PI / 2; btn2.position.set(-0.2, 0.72, 0.19);
    const buckle = box(0.12, 0.1, 0.03, 0xd9a83c); buckle.position.set(0, 0.52, 0.17);    // khóa thắt lưng đồng
    g.add(vestL, vestR, btn1, btn2, buckle);
  }

  // ===== giáp — 4 kiểu màu sắc + họa tiết huy hiệu riêng theo từng mẫu (đồng bộ với tông màu sẵn có của
  // mẫu đó: lá/nón mien, khăn đỏ soi, tai hồng tho, gi-lê xanh rêu gau) thay vì 1 kiểu xám dùng chung cho
  // tất cả. KHÔNG còn mũ giáp che đầu — chỉ ngực/vai/gối/cổ giáp thấp hơn cằm, nên mũ/tóc/tai riêng của
  // từng nhân vật luôn hiển thị rõ. Khung giáp mọi chỗ đều chủ động lớn hơn khung cơ thể/chân bên dưới
  // (ví dụ giáp ngực 0.7×0.54×0.46 so với thân 0.55×0.55×0.32) để bọc ra ngoài gọn gàng, không z-fighting.
  const ARMOR_STYLE = {
    mien: { main: 0x6a9c5a, dark: 0x4f7a40, trim: 0xd9c28a, emblem: 'diamond' }, // giáp lá rừng — đồng/ngọc, khớp nón lá
    soi:  { main: 0x3a3a42, dark: 0x26262c, trim: 0xc9505a, emblem: 'fang' },    // giáp sắt đen — viền đỏ khớp khăn choàng
    tho:  { main: 0xe8e2d8, dark: 0xc9bfae, trim: 0xf2a5b5, emblem: 'gem' },     // giáp ngọc trai — viền hồng khớp tai thỏ
    gau:  { main: 0xb08040, dark: 0x8a5f2e, trim: 0x3c5a2e, emblem: 'cross' },   // giáp đồng nặng — viền xanh rêu khớp gi-lê
  };
  const ap = ARMOR_STYLE[s.style];
  const armorC = ap.main, armorD = ap.dark, trim = ap.trim;
  const armorGroup = new THREE.Group();
  const plate = box(0.7, 0.54, 0.46, armorC); plate.position.y = 0.8;
  const ridge = box(0.1, 0.54, 0.48, armorD); ridge.position.y = 0.8;                      // gân giữa ngực
  const trimTop = box(0.72, 0.05, 0.48, trim); trimTop.position.y = 1.04;                  // viền trên/dưới
  const trimBot = box(0.72, 0.05, 0.48, trim); trimBot.position.y = 0.56;
  const gorget = box(0.46, 0.08, 0.42, armorD); gorget.position.y = 1.1;                   // cổ giáp — nằm sát dưới cằm, không đụng mũ/tóc phía trên
  for (const [rx, ry] of [[-0.26, 0.98], [0.26, 0.98], [-0.26, 0.63], [0.26, 0.63]]) {     // 4 đinh tán
    const rivet = box(0.05, 0.05, 0.03, 0xe8eef4);
    rivet.position.set(rx, ry, 0.245);
    armorGroup.add(rivet);
  }
  // huy hiệu ngực — không chỉ đổi màu mà đổi cả hình dạng theo từng mẫu
  if (ap.emblem === 'diamond') {
    const emblem = box(0.14, 0.14, 0.03, trim); emblem.position.set(0, 0.86, 0.25); emblem.rotation.z = Math.PI / 4;
    armorGroup.add(emblem);
  } else if (ap.emblem === 'fang') {
    const f1 = box(0.05, 0.17, 0.03, trim); f1.position.set(-0.04, 0.86, 0.25); f1.rotation.z = 0.5;
    const f2 = box(0.05, 0.17, 0.03, trim); f2.position.set(0.04, 0.86, 0.25); f2.rotation.z = -0.5;
    armorGroup.add(f1, f2);
  } else if (ap.emblem === 'gem') {
    const gem = cyl(0.08, 0.08, 0.05, trim, 8); gem.rotation.x = Math.PI / 2; gem.position.set(0, 0.86, 0.25);
    armorGroup.add(gem);
  } else {
    const c1 = box(0.15, 0.05, 0.03, trim); c1.position.set(0, 0.86, 0.25);
    const c2 = box(0.05, 0.15, 0.03, trim); c2.position.set(0, 0.86, 0.25);
    armorGroup.add(c1, c2);
  }
  const makePauldron = (side) => {   // giáp vai 2 lớp
    const p1 = box(0.32, 0.15, 0.36, armorC); p1.position.set(side * 0.43, 1.1, 0);
    const p2 = box(0.26, 0.13, 0.3, armorD); p2.position.set(side * 0.47, 1.0, 0);
    const spike = box(0.06, 0.12, 0.06, trim); spike.position.set(side * 0.43, 1.21, 0);
    armorGroup.add(p1, p2, spike);
  };
  makePauldron(-1); makePauldron(1);
  const kneeL = box(0.24, 0.13, 0.28, armorD); kneeL.position.set(-0.14, 0.28, 0.02);      // giáp gối — lớn hơn ống chân bên dưới
  const kneeR = box(0.24, 0.13, 0.28, armorD); kneeR.position.set(0.14, 0.28, 0.02);
  armorGroup.add(plate, ridge, trimTop, trimBot, gorget, kneeL, kneeR);
  armorGroup.visible = false;
  g.add(armorGroup);

  // tỉ lệ cơ thể khác nhau theo mẫu
  g.scale.set(s.scaleW, s.scaleH, s.scaleW);

  g.userData = {
    legL, legR, armL, armR, head, armorGroup, hideWithArmor,
    foreL: armL.userData.fore, foreR: armR.userData.fore,
    socketL: armL.userData.socket, socketR: armR.userData.socket,
  };
  return g; // gốc tại bàn chân
}

// Vũ khí cầm tay (gắn vào bàn tay phải — y ≈ -0.58 trong nhóm tay)
export function buildSword() {
  const g = new THREE.Group();
  const blade = box(0.07, 0.72, 0.05, 0xd8e4ea); blade.position.y = 0.5;
  const edge = box(0.03, 0.72, 0.06, 0xf0f6fa); edge.position.set(-0.03, 0.5, 0);
  const guard = box(0.24, 0.06, 0.08, 0xc9a227); guard.position.y = 0.12;
  const grip = box(0.07, 0.18, 0.07, 0x5a3c1e); grip.position.y = 0;
  const pommel = box(0.09, 0.06, 0.09, 0xc9a227); pommel.position.y = -0.1;
  g.add(blade, edge, guard, grip, pommel);
  return g;
}
export function buildGun() {
  const g = new THREE.Group();
  const barrel = box(0.07, 0.07, 0.42, 0x555a60); barrel.position.set(0, 0.1, 0.22);
  const muzzle = box(0.09, 0.09, 0.06, 0x3c4046); muzzle.position.set(0, 0.1, 0.44);
  const bodyG = box(0.1, 0.14, 0.22, 0x777d85); bodyG.position.y = 0.05;
  const sight = box(0.03, 0.05, 0.03, 0x3c4046); sight.position.set(0, 0.16, 0.1);
  const grip = box(0.08, 0.15, 0.09, 0x5a3c1e); grip.position.set(0, -0.06, -0.04);
  g.add(barrel, muzzle, bodyG, sight, grip);
  return g;
}

// ===== Cây các cỡ, hoa, cỏ, đá =====
export function buildTree(scale = 1) {
  const g = new THREE.Group();
  const h = rand(1.6, 2.6);
  const trunkC = pick([0x8a6a3e, 0x7a5a34, 0x96754a]); // nâu vàng ấm, gần tông ảnh tham khảo
  // thân thon dần lên trên — 2 đoạn thay vì 1 khối trụ đều suốt chiều cao
  const trunkLow = barkBox(0.32, h * 0.6, 0.32, trunkC); trunkLow.position.y = h * 0.3;
  const trunkHigh = barkBox(0.24, h * 0.42, 0.24, trunkC); trunkHigh.position.y = h * 0.6 + h * 0.21;
  g.add(trunkLow, trunkHigh);
  // 1 cành nhỏ chìa ra bên hông cho có nét, giống chi tiết trong ảnh tham khảo
  const branch = barkBox(0.5, 0.09, 0.09, trunkC);
  branch.position.set(-0.28, h * 0.55, 0);
  branch.rotation.z = 0.5;
  g.add(branch);

  const leafMain = pick([0x8fbf7f, 0x7fb069, 0x93c47d]);
  const leafHi = pick([0xa8d494, 0xb0d99e]); // tông sáng hơn — khối đỉnh làm điểm nhấn như trong ảnh
  // tán lá dạng CỤM khối lệch nhau quanh 1 khối đỉnh, thay vì tháp tầng đều — ra dáng bụi lá gộp khối
  const top = leafBox(1.1, 0.95, 1.1, leafHi);
  top.position.y = h + 0.7;
  g.add(top);
  const bumps = randInt(3, 4);
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 + rand(-0.35, 0.35);
    const d = rand(0.5, 0.7);
    const s = rand(0.6, 0.85);
    const b = leafBox(s, s * rand(0.85, 1.1), s, leafMain);
    b.position.set(Math.cos(a) * d, h + 0.32 + rand(-0.1, 0.15), Math.sin(a) * d);
    g.add(b);
  }
  g.scale.setScalar(scale);
  // thân cây là khối hộp VUÔNG → va chạm dùng hình vuông đo từ chính khối thân (xem measureFootprint)
  g.userData.trunkMesh = trunkLow;
  return g;
}
// cây cổ thụ: cùng logic tán CỤM khối như buildTree (không dùng tấm dẹt xếp chồng nữa) — chỉ to hơn, thân
// có thêm rễ, và 2 tầng cụm khối lá thay vì 1 để tán đầy/rộng hơn hẳn cây thường
export function buildBigTree(scale = 1) {
  const g = new THREE.Group();
  const h = rand(3.2, 4.4);
  const trunkC = pick([0x6e4a28, 0x5f3f22]);
  const trunkLow = barkBox(0.56, h * 0.55, 0.56, trunkC); trunkLow.position.y = h * 0.275;
  const trunkHigh = barkBox(0.4, h * 0.5, 0.4, trunkC); trunkHigh.position.y = h * 0.55 + h * 0.25;
  const root1 = barkBox(0.3, 0.6, 0.3, trunkC); root1.position.set(0.34, 0.3, 0.22);
  const root2 = barkBox(0.26, 0.5, 0.26, trunkC); root2.position.set(-0.32, 0.25, -0.18);
  const branch = barkBox(0.6, 0.14, 0.14, trunkC); branch.position.set(-0.36, h * 0.62, 0); branch.rotation.z = 0.5;
  g.add(trunkLow, trunkHigh, root1, root2, branch);

  const leafMain = pick([0x7fb069, 0x6fa860]);
  const leafHi = pick([0x98c47e, 0xa8c98a]); // tông sáng hơn — khối đỉnh làm điểm nhấn, đồng bộ buildTree
  const top = leafBox(1.7, 1.4, 1.7, leafHi);
  top.position.y = h + 1.05;
  g.add(top);
  // tầng cụm khối GIỮA (to) + tầng DƯỚI (thấp hơn, xòe rộng ra) — tạo tán dày, đầy hơn cây thường
  const midBumps = randInt(5, 6);
  for (let i = 0; i < midBumps; i++) {
    const a = (i / midBumps) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = rand(0.9, 1.15);
    const s = rand(1.0, 1.3);
    const b = leafBox(s, s * rand(0.85, 1.05), s, leafMain);
    b.position.set(Math.cos(a) * d, h + 0.55 + rand(-0.15, 0.2), Math.sin(a) * d);
    g.add(b);
  }
  const lowBumps = randInt(3, 4);
  for (let i = 0; i < lowBumps; i++) {
    const a = (i / lowBumps) * Math.PI * 2 + rand(0.3, 0.9);
    const d = rand(0.6, 0.85);
    const s = rand(0.75, 1.0);
    const b = leafBox(s, s * rand(0.85, 1.05), s, leafHi);
    b.position.set(Math.cos(a) * d, h + 0.1 + rand(-0.1, 0.1), Math.sin(a) * d);
    g.add(b);
  }
  g.scale.setScalar(scale);
  // thân cây là khối hộp VUÔNG → va chạm dùng hình vuông đo từ chính khối thân (xem measureFootprint)
  g.userData.trunkMesh = trunkLow;
  return g;
}
export function buildFlower() {
  const g = new THREE.Group();
  const stem = box(0.06, 0.3, 0.06, 0x7fb069); stem.position.y = 0.15;
  const bloom = box(0.18, 0.14, 0.18, pick([0xf2a5b5, 0xf7d060, 0xc98bb5, 0xfefefe, 0xf0946a])); bloom.position.y = 0.36;
  g.add(stem, bloom);
  return g;
}
export function buildGrassTuft() {
  const g = new THREE.Group();
  const c = pick([0x9ecf8a, 0x8fbf7f, 0xa8d494]);
  for (let i = 0; i < 3; i++) {
    const b = box(0.08, rand(0.2, 0.38), 0.08, c);
    b.position.set(rand(-0.15, 0.15), 0.14, rand(-0.15, 0.15));
    b.rotation.z = rand(-0.2, 0.2);
    g.add(b);
  }
  return g;
}
export function buildRock() {
  const g = new THREE.Group();
  const cMain = pick([0xc2c8ce, 0xb6bec6, 0xc4c0cc]); // xám xanh nhạt đúng tông ảnh mẫu
  const cA = pick([0xd0d6da, 0xc8ccd4]);
  const cB = pick([0xbcc4ca, 0xc6c0d0]);
  const rot = rand(0, Math.PI * 2); // CÙNG một góc xoay cho cả 3 khối — "xoay cùng chiều khối chính"

  // khối CHÍNH — khối vuông thường, nhô cao nhất trong cụm; thu nhỏ hẳn cả cụm so với bản trước
  const sMain = rand(0.22, 0.3); // "bán kính" quy ước — bề rộng khối thật = sMain*2
  const hMain = sMain * rand(1.8, 2.3);
  const embedDepth = sMain * 0.35; // chôn xuống đất — dùng chung cho cả 3 khối để chúng "mọc" từ cùng 1 mặt nền
  const main = box(sMain * 2, hMain, sMain * 2, cMain);
  main.position.y = hMain / 2 - embedDepth;
  main.rotation.y = rot;
  g.add(main);

  // khối phụ lệch TRÁI/PHẢI — bề ngang KHÔNG nhỏ hơn khối chính, thấp hơn khối chính, cùng góc xoay, đặt
  // sát khối chính (chồng lấn nhiều) để chỉ thò ra một chút thay vì lộ ra cả nửa khối như trước
  const sA = sMain * rand(1.0, 1.15);
  const hA = hMain * rand(0.45, 0.65);
  const sideDir = chance(0.5) ? 1 : -1;
  const offA = (sMain + sA) * 0.22;
  const a = box(sA * 2, hA, sA * 2, cA);
  a.position.set(sideDir * offA, hA / 2 - embedDepth, rand(-sMain * 0.15, sMain * 0.15));
  a.rotation.y = rot;
  g.add(a);

  // khối phụ lệch TRƯỚC/SAU — cũng không nhỏ hơn khối chính, cùng góc xoay, độ cao khác hẳn khối lệch trái/phải,
  // cũng chỉ thò ra một chút như khối lệch trái/phải
  const sB = sMain * rand(1.0, 1.15);
  let hB = hMain * rand(0.3, 0.5);
  if (Math.abs(hB - hA) < hMain * 0.1) hB = hMain * (hB < hA ? 0.3 : 0.55); // ép chênh lệch rõ với khối lệch trái/phải
  const frontDir = chance(0.5) ? 1 : -1;
  const offB = (sMain + sB) * 0.22;
  const b = box(sB * 2, hB, sB * 2, cB);
  b.position.set(rand(-sMain * 0.15, sMain * 0.15), hB / 2 - embedDepth, frontDir * offB);
  b.rotation.y = rot;
  g.add(b);

  // vùng va chạm không khai báo ở đây nữa — world.js đo trực tiếp bao lồi của cụm 3 khối bằng measureFootprint
  // (công thức cũ max(sMain, offA+sA*0.5, ...) là trụ tròn tính tay, bỏ qua cả góc xoay lẫn hình dạng cụm)
  g.userData.hitH = hMain - embedDepth;
  return g;
}

// ===== Thỏ trang trí — nhảy loanh quanh trên đảo =====
export function buildRabbit() {
  const g = new THREE.Group();
  const c = pick([0xf5f0e8, 0xd9c8b0, 0xb0a08a]);
  const body = box(0.3, 0.24, 0.4, c); body.position.set(0, 0.16, 0);
  const head = box(0.22, 0.2, 0.2, c); head.position.set(0, 0.32, 0.24);
  const earL = box(0.05, 0.2, 0.04, c); earL.position.set(-0.06, 0.5, 0.22); earL.rotation.x = -0.15;
  const earR = box(0.05, 0.2, 0.04, c); earR.position.set(0.06, 0.5, 0.22); earR.rotation.x = -0.15;
  const inEarL = box(0.02, 0.12, 0.02, 0xf2a5b5); inEarL.position.set(-0.06, 0.5, 0.24);
  const inEarR = box(0.02, 0.12, 0.02, 0xf2a5b5); inEarR.position.set(0.06, 0.5, 0.24);
  const tail = box(0.1, 0.1, 0.1, 0xffffff); tail.position.set(0, 0.18, -0.22);
  const eyeL = box(0.03, 0.03, 0.02, 0x222222); eyeL.position.set(-0.08, 0.34, 0.34);
  const eyeR = box(0.03, 0.03, 0.02, 0x222222); eyeR.position.set(0.08, 0.34, 0.34);
  const nose = box(0.04, 0.03, 0.02, 0xe08a9a); nose.position.set(0, 0.28, 0.35);
  g.add(body, head, earL, earR, inEarL, inEarR, tail, eyeL, eyeR, nose);
  return g;
}

// ===== Mèo trang trí — đi loanh quanh trên đảo =====
export function buildCat() {
  const g = new THREE.Group();
  const c = pick([0x4a4a4a, 0xe0a868, 0xf5f0e8, 0x8a6a52]);
  const body = box(0.26, 0.2, 0.42, c); body.position.set(0, 0.16, 0);
  const head = box(0.2, 0.18, 0.18, c); head.position.set(0, 0.3, 0.25);
  const earL = box(0.07, 0.09, 0.03, c); earL.position.set(-0.06, 0.42, 0.24); earL.rotation.z = -0.15;
  const earR = box(0.07, 0.09, 0.03, c); earR.position.set(0.06, 0.42, 0.24); earR.rotation.z = 0.15;
  const tail = box(0.05, 0.05, 0.3, c); tail.position.set(0, 0.24, -0.28); tail.rotation.x = -0.5;
  const legL1 = box(0.06, 0.14, 0.06, c); legL1.position.set(-0.09, 0.07, 0.14);
  const legR1 = box(0.06, 0.14, 0.06, c); legR1.position.set(0.09, 0.07, 0.14);
  const legL2 = box(0.06, 0.14, 0.06, c); legL2.position.set(-0.09, 0.07, -0.14);
  const legR2 = box(0.06, 0.14, 0.06, c); legR2.position.set(0.09, 0.07, -0.14);
  const eyeL = box(0.03, 0.03, 0.02, 0x3a7a4a); eyeL.position.set(-0.06, 0.31, 0.34);
  const eyeR = box(0.03, 0.03, 0.02, 0x3a7a4a); eyeR.position.set(0.06, 0.31, 0.34);
  const nose = box(0.03, 0.02, 0.02, 0xe08a9a); nose.position.set(0, 0.27, 0.35);
  g.add(body, head, earL, earR, tail, legL1, legR1, legL2, legR2, eyeL, eyeR, nose);
  return g;
}

// ===== Chó trang trí — đi loanh quanh trên đảo =====
export function buildDog() {
  const g = new THREE.Group();
  const c = pick([0xd9a868, 0x8a6a4a, 0xf5ecdc, 0x6a5040]);
  const body = box(0.3, 0.24, 0.5, c); body.position.set(0, 0.19, 0);
  const head = box(0.22, 0.2, 0.2, c); head.position.set(0, 0.34, 0.3);
  const snout = box(0.12, 0.1, 0.12, c); snout.position.set(0, 0.3, 0.42);
  const earL = box(0.06, 0.16, 0.05, 0x5a4030); earL.position.set(-0.11, 0.38, 0.26); earL.rotation.z = -0.2;
  const earR = box(0.06, 0.16, 0.05, 0x5a4030); earR.position.set(0.11, 0.38, 0.26); earR.rotation.z = 0.2;
  const tail = box(0.06, 0.06, 0.26, c); tail.position.set(0, 0.28, -0.32); tail.rotation.x = 0.4;
  const legL1 = box(0.07, 0.18, 0.07, c); legL1.position.set(-0.1, 0.09, 0.16);
  const legR1 = box(0.07, 0.18, 0.07, c); legR1.position.set(0.1, 0.09, 0.16);
  const legL2 = box(0.07, 0.18, 0.07, c); legL2.position.set(-0.1, 0.09, -0.16);
  const legR2 = box(0.07, 0.18, 0.07, c); legR2.position.set(0.1, 0.09, -0.16);
  const eyeL = box(0.03, 0.03, 0.02, 0x222222); eyeL.position.set(-0.07, 0.36, 0.4);
  const eyeR = box(0.03, 0.03, 0.02, 0x222222); eyeR.position.set(0.07, 0.36, 0.4);
  const nose = box(0.04, 0.03, 0.02, 0x222222); nose.position.set(0, 0.3, 0.48);
  g.add(body, head, snout, earL, earR, tail, legL1, legR1, legL2, legR2, eyeL, eyeR, nose);
  return g;
}

// ===== Gà trang trí — đi loanh quanh trên đảo =====
export function buildChicken() {
  const g = new THREE.Group();
  const c = pick([0xf5f0e8, 0xc98a4a, 0x6a4a3a]);
  const body = box(0.22, 0.24, 0.26, c); body.position.set(0, 0.28, 0);
  // đầu gộp thành 1 nhóm riêng (đầu+mào+mỏ+tích+mắt) để xoay được nguyên khối khi mổ mổ
  const headGroup = new THREE.Group(); headGroup.position.set(0, 0.46, 0.1);
  const head = box(0.14, 0.14, 0.14, c); head.position.set(0, 0, 0);
  const comb = box(0.03, 0.08, 0.1, 0xd9505a); comb.position.set(0, 0.09, -0.02);
  const beak = box(0.06, 0.04, 0.06, 0xe8a838); beak.position.set(0, -0.02, 0.08);
  const wattle = box(0.03, 0.05, 0.04, 0xd9505a); wattle.position.set(0, -0.06, 0.04);
  const eyeL = box(0.02, 0.02, 0.02, 0x222222); eyeL.position.set(-0.05, 0.02, 0.06);
  const eyeR = box(0.02, 0.02, 0.02, 0x222222); eyeR.position.set(0.05, 0.02, 0.06);
  headGroup.add(head, comb, beak, wattle, eyeL, eyeR);
  const tail = box(0.1, 0.2, 0.04, c); tail.position.set(0, 0.36, -0.14); tail.rotation.x = 0.6;
  const legL = box(0.03, 0.16, 0.03, 0xe8a838); legL.position.set(-0.05, 0.08, 0);
  const legR = box(0.03, 0.16, 0.03, 0xe8a838); legR.position.set(0.05, 0.08, 0);
  g.add(body, headGroup, tail, legL, legR);
  g.userData = { head: headGroup };
  return g;
}

// ===== Cá voi ngoài khơi — đầu to phía trước, thon dần về đuôi, đuôi xòe cong chữ V =====
export function buildWhale() {
  const g = new THREE.Group();
  const skin = 0x3a5a70, skin2 = 0x4a6f86, belly = 0xdce8ea;
  const head = box(1.9, 1.3, 1.7, skin); head.position.set(0, -0.1, 1.05);       // đầu — phần to nhất
  const body = box(1.4, 1.05, 1.5, skin2); body.position.set(0, -0.25, -0.5);    // thân giữa, thon dần
  const tailBase = box(0.85, 0.65, 1.0, skin); tailBase.position.set(0, -0.35, -1.75); // gốc đuôi, nhỏ hơn nữa
  const bellyPatch = box(1.1, 0.4, 2.6, belly); bellyPatch.position.set(0, -0.75, -0.2); // bụng sáng màu
  const backRidge = box(0.28, 0.35, 2.3, skin); backRidge.position.set(0, 0.5, -0.1);    // gờ sống lưng
  const blowhole = box(0.18, 0.1, 0.14, 0x22323c); blowhole.position.set(0, 0.55, 1.4);
  const finL = box(0.12, 0.5, 0.85, skin2); finL.position.set(-0.95, -0.5, -0.2); finL.rotation.z = 0.55;
  const finR = box(0.12, 0.5, 0.85, skin2); finR.position.set(0.95, -0.5, -0.2); finR.rotation.z = -0.55;
  const eyeL = box(0.07, 0.07, 0.06, 0x111111); eyeL.position.set(-0.85, 0, 1.65);
  const eyeR = box(0.07, 0.07, 0.06, 0x111111); eyeR.position.set(0.85, 0, 1.65);
  // đuôi cong xòe chữ V — 2 phiến dẹt nghiêng ra 2 bên như đuôi cá voi thật
  const flukeL = box(0.75, 0.08, 0.55, skin);
  flukeL.position.set(-0.32, 0.05, -2.35); flukeL.rotation.z = 0.4; flukeL.rotation.y = -0.25;
  const flukeR = box(0.75, 0.08, 0.55, skin);
  flukeR.position.set(0.32, 0.05, -2.35); flukeR.rotation.z = -0.4; flukeR.rotation.y = 0.25;
  g.add(head, body, tailBase, bellyPatch, backRidge, blowhole, finL, finR, eyeL, eyeR, flukeL, flukeR);
  return g;
}

// ===== Tia nước phun từ lỗ thở cá voi: 1 tia dọc + các hạt tõe tròn xung quanh ở đỉnh =====
export function buildSpout() {
  const g = new THREE.Group();
  const jetGeo = new THREE.ConeGeometry(0.1, 0.85, 8, 1, true);
  const jetMat = new THREE.MeshBasicMaterial({
    color: 0xe4f4f7, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const jet = new THREE.Mesh(jetGeo, jetMat);
  jet.position.y = 0.42;
  jet.visible = false;
  g.add(jet);

  // các hạt nước tõe ra xung quanh đỉnh tia — hướng + tốc độ ngẫu nhiên cố định từ lúc dựng
  const n = 12;
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const droplets = new THREE.Points(dropGeo, new THREE.PointsMaterial({
    color: 0xe4f4f7, size: 0.09, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  droplets.visible = false;
  const dirs = [];
  for (let i = 0; i < n; i++) {
    dirs.push({ a: (i / n) * Math.PI * 2 + rand(-0.25, 0.25), speed: rand(0.5, 1.1), up: rand(0.4, 0.9) });
  }
  droplets.userData.dirs = dirs;
  g.add(droplets);

  g.userData = { jet, droplets };
  return g;
}
export function buildBush() {
  const g = new THREE.Group();
  const c = pick([0x7fb069, 0x8fbf7f, 0x6fa860]);
  const b1 = box(rand(0.5, 0.8), rand(0.35, 0.5), rand(0.5, 0.8), c); b1.position.y = 0.2;
  const b2 = box(rand(0.3, 0.5), rand(0.25, 0.4), rand(0.3, 0.5), c); b2.position.set(rand(-0.2, 0.2), 0.42, rand(-0.2, 0.2));
  g.add(b1, b2);
  return g;
}

// ===== Cột đá cổ — trả về cả chiều cao va chạm =====
export function buildColumn(state) {
  const g = new THREE.Group();
  const stone = 0xd9cba8, stoneDark = 0xc4b494;
  const base = box(1.3, 0.35, 1.3, stoneDark); base.position.y = 0.17;
  g.add(base);
  const shaft = (h) => {
    const s = cyl(0.42, 0.5, h, stone, 10);
    for (let i = 0; i < 4; i++) {
      const groove = box(0.08, h * 0.85, 0.08, stoneDark);
      const a = (i / 4) * Math.PI * 2;
      groove.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
      s.add(groove);
    }
    return s;
  };
  let hitH = 0.4; // chiều cao khối va chạm
  if (state === 0) {
    const s = shaft(3.8); s.position.y = 2.25; g.add(s);
    const cap = box(1.15, 0.3, 1.15, stoneDark); cap.position.y = 4.3; g.add(cap);
    const cap2 = box(0.95, 0.2, 0.95, stone); cap2.position.y = 4.55; g.add(cap2);
    hitH = 4.6;
  } else if (state === 1) {
    const s = shaft(1.9); s.position.y = 1.3; g.add(s);
    const jag = box(0.5, 0.3, 0.5, stone); jag.position.y = 2.35; jag.rotation.y = 0.5; g.add(jag);
    hitH = 2.4;
  } else {
    const s = shaft(1.2); s.position.y = 0.95; g.add(s);
    const f = cyl(0.4, 0.46, 2.2, stone, 10);
    const fx = rand(1.2, 1.8), fz = rand(0.8, 1.4);
    f.position.set(fx, 0.5, fz);
    f.rotation.z = Math.PI / 2 + rand(-0.25, 0.25);
    f.rotation.y = rand(0, Math.PI);
    g.add(f);
    hitH = 1.6;
    // Phần thân đổ nằm ngang: khối TRỤ NẰM NGANG nên mặt cắt ngang là HÌNH CHỮ NHẬT (dài 2.2 × rộng ~0.92),
    // trước đây gán trụ tròn r=1.15 nên hai bên sườn phình ra thành tường vô hình rộng gấp đôi thân cột thật.
    // Trục nằm sau khi xoay chồng 2 trục (z rồi y) không suy ra được bằng công thức đơn giản → đo hình chữ nhật
    // bao nhỏ nhất trực tiếp từ hình học thật (mesh f đã mang đầy đủ phép xoay).
    g.userData.fallen = { mesh: f, x: fx, z: fz, h: 0.95 };
  }
  g.userData.hitH = hitH;
  // Bán kính va chạm = bán kính THÂN CỘT thật (cyl 0.42→0.5), lấy đúng từ tham số hình học đã dựng ở trên.
  // Bệ đá vuông 1.3×1.3 dưới chân chỉ cao 0.35 (bước qua được) nên không tính vào trụ va chạm — nếu tính,
  // trụ phải phình lên 0.92 và tạo tường vô hình cao suốt thân cột ở chỗ mắt chỉ thấy khoảng không.
  g.userData.hitR = 0.5;
  return g;
}

// ===== Cổng truyền tống: mâm đá chạm khắc + vòng sáng + trụ ánh sáng hắt lên =====
export function buildPortal(color = 0x7fd8e8, scale = 1) {
  const g = new THREE.Group();
  const stone = 0xcfc2a2, stoneDark = 0xb0a488;

  // mâm đá tròn làm bệ đỡ — ánh sáng hắt lên từ chính mâm này
  const platter = cyl(1.5 * scale, 1.62 * scale, 0.16, stone, 26);
  platter.position.y = 0.08;
  platter.receiveShadow = true;
  g.add(platter);
  // rãnh khắc tròn đồng tâm
  const groove = new THREE.Mesh(
    new THREE.TorusGeometry(1.32 * scale, 0.025 * scale, 6, 30),
    new THREE.MeshLambertMaterial({ color: stoneDark })
  );
  groove.rotation.x = -Math.PI / 2; groove.position.y = 0.165;
  g.add(groove);
  // hoa văn chạm khắc quanh viền: khối chữ nhật xen kẽ chấm tròn
  const nCarve = 14;
  for (let i = 0; i < nCarve; i++) {
    const a = (i / nCarve) * Math.PI * 2;
    const r = 1.44 * scale;
    if (i % 2 === 0) {
      const rune = box(0.14 * scale, 0.035, 0.07 * scale, stoneDark);
      rune.position.set(Math.cos(a) * r, 0.168, Math.sin(a) * r);
      rune.rotation.y = -a + Math.PI / 2;
      g.add(rune);
    } else {
      const dot = cyl(0.045 * scale, 0.045 * scale, 0.035, stoneDark, 8);
      dot.position.set(Math.cos(a) * r, 0.168, Math.sin(a) * r);
      g.add(dot);
    }
  }

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.1 * scale, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
  );
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.18;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.15 * scale, 0.1 * scale, 8, 28),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85 * scale, 1.0 * scale, 0.9, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  pillar.position.y = 0.62;
  const pillarCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4 * scale, 0.5 * scale, 0.85, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
  );
  pillarCore.position.y = 0.6;
  const light = new THREE.PointLight(color, 6 * scale, 8 * scale);
  light.position.y = 1.1;
  g.add(disc, ring, pillar, pillarCore, light);
  g.userData.disc = disc;
  g.userData.pillar = pillar;
  return g;
}

// ===== Rương gỗ có nắp, viền kim loại, khóa =====
export function buildChest() {
  const g = new THREE.Group();
  const wood = 0x8a5a2e, woodDark = 0x704822, iron = 0x4a4e55;
  const b = box(0.7, 0.38, 0.5, wood); b.position.y = 0.19;
  const lid = box(0.74, 0.2, 0.54, woodDark); lid.position.y = 0.48;
  const band1 = box(0.09, 0.62, 0.56, iron); band1.position.set(-0.2, 0.3, 0);
  const band2 = box(0.09, 0.62, 0.56, iron); band2.position.set(0.2, 0.3, 0);
  const edgeTop = box(0.76, 0.05, 0.56, iron); edgeTop.position.y = 0.585;
  const lockPlate = box(0.16, 0.18, 0.05, iron); lockPlate.position.set(0, 0.4, 0.27);
  const keyhole = box(0.05, 0.08, 0.02, 0x22242a); keyhole.position.set(0, 0.39, 0.3);
  g.add(b, lid, band1, band2, edgeTop, lockPlate, keyhole);
  return g;
}

// ===== Kho báu đảo đích: nắp vòm cong có đai sắt, bản lề cạnh sau, bật ngửa ra sau =====
export function buildTreasureChest() {
  const g = new THREE.Group();
  const wood = 0x9a6a34, wood2 = 0x835a2a, gold = 0xf5c542, goldHot = 0xffe28a, iron = 0x6a5a30, ironDark = 0x4a3f24;
  const b = box(1.2, 0.6, 0.85, wood); b.position.y = 0.3;
  const band1 = box(0.12, 0.64, 0.9, iron); band1.position.set(-0.35, 0.31, 0);
  const band2 = box(0.12, 0.64, 0.9, iron); band2.position.set(0.35, 0.31, 0);
  // viền mép miệng rương — tách rõ ranh giới thân/nắp thay vì hai khối trơn nối liền
  const rim = box(1.27, 0.07, 0.92, iron); rim.position.y = 0.635;
  // đinh tán góc mặt trước cho chi tiết kim loại
  const plateL = box(0.16, 0.12, 0.04, ironDark); plateL.position.set(-0.35, 0.52, 0.44);
  const plateR = box(0.16, 0.12, 0.04, ironDark); plateR.position.set(0.35, 0.52, 0.44);

  // nắp: bản lề đặt đúng CẠNH SAU MÉP TRÊN của thân rương, bật ngửa ra sau
  // dựng thành vỏ RỖNG (tấm nóc + 2 thành bên + thành trước) thay vì khối đặc — nhìn thấy rõ mặt trong lõm khi nắp mở, đúng dáng một cái nắp thật
  const lid = new THREE.Group();
  lid.position.set(0, 0.67, -0.46);
  const wallH = 0.24, topT = 0.07, sideT = 0.09;
  const lidTop = box(1.26, topT, 0.92, wood2); lidTop.position.set(0, wallH - topT / 2, 0.46);
  const lidFront = box(1.26, wallH, 0.09, wood2); lidFront.position.set(0, wallH / 2, 0.88);
  const lidSideL = box(sideT, wallH, 0.92, wood2); lidSideL.position.set(-0.585, wallH / 2, 0.46);
  const lidSideR = box(sideT, wallH, 0.92, wood2); lidSideR.position.set(0.585, wallH / 2, 0.46);
  const lidBand1 = box(0.14, wallH + 0.02, 0.11, iron); lidBand1.position.set(-0.35, wallH / 2, 0.88);
  const lidBand2 = box(0.14, wallH + 0.02, 0.11, iron); lidBand2.position.set(0.35, wallH / 2, 0.88);
  const lidEdge = box(1.3, 0.06, 0.1, iron); lidEdge.position.set(0, wallH, 0.9); // gờ mép trước, chỗ khóa
  lid.add(lidTop, lidFront, lidSideL, lidSideR, lidBand1, lidBand2, lidEdge);
  lid.rotation.x = -2.0; // bật ngửa ra sau, đứng lên rõ dáng nắp thay vì gần như nằm phẳng lẫn vào đống vàng

  // vàng chất đầy bên trong
  const pile = box(1.05, 0.25, 0.7, gold); pile.position.y = 0.68;
  const pile2 = box(0.7, 0.22, 0.45, goldHot); pile2.position.set(0, 0.85, 0);
  const pile3 = box(0.35, 0.18, 0.3, gold); pile3.position.set(0.1, 0.98, 0.05);
  g.add(b, band1, band2, rim, plateL, plateR, lid, pile, pile2, pile3);
  // đồng vàng & đá quý tràn ra ngay phía trước — cung hẹp thẳng hướng người chơi, không tạt sang hai bên
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 2 + rand(-0.5, 0.5), d = rand(0.45, 0.85);
    const c = cyl(0.1, 0.1, 0.05, gold, 8);
    c.position.set(Math.cos(a) * d, 0.03, Math.sin(a) * d);
    c.rotation.y = rand(0, Math.PI * 2);
    g.add(c);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 2 + rand(-0.45, 0.45), d = rand(0.4, 0.75);
    const gem = box(0.14, 0.14, 0.14, pick([0x6ad8e8, 0xe86ab0, 0x8af57a]));
    gem.position.set(Math.cos(a) * d, 0.08, Math.sin(a) * d);
    gem.rotation.y = rand(0, Math.PI);
    g.add(gem);
  }
  const light = new THREE.PointLight(0xffd76a, 8, 9);
  light.position.y = 1.4;
  g.add(light);
  const n = 40, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), d = rand(0.4, 1.2);
    pos[i * 3] = Math.cos(a) * d; pos[i * 3 + 1] = rand(0.2, 1.8); pos[i * 3 + 2] = Math.sin(a) * d;
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparkle = new THREE.Points(sGeo, new THREE.PointsMaterial({
    color: 0xffe9a0, size: 0.09, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sparkle.userData.noCollide = true; // hạt sáng trang trí — không phải vật cản, không tính vào vùng va chạm
  g.add(sparkle);
  g.userData.sparkle = sparkle;
  return g;
}

export function buildCoin() {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12),
    new THREE.MeshLambertMaterial({ color: 0xf0c24e, emissive: 0x8a6d1e })
  );
  m.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  g.userData.spin = m;
  return g;
}

// ===== Vật thể lơ lửng: đồ vật đời thường =====
// Mỗi builder trả về { group, hw, hd } — mặt đứng được là y=0 của group

function objBook() {
  const g = new THREE.Group();
  const cover = pick([0xc96a5a, 0x5a8cae, 0x7fb069, 0x9b6db0]);
  const pageL = box(1.1, 0.16, 1.5, 0xfdf6e0); pageL.position.set(-0.56, -0.1, 0); pageL.rotation.z = 0.07;
  const pageR = box(1.1, 0.16, 1.5, 0xf7eed6); pageR.position.set(0.56, -0.1, 0); pageR.rotation.z = -0.07;
  const covL = box(1.2, 0.1, 1.6, cover); covL.position.set(-0.6, -0.22, 0); covL.rotation.z = 0.07;
  const covR = box(1.2, 0.1, 1.6, cover); covR.position.set(0.6, -0.22, 0); covR.rotation.z = -0.07;
  const spine = box(0.18, 0.2, 1.6, cover); spine.position.y = -0.22;
  for (let i = 0; i < 3; i++) {
    const line = box(0.7, 0.02, 0.08, 0xb8b0a0);
    line.position.set(-0.5, 0.0, -0.45 + i * 0.4); line.rotation.z = 0.07;
    g.add(line);
  }
  g.add(pageL, pageR, covL, covR, spine);
  // mép ngoài covL/covR (box rộng 1.2, tâm lệch ±0.6) là điểm xa nhất — 0.6+0.6=1.2, không phải 1.15 như trước
  return { group: g, hw: 1.2, hd: 0.82, depth: 0.32 };
}
function objDice() {
  const g = new THREE.Group();
  const s = rand(1.5, 1.8);
  const body = box(s, s, s, 0xfdfdf5); body.position.y = -s / 2;
  g.add(body);
  const dot = (x, y, z) => {
    const d = box(0.18, 0.03, 0.18, 0x333333);
    d.position.set(x, y, z);
    return d;
  };
  const t = -0.015;
  g.add(dot(0, t, 0), dot(-s * 0.28, t, -s * 0.28), dot(s * 0.28, t, -s * 0.28), dot(-s * 0.28, t, s * 0.28), dot(s * 0.28, t, s * 0.28));
  for (let i = -1; i <= 1; i++) {
    const d = box(0.18, 0.18, 0.03, 0x333333);
    d.position.set(i * s * 0.26, -s / 2 + i * s * 0.26, s / 2 + 0.01);
    g.add(d);
  }
  return { group: g, hw: s / 2, hd: s / 2, depth: s };
}
function objBread() {
  const g = new THREE.Group();
  const crumb = box(1.7, 0.32, 1.7, 0xf5e0b8); crumb.position.y = -0.14;
  const crust = box(1.86, 0.36, 1.86, 0xc98a4a); crust.position.y = -0.18;
  g.add(crust, crumb);
  return { group: g, hw: 0.93, hd: 0.93, depth: 0.38 };
}
function objPillow() {
  const g = new THREE.Group();
  const c = pick([0xf2c9d5, 0xcfe3f0, 0xf7ecc9, 0xd9f0cf]);
  const body = box(1.9, 0.45, 1.4, c); body.position.y = -0.24;
  const mid = box(1.5, 0.55, 1.05, c); mid.position.y = -0.22;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const k = box(0.18, 0.18, 0.18, c);
    k.position.set(sx * 1.0, -0.3, sz * 0.75);
    g.add(k);
  }
  g.add(body, mid);
  // góc "khuy" (knot) ở (±1.0, ±0.75) rộng 0.18 là điểm xa nhất — 1.0+0.09=1.09 / 0.75+0.09=0.84
  return { group: g, hw: 1.1, hd: 0.85, depth: 0.5 };
}
function objYarn() {
  const g = new THREE.Group();
  const c = pick([0xe08a9a, 0x8ab0e0, 0xb0e08a, 0xe0c48a]);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), new THREE.MeshLambertMaterial({ color: c }));
  ball.scale.y = 0.75;
  ball.position.y = -0.62;
  ball.castShadow = true;
  g.add(ball);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.045, 6, 20),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    ring.position.y = -0.62;
    ring.scale.y = 0.75;
    ring.rotation.set(rand(0.6, 1.4), rand(0, Math.PI), rand(-0.4, 0.4));
    g.add(ring);
  }
  // round: quả cầu len — vùng va chạm dùng LỤC GIÁC đo từ đỉnh thật (xem measureFootprint), bám sát mặt tròn
  // hơn hẳn hình chữ nhật bao ngoài. hw/hd dưới đây chỉ còn dùng để rải xu/rương trang trí trên mặt vật.
  return { group: g, hw: 1.15, hd: 1.15, depth: 1.26, round: true };
}
function objLog() {
  const g = new THREE.Group();
  const wood = 0x7a5230;
  const trunk = cyl(0.5, 0.5, 2.3, wood, 12);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = -0.5;
  for (const s of [-1, 1]) {
    const face = cyl(0.42, 0.42, 0.04, 0xd9b98a, 12);
    face.rotation.z = Math.PI / 2;
    face.position.set(s * 1.16, -0.5, 0);
    g.add(face);
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 6, 16), new THREE.MeshLambertMaterial({ color: 0xb0906a }));
    ringM.rotation.y = Math.PI / 2;
    ringM.position.set(s * 1.185, -0.5, 0);
    g.add(ringM);
  }
  const knot = cyl(0.12, 0.16, 0.3, wood, 8);
  knot.position.set(rand(-0.5, 0.5), -0.1, 0.2);
  g.add(trunk, knot);
  // mặt cắt gỗ (face) ở x=±1.16 dày thêm 0.02 mới là điểm xa nhất theo X — 1.16+0.02=1.18
  return { group: g, hw: 1.2, hd: 0.5, depth: 1.0 };
}
function objMatchbox() {
  const g = new THREE.Group();
  const outer = box(1.8, 0.5, 1.1, 0x5a8cae); outer.position.y = -0.3;
  const label = box(1.82, 0.3, 0.9, 0xf0e0c0); label.position.y = -0.28;
  const drawer = box(1.0, 0.4, 1.0, 0xd9b98a); drawer.position.set(1.1, -0.32, 0);
  for (let i = 0; i < 3; i++) {
    const stick = box(0.5, 0.07, 0.07, 0xe8d8b0);
    stick.position.set(1.05, -0.08, -0.25 + i * 0.25);
    const head = box(0.1, 0.09, 0.09, 0xc9505a);
    head.position.set(1.32, -0.08, -0.25 + i * 0.25);
    g.add(stick, head);
  }
  g.add(outer, label, drawer);
  // ngăn kéo (drawer) đẩy ra tại x=1.1, rộng 1.0 → mép ngoài 1.1+0.5=1.6 — xa hơn HẲN so với 0.9 khai báo cũ
  // (thân hộp diêm chỉ rộng 0.9), khiến ngăn kéo trông như sàn đứng được nhưng thực ra rơi xuyên qua
  return { group: g, hw: 1.6, hd: 0.55, depth: 0.55 };
}
function objBookStack() {
  const g = new THREE.Group();
  let y = 0;
  const n = 3;
  const colors = [0xc96a5a, 0x5a8cae, 0x7fb069, 0x9b6db0, 0xd9a83c].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    const h = rand(0.28, 0.4);
    const bw = 1.9 - i * 0.15, bd = 1.35 - i * 0.1;
    const b = box(bw, h, bd, colors[i]);
    const pages = box(bw * 0.92, h * 0.7, bd * 1.02, 0xf5eeda);
    y -= h;
    b.position.set(rand(-0.08, 0.08), y + h / 2, rand(-0.08, 0.08));
    pages.position.copy(b.position);
    b.rotation.y = rand(-0.15, 0.15);
    pages.rotation.y = b.rotation.y;
    g.add(pages, b);
  }
  // cuốn to nhất (đáy) rộng 1.9x1.35 + lệch vị trí ±0.08 + xoay tới 0.15 rad — mép ngoài thật xa hơn hẳn khai báo cũ
  return { group: g, hw: 1.15, hd: 0.9, depth: 1.05 };
}
function objLid() {
  const g = new THREE.Group();
  const c = pick([0xc9505a, 0x5a8cae, 0xd9a83c]);
  const top = cyl(1.0, 1.0, 0.14, c, 18); top.position.y = -0.07;
  const rim = cyl(1.05, 1.05, 0.3, c, 18); rim.position.y = -0.25;
  const inner = cyl(0.95, 0.95, 0.02, 0xe8e8e0, 18); inner.position.y = -0.41;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const notch = box(0.1, 0.28, 0.06, c);
    notch.position.set(Math.cos(a) * 1.05, -0.25, Math.sin(a) * 1.05);
    notch.rotation.y = -a;
    g.add(notch);
  }
  g.add(top, rim, inner);
  // round: nắp vung tròn — vùng va chạm dùng LỤC GIÁC đo từ đỉnh thật (xem measureFootprint).
  // hw/hd dưới đây chỉ còn dùng để rải xu/rương trang trí trên mặt vật.
  return { group: g, hw: 1.1, hd: 1.1, depth: 0.42, round: true };
}
function objMossRock() {
  const g = new THREE.Group();
  const topM = box(rand(1.7, 2.2), 0.35, rand(1.7, 2.2), 0x9dc98a); topM.position.y = -0.18;
  const rock = box(topM.geometry.parameters.width * 0.85, 0.7, topM.geometry.parameters.depth * 0.85, 0xb0a090);
  rock.position.y = -0.68;
  const tuft = buildGrassTuft(); tuft.position.set(rand(-0.5, 0.5), 0, rand(-0.5, 0.5));
  g.add(topM, rock, tuft);
  // trước đây trừ đi 0.1 khiến va chạm hẹp hơn cả mặt cỏ (topM) thật — bỏ phần trừ, khớp đúng mép topM
  return { group: g, hw: topM.geometry.parameters.width / 2, hd: topM.geometry.parameters.depth / 2, depth: 1.03 };
}

const OBJECT_POOL = [objBook, objDice, objBread, objPillow, objYarn, objLog, objMatchbox, objBookStack, objLid];
// đồ vật đáy nông (< 0.6) — dùng khi vật thể bay thấp sát mặt đất
const SHALLOW_POOL = [objBook, objBread, objPillow, objMatchbox, objLid];

// Trả về kích thước GỐC (chưa xoay) — nơi gọi tự random góc xoay/nghiêng và tính lại AABB
export function buildFloatingObject(shallow = false) {
  const make = shallow ? pick(SHALLOW_POOL) : (chance(0.18) ? objMossRock : pick(OBJECT_POOL));
  return make();
}

// ===== Quái vật — mỗi loại tạo hình riêng biệt =====
// Cận chiến (5 loại): yêu tinh, cua đá, hộ vệ đá, tiểu quỷ, heo rừng
export function buildMonsterMelee(type) {
  const g = new THREE.Group();
  switch (type % 5) {
    case 0: { // yêu tinh xanh cầm chùy — chùy tách thành sub-group riêng (weaponArm) để animate lúc ra đòn
      const c = 0x6da85a;
      const bodyM = box(0.55, 0.5, 0.45, c); bodyM.position.y = 0.5;
      const head = box(0.45, 0.38, 0.42, c); head.position.y = 0.98;
      const earL = box(0.25, 0.1, 0.06, c); earL.position.set(-0.33, 1.05, 0); earL.rotation.z = 0.3;
      const earR = box(0.25, 0.1, 0.06, c); earR.position.set(0.33, 1.05, 0); earR.rotation.z = -0.3;
      const eyeL = box(0.09, 0.09, 0.03, 0xffe060); eyeL.position.set(-0.11, 1.0, 0.22);
      const eyeR = box(0.09, 0.09, 0.03, 0xffe060); eyeR.position.set(0.11, 1.0, 0.22);
      const tooth = box(0.06, 0.1, 0.03, 0xffffff); tooth.position.set(0.08, 0.82, 0.22);
      const legL = box(0.18, 0.26, 0.22, 0x4f7a40); legL.position.set(-0.15, 0.13, 0);
      const legR = box(0.18, 0.26, 0.22, 0x4f7a40); legR.position.set(0.15, 0.13, 0);
      const armWeapon = new THREE.Group();
      armWeapon.position.set(0.35, 0.75, 0.1);
      const club = box(0.14, 0.6, 0.14, 0x7a5230); club.position.set(0.07, -0.05, 0); club.rotation.z = -0.5;
      const clubHead = box(0.26, 0.26, 0.26, 0x5f4022); clubHead.position.set(0.23, 0.23, 0);
      armWeapon.add(club, clubHead);
      g.add(bodyM, head, earL, earR, eyeL, eyeR, tooth, legL, legR, armWeapon);
      g.userData.weaponArm = armWeapon;
      break;
    }
    case 1: { // cua đá cam càng to — càng phải tách riêng (weaponArm), càng trái đứng yên
      const c = 0xd97a4a;
      const bodyM = box(0.9, 0.4, 0.7, c); bodyM.position.y = 0.45;
      const eyeStalkL = box(0.06, 0.25, 0.06, c); eyeStalkL.position.set(-0.2, 0.75, 0.25);
      const eyeStalkR = box(0.06, 0.25, 0.06, c); eyeStalkR.position.set(0.2, 0.75, 0.25);
      const eyeL = box(0.11, 0.11, 0.11, 0x222222); eyeL.position.set(-0.2, 0.9, 0.25);
      const eyeR = box(0.11, 0.11, 0.11, 0x222222); eyeR.position.set(0.2, 0.9, 0.25);
      const clawL = box(0.32, 0.28, 0.3, 0xc4633a); clawL.position.set(-0.62, 0.5, 0.25);
      const pincerL = box(0.16, 0.1, 0.2, 0xb0522e); pincerL.position.set(-0.62, 0.68, 0.38);
      const armWeapon = new THREE.Group();
      armWeapon.position.set(0.5, 0.5, 0.15);
      const clawR = box(0.32, 0.28, 0.3, 0xc4633a); clawR.position.set(0.12, 0, 0.10);
      const pincerR = box(0.16, 0.1, 0.2, 0xb0522e); pincerR.position.set(0.12, 0.18, 0.23);
      armWeapon.add(clawR, pincerR);
      for (let i = 0; i < 3; i++) {
        const lgL = box(0.08, 0.3, 0.08, 0xb0522e); lgL.position.set(-0.4 + i * 0.05, 0.15, -0.15 + i * 0.18); lgL.rotation.z = 0.5;
        const lgR = box(0.08, 0.3, 0.08, 0xb0522e); lgR.position.set(0.4 - i * 0.05, 0.15, -0.15 + i * 0.18); lgR.rotation.z = -0.5;
        g.add(lgL, lgR);
      }
      g.add(bodyM, eyeStalkL, eyeStalkR, eyeL, eyeR, clawL, pincerL, armWeapon);
      g.userData.weaponArm = armWeapon;
      break;
    }
    case 2: { // hộ vệ đá — lõi phát sáng — tay phải tách riêng (weaponArm), tay trái đứng yên
      const c = 0x8a8f96;
      const bodyM = box(0.8, 0.7, 0.6, c); bodyM.position.y = 0.75;
      const core = box(0.24, 0.24, 0.06, 0x6ad8e8); core.position.set(0, 0.8, 0.31);
      const head = box(0.5, 0.35, 0.45, 0x7a7f86); head.position.y = 1.3;
      const eye = box(0.28, 0.08, 0.03, 0x6ad8e8); eye.position.set(0, 1.32, 0.24);
      const shoulderL = box(0.3, 0.35, 0.35, 0x7a7f86); shoulderL.position.set(-0.55, 1.0, 0);
      const shoulderR = box(0.3, 0.35, 0.35, 0x7a7f86); shoulderR.position.set(0.55, 1.0, 0);
      const armL = box(0.22, 0.5, 0.25, c); armL.position.set(-0.55, 0.55, 0);
      const armWeapon = new THREE.Group();
      armWeapon.position.set(0.55, 0.82, 0);
      const armR = box(0.22, 0.5, 0.25, c); armR.position.set(0, -0.27, 0);
      armWeapon.add(armR);
      const legL = box(0.26, 0.4, 0.3, 0x7a7f86); legL.position.set(-0.2, 0.2, 0);
      const legR = box(0.26, 0.4, 0.3, 0x7a7f86); legR.position.set(0.2, 0.2, 0);
      g.add(bodyM, core, head, eye, shoulderL, shoulderR, armL, legL, legR, armWeapon);
      g.userData.weaponArm = armWeapon;
      break;
    }
    case 3: { // tiểu quỷ tím có cánh và đuôi — không có tay cầm vũ khí, dùng đầu (weaponArm) để húc/cắn khi ra đòn
      const c = 0x9b6db0;
      const bodyM = box(0.5, 0.45, 0.4, c); bodyM.position.y = 0.55;
      const wingL = box(0.35, 0.28, 0.05, 0x7a4f8f); wingL.position.set(-0.4, 0.75, -0.2); wingL.rotation.y = 0.6;
      const wingR = box(0.35, 0.28, 0.05, 0x7a4f8f); wingR.position.set(0.4, 0.75, -0.2); wingR.rotation.y = -0.6;
      const tail = box(0.08, 0.08, 0.5, c); tail.position.set(0, 0.4, -0.4); tail.rotation.x = 0.5;
      const tailTip = box(0.14, 0.12, 0.08, 0x7a4f8f); tailTip.position.set(0, 0.58, -0.62);
      const legL = box(0.16, 0.28, 0.2, c); legL.position.set(-0.13, 0.16, 0);
      const legR = box(0.16, 0.28, 0.2, c); legR.position.set(0.13, 0.16, 0);
      const armWeapon = new THREE.Group();
      armWeapon.position.set(0, 0.8, 0);
      const head = box(0.42, 0.36, 0.4, c); head.position.set(0, 0.2, 0);
      const hornL = box(0.07, 0.2, 0.07, 0xe8e0d0); hornL.position.set(-0.14, 0.46, 0); hornL.rotation.z = 0.35;
      const hornR = box(0.07, 0.2, 0.07, 0xe8e0d0); hornR.position.set(0.14, 0.46, 0); hornR.rotation.z = -0.35;
      const eyeL = box(0.08, 0.06, 0.03, 0xff5a5a); eyeL.position.set(-0.1, 0.22, 0.21);
      const eyeR = box(0.08, 0.06, 0.03, 0xff5a5a); eyeR.position.set(0.1, 0.22, 0.21);
      armWeapon.add(head, hornL, hornR, eyeL, eyeR);
      g.add(bodyM, wingL, wingR, tail, tailTip, legL, legR, armWeapon);
      g.userData.weaponArm = armWeapon;
      break;
    }
    default: { // heo rừng nâu có nanh — đầu + nanh tách riêng (weaponArm) để húc khi ra đòn
      const c = 0x8a6242;
      // mô hình gốc dựng dọc theo trục X (mặt/mõm ở +X) — bọc trong sub-group rồi xoay lại cho khớp quy ước
      // "+Z là hướng trước" mà rotation.y = atan2(dx,dz) dùng chung toàn game, nếu không quái sẽ đi ngang hông
      const sub = new THREE.Group();
      const bodyM = box(0.85, 0.5, 0.55, c); bodyM.position.y = 0.5;
      const mane = box(0.5, 0.14, 0.57, 0x5f4022); mane.position.set(-0.1, 0.78, 0);
      const armWeapon = new THREE.Group();
      armWeapon.position.set(0.35, 0.5, 0);
      const head = box(0.4, 0.4, 0.42, c); head.position.set(0.15, 0.05, 0);
      const snout = box(0.18, 0.18, 0.2, 0xb08a6a); snout.position.set(0.37, -0.05, 0);
      const tuskL = box(0.05, 0.14, 0.05, 0xfff5e0); tuskL.position.set(0.33, -0.14, 0.14); tuskL.rotation.x = -0.4;
      const tuskR = box(0.05, 0.14, 0.05, 0xfff5e0); tuskR.position.set(0.33, -0.14, -0.14); tuskR.rotation.x = 0.4;
      const eyeL = box(0.06, 0.06, 0.03, 0x222222); eyeL.position.set(0.27, 0.18, 0.18);
      const eyeR = box(0.06, 0.06, 0.03, 0x222222); eyeR.position.set(0.27, 0.18, -0.18);
      armWeapon.add(head, snout, tuskL, tuskR, eyeL, eyeR);
      for (const [lx, lz] of [[-0.28, 0.18], [-0.28, -0.18], [0.28, 0.18], [0.28, -0.18]]) {
        const leg = box(0.14, 0.28, 0.14, 0x5f4022);
        leg.position.set(lx, 0.14, lz);
        sub.add(leg);
      }
      const tail = box(0.06, 0.2, 0.06, 0x5f4022); tail.position.set(-0.45, 0.65, 0); tail.rotation.z = 0.6;
      sub.add(bodyM, mane, armWeapon, tail);
      sub.rotation.y = -Math.PI / 2;
      g.add(sub);
      g.userData.weaponArm = armWeapon;
      break;
    }
  }
  return g;
}

// Tầm xa (2 loại): pháp sư bắn phép, pháo đài mắt độc — đều có "nòng" chĩa ra dễ nhận diện
export function buildMonsterRanged(type) {
  const g = new THREE.Group();
  if (type % 2 === 0) { // pháp sư áo choàng xanh, mũ nhọn, gậy có quả cầu
    const robe = 0x4a6e9a, robeD = 0x3a5a80;
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 8), new THREE.MeshLambertMaterial({ color: robe }));
    body.position.y = 0.5; body.castShadow = true;
    const head = box(0.36, 0.32, 0.34, 0xe8c9a8); head.position.y = 1.12;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 8), new THREE.MeshLambertMaterial({ color: robeD }));
    hat.position.y = 1.5; hat.castShadow = true;
    const brim = cyl(0.42, 0.42, 0.06, robeD, 10); brim.position.y = 1.28;
    const eyeL = box(0.06, 0.06, 0.03, 0x222222); eyeL.position.set(-0.08, 1.14, 0.18);
    const eyeR = box(0.06, 0.06, 0.03, 0x222222); eyeR.position.set(0.08, 1.14, 0.18);
    // gậy + quả cầu tách thành sub-group riêng, trục xoay đặt ở vị trí bàn tay — cho phép animate
    // "giơ gậy chỉ hướng" lúc bắn phép (xoay staffArm ở nơi gọi), thay vì đứng yên một chỗ cố định
    const staffArm = new THREE.Group();
    staffArm.position.set(0.38, 0.8, 0.12);
    const staff = box(0.07, 1.1, 0.07, 0x7a5230); staff.position.set(0, 0, 0);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0x6ad8e8, emissive: 0x2a7a8a }));
    orb.position.set(0, 0.62, 0);
    staffArm.add(staff, orb);
    g.add(body, head, hat, brim, eyeL, eyeR, staffArm);
    g.userData.staffArm = staffArm;
  } else { // pháo đài mắt độc màu đỏ đất, nòng pháo lớn
    const c = 0x9a5a5a, cD = 0x7a4444;
    const base = box(0.7, 0.35, 0.6, cD); base.position.y = 0.18;
    const body = box(0.6, 0.55, 0.55, c); body.position.y = 0.62;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0xfff0b0, emissive: 0x8a7a30 }));
    eye.position.set(0, 0.95, 0.2);
    const pup = box(0.09, 0.09, 0.04, 0x222222); pup.position.set(0, 0.95, 0.34);
    const barrel = cyl(0.11, 0.14, 0.55, 0x444a50, 8);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.6, 0.5);
    const barrelTip = cyl(0.15, 0.15, 0.1, 0x33383e, 8);
    barrelTip.rotation.x = Math.PI / 2; barrelTip.position.set(0, 0.6, 0.78);
    const rivetL = box(0.08, 0.08, 0.08, cD); rivetL.position.set(-0.28, 0.85, 0.2);
    const rivetR = box(0.08, 0.08, 0.08, cD); rivetR.position.set(0.28, 0.85, 0.2);
    g.add(base, body, eye, pup, barrel, barrelTip, rivetL, rivetR);
  }
  return g;
}

// ===== Mây voxel =====
export function buildCloud() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const n = randInt(3, 5);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(rand(1.5, 3), rand(0.6, 1), rand(1, 2)), mat);
    m.position.set(rand(-2, 2), rand(-0.3, 0.3), rand(-1, 1));
    g.add(m);
  }
  return g;
}

// ===== Xúc tu bạch tuộc — chuỗi khớp nối để uốn lượn =====
export function buildTentacle() {
  const root = new THREE.Group();
  const segs = [];
  let parent = root;
  const nSeg = 9;
  for (let i = 0; i < nSeg; i++) {
    const segLen = 0.85 - i * 0.045;
    const s = 0.78 - i * 0.075;
    const joint = new THREE.Group();
    joint.position.y = i === 0 ? 0 : (0.85 - (i - 1) * 0.045);
    const m = box(s, segLen, s, 0x5a3c6e);
    m.position.y = segLen / 2;
    joint.add(m);
    if (i < 7) {
      for (const side of [-1, 1]) {
        const sucker = cyl(0.09, 0.11, 0.06, 0xc9a5d5, 8);
        sucker.rotation.x = Math.PI / 2;
        sucker.position.set(side * (s / 2 + 0.02) * 0.4, segLen / 2, s / 2 + 0.03);
        joint.add(sucker);
      }
    }
    parent.add(joint);
    parent = joint;
    segs.push(joint);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x6a4a7e }));
  tip.position.y = 0.6;
  parent.add(tip);
  root.userData.segs = segs;
  return root;
}

// ===== Vòng sao choáng váng trên đầu =====
export function buildStunStars() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14),
      new THREE.MeshBasicMaterial({ color: 0xffe060 })
    );
    star.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
    g.add(star);
  }
  return g;
}

function darken(hex, amt) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) * (1 - amt)));
  const gr = Math.max(0, Math.min(255, ((hex >> 8) & 255) * (1 - amt)));
  const b = Math.max(0, Math.min(255, (hex & 255) * (1 - amt)));
  return (r << 16) | (gr << 8) | b;
}

// ===== Đế đá voxel — nhiều lớp khối hộp nhỏ xếp chồng, co nhỏ dần xuống đáy =====
// (thay cho khối nón/trụ trơn — giữ đúng dáng vẻ voxel như phần còn lại của game)
// Dùng InstancedMesh (2 draw call cố định dù bao nhiêu khối) — vì hàm này được gọi cho
// TẤT CẢ đảo (14 đảo nền/level + đảo quái + đảo đích), Mesh riêng lẻ từng khối sẽ quá tốn draw call.
const rockBoxGeo = new THREE.BoxGeometry(1, 1, 1);
// grassColor (tuỳ chọn): nếu truyền vào, lớp đá TRÊN CÙNG được phủ thêm viền cỏ — dùng ĐÚNG ô lưới của
// lớp đá đó, phóng to hơn một chút, cao bằng nửa khối đá, tâm đặt ngay mặt trên lớp đá để ăn chồng đúng
// 50% chiều cao vào khối đá bên dưới (kiểu viền cỏ trùm mép dirt-block trong Minecraft).
export function buildRockBase(rTop, depth, color, grassColor) {
  const g = new THREE.Group();
  const colorAlt = darken(color, 0.14);
  const layers = Math.max(4, Math.round(depth / (rTop * 0.2 + 0.4)));
  const mainB = [], altB = [], grassB = [];
  let curR = rTop;
  let y = 0.4; // nhô lên — lớp đầu ăn sâu vào khối phía trên, không hở khe nối
  for (let i = 0; i < layers; i++) {
    const layerH = (depth / layers) * rand(0.9, 1.2);
    const cell = Math.max(0.38, curR / 3.8); // lưới dày hơn — nhiều khối hơn hẳn
    const steps = Math.round(curR / cell) + 1;
    const jitter = i % 2 === 0 ? 0 : cell * 0.5; // so le từng lớp cho gồ ghề tự nhiên
    const topY = y + 0.2; // mặt trên danh nghĩa của lớp này (không phụ thuộc bh từng khối)
    for (let bx = -steps; bx <= steps; bx++) {
      for (let bz = -steps; bz <= steps; bz++) {
        const lx = bx * cell + jitter, lz = bz * cell;
        // lớp trên cùng (i===0) là mặt đứng/va chạm thật — giới hạn độ tràn mép chặt hơn để không vượt quá
        // bán kính va chạm đăng ký; các lớp đá bên dưới (không ai đứng lên) được phép to/lệch mạnh hơn cho kịch
        const edgeLimit = i === 0 ? curR + cell * 0.25 : curR + cell * 0.5;
        if (Math.hypot(lx, lz) > edgeLimit) continue;
        // trộn khối to/nhỏ lẫn nhau trong CÙNG một lớp (không đồng nhất kích cỡ), nhưng vị trí tâm vẫn
        // theo đúng lưới của "cell" nên hình dáng tổng thể vẫn thon nhỏ dần xuống đáy như thiết kế
        const sizeRoll = Math.random();
        const bigMax = i === 0 ? 1.7 : 2.3;
        const sizeMul = sizeRoll < 0.16 ? rand(1.4, bigMax) : sizeRoll < 0.34 ? rand(0.5, 0.72) : rand(0.95, 1.3);
        const bh = layerH * rand(0.7, 1.6) + 0.25; // chênh lệch chiều cao rõ rệt giữa các khối — gồ ghề tự nhiên
        const bw = cell * sizeMul * rand(0.94, 1.06), bd = cell * sizeMul * rand(0.94, 1.06);
        (chance(0.35) ? altB : mainB).push({ x: lx, y: topY - bh / 2, z: lz, w: bw, h: bh, d: bd, ry: rand(-0.08, 0.08) });
        if (i === 0 && grassColor) {
          const gh = bh * rand(0.35, 0.65); // mỗi khối co dãn ngẫu nhiên, không đồng đều 50%
          const overhang = rand(1.05, 1.22); // tràn ra ngoài mép lớp đá một chút — không vượt quá bán kính va chạm
          grassB.push({ x: lx, y: topY, z: lz, w: bw * overhang, h: gh, d: bd * overhang, ry: rand(-0.08, 0.08) });
        }
      }
    }
    y -= layerH;
    curR *= rand(0.62, 0.75);
  }
  const addInst = (arr, col, tex) => {
    if (!arr.length) return;
    const mat = new THREE.MeshLambertMaterial({ color: col, map: tex });
    const im = new THREE.InstancedMesh(rockBoxGeo, mat, arr.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    arr.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, b.ry, 0));
      pos.set(b.x, b.y, b.z);
      s.set(b.w, b.h, b.d);
      m4.compose(pos, q, s);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
  };
  addInst(mainB, color, objTexFor(color));
  addInst(altB, colorAlt, objTexFor(colorAlt));
  if (grassColor) addInst(grassB, grassColor, makeBlockTexture('grass', { grain: 0.14, border: 0.2 }));
  // Bán kính MẶT ĐỨNG THẬT: chỉ tính lớp trên cùng (khối đá lớp i===0 + viền cỏ phủ lên nó) — đây mới là mặt
  // người chơi/quái đứng lên và nhìn thấy mép. Các lớp đá bên dưới thon nhỏ dần nên không liên quan.
  // Lấy đúng góc xa nhất của từng khối (đã tính cả góc xoay ry) — số đo thật, không phải hệ số ước lượng.
  const topLayerY = 0.4 + 0.2; // topY của lớp i===0 (xem vòng lặp phía trên)
  let topR = 0;
  for (const arr of [mainB, altB, grassB]) {
    for (const b of arr) {
      if (b.y + b.h / 2 < topLayerY - 0.01) continue; // không thuộc lớp trên cùng
      const c = Math.abs(Math.cos(b.ry)), s = Math.abs(Math.sin(b.ry));
      const ex = (b.w / 2) * c + (b.d / 2) * s; // nửa bề rộng hình chiếu sau khi xoay ry
      const ez = (b.w / 2) * s + (b.d / 2) * c;
      const d = Math.hypot(Math.abs(b.x) + ex, Math.abs(b.z) + ez);
      if (d > topR) topR = d;
    }
  }
  g.userData.topR = topR;
  return g;
}

// ===== Đảo nền trang trí — đế thon dần xuống đáy kiểu đảo bay =====
export function buildDecorIsland(sizeScale = 1) {
  const g = new THREE.Group();
  const r = rand(3, 7) * sizeScale;
  const groundC = pick([0x8fae88, 0x9db98a, 0x86a878, 0xa2bd90]);
  const rockC = pick([0xb0a090, 0xa89a8a, 0x9a8f80]);
  // đế đá voxel — nhiều lớp khối hộp thu nhỏ dần xuống đáy, viền cỏ phủ lớp trên cùng (không dùng đĩa tròn trơn nữa)
  const base = buildRockBase(r * 0.92, rand(4, 6.5) * sizeScale, rockC, groundC);
  base.position.y = 0.2;
  g.add(base);

  const style = pick(['forest', 'hill', 'barren', 'mixed']);
  const offX = rand(-r * 0.4, r * 0.4), offZ = rand(-r * 0.4, r * 0.4);
  if (style === 'forest') {
    const n = randInt(4, 8);
    for (let i = 0; i < n; i++) {
      const t = chance(0.25) ? buildBigTree(rand(0.4, 0.7) * sizeScale) : buildTree(rand(0.5, 1.1) * sizeScale);
      t.position.set(offX + rand(-r * 0.5, r * 0.5), 1.2, offZ + rand(-r * 0.5, r * 0.5));
      g.add(t);
    }
  } else if (style === 'hill') {
    // bỏ gò đất riêng (khó ghép khối tự nhiên ở kích thước nhỏ) — cây mọc thẳng trên mặt đảo
    const n = randInt(2, 4);
    for (let i = 0; i < n; i++) {
      const t = buildTree(rand(0.7, 1.3) * sizeScale);
      t.position.set(offX + rand(-r * 0.3, r * 0.3), 1.2, offZ + rand(-r * 0.3, r * 0.3));
      g.add(t);
    }
  } else if (style === 'barren') {
    for (let i = 0; i < randInt(2, 4); i++) {
      const rk = buildRock();
      rk.position.set(rand(-r * 0.5, r * 0.5), 1.2, rand(-r * 0.5, r * 0.5));
      rk.scale.setScalar(rand(1, 2));
      g.add(rk);
    }
    for (let i = 0; i < randInt(3, 6); i++) {
      const gt = buildGrassTuft();
      gt.position.set(rand(-r * 0.6, r * 0.6), 1.2, rand(-r * 0.6, r * 0.6));
      g.add(gt);
    }
  } else {
    const t = chance(0.4) ? buildBigTree(rand(0.5, 0.8) * sizeScale) : buildTree(rand(0.8, 1.4) * sizeScale);
    t.position.set(offX, 1.2, offZ);
    g.add(t);
    for (let i = 0; i < randInt(2, 4); i++) {
      const t2 = buildTree(rand(0.4, 0.7) * sizeScale);
      t2.position.set(rand(-r * 0.5, r * 0.5), 1.2, rand(-r * 0.5, r * 0.5));
      g.add(t2);
    }
    if (chance(0.5)) { const rk = buildRock(); rk.position.set(-offX, 1.2, -offZ); g.add(rk); }
  }
  return g;
}

// ===== Núi mờ phía chân trời =====
export function buildFarMountain() {
  const g = new THREE.Group();
  const c = pick([0xa8c0cc, 0xb2c6d4, 0x9db4c4]);
  const n = randInt(1, 3);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(rand(18, 45), rand(20, 45), 7),
      new THREE.MeshLambertMaterial({ color: c, fog: true })
    );
    m.position.set(rand(-30, 30), rand(5, 12), rand(-15, 15));
    g.add(m);
  }
  return g;
}
