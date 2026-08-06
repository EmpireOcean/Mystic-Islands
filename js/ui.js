// ===== Giao diện: màn hình, HUD, shop, bảng xếp hạng, túi đồ, joystick =====
import * as THREE from 'three';
import { CFG, randInt, pick } from './config.js';
import { CHAR_SKINS, buildCharacter, buildSword, buildGun } from './voxel.js';

const $ = (id) => document.getElementById(id);

const FAKE_NAMES = ['WhiteCloud', 'SeaWind', 'WildWolf', 'MapleLeaf', 'Firefly', 'MidnightMoon',
  'Seagull', 'ShootingStar', 'LittleFox', 'GoldTurtle', 'Storm', 'MorningMist', 'SummerSun', 'PaperBoat'];

export class UI {
  constructor(save, audio) {
    this.save = save;
    this.audio = audio;
    this.isMobile = 'ontouchstart' in window;
    this.selectedChar = save.charIndex;
    this.warnTimer = null;
  }

  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  }
  hideAll() { this.showScreen(null); }

  showHUD(show) {
    $('hud').classList.toggle('hidden', !show);
    if (this.isMobile) {
      $('joystick').classList.remove('hidden');
      $('mobile-btns').classList.remove('hidden');
      $('btn-rotate').classList.remove('hidden');
    }
  }

  // ---------- Tạo nhân vật ----------
  renderCharScreen() {
    $('name-row').style.display = this.save.name ? 'none' : 'flex';
    const list = $('char-list');
    list.innerHTML = '';
    CHAR_SKINS.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'char-card' + (i === this.selectedChar ? ' sel' : '');
      const hex = (n) => '#' + n.toString(16).padStart(6, '0');
      card.innerHTML = `
        <div class="char-avatar">
          <div style="left:18px;top:0;width:20px;height:8px;background:${hex(s.hair)}"></div>
          <div style="left:19px;top:7px;width:18px;height:16px;background:${hex(s.skin)}"></div>
          <div style="left:14px;top:24px;width:28px;height:22px;background:${hex(s.shirt)}"></div>
          <div style="left:17px;top:47px;width:10px;height:20px;background:${hex(s.pants)}"></div>
          <div style="left:29px;top:47px;width:10px;height:20px;background:${hex(s.pants)}"></div>
        </div>
        <div class="char-name">${s.name}</div>`;
      card.onclick = () => {
        this.selectedChar = i;
        this.audio.sfx('click');
        this.renderCharScreen();
      };
      list.appendChild(card);
    });
  }

  // ---------- Bảng xếp hạng ----------
  renderScores() {
    const s = this.save;
    const list = $('score-list');
    const L = CFG.leaderboard;
    const myLevel = s.maxLevel;

    // sinh tên giả định quanh level người chơi — mỗi lần mở lại đổi mới
    const names = [...FAKE_NAMES].sort(() => Math.random() - 0.5);
    const rows = [{ name: s.name || 'You', level: myLevel, gold: s.gold, dia: s.diamonds, me: true }];

    const isTop = myLevel >= L.fakeLevelMax;
    const above = isTop ? 2 : Math.min(2, Math.max(1, 2));
    for (let i = 0; i < 2; i++) {
      // 2 người trên (nếu người chơi top 1 vẫn sinh 2 tên cao hơn để luôn có mục tiêu)
      rows.push({ name: names.pop(), level: myLevel + randInt(2, 15) + i * randInt(3, 10),
        gold: randInt(L.fakeGoldMin, L.fakeGoldMax), dia: randInt(L.fakeDiaMin, L.fakeDiaMax) });
    }
    for (let i = 0; i < 2; i++) {
      const lv = Math.max(1, myLevel - randInt(1, 8) - i * randInt(1, 6));
      rows.push({ name: names.pop(), level: lv,
        gold: randInt(L.fakeGoldMin, L.fakeGoldMax), dia: randInt(L.fakeDiaMin, L.fakeDiaMax) });
    }
    rows.sort((a, b) => b.level - a.level);

    list.innerHTML = '';
    rows.slice(0, L.rows).forEach((r, i) => {
      const div = document.createElement('div');
      div.className = 'score-row' + (r.me ? ' me' : '');
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      div.innerHTML = `
        <div class="score-rank">${medal}</div>
        <div class="score-name">${r.name}${r.me && s.name ? ' (you)' : ''}<div class="score-sub">🟡 ${r.gold} · 💎 ${r.dia}</div></div>
        <div class="score-level">Level ${r.level}</div>`;
      list.appendChild(div);
    });
  }

  // ---------- Shop ----------
  renderShop(onBuy) {
    const s = this.save;
    $('shop-balance').innerHTML = `<span>🟡 ${s.gold} Gold</span><span>💎 ${s.diamonds} Diamonds</span>`;
    const items = [
      {
        ico: '🛡', name: 'Armor',
        desc: `Reduces ${CFG.shop.armor.reduce} damage per hit` +
          (s.armorDur > 0 ? ` · Current: ${s.armorDur}/${CFG.shop.armor.maxDur} durability` : ` · Durability ${CFG.shop.armor.dur}`),
        // đã có sẵn giáp trên người: mua thêm là CỘNG DỒN +dur độ bền (không mua ra cái giáp thứ 2), tối đa maxDur
        label: s.armorDur >= CFG.shop.armor.maxDur ? 'Durability maxed'
          : s.armorDur > 0 ? `Reinforce +${CFG.shop.armor.dur} (${CFG.shop.armor.price} 🟡)`
          : `Buy ${CFG.shop.armor.price} 🟡`,
        can: s.armorDur < CFG.shop.armor.maxDur && s.gold >= CFG.shop.armor.price,
        buy: () => {
          s.gold -= CFG.shop.armor.price;
          if (s.armorDur > 0) {
            s.armorDur = Math.min(CFG.shop.armor.maxDur, s.armorDur + CFG.shop.armor.dur);
          } else {
            s.armorDur = CFG.shop.armor.dur;
            s.armorWorn = true; // mua lần đầu thì mặc luôn
          }
        },
      },
      {
        ico: '🗡', name: 'Sword', desc: `Damage ${CFG.shop.sword.dmg} · Durability ${CFG.shop.sword.dur}` +
          (s.swordDur > 0 ? ` · Current: ${s.swordDur} durability` : ''),
        price: `${CFG.shop.sword.price} 🟡`, can: s.gold >= CFG.shop.sword.price,
        buy: () => { s.gold -= CFG.shop.sword.price; s.swordDur = CFG.shop.sword.dur; },
      },
      {
        ico: '🔫', name: 'Gun', desc: `Damage ${CFG.shop.gun.dmg} · Requires ammo` + (s.hasGun ? ' · ✔ Owned' : ''),
        price: s.hasGun ? '—' : `${CFG.shop.gun.price} 🟡`, can: !s.hasGun && s.gold >= CFG.shop.gun.price,
        buy: () => { s.gold -= CFG.shop.gun.price; s.hasGun = true; },
      },
      {
        ico: '🥏', name: 'Ammo ×5', desc: `Each shot uses 1 round · Current: ${s.ammo} rounds`,
        price: `${CFG.shop.ammo.price * 5} 🟡`, can: s.gold >= CFG.shop.ammo.price * 5,
        buy: () => { s.gold -= CFG.shop.ammo.price * 5; s.ammo += 5; },
      },
      {
        ico: '🔮', name: 'Protection Orb', desc: `${CFG.shop.orb.points} protection points — absorbs fall damage` +
          (s.orbPoints > 0 ? ` · Current: ${s.orbPoints} points` : ''),
        price: `${CFG.shop.orb.price} 💎`, can: s.diamonds >= CFG.shop.orb.price,
        buy: () => { s.diamonds -= CFG.shop.orb.price; s.orbPoints += CFG.shop.orb.points; },
      },
    ];
    const list = $('shop-list');
    list.innerHTML = '';
    items.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.innerHTML = `
        <div class="shop-ico">${it.ico}</div>
        <div class="shop-info"><b>${it.name}</b><small>${it.desc}</small></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn' + (it.can ? '' : ' disabled');
      btn.textContent = it.label ?? (it.price === '—' ? 'Owned' : `Buy ${it.price}`);
      btn.onclick = () => {
        if (!it.can) { this.audio.sfx('deny'); return; }
        it.buy();
        this.audio.sfx('buy');
        onBuy();
        this.renderShop(onBuy);
      };
      div.appendChild(btn);
      list.appendChild(div);
    });
  }

  // ---------- Túi đồ: chọn trang bị + xem trước nhân vật ----------
  renderBag(game) {
    const s = this.save;
    const list = $('bag-list');
    list.innerHTML = '';

    const addRow = (html, cls = '') => {
      const div = document.createElement('div');
      div.className = 'bag-row' + (cls ? ' ' + cls : '');
      div.innerHTML = html;
      list.appendChild(div);
      return div;
    };
    const addSep = (txt) => {
      const div = document.createElement('div');
      div.className = 'bag-sep';
      div.textContent = txt;
      list.appendChild(div);
    };

    addSep('— Weapons (tap to equip) —');
    const weapons = [
      { id: 'fist', ico: '✊', name: 'Bare Hands', stats: `Damage ${CFG.player.fistDmg}`, can: true },
      {
        id: 'sword', ico: '🗡', name: 'Sword',
        stats: s.swordDur > 0 ? `Damage ${CFG.shop.sword.dmg} · Durability left ${s.swordDur}` : 'Not owned — buy in Shop',
        can: s.swordDur > 0,
      },
      {
        id: 'gun', ico: '🔫', name: 'Gun',
        stats: s.hasGun ? `Damage ${CFG.shop.gun.dmg} · Ammo left ${s.ammo} · Hold right mouse button to aim & shoot` : 'Not owned — buy in Shop',
        can: s.hasGun,
      },
    ];
    for (const wItem of weapons) {
      const equipped = game.weapon === wItem.id;
      const row = addRow(`
        <span>${wItem.ico}</span>
        <div class="bag-info"><span>${wItem.name}${equipped ? ' · EQUIPPED' : ''}</span><small>${wItem.stats}</small></div>`,
        equipped ? 'equipped' : '');
      if (wItem.can && !equipped) {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Equip';
        btn.onclick = () => {           // onclick chạy được cả chuột lẫn chạm màn hình
          game.setWeapon(wItem.id);
          this.renderBag(game);
        };
        row.appendChild(btn);
      }
    }

    addSep('— Worn Equipment —');
    const armorWorn = s.armorDur > 0 && s.armorWorn;
    const armorRow = addRow(`<span>🛡</span><div class="bag-info"><span>Armor${armorWorn ? ' · WORN' : ''}</span>
      <small>${s.armorDur > 0
        ? `Reduces ${CFG.shop.armor.reduce} damage per hit · Durability left ${s.armorDur}/${CFG.shop.armor.maxDur}` + (armorWorn ? '' : ' · Currently taken off')
        : 'Not owned — buy in Shop'}</small></div>`,
      armorWorn ? 'equipped' : '');
    if (s.armorDur > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = armorWorn ? 'Take Off' : 'Wear';
      btn.onclick = () => {
        game.toggleArmor();
        this.renderBag(game);
      };
      armorRow.appendChild(btn);
    }
    addRow(`<span>🔮</span><div class="bag-info"><span>Protection Orb${s.orbPoints > 0 ? ' · ACTIVE' : ''}</span>
      <small>${s.orbPoints > 0 ? `Absorbs fall damage · ${s.orbPoints} protection points left` : 'Not owned — buy in Shop with diamonds'}</small></div>`,
      s.orbPoints > 0 ? 'equipped' : '');

    addSep('— Assets —');
    addRow(`<span>🟡</span><div class="bag-info"><span>Gold</span></div><span>${s.gold}</span>`);
    addRow(`<span>💎</span><div class="bag-info"><span>Diamonds</span></div><span>${s.diamonds}</span>`);
    addRow(`<span>💚</span><div class="bag-info"><span>Lives</span></div><span>${s.lives}</span>`);

    this.renderBagPreview(game);
  }

  // xem trước 3D: nhân vật + giáp + vũ khí đang chọn, cập nhật ngay khi đổi trang bị
  renderBagPreview(game) {
    const wrap = $('bag-preview');
    if (!this.pvRenderer) {
      try {
        this.pvRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.pvRenderer.setSize(150, 190);
        this.pvRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        wrap.appendChild(this.pvRenderer.domElement);
        this.pvScene = new THREE.Scene();
        this.pvCam = new THREE.PerspectiveCamera(36, 150 / 190, 0.1, 20);
        this.pvCam.position.set(0.6, 1.5, 3.4);
        this.pvCam.lookAt(0, 0.85, 0);
        this.pvScene.add(new THREE.HemisphereLight(0xcfe8f5, 0xd9c295, 1.3));
        const sun = new THREE.DirectionalLight(0xfff0d0, 1.8);
        sun.position.set(2, 4, 3);
        this.pvScene.add(sun);
      } catch { return; } // WebGL không khả dụng — bỏ qua xem trước
    }
    if (this.pvChar) this.pvScene.remove(this.pvChar);
    const s = this.save;
    this.pvChar = buildCharacter(s.charIndex);
    this.pvChar.rotation.y = 0.45;
    const pvWearingArmor = s.armorDur > 0 && s.armorWorn;
    this.pvChar.userData.armorGroup.visible = pvWearingArmor;
    for (const o of this.pvChar.userData.hideWithArmor || []) o.visible = !pvWearingArmor;
    if (game.weapon === 'sword' && s.swordDur > 0) {
      const sw = buildSword();
      sw.position.set(0, -0.02, 0.1);
      sw.rotation.x = Math.PI / 2;
      this.pvChar.userData.socketR.add(sw);
      this.pvChar.userData.armR.rotation.x = -0.5; // giơ nhẹ khoe vũ khí
    } else if (game.weapon === 'gun' && s.hasGun) {
      const gn = buildGun();
      gn.position.set(0, -0.04, 0.1);
      gn.rotation.x = Math.PI / 2;
      this.pvChar.userData.socketR.add(gn);
      this.pvChar.userData.armR.rotation.x = -1.25;
      this.pvChar.userData.armR.rotation.z = -0.16;
      this.pvChar.userData.foreR.rotation.x = -0.35;
    }
    this.pvScene.add(this.pvChar);
    this.pvRenderer.render(this.pvScene, this.pvCam);
  }

  // ---------- HUD ----------
  updateHUD(game) {
    const s = this.save, pl = game.player;
    if (!pl) return;
    $('hp-fill').style.width = `${Math.max(0, pl.hp / CFG.player.maxHp) * 100}%`;
    $('hp-text').textContent = `${Math.max(0, pl.hp)}/${CFG.player.maxHp}`;
    $('orb-row').classList.toggle('hidden', s.orbPoints <= 0);
    if (s.orbPoints > 0) {
      $('orb-fill').style.width = `${Math.min(100, s.orbPoints)}%`;
      $('orb-text').textContent = s.orbPoints;
    }
    $('hud-gold').textContent = s.gold;
    $('hud-diamond').textContent = s.diamonds;
    $('hud-level').textContent = s.level;
    $('hud-lives').textContent = s.lives;

    const wNames = { fist: '✊ Bare Hands', sword: `🗡 Sword (${s.swordDur})`, gun: `🔫 Gun (${s.ammo})` };
    $('btn-weapon').textContent = wNames[game.weapon];
    $('crosshair').classList.toggle('hidden', game.weapon !== 'gun');

    // cảnh báo độ bền / đạn
    const warns = [];
    if (s.hasGun && s.ammo > 0 && s.ammo <= 3) warns.push(`⚠ Low ammo (${s.ammo})`);
    if (s.swordDur > 0 && s.swordDur <= 4) warns.push(`⚠ Sword about to break (${s.swordDur})`);
    if (s.armorDur > 0 && s.armorWorn && s.armorDur <= 5) warns.push(`⚠ Armor about to break (${s.armorDur})`);
    if (s.orbPoints > 0 && s.orbPoints <= 20) warns.push(`⚠ Protection running low (${s.orbPoints})`);
    if (warns.length && !this.toastActive) {
      $('hud-warning').textContent = warns.join(' · ');
      $('hud-warning').classList.remove('hidden');
    } else if (!this.toastActive) {
      $('hud-warning').classList.add('hidden');
    }
  }

  toast(msg) {
    this.toastActive = true;
    $('hud-warning').textContent = msg;
    $('hud-warning').classList.remove('hidden');
    clearTimeout(this.warnTimer);
    this.warnTimer = setTimeout(() => {
      this.toastActive = false;
      $('hud-warning').classList.add('hidden');
    }, 2200);
  }

  // ---------- Joystick điện thoại ----------
  initJoystick(moveVec, game) {
    const base = $('joy-base'), stick = $('joy-stick');
    let touchId = null;
    const center = () => {
      const r = base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const onMove = (t) => {
      const c = center();
      // núm joystick di chuyển theo đúng toạ độ VẬT LÝ (khớp CSS %, tự co giãn theo kích thước joy-base
      // thực tế thay vì trừ cứng "31px" như trước — sai lệch khi joy-base co nhỏ trên máy màn hình hẹp)
      const restOffset = base.clientWidth / 2 - stick.clientWidth / 2;
      const maxD = base.clientWidth * 0.36;
      let dx = t.clientX - c.x, dy = t.clientY - c.y;
      const d = Math.hypot(dx, dy);
      if (d > maxD) { dx *= maxD / d; dy *= maxD / d; }
      stick.style.left = `${restOffset + dx}px`;
      stick.style.top = `${restOffset + dy}px`;
      // hướng di chuyển LOGIC thì quy đổi theo chế độ ép ngang (nếu bật) — khác với vị trí núm ở trên
      const logical = game.toLogicalDelta(dx, dy);
      moveVec.x = logical.x / maxD;
      moveVec.z = -logical.y / maxD;
    };
    const reset = () => {
      stick.style.left = ''; stick.style.top = ''; // bỏ inline style, quay lại vị trí giữa mặc định theo CSS
      moveVec.x = 0; moveVec.z = 0; touchId = null;
      game.joystickTouchId = null; // báo cho canvas biết ngón này đã thả, không còn cần loại trừ nữa
    };
    $('joystick').addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchId = e.changedTouches[0].identifier;
      game.joystickTouchId = touchId; // để canvas (xoay camera/zoom) loại trừ ngón này khi đếm số điểm chạm
      onMove(e.changedTouches[0]);
    }, { passive: false });
    $('joystick').addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === touchId) onMove(t);
    }, { passive: false });
    $('joystick').addEventListener('touchend', reset);
    $('joystick').addEventListener('touchcancel', reset);
  }
}
