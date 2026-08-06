// ===== Kết nối mọi thứ: menu → nhân vật → game =====
import { loadSave, persist } from './save.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const save = loadSave();
const audio = new AudioSys(save);
const ui = new UI(save, audio);

const game = new Game($('app'), save, audio, {
  updateHUD: () => ui.updateHUD(game),
  persist: () => persist(save),
  toast: (msg) => ui.toast(msg),
  toggleBag: () => {
    const bag = $('screen-bag');
    if (bag.classList.contains('hidden')) {
      game.suppressAutoPause = true;      // thả chuột để bấm nút trong túi mà không mở bảng tạm dừng
      document.exitPointerLock?.();
      ui.renderBag(game);
      bag.classList.remove('hidden');
    } else {
      bag.classList.add('hidden');
      game.suppressAutoPause = false;
    }
  },
  showReward: (gold, extraLife) => {
    $('reward-gold').textContent = `+${gold} Gold`;
    const ex = $('reward-extra');
    if (extraLife) { ex.textContent = '💚 +1 life (every 10 levels)!'; ex.classList.remove('hidden'); }
    else ex.classList.add('hidden');
    ui.showScreen('screen-reward');
  },
  showDeath: (title, msg, anchorTop) => {
    $('death-title').textContent = title;
    $('death-msg').textContent = msg;
    $('btn-death-ok').textContent = save.lives > 0 ? 'Try Again ▶' : 'Continue';
    // neo bảng lên mép trên để không che nhân vật nằm choáng váng
    $('screen-death').classList.toggle('anchor-top', !!anchorTop);
    ui.showScreen('screen-death');
  },
  showGameOver: () => {
    ui.showScreen('screen-over');
    ui.showHUD(false);
  },
  showPause: () => ui.showScreen('screen-pause'),
  hidePause: () => ui.hideAll(),
});

// ---------- Menu chính ----------
$('btn-start').onclick = () => {
  audio.sfx('click');
  ui.renderCharScreen();
  $('inp-name').value = save.name;
  ui.showScreen('screen-char');
};
$('btn-scores').onclick = () => {
  audio.sfx('click');
  ui.renderScores();
  ui.showScreen('screen-scores');
};
$('btn-shop').onclick = () => {
  audio.sfx('click');
  ui.renderShop(() => persist(save));
  ui.showScreen('screen-shop');
};
$('btn-options').onclick = () => {
  audio.sfx('click');
  $('vol-music').value = save.musicVol * 100;
  $('vol-sfx').value = save.sfxVol * 100;
  $('inp-rename').value = save.name;
  ui.showScreen('screen-options');
};
$('btn-end').onclick = () => {
  audio.sfx('click');
  audio.stopMusic();
  ui.showScreen('screen-bye');
  setTimeout(() => window.close(), 600); // trình duyệt có thể chặn — màn hình tạm biệt là dự phòng
};

// ---------- Tạo nhân vật ----------
$('btn-char-back').onclick = () => { audio.sfx('click'); ui.showScreen('screen-menu'); };
$('btn-char-go').onclick = () => {
  const name = $('inp-name').value.trim();
  if (!save.name && !name) { $('inp-name').focus(); return; }
  if (name) save.name = name;
  save.charIndex = ui.selectedChar;
  persist(save);
  audio.sfx('click');
  ui.hideAll();
  ui.showHUD(true);
  game.startRun();
  ui.updateHUD(game);
};

// ---------- Quay lại từ các màn phụ ----------
$('btn-scores-back').onclick = () => { audio.sfx('click'); ui.showScreen('screen-menu'); };
$('btn-shop-back').onclick = () => {
  audio.sfx('click');
  // nếu đang chơi dở thì quay lại game, không thì về menu
  if (game.state === 'play') { ui.hideAll(); ui.updateHUD(game); }
  else ui.showScreen('screen-menu');
};
$('btn-options-back').onclick = () => {
  const nm = $('inp-rename').value.trim();
  if (nm) save.name = nm;
  persist(save);
  audio.sfx('click');
  // mở từ menu tạm dừng thì quay lại đó, không thì về màn hình chính
  if (ui.optionsFrom === 'pause' && game.state === 'paused') ui.showScreen('screen-pause');
  else ui.showScreen('screen-menu');
  ui.optionsFrom = null;
};
$('vol-music').oninput = (e) => { save.musicVol = e.target.value / 100; audio.applyVolumes(); persist(save); };
$('vol-sfx').oninput = (e) => { save.sfxVol = e.target.value / 100; audio.applyVolumes(); persist(save); };

