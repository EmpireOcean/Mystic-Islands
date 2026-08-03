// ===== Dựng mô hình voxel từ các khối hộp =====
import * as THREE from 'three';
import { rand, randInt, pick, chance } from './config.js';

// ===== Texture pixel 16x16 dùng chung — vân hạt + viền tối giả AO ở cạnh khối =====
// Một tấm texture cho cả nghìn khối instance nên chi phí gần như bằng 0.
const texCache = new Map();
export function makeBlockTexture(key, { grain = 0.12, border = 0.22, speckle = 0.06 } = {}) {
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
      if (rnd() < speckle) v -= 0.12;                  // đốm sẫm rải rác
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
  const h = rand(1.8, 3.2);
  const trunk = box(0.28, h, 0.28, pick([0x6e4a28, 0x7a5230, 0x5f3f22]));
  trunk.position.y = h / 2;
  g.add(trunk);
  const leafC = pick([0x8fbf7f, 0x7fb069, 0xa8c98a, 0x6fa860, 0x98c47e]);
  const layers = randInt(2, 3);
  for (let i = 0; i < layers; i++) {
    const s = rand(1.5, 1.9) - i * 0.45;
    const c = box(s, rand(0.6, 0.9), s, leafC);
    c.position.set(rand(-0.1, 0.1), h + 0.3 + i * 0.65, rand(-0.1, 0.1));
    g.add(c);
  }
  g.scale.setScalar(scale);
  return g;
}
// cây cổ thụ: cao, tán rộng nhiều lớp nhiều tông màu
export function buildBigTree(scale = 1) {
  const g = new THREE.Group();
  const h = rand(4, 5.5);
  const trunkC = pick([0x6e4a28, 0x5f3f22]);
  const trunk = box(0.5, h, 0.5, trunkC); trunk.position.y = h / 2;
  const root1 = box(0.24, 0.5, 0.24, trunkC); root1.position.set(0.3, 0.25, 0.2);
  const root2 = box(0.2, 0.4, 0.2, trunkC); root2.position.set(-0.28, 0.2, -0.15);
  const branch = box(0.2, 0.2, 1.1, trunkC); branch.position.set(0.3, h * 0.72, 0.4); branch.rotation.y = 0.5;
  g.add(trunk, root1, root2, branch);
  const c1 = pick([0x7fb069, 0x6fa860]);
  const c2 = pick([0x98c47e, 0xa8c98a]);
  // tán chính 4 lớp so le hai tông
  const layers = [
    [3.4, 1.0, 0, h + 0.4, 0, c1],
    [2.7, 0.9, 0.5, h + 1.2, -0.3, c2],
    [2.0, 0.8, -0.4, h + 1.9, 0.3, c1],
    [1.2, 0.7, 0.1, h + 2.5, 0, c2],
  ];
  for (const [s, hh, ox, y, oz, cc] of layers) {
    const c = box(s, hh, s * rand(0.9, 1.1), cc);
    c.position.set(ox, y, oz);
    g.add(c);
  }
  // cụm tán phụ trên cành
  const side = box(1.1, 0.7, 1.1, c2); side.position.set(0.85, h * 0.72 + 0.5, 0.9);
  g.add(side);
  g.scale.setScalar(scale);
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
  const c = pick([0x9a9a92, 0x8a8f96, 0xa8a49a]);
  const n = randInt(1, 3);
  for (let i = 0; i < n; i++) {
    const r = box(rand(0.3, 0.7), rand(0.25, 0.5), rand(0.3, 0.7), c);
    r.position.set(rand(-0.3, 0.3), 0.15, rand(-0.3, 0.3));
    r.rotation.y = rand(0, Math.PI);
    g.add(r);
  }
  g.userData.hitR = 0.5; g.userData.hitH = 0.55; // khối va chạm trụ tròn
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
    // phần thân đổ nằm ngang cũng là vật rắn (trụ va chạm thấp bao quanh)
    g.userData.fallen = { x: fx, z: fz, r: 1.15, h: 0.95 };
  }
  g.userData.hitH = hitH;
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
  return { group: g, hw: 1.15, hd: 0.85, depth: 0.32 };
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
  return { group: g, hw: 0.95, hd: 0.72, depth: 0.5 };
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
  return { group: g, hw: 0.7, hd: 0.7, depth: 1.26 };
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
  return { group: g, hw: 1.15, hd: 0.5, depth: 1.0 };
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
  return { group: g, hw: 0.9, hd: 0.55, depth: 0.55 };
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
  return { group: g, hw: 0.85, hd: 0.62, depth: 1.05 };
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
  return { group: g, hw: 0.85, hd: 0.85, depth: 0.42 };
}
function objMossRock() {
  const g = new THREE.Group();
  const topM = box(rand(1.7, 2.2), 0.35, rand(1.7, 2.2), 0x9dc98a); topM.position.y = -0.18;
  const rock = box(topM.geometry.parameters.width * 0.85, 0.7, topM.geometry.parameters.depth * 0.85, 0xb0a090);
  rock.position.y = -0.68;
  const tuft = buildGrassTuft(); tuft.position.set(rand(-0.5, 0.5), 0, rand(-0.5, 0.5));
  g.add(topM, rock, tuft);
  return { group: g, hw: topM.geometry.parameters.width / 2 - 0.1, hd: topM.geometry.parameters.depth / 2 - 0.1, depth: 1.03 };
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
    case 0: { // yêu tinh xanh cầm chùy
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
      const club = box(0.14, 0.6, 0.14, 0x7a5230); club.position.set(0.42, 0.7, 0.1); club.rotation.z = -0.5;
      const clubHead = box(0.26, 0.26, 0.26, 0x5f4022); clubHead.position.set(0.58, 0.98, 0.1);
      g.add(bodyM, head, earL, earR, eyeL, eyeR, tooth, legL, legR, club, clubHead);
      break;
    }
    case 1: { // cua đá cam càng to
      const c = 0xd97a4a;
      const bodyM = box(0.9, 0.4, 0.7, c); bodyM.position.y = 0.45;
      const eyeStalkL = box(0.06, 0.25, 0.06, c); eyeStalkL.position.set(-0.2, 0.75, 0.25);
      const eyeStalkR = box(0.06, 0.25, 0.06, c); eyeStalkR.position.set(0.2, 0.75, 0.25);
      const eyeL = box(0.11, 0.11, 0.11, 0x222222); eyeL.position.set(-0.2, 0.9, 0.25);
      const eyeR = box(0.11, 0.11, 0.11, 0x222222); eyeR.position.set(0.2, 0.9, 0.25);
      const clawL = box(0.32, 0.28, 0.3, 0xc4633a); clawL.position.set(-0.62, 0.5, 0.25);
      const clawR = box(0.32, 0.28, 0.3, 0xc4633a); clawR.position.set(0.62, 0.5, 0.25);
      const pincerL = box(0.16, 0.1, 0.2, 0xb0522e); pincerL.position.set(-0.62, 0.68, 0.38);
      const pincerR = box(0.16, 0.1, 0.2, 0xb0522e); pincerR.position.set(0.62, 0.68, 0.38);
      for (let i = 0; i < 3; i++) {
        const lgL = box(0.08, 0.3, 0.08, 0xb0522e); lgL.position.set(-0.4 + i * 0.05, 0.15, -0.15 + i * 0.18); lgL.rotation.z = 0.5;
        const lgR = box(0.08, 0.3, 0.08, 0xb0522e); lgR.position.set(0.4 - i * 0.05, 0.15, -0.15 + i * 0.18); lgR.rotation.z = -0.5;
        g.add(lgL, lgR);
      }
      g.add(bodyM, eyeStalkL, eyeStalkR, eyeL, eyeR, clawL, clawR, pincerL, pincerR);
      break;
    }
    case 2: { // hộ vệ đá — lõi phát sáng
      const c = 0x8a8f96;
      const bodyM = box(0.8, 0.7, 0.6, c); bodyM.position.y = 0.75;
      const core = box(0.24, 0.24, 0.06, 0x6ad8e8); core.position.set(0, 0.8, 0.31);
      const head = box(0.5, 0.35, 0.45, 0x7a7f86); head.position.y = 1.3;
      const eye = box(0.28, 0.08, 0.03, 0x6ad8e8); eye.position.set(0, 1.32, 0.24);
      const shoulderL = box(0.3, 0.35, 0.35, 0x7a7f86); shoulderL.position.set(-0.55, 1.0, 0);
      const shoulderR = box(0.3, 0.35, 0.35, 0x7a7f86); shoulderR.position.set(0.55, 1.0, 0);
      const armL = box(0.22, 0.5, 0.25, c); armL.position.set(-0.55, 0.55, 0);
      const armR = box(0.22, 0.5, 0.25, c); armR.position.set(0.55, 0.55, 0);
      const legL = box(0.26, 0.4, 0.3, 0x7a7f86); legL.position.set(-0.2, 0.2, 0);
      const legR = box(0.26, 0.4, 0.3, 0x7a7f86); legR.position.set(0.2, 0.2, 0);
      g.add(bodyM, core, head, eye, shoulderL, shoulderR, armL, armR, legL, legR);
      break;
    }
    case 3: { // tiểu quỷ tím có cánh và đuôi
      const c = 0x9b6db0;
      const bodyM = box(0.5, 0.45, 0.4, c); bodyM.position.y = 0.55;
      const head = box(0.42, 0.36, 0.4, c); head.position.y = 1.0;
      const hornL = box(0.07, 0.2, 0.07, 0xe8e0d0); hornL.position.set(-0.14, 1.26, 0); hornL.rotation.z = 0.35;
      const hornR = box(0.07, 0.2, 0.07, 0xe8e0d0); hornR.position.set(0.14, 1.26, 0); hornR.rotation.z = -0.35;
      const eyeL = box(0.08, 0.06, 0.03, 0xff5a5a); eyeL.position.set(-0.1, 1.02, 0.21);
      const eyeR = box(0.08, 0.06, 0.03, 0xff5a5a); eyeR.position.set(0.1, 1.02, 0.21);
      const wingL = box(0.35, 0.28, 0.05, 0x7a4f8f); wingL.position.set(-0.4, 0.75, -0.2); wingL.rotation.y = 0.6;
      const wingR = box(0.35, 0.28, 0.05, 0x7a4f8f); wingR.position.set(0.4, 0.75, -0.2); wingR.rotation.y = -0.6;
      const tail = box(0.08, 0.08, 0.5, c); tail.position.set(0, 0.4, -0.4); tail.rotation.x = 0.5;
      const tailTip = box(0.14, 0.12, 0.08, 0x7a4f8f); tailTip.position.set(0, 0.58, -0.62);
      const legL = box(0.16, 0.28, 0.2, c); legL.position.set(-0.13, 0.16, 0);
      const legR = box(0.16, 0.28, 0.2, c); legR.position.set(0.13, 0.16, 0);
      g.add(bodyM, head, hornL, hornR, eyeL, eyeR, wingL, wingR, tail, tailTip, legL, legR);
      break;
    }
    default: { // heo rừng nâu có nanh
      const c = 0x8a6242;
      const bodyM = box(0.85, 0.5, 0.55, c); bodyM.position.y = 0.5;
      const mane = box(0.5, 0.14, 0.57, 0x5f4022); mane.position.set(-0.1, 0.78, 0);
      const head = box(0.4, 0.4, 0.42, c); head.position.set(0.5, 0.55, 0);
      const snout = box(0.18, 0.18, 0.2, 0xb08a6a); snout.position.set(0.72, 0.45, 0);
      const tuskL = box(0.05, 0.14, 0.05, 0xfff5e0); tuskL.position.set(0.68, 0.36, 0.14); tuskL.rotation.x = -0.4;
      const tuskR = box(0.05, 0.14, 0.05, 0xfff5e0); tuskR.position.set(0.68, 0.36, -0.14); tuskR.rotation.x = 0.4;
      const eyeL = box(0.06, 0.06, 0.03, 0x222222); eyeL.position.set(0.62, 0.68, 0.18);
      const eyeR = box(0.06, 0.06, 0.03, 0x222222); eyeR.position.set(0.62, 0.68, -0.18);
      for (const [lx, lz] of [[-0.28, 0.18], [-0.28, -0.18], [0.28, 0.18], [0.28, -0.18]]) {
        const leg = box(0.14, 0.28, 0.14, 0x5f4022);
        leg.position.set(lx, 0.14, lz);
        g.add(leg);
      }
      const tail = box(0.06, 0.2, 0.06, 0x5f4022); tail.position.set(-0.45, 0.65, 0); tail.rotation.z = 0.6;
      g.add(bodyM, mane, head, snout, tuskL, tuskR, eyeL, eyeR, tail);
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
    const staff = box(0.07, 1.1, 0.07, 0x7a5230); staff.position.set(0.4, 0.7, 0.15);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0x6ad8e8, emissive: 0x2a7a8a }));
    orb.position.set(0.4, 1.32, 0.15);
    g.add(body, head, hat, brim, eyeL, eyeR, staff, orb);
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

