// ===== Lõi game: vòng lặp, vật lý, chiến đấu, AI quái, camera =====
import * as THREE from 'three';
import { CFG, fallDamage, orbLoss, rand, randInt, chance } from './config.js';
import { generateLevel } from './world.js';
import * as V from './voxel.js';

const tileKey = (x, z) => `${Math.round(x)},${Math.round(z)}`;

export class Game {
  constructor(container, save, audio, events) {
    this.container = container;
    this.save = save;
    this.audio = audio;
    this.events = events; // { updateHUD, showReward, hideAll, showDeath, showGameOver, toast }
    this.state = 'idle';  // idle | play | dead | tentacle | reward | beam
    this.isMobile = 'ontouchstart' in window;
    this.forceLandscape = false; // chế độ ép ngang trên điện thoại (bật/tắt qua nút riêng)
    this.joystickTouchId = null; // ID ngón tay đang giữ joystick — set/clear bởi ui.js initJoystick()

    this.initThree();
    this.initInput();

    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // ---------- Khởi tạo Three.js ----------
  initThree() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xd8e8e0, 55, 300); // sương xa — núi mờ dần hòa vào trời

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camYaw = 0; this.camPitch = 0.25; this.camDist = 6;

    // ánh sáng vàng ấm dịu nhẹ
    const hemi = new THREE.HemisphereLight(0xcfe8f5, 0xd9c295, 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    this.sun.position.set(20, 35, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -30; this.sun.shadow.camera.right = 30;
    this.sun.shadow.camera.top = 30; this.sun.shadow.camera.bottom = -30;
    this.sun.shadow.camera.far = 120;
    this.scene.add(this.sun);

    // hạt bụi / lá bay
    const pGeo = new THREE.BufferGeometry();
    const n = 120, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-30, 30); pos[i * 3 + 1] = rand(0, 20); pos[i * 3 + 2] = rand(-30, 30);
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xfff8e0, size: 0.12, transparent: true, opacity: 0.7 }));
    this.scene.add(this.dust);

    window.addEventListener('resize', () => {
      this.camera.aspect = this.logicalWidth() / this.logicalHeight();
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.logicalWidth(), this.logicalHeight());
    });
  }

  // ---------- Chế độ "ép ngang" (xoay CSS 90° khi máy đang cầm dọc) ----------
  // Trình duyệt luôn báo toạ độ chạm (clientX/Y) theo khung hình VẬT LÝ (dọc), bất kể nội dung có bị xoay
  // bằng CSS hay không — nên khi bật forceLandscape phải tự quy đổi lại toạ độ/phương hướng cho khớp với
  // những gì người chơi THẤY trên màn hình, nếu không joystick/camera sẽ lệch trục.
  logicalWidth() { return this.forceLandscape ? window.innerHeight : window.innerWidth; }
  logicalHeight() { return this.forceLandscape ? window.innerWidth : window.innerHeight; }
  toLogicalXY(clientX, clientY) {
    if (!this.forceLandscape) return { x: clientX, y: clientY };
    return { x: clientY, y: window.innerWidth - clientX };
  }
  toLogicalDelta(dx, dy) {
    if (!this.forceLandscape) return { x: dx, y: dy };
    return { x: dy, y: -dx };
  }

  setForceLandscape(on) {
    this.forceLandscape = on;
    document.body.classList.toggle('force-landscape', on);
    if (on && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {}); // best-effort, im lặng bỏ qua nếu trình duyệt không hỗ trợ
    } else if (!on && screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch { /* bỏ qua */ }
    }
    this.camera.aspect = this.logicalWidth() / this.logicalHeight();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.logicalWidth(), this.logicalHeight());
  }

  // ---------- Điều khiển ----------
  initInput() {
    this.keys = {};
    this.moveVec = { x: 0, z: 0 };   // joystick điện thoại
    const cv = this.renderer.domElement;

    window.addEventListener('keydown', (e) => {
      // Esc hoặc P: mở/đóng menu tạm dừng
      if ((e.code === 'Escape' || e.code === 'KeyP') && (this.state === 'play' || this.state === 'paused')) {
        this.togglePause();
        return;
      }
      if (this.state !== 'play') return;
      this.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); this.tryJump(); }
      if (e.code === 'KeyE') this.events.toggleBag();
      if (e.code === 'Digit1') this.setWeapon('fist');
      if (e.code === 'Digit2') this.setWeapon('sword');
      if (e.code === 'Digit3') this.setWeapon('gun');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // chuột: khóa con trỏ để xoay camera. Dùng MOUSEDOWN (không dùng 'click') và kiểm tra đúng e.button cho từng
    // nút, để chuột phải (giữ ngắm) và chuột trái (bắn) không bao giờ lẫn vào nhau — chuột phải chỉ giữ để ngắm,
    // KHÔNG bao giờ tự bắn khi thả ra.
    this.aiming = false;
    this.aimPitch = 0; // góc ngắm lên/xuống, chỉ đổi khi đang giữ ngắm — tách riêng khỏi camPitch (góc camera quỹ đạo)
    cv.addEventListener('contextmenu', (e) => { if (this.state === 'play') e.preventDefault(); });
    cv.addEventListener('mousedown', (e) => {
      if (this.state !== 'play' || this.isMobile) return;
      if (document.pointerLockElement !== cv) {
        if (e.button === 0) cv.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.attack();
      else if (e.button === 2 && this.weapon === 'gun') { e.preventDefault(); this.aiming = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.aiming = false; });
    // Esc trong lúc khóa con trỏ: trình duyệt tự thả chuột mà KHÔNG gửi phím Esc cho trang
    // → nghe sự kiện mất khóa để mở thẳng bảng tạm dừng (luồng: Esc → bảng hiện, bấm nút được ngay)
    document.addEventListener('pointerlockchange', () => {
      // suppressAutoPause: túi đồ tự thả chuột để bấm nút — không mở bảng tạm dừng trong trường hợp đó
      if (document.pointerLockElement !== cv && this.state === 'play' && !this.isMobile && !this.suppressAutoPause) {
        this.togglePause();
      }
      if (document.pointerLockElement !== cv) this.aiming = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== cv) return;
      if (this.aiming) {
        // giữ ngắm: độ nhạy giảm để chỉnh chính xác — xoay ngang vẫn dùng camYaw, còn lên/xuống đổi aimPitch
        // (KHÔNG đụng camPitch) để việc ngắm lên trời/xuống đất không làm camera quỹ đạo giật lung tung
        this.camYaw -= e.movementX * 0.0032 * 0.4;
        this.aimPitch = Math.max(-1.0, Math.min(1.0, this.aimPitch - e.movementY * 0.0028 * 0.55));
      } else {
        this.camYaw -= e.movementX * 0.0032;
        this.camPitch = Math.max(-0.5, Math.min(1.2, this.camPitch + e.movementY * 0.0028));
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.state !== 'play') return;
      this.camDist = Math.max(3.5, Math.min(10, this.camDist + Math.sign(e.deltaY) * 0.6));
    });

    // cảm ứng: vuốt nửa phải xoay camera, chụm 2 ngón zoom
    // passive:false + preventDefault BẮT BUỘC phải có — nếu không, trình duyệt/webview coi thao tác vuốt
    // này là cử chỉ điều hướng gốc (vuốt lùi trang, kéo-để-làm-mới...) và sẽ thoát game giữa chừng.
    // QUAN TRỌNG: e.touches gồm CẢ ngón đang giữ joystick (chạm trên #joystick, một phần tử khác hẳn canvas)
    // — phải loại bỏ ngón đó trước khi đếm số điểm chạm, nếu không vừa di chuyển (giữ joystick) vừa vuốt 1
    // ngón để xoay camera sẽ bị hiểu nhầm thành 2 ngón chụm zoom.
    const otherTouches = (e) => [...e.touches].filter((t) => t.identifier !== this.joystickTouchId);
    let lastTouch = null, pinchDist = null;
    cv.addEventListener('touchstart', (e) => {
      const touches = otherTouches(e);
      if (touches.length === 2) {
        e.preventDefault();
        pinchDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        return;
      }
      if (touches.length !== 1) return;
      const p = this.toLogicalXY(touches[0].clientX, touches[0].clientY);
      if (p.x > this.logicalWidth() / 2) {
        e.preventDefault();
        lastTouch = { x: touches[0].clientX, y: touches[0].clientY, id: touches[0].identifier };
      }
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      const touches = otherTouches(e);
      if (touches.length === 2 && pinchDist !== null) {
        e.preventDefault();
        const d = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        this.camDist = Math.max(3.5, Math.min(10, this.camDist - (d - pinchDist) * 0.02));
        pinchDist = d;
        return;
      }
      if (!lastTouch) return;
      e.preventDefault();
      for (const t of touches) {
        if (t.identifier === lastTouch.id) {
          const delta = this.toLogicalDelta(t.clientX - lastTouch.x, t.clientY - lastTouch.y);
          this.camYaw -= delta.x * 0.006;
          this.camPitch = Math.max(-0.5, Math.min(1.2, this.camPitch + delta.y * 0.005));
          lastTouch.x = t.clientX; lastTouch.y = t.clientY;
        }
      }
    }, { passive: false });
    cv.addEventListener('touchend', (e) => {
      const touches = otherTouches(e);
      if (touches.length < 2) pinchDist = null;
      if (touches.length === 0) lastTouch = null;
    });
  }

  // ---------- Bắt đầu / nạp level ----------
  startRun() {
    this.loadLevel(this.save.level);
    this.state = 'play';
    this.audio.startMusic();
  }

  loadLevel(level) {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => { o.geometry?.dispose?.(); });
    }
    this.world = generateLevel(level);
    this.scene.add(this.world.group);

    // nhân vật
    if (this.char) this.scene.remove(this.char);
    this.char = V.buildCharacter(this.save.charIndex);
    this.scene.add(this.char);
    this.swordMesh = V.buildSword(); this.swordMesh.visible = false;
    this.gunMesh = V.buildGun(); this.gunMesh.visible = false;
    // gắn vào Ổ CẮM BÀN TAY (trong nhóm cẳng tay) — vũ khí giữ góc cố định ~90° với cẳng tay,
    // chuyển động cùng chiều với tay trong suốt animation
    this.char.userData.socketR.add(this.swordMesh, this.gunMesh);
    this.swordMesh.position.set(0, -0.02, 0.1);
    this.swordMesh.rotation.x = Math.PI / 2;
    // súng nằm khít trong lòng bàn tay, nòng dọc theo hướng cẳng tay chỉ tới (hướng ngắm)
    this.gunMesh.position.set(0, -0.04, 0.1);
    this.gunMesh.rotation.x = Math.PI / 2;

    const p = this.world.portal;
    this.player = {
      pos: new THREE.Vector3(p.x, p.y, p.z),
      vel: new THREE.Vector3(),
      yaw: 0, grounded: true,
      lastPlat: null,          // vật thể lơ lửng đứng gần nhất {y,tier,x,z}
      canAirJump: false,
      invuln: 0, hp: CFG.player.maxHp,
      attackCd: 0, attackAnim: 0,
    };
    this.weapon = this.save.swordDur > 0 ? 'sword' : 'fist';
    this.updateWeaponMesh();

    // camera nhìn về hướng chuỗi vật thể
    const first = this.world.platforms[0];
    if (first) this.camYaw = Math.atan2(first.x - p.x, first.z - p.z);
    this.player.yaw = this.camYaw;
    this.camPitch = 0.25;
    if (this.tentacle) { this.scene.remove(this.tentacle); this.tentacle = null; }
    this.zoomClose = false;
    if (this.stunStars) { this.scene.remove(this.stunStars); this.stunStars = null; }
    for (const r of this.beamRings || []) this.scene.remove(r);
    this.beamRings = [];
    if (this.beamLight) { this.scene.remove(this.beamLight); this.beamLight = null; }
    for (const gh of this.bladeGhosts || []) this.scene.remove(gh.mesh);
    this.bladeGhosts = [];
    for (const b of this.bullets || []) this.scene.remove(b.mesh);
    this.bullets = [];
    this.aiming = false;
    this.aimDirWorld = null;
    for (const d of this.aimDots || []) d.visible = false;
    this.regenT = 0;
    this.char.rotation.set(0, 0, 0);
    this.beamT = 0;
    this.events.updateHUD();
    this.startSpawnEffect();
  }

  startSpawnEffect() {
    for (const r of this.spawnEffect?.rings || []) this.scene.remove(r);
    const p = this.world.portal;
    this.spawnEffect = { t: 0, ringTimer: 0, rings: [], cx: p.x, cz: p.z, baseY: p.y };
    this.char.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = 0; } });
  }

  stopToMenu() {
    this.state = 'idle';
    this.suppressAutoPause = false;
    document.exitPointerLock?.();
    this.audio.stopMusic();
  }

  // ---------- Tạm dừng ----------
  togglePause() {
    this.suppressAutoPause = false;
    if (this.state === 'play') {
      this.state = 'paused';
      this.keys = {};
      this.aiming = false;
      this.aimDirWorld = null;
      for (const d of this.aimDots || []) d.visible = false;
      document.exitPointerLock?.();
      this.events.showPause();
    } else if (this.state === 'paused') {
      this.state = 'play';
      this.events.hidePause();
    }
  }

  // ---------- Vũ khí ----------
  setWeapon(wp) {
    if (wp === 'sword' && this.save.swordDur <= 0) { this.events.toast('No sword yet — buy one in the Shop!'); return; }
    if (wp === 'gun' && !this.save.hasGun) { this.events.toast('No gun yet — buy one in the Shop!'); return; }
    this.weapon = wp;
    this.updateWeaponMesh();
    this.audio.sfx('click');
    this.events.updateHUD();
  }
  cycleWeapon() {
    const order = ['fist'];
    if (this.save.swordDur > 0) order.push('sword');
    if (this.save.hasGun) order.push('gun');
    const i = order.indexOf(this.weapon);
    this.weapon = order[(i + 1) % order.length];
    this.updateWeaponMesh();
    this.audio.sfx('click');
    this.events.updateHUD();
  }
  updateWeaponMesh() {
    if (!this.swordMesh) return;
    this.swordMesh.visible = this.weapon === 'sword';
    this.gunMesh.visible = this.weapon === 'gun';
  }

  // ---------- Giáp: mặc vào / tháo ra (không mất trang bị, chỉ ẩn/hiện + tắt/bật giảm sát thương) ----------
  toggleArmor() {
    if (this.save.armorDur <= 0) { this.events.toast('No armor yet — buy one in the Shop!'); return; }
    this.save.armorWorn = !this.save.armorWorn;
    this.audio.sfx('click');
    this.events.persist();
    this.events.updateHUD();
  }

  // ---------- Nhảy / tấn công ----------
  tryJump() {
    const pl = this.player;
    if (pl.grounded) {
      pl.vel.y = CFG.player.jumpV;
      pl.grounded = false;
      pl.airPeak = pl.pos.y;
      this.audio.sfx('jump');
    } else if (pl.canAirJump) {
      pl.vel.y = CFG.player.jumpV * 0.95;
      pl.canAirJump = false;
      this.audio.sfx('jump');
    }
  }

  attack() {
    const pl = this.player;
    if (pl.attackCd > 0 || this.state !== 'play') return;
    pl.attackCd = 0.45;
    pl.attackDur = this.weapon === 'sword' ? 0.5 : 0.28;
    pl.attackAnim = pl.attackDur;
    // Trên PC, nhân vật quay mặt theo đúng hướng camera lúc ra đòn (chuột xoay camera nhanh/chính xác nên
    // không thấy vướng). Trên điện thoại thì khác: joystick (di chuyển) và vuốt xoay camera là 2 thao tác
    // TÁCH RỜI nhau — nếu vẫn bắt quay mặt theo camera mỗi lần đánh, người chơi phải vuốt canh lại hướng
    // camera trước mỗi đòn, rất khó thao tác. Nên trên di động: đánh thẳng theo hướng đang đứng (đã quay
    // sẵn theo hướng di chuyển), CHỈ theo camera khi đang giữ nút ngắm (aiming — ngắm chính xác, ví dụ bắn súng).
    if (!this.isMobile || this.aiming) pl.yaw = this.camYaw;
    if (this.weapon === 'sword') {
      this.slashDir = -(this.slashDir || 1); // luân phiên chém chéo trái/phải
    }

    const s = this.save;
    if (this.weapon === 'gun') {
      if (s.ammo <= 0) { this.audio.sfx('deny'); this.events.toast('Out of ammo!'); return; }
      s.ammo--;
      this.audio.sfx('shoot');
      this.fireBullet();
    } else {
      const dmg = this.weapon === 'sword' ? CFG.shop.sword.dmg : CFG.player.fistDmg;
      const hit = this.hitScan(2.3, 1.2, dmg);
      if (hit && this.weapon === 'sword') {
        s.swordDur -= CFG.shop.sword.durHit;
        if (s.swordDur <= 0) {
          s.swordDur = 0;
          this.weapon = 'fist';
          this.updateWeaponMesh();
          this.events.toast('⚔ Your sword broke! Switched to bare hands.');
        }
      }
    }
    this.events.updateHUD();
  }

  // vệt kiếm = ảnh tàn của CHÍNH lưỡi kiếm: chụp transform thế giới của lưỡi ở từng khung hình pha chém
  // → vệt luôn trùng khít đường di chuyển thật của lưỡi kiếm
  spawnBladeGhost() {
    if (!this.swordMesh?.visible) return;
    this.ghostGeo ??= new THREE.BoxGeometry(0.1, 0.78, 0.09);
    const ghost = new THREE.Mesh(
      this.ghostGeo,
      new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.swordMesh.updateWorldMatrix(true, false);
    ghost.matrixAutoUpdate = false;
    ghost.matrix.copy(this.swordMesh.matrixWorld);
    ghost.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0.48, 0)); // tâm ảnh tàn = giữa lưỡi kiếm
    this.scene.add(ghost);
    this.bladeGhosts.push({ mesh: ghost, t: 0 });
  }

  // tìm mục tiêu (rương / quái) trong tầm + góc nhìn; trả về true nếu trúng
  hitScan(range, angleTol, dmg) {
    const pl = this.player;
    // dùng pl.yaw (hướng nhân vật ĐANG quay mặt) chứ không phải camYaw trực tiếp — 2 giá trị này chỉ chắc
    // chắn khớp nhau khi attack() vừa đồng bộ (xem giải thích ở đó); nếu hitScan tự ý dùng camYaw riêng thì
    // trên di động nhân vật sẽ vung kiếm một hướng nhưng trúng đòn theo hướng khác (camera), rất vô lý.
    const fwd = new THREE.Vector3(Math.sin(pl.yaw), 0, Math.cos(pl.yaw));
    const from = pl.pos.clone(); from.y += 0.9;
    let best = null, bestD = range;

    const consider = (x, y, z, obj, kind) => {
      const to = new THREE.Vector3(x - from.x, 0, z - from.z);
      const d = Math.hypot(x - from.x, z - from.z);
      if (d > bestD || Math.abs(y - pl.pos.y) > 2.5) return;
      to.normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, to.dot(fwd))));
      if (ang > angleTol && d > 0.7) return;
      best = { obj, kind }; bestD = d;
    };

    for (const c of this.world.chests) if (!c.broken) consider(c.x, c.y, c.z, c, 'chest');
    for (const m of this.world.monsters) if (!m.dead) consider(m.mesh.position.x, m.mesh.position.y, m.mesh.position.z, m, 'monster');

    if (!best) return false;
    this.applyHitTo(best, dmg);
    return true;
  }

  // gây sát thương lên mục tiêu (dùng chung cho đòn cận chiến và viên đạn)
  applyHitTo(best, dmg) {
    const pl = this.player;
    if (best.kind === 'chest') {
      const c = best.obj;
      c.hp -= dmg;
      this.audio.sfx('chest');
      c.mesh.scale.setScalar(1.15); setTimeout(() => c.mesh.scale.setScalar(1), 90);
      if (!pl.grounded) pl.canAirJump = true;   // nhảy lần 2 khi đánh trúng rương trên không
      if (c.hp <= 0) {
        c.broken = true;
        this.world.group.remove(c.mesh);
        const g = randInt(CFG.chest.goldMin, CFG.chest.goldMax);
        this.save.gold += g;
        this.audio.sfx('break');
        let msg = `🟡 +${g} gold from wooden chest!`;
        if (this.save.lives < CFG.lives.max && chance(0.05)) {
          this.save.lives++;
          msg += ' 💚 +1 life!';
        }
        this.events.toast(msg);
      }
    } else {
      const m = best.obj;
      m.hp -= dmg;
      m.flashT = 0.15;
      this.audio.sfx('hit');
      if (m.hp <= 0) {
        m.dead = true;
        const g = randInt(CFG.monsters.goldMin, CFG.monsters.goldMax);
        if (g > 0) { this.save.gold += g; this.events.toast(`🟡 +${g} gold from monster!`); this.audio.sfx('coin'); }
      }
    }
    this.events.updateHUD();
  }

  // hỗ trợ ngắm súng: tìm mục tiêu (rương/quái) trong hình nón trước mặt — dùng chung cho bắn thật & đường ngắm xem trước
  findGunTarget(range = 18) {
    const pl = this.player;
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const from = pl.pos.clone(); from.y += 0.9;
    let target = null, bestD = range;
    const consider = (x, y, z, obj, kind) => {
      const d = Math.hypot(x - from.x, z - from.z);
      if (d > bestD || Math.abs(y - pl.pos.y) > 2.5) return;
      const to = new THREE.Vector3(x - from.x, 0, z - from.z).normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, to.dot(fwd))));
      if (ang > 0.25 && d > 0.7) return;
      target = { obj, kind, x, y, z }; bestD = d;
    };
    for (const c of this.world.chests) if (!c.broken) consider(c.x, c.y + 0.4, c.z, c, 'chest');
    for (const m of this.world.monsters) if (!m.dead) consider(m.mesh.position.x, m.mesh.position.y + 0.8, m.mesh.position.z, m, 'monster');
    return target;
  }

  // hướng bắn/ngắm khi KHÔNG có mục tiêu tự động bắt: tính đủ 3 chiều từ yaw ngang + aimPitch (góc ngắm lên/xuống)
  gunAimDir() {
    const cp = Math.cos(this.aimPitch), sp = Math.sin(this.aimPitch);
    return new THREE.Vector3(Math.sin(this.camYaw) * cp, sp, Math.cos(this.camYaw) * cp).normalize();
  }

  // viên đạn thật bay ra từ đầu nòng súng — thấy được, chạm mục tiêu mới tính sát thương
  fireBullet() {
    const target = this.findGunTarget();

    // xuất phát đúng từ đầu nòng súng
    const muzzle = new THREE.Vector3();
    this.gunMesh.getWorldPosition(muzzle);
    const dir = target
      ? new THREE.Vector3(target.x - muzzle.x, target.y - muzzle.y, target.z - muzzle.z).normalize()
      : this.gunAimDir();
    muzzle.addScaledVector(dir, 0.35);

    const mesh = new THREE.Mesh(
      this.bulletGeo ??= new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe28a })
    );
    mesh.position.copy(muzzle);
    this.scene.add(mesh);
    this.bullets.push({ mesh, vel: dir.multiplyScalar(24), life: 1.0, dmg: CFG.shop.gun.dmg });
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      for (const m of this.world.monsters) {
        if (m.dead) continue;
        if (b.mesh.position.distanceTo(new THREE.Vector3(m.mesh.position.x, m.mesh.position.y + 0.7, m.mesh.position.z)) < 0.65) {
          this.applyHitTo({ obj: m, kind: 'monster' }, b.dmg);
          hit = true; break;
        }
      }
      if (!hit) {
        for (const c of this.world.chests) {
          if (c.broken) continue;
          if (b.mesh.position.distanceTo(new THREE.Vector3(c.x, c.y + 0.35, c.z)) < 0.6) {
            this.applyHitTo({ obj: c, kind: 'chest' }, b.dmg);
            hit = true; break;
          }
        }
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.material.dispose();
        this.bullets.splice(i, 1);
      }
    }
  }

  // ---------- Đường ngắm súng: chuỗi viên đạn mờ dẫn hướng, hiện khi giữ nút ngắm ----------
  ensureAimDots() {
    if (this.aimDots) return;
    this.aimDots = [];
    const geo = new THREE.SphereGeometry(0.075, 6, 6);
    for (let i = 0; i < 9; i++) {
      const dot = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffe28a, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      dot.visible = false;
      this.scene.add(dot);
      this.aimDots.push(dot);
    }
  }

  updateAimGuide(dt, t) {
    this.ensureAimDots();
    if (!this.aiming || this.weapon !== 'gun' || !this.gunMesh?.visible) {
      for (const d of this.aimDots) d.visible = false;
      this.aimDirWorld = null; // báo cho updateVisuals biết không cần xoay tay/thân/đầu theo hướng ngắm nữa
      return;
    }
    const target = this.findGunTarget();
    const muzzle = new THREE.Vector3();
    this.gunMesh.getWorldPosition(muzzle);
    const dir = target
      ? new THREE.Vector3(target.x - muzzle.x, target.y - muzzle.y, target.z - muzzle.z).normalize()
      : this.gunAimDir();
    this.aimDirWorld = dir.clone(); // updateVisuals dùng hướng này để xoay tay súng / thân người / đầu theo đúng hướng ngắm
    const maxDist = target ? Math.min(14, muzzle.distanceTo(new THREE.Vector3(target.x, target.y, target.z))) : 14;
    const n = this.aimDots.length;
    for (let i = 0; i < n; i++) {
      const frac = (i + 1) / n;
      const dist = 0.4 + frac * (maxDist - 0.4);
      const dot = this.aimDots[i];
      dot.position.copy(muzzle).addScaledVector(dir, dist);
      dot.visible = true;
      const flow = (Math.sin(t * 5 - i * 0.9) + 1) / 2; // hiệu ứng chảy dọc theo tia, dẫn mắt về phía mục tiêu
      dot.material.opacity = 0.15 + flow * 0.35;
    }
  }

  // ---------- Sát thương lên người chơi ----------
  damagePlayer(n, src) {
    const pl = this.player, s = this.save;
    if (pl.invuln > 0 || this.state !== 'play') return;
    if (s.armorDur > 0 && s.armorWorn && n > 0) {
      n = Math.max(0, n - CFG.shop.armor.reduce);
      s.armorDur--;
      this.audio.sfx('armor'); // luôn phát tiếng giáp đỡ đòn — kể cả khi giáp hấp thụ hết, không còn im lặng
      if (s.armorDur === 0) this.events.toast('🛡 Your armor broke!');
    }
    if (n <= 0) { this.events.updateHUD(); return; }
    pl.hp -= n;
    pl.invuln = 0.6;
    this.audio.sfx('hurt');
    this.events.updateHUD();
    if (pl.hp <= 0) this.die(src);
  }

  // rơi khỏi đường nhảy — tính theo tầng, có xét quả cầu bảo hộ
  applyFall(tier) {
    const s = this.save, pl = this.player;
    if (s.orbPoints > 0) {
      const loss = orbLoss(tier);
      s.orbPoints = Math.max(0, s.orbPoints - loss);
      this.events.toast(`🛡 Protection orb absorbed the fall from tier ${tier >= 10 ? '10+' : tier} (-${loss} protection)`);
      if (s.orbPoints === 0) this.events.toast('🛡 Protection orb depleted!');
      this.events.updateHUD();
      return true;
    }
    const dmg = fallDamage(tier);
    if (dmg >= 9999) { pl.hp = 0; this.events.updateHUD(); this.die('fall-high'); return false; }
    pl.hp -= dmg;
    this.events.toast(`💥 Fell from tier ${tier}! -${dmg} HP`);
    this.audio.sfx('hurt');
    this.events.updateHUD();
    if (pl.hp <= 0) { this.die('fall'); return false; }
    return true;
  }

  die(reason) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.aiming = false;
    this.aimDirWorld = null;
    for (const d of this.aimDots || []) d.visible = false;
    document.exitPointerLock?.();
    this.audio.sfx('lose');
    const msgs = {
      'fall': 'You fell from too great a height...',
      'fall-high': 'Falling from tier 10 or higher — no one survives that!',
      'monster': 'A monster took you down...',
      'water': 'A giant octopus tentacle has caught you!',
    };
    const hasLife = this.save.lives > 0;
    this.events.showDeath(
      reason === 'water' ? '🐙 Giant Octopus!' : '💀 You Fell',
      (msgs[reason] || msgs['fall']) + (hasLife
        ? ` Used 1 life (${this.save.lives - 1} left after this) — retrying level ${this.save.level}.`
        : ' You have no lives left...'),
      reason === 'water' // neo bảng lên trên để không che nhân vật nằm choáng váng
    );
  }

  // người chơi bấm nút sau khi thua
  afterDeath() {
    const s = this.save;
    if (s.lives > 0) {
      s.lives--;
      this.loadLevel(s.level);   // chơi lại level hiện tại — giữ nguyên level/vàng/kim cương
      this.state = 'play';
    } else {
      // hết mạng: reset tiến trình level về 1, giữ vàng + kim cương + trang bị
      s.level = 1;
      s.lives = CFG.lives.start;
      this.events.showGameOver();
      this.state = 'idle';
    }
    this.events.persist();
  }

  // ---------- Chạm nước → xúc tu bạch tuộc ----------
  waterDeath() {
    if (this.state !== 'play') return;
    this.state = 'tentacle';
    this.aiming = false;
    this.aimDirWorld = null;
    for (const d of this.aimDots || []) d.visible = false;
    document.exitPointerLock?.();
    this.audio.sfx('splash');
    const pl = this.player;

    this.tentacle = V.buildTentacle();
    this.tentacle.position.set(pl.pos.x, pl.pos.y - 6.5, pl.pos.z);
    this.scene.add(this.tentacle);
    this.tentacleT = 0;

    // tìm ô đất gần nhất để hất người chơi lên bờ
    let best = null, bestD = 15;
    for (const [k, h] of this.world.tiles) {
      if (this.world.water.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      const d = Math.hypot(x - pl.pos.x, z - pl.pos.z);
      if (d < bestD) { bestD = d; best = { x, y: h, z }; }
    }
    this.tentacleTarget = best;
    this.tentacleFrom = pl.pos.clone();
    // xúc tu quay mặt về phía bờ để cú quất trông đúng hướng
    if (best) this.tentacle.rotation.y = Math.atan2(best.x - pl.pos.x, best.z - pl.pos.z);
    // camera CHƯA zoom vội — chỉ kéo gần sau khi nhân vật đã nằm yên trên đất
  }

  updateTentacle(dt) {
    this.tentacleT += dt;
    const t = this.tentacleT;
    const pl = this.player;
    const segs = this.tentacle?.userData.segs || [];

    if (t < 1.1) {
      // 0–1.1s: xúc tu trồi lên, các khớp uốn lượn như sinh vật sống
      const k = Math.min(1, t / 1.0);
      this.tentacle.position.y = this.tentacleFrom.y - 6.5 + k * 7.2;
      segs.forEach((s, i) => {
        s.rotation.x = Math.sin(t * 5 + i * 0.7) * 0.16;
        s.rotation.z = Math.cos(t * 4 + i * 0.5) * 0.1;
      });
    } else if (t < 1.75) {
      // 1.1–1.75s: cuộn ngược lấy đà rồi QUẤT người chơi văng lên bờ
      const k = (t - 1.1) / 0.65;
      const windup = k < 0.35 ? -(k / 0.35) * 0.35 : 0;                 // ngả ra sau lấy đà
      const strike = k >= 0.35 ? Math.sin((k - 0.35) / 0.65 * Math.PI) : 0; // quất tới trước
      segs.forEach((s, i) => {
        s.rotation.x = windup + strike * (0.28 + i * 0.045);           // cong dần về phía ngọn
        s.rotation.z = Math.cos(t * 6 + i * 0.5) * 0.05;
      });
      if (k >= 0.35) {
        const fk = (k - 0.35) / 0.65;
        if (this.tentacleTarget) {
          pl.pos.lerpVectors(this.tentacleFrom,
            new THREE.Vector3(this.tentacleTarget.x, this.tentacleTarget.y + 0.1, this.tentacleTarget.z), fk);
          pl.pos.y += Math.sin(fk * Math.PI) * 3;   // vòng cung bay lên bờ
          this.char.rotation.set(-fk * Math.PI / 2, 0, 0); // ngã dần RA SAU — luôn nằm ngửa, không nghiêng
        } else {
          pl.pos.y = this.tentacleFrom.y - fk * 2;  // giữa biển: bị kéo xuống nước
        }
        this.char.position.copy(pl.pos);
      }
    } else if (t < 4.4) {
      // 1.75–4.4s: đã nằm yên hẳn trên đất → LÚC NÀY camera mới kéo gần, sao bắt đầu xoay
      this.char.rotation.set(-Math.PI / 2, 0, 0);   // cố định tư thế nằm ngửa
      this.char.position.copy(pl.pos);
      if (!this.zoomClose) {
        this.zoomClose = true;
        this.stunStars = V.buildStunStars();
        this.scene.add(this.stunStars);
        this.audio.sfx('hit');
      }
      segs.forEach((s, i) => {
        s.rotation.x = Math.sin(t * 2.2 + i * 0.6) * 0.12;
        s.rotation.z = Math.cos(t * 1.8 + i * 0.5) * 0.08;
      });
    } else {
      // hiện bảng thua (neo trên màn hình) — giữ nguyên cảnh nằm + xúc tu phía sau
      this.die('water');
    }
  }

  // ---------- Đảo đích ----------
  claimGoal() {
    const w = this.world;
    if (w.goal.claimed) return;
    w.goal.claimed = true;
    this.state = 'reward';
    this.aiming = false;
    this.aimDirWorld = null;
    for (const d of this.aimDots || []) d.visible = false;
    document.exitPointerLock?.();
    this.audio.sfx('win');
    this.rewardGold = randInt(CFG.goal.goldMin, CFG.goal.goldMax);
    const nextLevel = this.save.level + 1;
    const extraLife = this.save.level % CFG.lives.per === 0 && this.save.lives < CFG.lives.max;
    this.events.showReward(this.rewardGold, extraLife);
  }

  confirmReward() {
    const s = this.save;
    s.gold += this.rewardGold;
    s.diamonds += CFG.goal.diamond;
    if (s.level % CFG.lives.per === 0 && s.lives < CFG.lives.max) s.lives++;
    s.level++;
    s.maxLevel = Math.max(s.maxLevel, s.level);
    this.events.persist();
    // cảnh hóa thành chùm sáng: vòng sáng dâng lên, nhân vật sáng dần, thu nhỏ VÀ bay lên
    this.state = 'beam';
    this.beamT = 0;
    this.beamRings = [];
    this.ringTimer = 0;
    // vòng sáng dâng từ ĐÚNG TÂM bệ đá; nhân vật lướt về điểm đứng trước rương rồi bay lên
    this.beamFrom = this.player.pos.clone();
    this.beamCenter = { x: this.world.goal.x, z: this.world.goal.z };
    this.beamStand = { x: this.world.goal.frontX ?? this.world.goal.x, z: this.world.goal.frontZ ?? this.world.goal.z };
    this.beamBaseY = this.world.goal.y;
    this.beamRise = 0;
    this.beamBaseScale = this.char.scale.clone(); // giữ tỉ lệ cơ thể riêng của từng mẫu nhân vật
    this.beamLight = new THREE.PointLight(0xffffff, 0, 6);
    this.scene.add(this.beamLight);
    // cho phép làm mờ dần nhân vật
    this.char.traverse((o) => {
      if (o.material) { o.material.transparent = true; o.material.opacity = 1; }
    });
    this.audio.sfx('beam');
  }

  updateBeam(dt) {
    this.beamT += dt;
    const k = Math.min(1, this.beamT / 2.0);
    // 0–0.35s: lướt về điểm đứng trước rương (trong vòng sáng), sau đó mới bay lên
    const move = Math.min(1, this.beamT / 0.35);
    const cx = this.beamFrom.x + (this.beamStand.x - this.beamFrom.x) * move;
    const cz = this.beamFrom.z + (this.beamStand.z - this.beamFrom.z) * move;
    if (move >= 1) this.beamRise += dt * (0.8 + k * k * 16); // bay chậm rồi vút nhanh dần
    this.char.position.set(cx, this.beamBaseY + this.beamRise, cz);
    const bf = Math.max(0.4, 1 - k * 0.6);
    this.char.scale.set(this.beamBaseScale.x * bf, this.beamBaseScale.y * bf, this.beamBaseScale.z * bf);
    const fade = Math.max(0, 1 - k * 1.15);
    this.char.traverse((o) => { if (o.material) o.material.opacity = fade; });
    if (this.beamLight) {
      this.beamLight.position.set(this.char.position.x, this.char.position.y + 1, this.char.position.z);
      this.beamLight.intensity = 4 + k * 12;
    }
    // vòng sáng dâng lên từ đúng tâm vòng tròn đảo đích
    this.ringTimer -= dt;
    if (k < 0.8 && this.ringTimer <= 0) {
      this.ringTimer = 0.16;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.055, 8, 26),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(this.beamCenter.x, this.beamBaseY + 0.1, this.beamCenter.z);
      ring.userData.idx = this.beamRings.length;
      this.scene.add(ring);
      this.beamRings.push(ring);
    }
    // gradient mờ theo chiều cao + xung sáng chạy tuần tự từ dưới lên, NHANH DẦN theo thời gian
    const nR = Math.max(1, this.beamRings.length);
    const pulsePos = (this.beamT * (1.2 + this.beamT * 2.2)) % nR;
    for (const r of this.beamRings) {
      r.position.y += dt * 1.6;
      r.scale.multiplyScalar(1 + dt * 0.35);
      const hRel = r.position.y - this.beamBaseY;
      const heightFade = Math.max(0, 1 - hRel / 4.5);          // càng cao càng mờ, tan vào không trung
      let dIdx = Math.abs(r.userData.idx - pulsePos);
      dIdx = Math.min(dIdx, nR - dIdx);                        // khoảng cách vòng tròn (quay vòng)
      const pulse = Math.exp(-dIdx * dIdx * 2.5);              // vòng đang "tới lượt" sáng bừng lên
      r.material.opacity = (0.14 + 0.55 * pulse) * heightFade; // nền rất trong suốt
    }
    if (k >= 1) {
      for (const r of this.beamRings) this.scene.remove(r);
      this.beamRings = [];
      if (this.beamLight) { this.scene.remove(this.beamLight); this.beamLight = null; }
      this.char.scale.setScalar(1);
      this.loadLevel(this.save.level);
      this.state = 'play';
    }
  }

  // Di chuyển quái theo hướng mong muốn (desiredAng, radian, quy ước atan2(dx,dz)). Quái đi xuyên qua được
  // đá/cây trang trí (như người chơi hay bị vướng vào — ưu tiên vận động mượt mà hơn thực tế), chỉ còn ràng
  // buộc qua extraValid (VD không rời khỏi đảo). Nếu vẫn bị chặn (extraValid) LIÊN TỤC một lúc — quét thử
  // nhiều hướng quanh vòng tròn tìm lối thoát; nếu quét mãi vẫn không được (kẹt cứng thật sự, hiếm) thì sau
  // một lúc lâu hơn sẽ "nhảy" bừa một hướng ngẫu nhiên để chắc chắn thoát, kèm hiệu ứng nảy lên.
  monsterStep(m, desiredAng, spd, dt, extraValid) {
    const valid = (nx, nz) => !extraValid || extraValid(nx, nz);
    const step = spd * dt;
    let ang = desiredAng;
    if (m.stuckT > 0.4) {
      let found = false;
      for (let k = 0; k < 12 && !found; k++) {
        const tryAng = m.escapeSweep + k * (Math.PI / 6);
        const tx = m.mesh.position.x + Math.sin(tryAng) * step;
        const tz = m.mesh.position.z + Math.cos(tryAng) * step;
        if (valid(tx, tz)) { ang = tryAng; found = true; }
      }
      m.escapeSweep += 1.1; // lệch pha lần quét sau, tránh dò trúng y hệt hướng vừa thất bại
      if (!found && m.stuckT > 1.0) {
        // quét đủ kiểu vẫn không thoát được (kẹt cứng thật sự) — nhảy bừa ra ngoài cho chắc chắn thoát
        const forceAng = rand(0, Math.PI * 2);
        m.mesh.position.x += Math.sin(forceAng) * step * 3;
        m.mesh.position.z += Math.cos(forceAng) * step * 3;
        m.mesh.rotation.y = forceAng;
        m.hopT = 0.3;
        m.stuckT = 0;
        m.moving = true;
        return true;
      }
    }
    const nx = m.mesh.position.x + Math.sin(ang) * step;
    const nz = m.mesh.position.z + Math.cos(ang) * step;
    if (valid(nx, nz)) {
      m.mesh.position.x = nx; m.mesh.position.z = nz;
      m.mesh.rotation.y = ang;
      m.stuckT = 0;
      m.moving = true;
      return true;
    }
    m.stuckT += dt;
    m.mesh.rotation.y = ang;
    return false;
  }

  // ---------- Hỗ trợ va chạm ----------
  // trả về mặt đứng cao nhất dưới chân trong khoảng [minY, maxY], kèm nguồn
  supportAt(x, z, minY, maxY) {
    const w = this.world;
    let top = null, src = null;

    // đảo khởi đầu (xét 4 ô quanh chân)
    for (const dx of [-0.28, 0.28]) for (const dz of [-0.28, 0.28]) {
      const h = w.tiles.get(tileKey(x + dx, z + dz));
      if (h !== undefined && h >= minY && h <= maxY && (top === null || h > top)) { top = h; src = { kind: 'ground' }; }
    }
    // vật thể lơ lửng
    for (const p of w.platforms) {
      if (Math.abs(x - p.x) <= p.hw + 0.3 && Math.abs(z - p.z) <= p.hd + 0.3 &&
          p.y >= minY && p.y <= maxY && (top === null || p.y > top)) { top = p.y; src = { kind: 'plat', plat: p }; }
    }
    // đảo quái / đảo đích
    for (const isl of w.islands) {
      if (Math.hypot(x - isl.x, z - isl.z) <= isl.r + 0.2 &&
          isl.y >= minY && isl.y <= maxY && (top === null || isl.y > top)) { top = isl.y; src = { kind: 'island', isl }; }
    }
    // đứng trên rương
    for (const c of w.chests) {
      if (!c.broken && Math.abs(x - c.x) <= c.hw + 0.25 && Math.abs(z - c.z) <= c.hd + 0.25 &&
          c.top >= minY && c.top <= maxY && (top === null || c.top > top)) { top = c.top; src = { kind: 'chest' }; }
    }
    return top === null ? null : { top, src };
  }

  // ---------- Cập nhật người chơi ----------
  updatePlayer(dt) {
    const pl = this.player, w = this.world;
    pl.attackCd = Math.max(0, pl.attackCd - dt);
    pl.attackAnim = Math.max(0, pl.attackAnim - dt);
    pl.invuln = Math.max(0, pl.invuln - dt);

    // hồi máu tự động
    this.regenT = (this.regenT || 0) + dt;
    if (this.regenT >= CFG.player.regenSec) {
      this.regenT -= CFG.player.regenSec;
      if (pl.hp < CFG.player.maxHp) {
        pl.hp = Math.min(CFG.player.maxHp, pl.hp + CFG.player.regenAmount);
        this.events.updateHUD();
      }
    }

    // di chuyển theo hướng camera
    let ix = 0, iz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) iz += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) iz -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) ix -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) ix += 1;
    ix += this.moveVec.x; iz += this.moveVec.z;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }

    // trục "phải" của camera là (-cos, sin) khi nhìn theo (sin, cos) — trái/phải đúng chiều tự nhiên
    const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
    const mvx = (sin * iz - cos * ix);
    const mvz = (cos * iz + sin * ix);
    const speed = CFG.player.speed * (pl.grounded ? 1 : 0.85); // trên không vẫn điều chỉnh nhẹ được

    // đà ngang: mặt đất bám hoàn toàn, trên không giữ đà + chỉnh nhẹ
    if (pl.grounded) {
      pl.vel.x = mvx * speed;
      pl.vel.z = mvz * speed;
    } else {
      pl.vel.x += mvx * speed * 2.2 * dt;
      pl.vel.z += mvz * speed * 2.2 * dt;
      const hLen = Math.hypot(pl.vel.x, pl.vel.z);
      if (hLen > speed) { pl.vel.x *= speed / hLen; pl.vel.z *= speed / hLen; }
    }

    if (len > 0.1) pl.yaw = Math.atan2(mvx, mvz);

    // trọng lực + tích phân
    const prevY = pl.pos.y;
    pl.vel.y -= CFG.player.gravity * dt;
    pl.pos.x += pl.vel.x * dt;
    pl.pos.z += pl.vel.z * dt;
    pl.pos.y += pl.vel.y * dt;
    if (!pl.grounded) pl.airPeak = Math.max(pl.airPeak ?? pl.pos.y, pl.pos.y);

    // ===== VA CHẠM RẮN 6 MẶT =====
    // 1) Vách địa hình: ô đất cao hơn tầm bước chân (1 khối) là tường — đẩy ngang ra
    {
      const tx0 = Math.round(pl.pos.x), tz0 = Math.round(pl.pos.z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const tx = tx0 + dx, tz = tz0 + dz;
          const h = w.tiles.get(tileKey(tx, tz));
          if (h === undefined) continue;
          // "bước lên 1 khối" CHỈ áp dụng khi đang đứng đất; giữa không trung mọi khối cao hơn chân đều là tường
          // (fix bug: nhảy sát tường 2 tầng lách qua được khối trên cùng)
          const stepAllow = pl.grounded ? 1.05 : 0.05;
          // NGOẠI LỆ: nếu khung hình TRƯỚC đã ở ngang hoặc cao hơn đỉnh khối này (đang rơi xuống từ bên trên,
          // tức là đang đáp lên đúng đỉnh khối chứ không phải chui/lách từ dưới hoặc bên hông vào) thì không
          // coi là tường — nhường cho phần kiểm tra "đáp đất" bên dưới xử lý. Nếu không có ngoại lệ này, nhân
          // vật nhảy lên đúng 1 ô cao hơn sẽ bị đẩy văng ngang ngay khung hình chạm đỉnh (trước khi kịp đáp),
          // lọt ra ngoài rìa khối và rơi xuyên xuống dưới.
          const wasAboveTop = prevY >= h - 0.05;
          if (h <= pl.pos.y + stepAllow || wasAboveTop) continue;
          const ox = 0.82 - Math.abs(pl.pos.x - tx);   // 0.5 (nửa ô) + 0.32 (bán kính người)
          const oz = 0.82 - Math.abs(pl.pos.z - tz);
          if (ox > 0 && oz > 0 && pl.pos.y < h && pl.pos.y + 1.6 > 0) {
            if (ox < oz) pl.pos.x += Math.sign(pl.pos.x - tx || 0.01) * ox;
            else pl.pos.z += Math.sign(pl.pos.z - tz || 0.01) * oz;
          }
        }
      }
    }

    // 2) Vật thể lơ lửng: chặn 4 mặt ngang + đập đầu vào đáy khi nhảy từ dưới lên
    for (const p of w.platforms) {
      const dxp = pl.pos.x - p.x, dzp = pl.pos.z - p.z;
      if (Math.abs(dxp) >= p.hw + 0.3 || Math.abs(dzp) >= p.hd + 0.3) continue;
      const bottom = p.y - (p.depth || 1.2) - 0.05;
      // đập đầu vào mặt dưới khi đang bay lên
      if (pl.vel.y > 0 && prevY + 1.65 <= bottom + 0.06 && pl.pos.y + 1.65 > bottom) {
        pl.pos.y = bottom - 1.65;
        pl.vel.y = 0;
        continue;
      }
      // thân người kẹt giữa đáy và mặt trên → đẩy ngang ra — TRỪ khi khung hình trước đang ở ngang/cao hơn
      // mặt trên (đang rơi xuống từ bên trên để đáp lên đúng vật thể này, không phải đang chui/lách từ dưới
      // hoặc bên hông vào). Không có ngoại lệ này thì đúng khung hình sắp chạm mặt trên sẽ bị đẩy văng ngang
      // ra rìa trước khi phần "đáp đất" bên dưới kịp bắt được, khiến người chơi lọt qua rìa và rơi xuyên xuống.
      const landingFromAbove = prevY >= p.y - 0.12;
      if (!landingFromAbove && pl.pos.y < p.y - 0.12 && pl.pos.y + 1.6 > bottom) {
        const oxp = (p.hw + 0.3) - Math.abs(dxp);
        const ozp = (p.hd + 0.3) - Math.abs(dzp);
        if (oxp < ozp) pl.pos.x = p.x + Math.sign(dxp || 0.01) * (p.hw + 0.3);
        else pl.pos.z = p.z + Math.sign(dzp || 0.01) * (p.hd + 0.3);
      }
    }

    // 3) Thành đảo quái/đảo đích (hình trụ): đẩy ra khi va vào thành bên
    for (const isl of w.islands) {
      const dxi = pl.pos.x - isl.x, dzi = pl.pos.z - isl.z;
      const di = Math.hypot(dxi, dzi);
      if (di < isl.r + 0.3 && pl.pos.y < isl.y - 0.15 && pl.pos.y > isl.y - 3.5) {
        const push = isl.r + 0.3 - di;
        pl.pos.x += (dxi / (di || 0.01)) * push;
        pl.pos.z += (dzi / (di || 0.01)) * push;
      }
    }

    // 4) Cột đá + thân cây (vật cản hình trụ)
    for (const col of w.colliders || []) {
      const dx = pl.pos.x - col.x, dz = pl.pos.z - col.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d < col.r + 0.3 && pl.pos.y < col.y + col.h && pl.pos.y + 1.6 > col.y) {
        const push = col.r + 0.3 - d;
        pl.pos.x += (dx / d) * push;
        pl.pos.z += (dz / d) * push;
      }
    }

    // rương chắn đường: đẩy ngang ra
    for (const c of w.chests) {
      if (c.broken) continue;
      const dx = pl.pos.x - c.x, dz = pl.pos.z - c.z;
      if (Math.abs(dx) < c.hw + 0.3 && Math.abs(dz) < c.hd + 0.3 &&
          pl.pos.y < c.top - 0.1 && pl.pos.y + 1.6 > c.y) {
        if (Math.abs(dx) > Math.abs(dz)) pl.pos.x = c.x + Math.sign(dx) * (c.hw + 0.31);
        else pl.pos.z = c.z + Math.sign(dz) * (c.hd + 0.31);
      }
    }

    if (pl.grounded) {
      // bám mặt đất — bước lên/xuống bậc 1 khối
      const sup = this.supportAt(pl.pos.x, pl.pos.z, pl.pos.y - 1.2, pl.pos.y + 1.05);
      if (sup) {
        pl.pos.y = sup.top;
        pl.vel.y = 0;
        if (sup.src.kind === 'plat') pl.lastPlat = sup.src.plat;
        if (sup.src.kind === 'island' && sup.src.isl.tier !== 999) pl.lastPlat = { y: sup.src.isl.y, tier: sup.src.isl.tier, x: sup.src.isl.x, z: sup.src.isl.z, hw: sup.src.isl.r * 0.7, hd: sup.src.isl.r * 0.7 };
      } else {
        pl.grounded = false;
        pl.airPeak = pl.pos.y;
      }
    } else if (pl.vel.y <= 0) {
      // đang rơi: kiểm tra đáp xuống
      const sup = this.supportAt(pl.pos.x, pl.pos.z, pl.pos.y - 0.05, prevY + 0.01);
      if (sup && prevY >= sup.top - 0.05 && pl.pos.y <= sup.top + 0.05) {
        pl.pos.y = sup.top;
        pl.vel.y = 0;
        pl.grounded = true;
        pl.canAirJump = false;
        if (sup.src.kind === 'plat') pl.lastPlat = sup.src.plat;

        // sát thương rơi khi đáp xuống chỗ thấp hơn nhiều
        const drop = (pl.airPeak ?? sup.top) - sup.top;
        if (drop >= 3.2) {
          const tier = Math.max(1, Math.round(drop));
          const alive = this.applyFall(Math.min(tier, 12));
          if (!alive) return;
        }
        pl.airPeak = pl.pos.y;
      }
    }

    // rơi khỏi đường nhảy — hụt xuống vực sâu dưới vật thể gần nhất
    if (!pl.grounded && pl.vel.y < 0 && pl.lastPlat && pl.pos.y < pl.lastPlat.y - 8 && pl.pos.y > w.seaY + 1) {
      const alive = this.applyFall(pl.lastPlat.tier);
      if (alive) {
        pl.pos.set(pl.lastPlat.x, pl.lastPlat.y + 0.1, pl.lastPlat.z);
        pl.vel.set(0, 0, 0);
        pl.grounded = true;
        pl.invuln = 1;
        pl.airPeak = pl.pos.y;
      }
      return;
    }

    // chạm nước → chết ngay (biển hoặc hồ)
    if (pl.pos.y < w.seaY + 0.25) { this.waterDeath(); return; }
    const wk = tileKey(pl.pos.x, pl.pos.z);
    if (w.water.has(wk) && pl.pos.y <= w.water.get(wk) + 0.12) { this.waterDeath(); return; }

    // nhặt vàng
    for (const c of w.coins) {
      if (c.taken) continue;
      if (Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z) < 0.8 && Math.abs(pl.pos.y + 0.5 - c.y) < 1.2) {
        c.taken = true;
        w.group.remove(c.mesh);
        this.save.gold += c.value;
        this.audio.sfx('coin');
        this.events.updateHUD();
      }
    }

    // chạm rương vàng đảo đích — tính khoảng cách tới đúng vị trí rương (không phải tâm đảo), bán kính hẹp để phải tới sát mới nhận quà
    const g = w.goal;
    if (!g.claimed && Math.hypot(pl.pos.x - g.chestX, pl.pos.z - g.chestZ) < 1.7 && Math.abs(pl.pos.y - g.y) < 2) {
      this.claimGoal();
    }
  }

  // ---------- Quái vật ----------
  updateMonsters(dt) {
    const pl = this.player, w = this.world;
    for (const m of this.world.monsters) {
      if (m.dead) {
        if (m.hpBar) m.hpBar.visible = false;
        if (m.mesh.parent) {
          m.mesh.scale.multiplyScalar(1 - dt * 4);
          m.mesh.rotation.z += dt * 3;
          if (m.mesh.scale.x < 0.05) w.group.remove(m.mesh);
        }
        continue;
      }
      m.animT += dt;
      m.moving = false;
      m.attackAnim = Math.max(0, m.attackAnim - dt);
      m.recoilT = Math.max(0, m.recoilT - dt);

      const dx = pl.pos.x - m.mesh.position.x;
      const dz = pl.pos.z - m.mesh.position.z;
      const distP = Math.hypot(dx, dz);
      const playerNear = Math.hypot(pl.pos.x - m.island.x, pl.pos.z - m.island.z) < m.island.r + 1.5 &&
                         Math.abs(pl.pos.y - m.island.y) < 2.5;

      if (m.kind === 'melee') {
        m.atkCd = Math.max(0, m.atkCd - dt);

        // đòn đánh: kéo tay/vũ khí ra sau báo hiệu (windup) → vung mạnh ra trước (strike) → thu về.
        // Trúng đòn đúng lúc tay/vũ khí vươn xa nhất (không phải ngay lúc bắt đầu vung), không chỉ lắc thân.
        const wArm = m.mesh.userData.weaponArm;
        if (m.attackWindup > 0) {
          m.attackWindup = Math.max(0, m.attackWindup - dt);
          const wp = 1 - m.attackWindup / 0.2; // 0 → 1: đang kéo ra sau dần
          m.mesh.rotation.x = wp * 0.15;
          m.mesh.scale.setScalar(1 - wp * 0.06);
          if (wArm) wArm.rotation.x = wp * 0.9; // tay/vũ khí kéo ra sau chuẩn bị
          if (m.attackWindup <= 0 && m.attackPending) {
            m.attackPending = false;
            m.attackAnim = 0.3;
            m.attackHit = false;
          }
        } else if (m.attackAnim > 0) {
          const t = 1 - m.attackAnim / 0.3;
          // vung ra trước rất nhanh (đỉnh ở t≈0.35) rồi thu về từ từ
          const swing = t < 0.35 ? 0.9 - 1.9 * (t / 0.35) : -1.0 + 1.0 * ((t - 0.35) / 0.65);
          if (wArm) wArm.rotation.x = swing;
          m.mesh.rotation.x = -Math.sin(t * Math.PI) * 0.3; // thân phụ hoạ nhẹ, tay/vũ khí mới là chính
          m.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.08);
          if (!m.attackHit && t >= 0.35) {
            m.attackHit = true;
            const stillNear = Math.hypot(pl.pos.x - m.mesh.position.x, pl.pos.z - m.mesh.position.z) < 1.6;
            if (stillNear && this.state === 'play') this.damagePlayer(CFG.monsters.meleeDmg, 'monster');
          }
        } else {
          m.mesh.rotation.x = 0;
          m.mesh.scale.setScalar(1);
          if (wArm) wArm.rotation.x = 0;
        }

        const islandBound = (nx, nz) => Math.hypot(nx - m.island.x, nz - m.island.z) < m.island.r - 0.2;
        if (playerNear && this.state === 'play') {
          // đuổi theo người chơi
          if (distP > 1.1) {
            this.monsterStep(m, Math.atan2(dx, dz), 1.9, dt, islandBound);
          } else if (m.attackWindup <= 0 && !m.attackPending) {
            m.mesh.rotation.y = Math.atan2(dx, dz); // đứng yên trong tầm vẫn quay mặt về người chơi
          }
          if (distP < 1.35 && m.atkCd <= 0 && m.attackWindup <= 0 && !m.attackPending) {
            m.atkCd = 1.2;
            m.attackWindup = 0.2; // báo hiệu trước khi trúng đòn, không mất máu ngay tức khắc
            m.attackPending = true;
          }
        } else {
          // lang thang quanh đảo — bán kính/tốc độ/chiều riêng từng con nên đường đi không giống nhau,
          // tốc độ góc khớp đúng tốc độ đi thật để mặt luôn xoay theo đúng hướng đang di chuyển
          const wanderR = Math.max(1, (m.island.r - 1) * m.wanderRFrac);
          const wspd = m.wanderSpd;
          m.wanderA += dt * (wspd / wanderR) * m.wanderDir;
          const tx = m.island.x + Math.cos(m.wanderA) * wanderR;
          const tz = m.island.z + Math.sin(m.wanderA) * wanderR;
          const wx = tx - m.mesh.position.x, wz = tz - m.mesh.position.z;
          const wd = Math.hypot(wx, wz);
          if (wd > 0.08) this.monsterStep(m, Math.atan2(wx, wz), wspd, dt, islandBound);
        }
      } else {
        // animation quái tầm xa: khựng lại + phồng nhẹ khi vừa bắn; pháp sư còn giơ gậy chỉ về hướng bắn
        m.mesh.rotation.x = m.recoilT > 0 ? Math.sin((m.recoilT / 0.25) * Math.PI) * 0.3 : 0;
        const sc = m.recoilT > 0 ? 1 + Math.sin((m.recoilT / 0.25) * Math.PI) * 0.12 : 1;
        m.mesh.scale.setScalar(sc);
        if (m.mesh.userData.staffArm) {
          m.mesh.userData.staffArm.rotation.x = m.recoilT > 0 ? -Math.sin((m.recoilT / 0.25) * Math.PI) * 0.9 : 0;
        }

        // quái tầm xa — chỉ bắn liên tục khi người chơi ĐÃ đặt chân lên đảo
        m.burstCd = Math.max(0, m.burstCd - dt);
        const playerOnIsland = Math.hypot(pl.pos.x - m.island.x, pl.pos.z - m.island.z) < m.island.r - 0.2 &&
                               Math.abs(pl.pos.y - m.island.y) < 2.5;
        const moveTo = (tx, tz, spd) => {
          const vx = tx - m.mesh.position.x, vz = tz - m.mesh.position.z;
          const vd = Math.hypot(vx, vz);
          if (vd > 0.15) {
            this.monsterStep(m, Math.atan2(vx, vz), spd, dt);
            return false;
          }
          return true;
        };
        // hướng bắn có tính cả độ cao (nhắm đúng vị trí người chơi), không chỉ bắn thẳng phương ngang.
        // QUAN TRỌNG: nhân sin(a)/cos(a) (biên độ ≤1) với khoảng cách ngang thật (distP) trước khi ghép
        // với chênh lệch độ cao thô (vy) — nếu không, vy (có thể vài đơn vị) sẽ lấn át hẳn hướng ngang khi
        // chuẩn hoá, khiến đạn bay gần như thẳng đứng thay vì đúng hướng người chơi.
        const aimDir = (a) => {
          if (distP < 32 && this.state === 'play') {
            const vy = (pl.pos.y + 0.8) - (m.mesh.position.y + 0.7);
            const horiz = Math.max(distP, 0.5);
            return new THREE.Vector3(Math.sin(a) * horiz, vy, Math.cos(a) * horiz).normalize();
          }
          return new THREE.Vector3(Math.sin(a), 0.03, Math.cos(a)).normalize();
        };

        if (playerOnIsland && distP < 12 && this.state === 'play') {
          // chế độ tấn công: nhắm thẳng, bắn liên tục
          m.mode = 'attack';
          m.mesh.rotation.y = Math.atan2(dx, dz);
          if (m.burstCd <= 0) {
            m.burstCd = 0.85;
            this.fireProjectile(m, new THREE.Vector3(dx, (pl.pos.y + 0.8) - (m.mesh.position.y + 0.7), dz).normalize());
          }
        } else if (m.mode === 'burst') {
          // đứng ở mép, bắn đúng một loạt 3–5 phát rồi bắt buộc rút vào nghỉ
          if (m.burstLeft > 0) {
            if (m.burstCd <= 0) {
              m.burstCd = 0.3;
              m.burstLeft--;
              // nếu người chơi trong tầm nhìn thì nhắm bắn khá chính xác về phía đó, không thì bắn ra xa
              let a;
              if (distP < 32 && this.state === 'play') a = Math.atan2(dx, dz) + rand(-0.05, 0.05);
              else a = m.mesh.rotation.y + rand(-0.3, 0.3);
              m.mesh.rotation.y = a;
              this.fireProjectile(m, aimDir(a));
            }
          } else {
            m.mode = 'hide';
            m.idleCd = rand(2.5, 4.5); // thời gian nghỉ bắt buộc giữa các loạt
          }
        } else if (m.mode === 'toEdge') {
          // đang ĐI BỘ ra mép đảo để bắn — không dịch chuyển tức thời như trước nữa
          const arrived = moveTo(m.edgeTarget.x, m.edgeTarget.z, 1.7);
          if (arrived) {
            m.mode = 'burst';
            m.burstLeft = randInt(CFG.monsters.burstMin, CFG.monsters.burstMax);
            m.burstCd = 0.4;
            m.mesh.rotation.y = m.edgeTarget.a;
          }
        } else {
          // hide: rút vào giữa đảo nghỉ, hết giờ nghỉ mới đi bộ ra mép để bắn loạt mới
          m.mode = 'hide';
          moveTo(m.island.x, m.island.z, 1.6);
          m.idleCd -= dt;
          if (m.idleCd <= 0) {
            // chọn hướng ra mép: về phía người chơi nếu trong tầm nhìn, không thì ngẫu nhiên — rồi ĐI BỘ tới đó
            const a = (distP < 32 && this.state === 'play') ? Math.atan2(dx, dz) : rand(0, Math.PI * 2);
            m.edgeTarget = {
              a,
              x: m.island.x + Math.sin(a) * (m.island.r - 0.8),
              z: m.island.z + Math.cos(a) * (m.island.r - 0.8),
            };
            m.mode = 'toEdge';
          }
        }
      }

      // đứng đúng độ cao mặt đất tại vị trí hiện tại (bám theo gò đất nếu đang ở trên gò, tránh xuyên qua)
      const sup = this.supportAt(m.mesh.position.x, m.mesh.position.z, m.island.y - 0.6, m.island.y + 2.5);
      const groundY = sup ? sup.top : m.island.y;
      // dáng đi: nảy nhẹ + lắc người khi đang di chuyển, đứng yên thì thôi
      const bob = m.moving ? Math.abs(Math.sin(m.animT * 9)) * 0.07 : 0;
      m.mesh.rotation.z = m.moving ? Math.sin(m.animT * 9) * 0.06 : 0;
      // cú nhảy thoát kẹt — vòng cung nảy lên rồi rơi xuống trong 0.3s
      const hop = m.hopT > 0 ? Math.sin((0.3 - m.hopT) / 0.3 * Math.PI) * 0.7 : 0;
      if (m.hopT > 0) m.hopT = Math.max(0, m.hopT - dt);
      m.mesh.position.y = groundY + bob + hop + (m.flashT > 0 ? Math.sin(m.flashT * 40) * 0.06 : 0);
      if (m.flashT > 0) m.flashT -= dt;

      // thanh máu trên đầu — quay mặt về camera, đổi màu theo lượng máu
      if (m.hpBar) {
        const ratio = Math.max(0, m.hp / m.maxHp);
        m.hpBar.position.set(m.mesh.position.x, groundY + 2.15, m.mesh.position.z);
        m.hpBar.quaternion.copy(this.camera.quaternion);
        m.hpFg.scale.x = Math.max(0.001, ratio);
        m.hpFg.position.x = -0.4 * (1 - ratio);
        m.hpFg.material.color.setHex(ratio > 0.5 ? 0x6ad86a : ratio > 0.25 ? 0xe8c04a : 0xe05252);
        m.hpBar.visible = m.hp < m.maxHp || distP < 12;
      }
    }

    // tránh 2 quái cùng đảo đè lên nhau — đẩy nhẹ ra xa nếu đứng quá sát
    const monsters = w.monsters;
    for (let i = 0; i < monsters.length; i++) {
      const a = monsters[i];
      if (a.dead) continue;
      for (let j = i + 1; j < monsters.length; j++) {
        const b = monsters[j];
        if (b.dead || a.island.x !== b.island.x || a.island.z !== b.island.z) continue;
        const ddx = b.mesh.position.x - a.mesh.position.x, ddz = b.mesh.position.z - a.mesh.position.z;
        const dd = Math.hypot(ddx, ddz);
        const minSep = 0.85;
        if (dd > 0.001 && dd < minSep) {
          const push = (minSep - dd) / 2;
          const nx = ddx / dd, nz = ddz / dd;
          a.mesh.position.x -= nx * push; a.mesh.position.z -= nz * push;
          b.mesh.position.x += nx * push; b.mesh.position.z += nz * push;
        }
      }
    }

    // đạn quái
    for (let i = w.projectiles.length - 1; i >= 0; i--) {
      const p = w.projectiles[i];
      p.mesh.position.addScaledVector(p.vel, dt);
      p.life -= dt;
      const d = p.mesh.position.distanceTo(new THREE.Vector3(pl.pos.x, pl.pos.y + 0.9, pl.pos.z));
      if (d < 0.55 && this.state === 'play' && pl.invuln <= 0) {
        // chỉ đẩy lùi, không trừ máu
        const push = p.vel.clone().setY(0).normalize().multiplyScalar(5.5);
        pl.vel.x += push.x; pl.vel.z += push.z; pl.vel.y += 2.2;
        pl.grounded = false;
        pl.airPeak = pl.pos.y;
        this.audio.sfx('hit');
        this.events.toast('💨 Knocked back by monster fire!');
        p.life = 0;
      }
      if (p.life <= 0) { w.group.remove(p.mesh); w.projectiles.splice(i, 1); }
    }
  }

  fireProjectile(m, dir) {
    m.recoilT = 0.25; // động tác khựng lại khi bắn
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xe86ab0 })
    );
    mesh.position.set(m.mesh.position.x + dir.x * 0.5, m.mesh.position.y + 0.75, m.mesh.position.z + dir.z * 0.5);
    this.world.group.add(mesh);
    this.world.projectiles.push({ mesh, vel: dir.clone().multiplyScalar(8), life: 3 });
    this.audio.sfx('shoot');
  }

  // hiệu ứng xuất hiện ở cổng khởi đầu: vòng sáng dâng lên từ mặt cổng + nhân vật mờ dần rõ lên —
  // khi đã rõ hẳn thì dừng, không còn vòng sáng dâng lên nữa (đối xứng ngược với hiệu ứng bay lên ở đảo đích)
  updateSpawnEffect(dt) {
    const se = this.spawnEffect;
    if (!se) return;
    se.t += dt;
    const k = Math.min(1, se.t / 1.3);
    if (this.char) this.char.traverse((o) => { if (o.material) o.material.opacity = k; });
    se.ringTimer -= dt;
    if (k < 0.85 && se.ringTimer <= 0) {
      se.ringTimer = 0.16;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.055, 8, 26),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(se.cx, se.baseY + 0.1, se.cz);
      ring.userData.idx = se.rings.length;
      this.scene.add(ring);
      se.rings.push(ring);
    }
    const nR = Math.max(1, se.rings.length);
    const pulsePos = (se.t * (1.2 + se.t * 2.2)) % nR;
    for (const r of se.rings) {
      r.position.y += dt * 1.6;
      r.scale.multiplyScalar(1 + dt * 0.35);
      const hRel = r.position.y - se.baseY;
      const heightFade = Math.max(0, 1 - hRel / 4.5);
      let dIdx = Math.abs(r.userData.idx - pulsePos);
      dIdx = Math.min(dIdx, nR - dIdx);
      const pulse = Math.exp(-dIdx * dIdx * 2.5);
      r.material.opacity = (0.14 + 0.55 * pulse) * heightFade;
    }
    if (k >= 1) {
      for (const r of se.rings) this.scene.remove(r);
      if (this.char) this.char.traverse((o) => { if (o.material) o.material.opacity = 1; });
      this.spawnEffect = null;
    }
  }

  // ---------- Hoạt ảnh nhân vật & thế giới ----------
  updateVisuals(dt, t) {
    this.updateSpawnEffect(dt);
    const pl = this.player;
    // hoạt cảnh xúc tu/thua/bay lên tự điều khiển tư thế — không ghi đè ở đây
    const posing = this.state === 'tentacle' || this.state === 'dead' || this.state === 'beam';
    if (this.char && pl && !posing) {
      this.char.position.copy(pl.pos);
      const u = this.char.userData;

      // đang giữ ngắm súng: thân xoay DẦN về hướng ngắm (ngang), đầu xoay CHÍNH XÁC theo hướng ngắm (ngang + dọc)
      let headYawResidual = 0, aimPitchAngle = 0;
      if (this.aimDirWorld) {
        const aimYaw = Math.atan2(this.aimDirWorld.x, this.aimDirWorld.z);
        let dyaw = aimYaw - this.char.rotation.y;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); // quy về [-π, π], luôn quay theo đường ngắn nhất
        this.char.rotation.y += dyaw * Math.min(1, dt * 8);
        pl.yaw = this.char.rotation.y; // đồng bộ để lúc thôi ngắm thân không bị giật hướng
        headYawResidual = Math.atan2(Math.sin(aimYaw - this.char.rotation.y), Math.cos(aimYaw - this.char.rotation.y));
        aimPitchAngle = Math.asin(Math.max(-1, Math.min(1, this.aimDirWorld.y)));
        u.head.rotation.y = Math.max(-1.3, Math.min(1.3, headYawResidual));
        u.head.rotation.x = -aimPitchAngle;
      } else {
        this.char.rotation.y = pl.yaw;
        u.head.rotation.set(0, 0, 0);
      }

      const moving = Math.hypot(pl.vel.x, pl.vel.z) > 0.5;
      const swing = moving && pl.grounded ? Math.sin(t * 10) * 0.6 : 0;
      u.legL.rotation.x = swing;
      u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.7;
      u.foreL.rotation.x = moving ? -0.3 : -0.12; // khuỷu tay trái hơi gập tự nhiên
      // giáp hiện trên người khi đang sở hữu — ẩn mũ/tóc/tai/khăn riêng của nhân vật lúc này vì chúng
      // chiếm cùng chỗ với mũ giáp/cổ giáp, mặc cùng lúc sẽ chồng mesh gây nhấp nháy (z-fighting)
      const wearingArmor = this.save.armorDur > 0 && this.save.armorWorn;
      u.armorGroup.visible = wearingArmor;
      for (const o of u.hideWithArmor || []) o.visible = !wearingArmor;
      // animation tay phải: vai + khuỷu phối hợp theo từng loại vũ khí
      const prog = pl.attackAnim > 0 ? 1 - pl.attackAnim / (pl.attackDur || 0.28) : -1; // 0→1 trong lúc ra đòn
      u.armR.rotation.y = 0; // reset — chỉ nhánh súng-đang-ngắm bên dưới mới ghi đè
      if (this.weapon === 'gun') {
        // tư thế ngắm tự nhiên: vai đưa ra trước hơi thấp, tay khép vào thân, khuỷu hơi gập; giật nhẹ khi bắn
        // khi đang ngắm: vai nghiêng thêm theo góc ngắm dọc (lên/xuống) + xoay ngang bù phần thân chưa kịp quay tới
        u.armR.rotation.x = -1.25 - (prog >= 0 ? Math.sin(prog * Math.PI) * 0.22 : 0) - aimPitchAngle * 0.9;
        u.armR.rotation.y = this.aimDirWorld ? headYawResidual * 0.5 : 0;
        u.armR.rotation.z = -0.16;
        u.foreR.rotation.x = -0.35;
      } else if (prog >= 0 && this.weapon === 'sword') {
        // chém 3 giai đoạn bằng keyframe nội suy: nghỉ → vung lên qua vai → chém chéo xuống bên kia → hồi về nghỉ
        // cổ tay (ổ vũ khí) giữ nguyên góc với cẳng tay nên kiếm luôn chuyển động cùng chiều tay
        const dir = this.slashDir || 1;
        const rest = { ax: swing * 0.7, az: 0, fx: -0.12 };
        const up   = { ax: -2.5, az: dir * 0.85, fx: -1.15 };
        const end  = { ax: -0.35, az: -dir * 0.95, fx: -0.15 };
        let from, to, k;
        if (prog < 0.3)      { from = rest; to = up;  k = prog / 0.3; }          // 1. vung lên (windup)
        else if (prog < 0.7) { from = up;   to = end; k = (prog - 0.3) / 0.4; }  // 2. chém chéo (swing)
        else                 { from = end;  to = rest; k = (prog - 0.7) / 0.3; } // 3. hồi (recovery)
        u.armR.rotation.x = from.ax + (to.ax - from.ax) * k;
        u.armR.rotation.z = from.az + (to.az - from.az) * k;
        u.foreR.rotation.x = from.fx + (to.fx - from.fx) * k;
        // ảnh tàn lưỡi kiếm trong pha chém — vệt bám đúng đường lưỡi thật
        if (prog >= 0.3 && prog < 0.72) this.spawnBladeGhost();
      } else if (prog >= 0) {
        // đấm thẳng: vai + khuỷu cùng duỗi
        u.armR.rotation.x = -1.2 * Math.sin(prog * Math.PI);
        u.armR.rotation.z = 0;
        u.foreR.rotation.x = -0.8 * Math.sin(prog * Math.PI);
      } else {
        u.armR.rotation.x = swing * 0.7;
        u.armR.rotation.z = 0;
        u.foreR.rotation.x = moving ? -0.3 : -0.12;
      }
      if (!pl.grounded) { u.legL.rotation.x = 0.4; u.legR.rotation.x = -0.3; }
    }

    // mây trôi
    for (const c of this.world?.clouds || []) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 100) c.position.x = -100;
    }
    // vàng xoay
    for (const c of this.world?.coins || []) {
      if (!c.taken) { c.mesh.rotation.y += dt * 2.5; c.mesh.position.y = c.y + Math.sin(t * 2 + c.x) * 0.08; }
    }
    // cổng sáng nhấp nháy + trụ ánh sáng thở nhẹ
    for (const p of this.world?.portals || []) {
      if (p.userData.disc) p.userData.disc.material.opacity = 0.45 + Math.sin(t * 2.4) * 0.18;
      if (p.userData.pillar) p.userData.pillar.material.opacity = 0.12 + Math.sin(t * 1.8) * 0.06;
    }
    // vật trang trí lơ lửng bồng bềnh
    for (const f of this.world?.floaters || []) {
      f.position.y = f.userData.baseY + Math.sin(t * 0.5 + f.userData.bobPhase) * 0.8;
      f.rotation.y += dt * 0.08;
    }
    // hạt lấp lánh quanh kho báu
    for (const sp of this.world?.sparkles || []) {
      sp.rotation.y = t * 0.8;
      sp.material.opacity = 0.6 + Math.sin(t * 5) * 0.35;
    }
    // ảnh tàn lưỡi kiếm mờ dần rồi biến mất
    for (let i = this.bladeGhosts.length - 1; i >= 0; i--) {
      const gh = this.bladeGhosts[i];
      gh.t += dt;
      if (gh.t >= 0.16) {
        this.scene.remove(gh.mesh);
        gh.mesh.material.dispose();
        this.bladeGhosts.splice(i, 1);
      } else {
        gh.mesh.material.opacity = 0.55 * (1 - gh.t / 0.16);
      }
    }

    // vật nuôi (thỏ/chó/mèo/gà) di chuyển loanh quanh trên đảo — mỗi loại một kiểu hành vi riêng.
    // dùng chung 1 hàm kiểm tra hợp lệ: không lệch quá 1 tầng cao, không phải nước, không đâm vào vật cản rắn
    // (cột, đá...) — áp dụng cho MỌI loại kể cả thỏ, để không con nào xuyên tầng/xuyên vật thể được nữa
    const animalBlocked = (x, z, curH) => {
      const key = `${Math.round(x)},${Math.round(z)}`;
      const h = this.world.tiles.get(key);
      if (h === undefined || this.world.water.has(key)) return true;
      if (curH !== undefined && Math.abs(h - curH) > 1) return true;
      for (const c of this.world.colliders || []) {
        if (Math.hypot(x - c.x, z - c.z) < c.r + 0.18) return true;
      }
      return false;
    };
    for (const a of this.world?.animals || []) {
      a.timer -= dt;
      const isWalker = a.type !== 'rabbit'; // chó/mèo/gà: đi bộ thật; thỏ: giữ kiểu nhảy cong đặc trưng
      if (a.state === 'idle') {
        // gà đứng mổ mổ khi đang đứng yên
        if (a.type === 'chicken' && a.mesh.userData.head) {
          a.peckT = (a.peckT || 0) + dt;
          const cyc = a.peckT % 2.2;
          a.mesh.userData.head.rotation.x = cyc < 0.3 ? Math.sin((cyc / 0.3) * Math.PI) * 0.9 : 0;
        }
        if (a.timer <= 0) {
          // chó/mèo thỉnh thoảng ngồi nghỉ một lúc lâu thay vì di chuyển ngay (không ngồi 2 lần liên tiếp)
          if ((a.type === 'dog' || a.type === 'cat') && !a.justSat && Math.random() < 0.3) {
            a.justSat = true; a.sitting = true;
            a.mesh.position.y -= 0.05; // hạ thấp người xuống một chút ra dáng ngồi
            a.timer = rand(3, 6);
            continue;
          }
          if (a.sitting) { a.mesh.position.y += 0.05; a.sitting = false; }
          a.justSat = false;

          const curKey = `${Math.round(a.mesh.position.x)},${Math.round(a.mesh.position.z)}`;
          const curH = this.world.tiles.get(curKey);

          if (isWalker) {
            // gà thỉnh thoảng chạy nhanh một đoạn dài hơn bình thường
            a.running = a.type === 'chicken' && Math.random() < 0.22;
            let found = false;
            for (let tries = 0; tries < 8 && !found; tries++) {
              const dir = Math.random() * Math.PI * 2;
              const px = a.mesh.position.x + Math.sin(dir) * 1.2, pz = a.mesh.position.z + Math.cos(dir) * 1.2;
              if (!animalBlocked(px, pz, curH)) { a.dir = dir; found = true; }
            }
            if (found) {
              a.state = 'walk';
              a.walkT = a.running ? rand(0.8, 1.6) : rand(1.5, 4);
              a.mesh.rotation.y = a.dir;
            } else a.timer = 0.4;
          } else {
            // thỏ: nhảy cong tới điểm ngẫu nhiên, kiểm tra cả điểm giữa lẫn điểm đến cho hợp lệ
            const ang = Math.random() * Math.PI * 2, d = 1 + Math.random() * 2.2;
            const tx = a.mesh.position.x + Math.sin(ang) * d, tz = a.mesh.position.z + Math.cos(ang) * d;
            const mx = a.mesh.position.x + Math.sin(ang) * d * 0.5, mz = a.mesh.position.z + Math.cos(ang) * d * 0.5;
            if (!animalBlocked(tx, tz, curH) && !animalBlocked(mx, mz, curH)) {
              const key = `${Math.round(tx)},${Math.round(tz)}`;
              a.from = a.mesh.position.clone();
              a.to = { x: tx, y: this.world.tiles.get(key), z: tz };
              a.state = 'hop'; a.hopT = 0;
              a.mesh.rotation.y = Math.atan2(tx - a.from.x, tz - a.from.z);
            } else a.timer = 0.4;
          }
        }
      } else if (a.state === 'walk') {
        // đi bộ thật: từng bước nhỏ liên tục theo tốc độ, chân luôn dính mặt đất — không cung nhảy
        const curKey = `${Math.round(a.mesh.position.x)},${Math.round(a.mesh.position.z)}`;
        const curH = this.world.tiles.get(curKey);
        const spd = a.running ? (a.runSpeed ?? 2.5) : (a.walkSpeed ?? 1.0);
        const nx = a.mesh.position.x + Math.sin(a.dir) * spd * dt;
        const nz = a.mesh.position.z + Math.cos(a.dir) * spd * dt;
        a.walkT -= dt;
        if (a.walkT <= 0 || animalBlocked(nx, nz, curH)) {
          a.state = 'idle'; a.timer = 0.8 + Math.random() * 2.5; a.running = false;
        } else {
          const key = `${Math.round(nx)},${Math.round(nz)}`;
          a.mesh.position.x = nx; a.mesh.position.z = nz;
          a.mesh.position.y = this.world.tiles.get(key);
        }
      } else { // 'hop' — chỉ thỏ dùng, cung nhảy cong đặc trưng
        a.hopT += dt / (a.hopSec ?? 0.55);
        if (a.hopT >= 1) {
          a.mesh.position.set(a.to.x, a.to.y, a.to.z);
          a.state = 'idle'; a.timer = 0.8 + Math.random() * 2.5;
        } else {
          a.mesh.position.x = a.from.x + (a.to.x - a.from.x) * a.hopT;
          a.mesh.position.z = a.from.z + (a.to.z - a.from.z) * a.hopT;
          a.mesh.position.y = a.from.y + (a.to.y - a.from.y) * a.hopT + Math.sin(a.hopT * Math.PI) * (a.hopH ?? 0.45);
        }
      }
    }

    // cá voi ngoài khơi: thỉnh thoảng trồi lên phun nước rồi lặn xuống, đổi chỗ ngẫu nhiên mỗi lần
    const wh = this.world?.whale;
    if (wh) {
      wh.timer -= dt;
      if (wh.state === 'hidden') {
        if (wh.timer <= 0) {
          const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 40;
          wh.mesh.position.set(Math.cos(a) * d, wh.baseY - 3, Math.sin(a) * d);
          wh.mesh.rotation.y = Math.random() * Math.PI * 2;
          // càng gần đảo càng to (gấp đôi khi ở sát vùng gần), càng xa thì giữ kích thước gốc
          const scale = THREE.MathUtils.clamp(2.0 - (d - 24) / (50 - 24), 1.0, 2.0);
          wh.mesh.scale.setScalar(scale);
          wh.mesh.visible = true;
          wh.state = 'rise'; wh.t = 0;
        }
      } else if (wh.state === 'rise') {
        wh.t += dt;
        const k = Math.min(1, wh.t / 2.6); // trồi lên từ từ
        wh.mesh.position.y = wh.baseY - 3 + k * 3.15;
        if (k >= 1) {
          wh.state = 'hold'; wh.t = 0; wh.spoutT = 0;
          const { jet, droplets } = wh.spout.userData;
          wh.spout.visible = true;
          jet.visible = true; jet.scale.set(1, 0.15, 1); jet.material.opacity = 0.7;
          droplets.visible = true; droplets.material.opacity = 0.85;
        }
      } else if (wh.state === 'hold') {
        wh.t += dt;
        wh.spoutT += dt; // tia nước phun nhanh như thật, tách riêng khỏi thời lượng cá voi nổi trên mặt
        const { jet, droplets } = wh.spout.userData;
        jet.scale.y = Math.min(1.7, jet.scale.y + dt * 3.2);
        jet.material.opacity = Math.max(0, 0.7 - wh.spoutT * 0.45);
        // hạt nước tõe ra xung quanh đỉnh tia, rơi dần xuống theo trọng lực rồi mờ tắt
        const dirs = droplets.userData.dirs;
        const posAttr = droplets.geometry.attributes.position;
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i], r = d.speed * wh.spoutT;
          posAttr.array[i * 3] = Math.cos(d.a) * r;
          posAttr.array[i * 3 + 1] = 0.75 + d.up * wh.spoutT - 2.2 * wh.spoutT * wh.spoutT;
          posAttr.array[i * 3 + 2] = Math.sin(d.a) * r;
        }
        posAttr.needsUpdate = true;
        droplets.material.opacity = Math.max(0, 0.85 - wh.spoutT * 0.6);
        if (wh.spoutT >= 1.7 && jet.visible) { jet.visible = false; droplets.visible = false; }
        if (wh.t >= 3.2) { // nán lại trên mặt biển một lúc rồi mới lặn, không vội vã
          wh.state = 'sink'; wh.t = 0;
          wh.spout.visible = false; jet.visible = false; droplets.visible = false;
        }
      } else if (wh.state === 'sink') {
        wh.t += dt;
        const k = Math.min(1, wh.t / 2.4); // lặn xuống từ từ
        wh.mesh.position.y = wh.baseY - 3 + (1 - k) * 3.15;
        if (k >= 1) {
          wh.mesh.visible = false;
          wh.state = 'hidden';
          wh.timer = 14 + Math.random() * 26; // thỉnh thoảng thôi, không dồn dập
        }
      }
    }

    // sao choáng váng xoay vòng quanh đầu (chạy cả khi bảng thua đang mở)
    if (this.stunStars && pl) {
      this.stunStars.rotation.y += dt * 4.5;
      this.stunStars.position.set(pl.pos.x, pl.pos.y + 0.7, pl.pos.z);
    }

    // hạt bụi trôi
    if (this.dust) this.dust.rotation.y = t * 0.01;

    // nhấp nháy khi bất tử tạm thời
    if (this.char && !posing) this.char.visible = !(pl?.invuln > 0 && Math.floor(t * 12) % 2 === 0);
  }

  updateCamera(dt) {
    const pl = this.player;
    if (!pl) return;
    // hoạt cảnh xúc tu/choáng váng: kéo camera lại gần nhìn rõ
    const dist = this.zoomClose ? 3.4 : this.camDist;
    const pitch = this.zoomClose ? 0.4 : this.camPitch;
    const target = new THREE.Vector3(pl.pos.x, pl.pos.y + (this.zoomClose ? 0.8 : 1.5), pl.pos.z);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const off = new THREE.Vector3(
      -Math.sin(this.camYaw) * cp * dist,
      sp * dist + 0.5,
      -Math.cos(this.camYaw) * cp * dist
    );
    const desired = target.clone().add(off);
    if (desired.y < this.world.seaY + 0.5) desired.y = this.world.seaY + 0.5;
    this.camera.position.lerp(desired, Math.min(1, dt * 10));
    this.camera.lookAt(target);

    // nắng đi theo người chơi để bóng đổ luôn đẹp
    this.sun.position.set(pl.pos.x + 20, pl.pos.y + 35, pl.pos.z + 12);
    this.sun.target.position.set(pl.pos.x, pl.pos.y, pl.pos.z);
    this.sun.target.updateMatrixWorld();
  }

  // ---------- Vòng lặp chính ----------
  animate() {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    if (this.world) {
      if (this.state === 'play') {
        this.updatePlayer(dt);
        this.updateMonsters(dt);
        this.updateBullets(dt);
        this.updateAimGuide(dt, t);
      } else if (this.state === 'tentacle' && this.tentacle) {
        this.updateTentacle(dt);
      } else if (this.state === 'beam') {
        this.updateBeam(dt);
      }
      this.updateVisuals(dt, t);
      this.updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
    }
  }
}