// ---------- Trong game ----------
$('btn-weapon').onclick = () => game.cycleWeapon();
$('btn-bag').onclick = () => {
  game.suppressAutoPause = true;
  ui.renderBag(game);
  $('screen-bag').classList.remove('hidden');
};
$('btn-bag-close').onclick = () => {
  $('screen-bag').classList.add('hidden');
  game.suppressAutoPause = false;
};
$('btn-pause').onclick = () => { audio.sfx('click'); game.togglePause(); };

// ---------- Menu tạm dừng ----------
$('btn-pause-continue').onclick = () => { audio.sfx('click'); game.togglePause(); };
$('btn-pause-option').onclick = () => {
  audio.sfx('click');
  ui.optionsFrom = 'pause';
  $('vol-music').value = save.musicVol * 100;
  $('vol-sfx').value = save.sfxVol * 100;
  $('inp-rename').value = save.name;
  ui.showScreen('screen-options');
};
$('btn-pause-quit').onclick = () => {
  audio.sfx('click');
  persist(save);
  game.stopToMenu();
  ui.showHUD(false);
  ui.showScreen('screen-menu');
};

// ---------- Thưởng / thua / hết mạng ----------
$('btn-reward-ok').onclick = () => {
  audio.sfx('click');
  ui.hideAll();
  game.confirmReward();
};
$('btn-death-ok').onclick = () => {
  audio.sfx('click');
  ui.hideAll();
  game.afterDeath();
  if (game.state === 'play') ui.updateHUD(game);
};
$('btn-over-ok').onclick = () => {
  audio.sfx('click');
  game.stopToMenu();
  ui.showHUD(false);
  ui.showScreen('screen-menu');
};

// ---------- Nút cảm ứng ----------
if (ui.isMobile) {
  ui.initJoystick(game.moveVec, game);
  const bind = (id, fn) => {
    $(id).addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
  };
  bind('btn-m-jump', () => game.tryJump());
  bind('btn-m-attack', () => game.attack());
  bind('btn-rotate', () => game.setForceLandscape(!game.forceLandscape));
  // nút ngắm: giữ rồi KÉO ngón tay (như joystick) để xoay hướng ngắm chính xác, thả ra thì tắt
  const btnAim = $('btn-m-aim');
  let aimTouch = null;
  btnAim.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    aimTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
    if (game.state === 'play') game.aiming = true;
  }, { passive: false });
  btnAim.addEventListener('touchmove', (e) => {
    if (!aimTouch) return;
    e.preventDefault();
    for (const t of e.touches) {
      if (t.identifier !== aimTouch.id) continue;
      const d = game.toLogicalDelta(t.clientX - aimTouch.x, t.clientY - aimTouch.y);
      game.camYaw -= d.x * 0.003;
      // kéo lên/xuống đổi góc ngắm dọc (aimPitch riêng), không đụng camPitch của camera quỹ đạo
      game.aimPitch = Math.max(-1.0, Math.min(1.0, game.aimPitch - d.y * 0.0022));
      aimTouch.x = t.clientX; aimTouch.y = t.clientY;
    }
  }, { passive: false });
  const endAim = (e) => {
    if (!aimTouch) return;
    for (const t of e.changedTouches) {
      if (t.identifier === aimTouch.id) { aimTouch = null; game.aiming = false; }
    }
  };
  btnAim.addEventListener('touchend', endAim, { passive: false });
  btnAim.addEventListener('touchcancel', endAim, { passive: false });
}

// mở khóa âm thanh sau thao tác đầu tiên
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// hook cho việc kiểm thử / gỡ lỗi
window.__game = game;
window.__save = save;