// ===== Đảo nền trang trí — đế thon dần xuống đáy kiểu đảo bay =====
export function buildDecorIsland(sizeScale = 1) {
  const g = new THREE.Group();
  const r = rand(3, 7) * sizeScale;
  const groundC = pick([0x8fae88, 0x9db98a, 0x86a878, 0xa2bd90]);
  const rockC = pick([0xb0a090, 0xa89a8a, 0x9a8f80]);
  // mặt trên phẳng
  const top = cyl(r, r * 0.96, rand(1, 1.6), groundC, 10);
  top.position.y = 0.6;
  g.add(top);
  // đế đá thu nhỏ dần xuống đáy (2 tầng + chóp nhọn)
  const mid = cyl(r * 0.8, r * 0.5, rand(1.5, 2.5), rockC, 9);
  mid.position.y = -0.9;
  const tipCone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, rand(2, 4) * sizeScale, 8),
    new THREE.MeshLambertMaterial({ color: rockC }));
  tipCone.rotation.x = Math.PI;
  tipCone.position.y = -2.2 - rand(0.8, 1.6);
  tipCone.castShadow = true;
  g.add(mid, tipCone);

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
    const hill = cyl(r * 0.5, r * 0.65, rand(1.5, 3), groundC, 8);
    hill.position.set(offX, 1.8, offZ);
    g.add(hill);
    if (chance(0.7)) {
      const t = buildTree(rand(0.7, 1.3) * sizeScale);
      t.position.set(offX, 2.8, offZ);
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
