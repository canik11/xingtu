// 删除节点时的黑洞：事件视界 + 吸积盘 + 螺旋内落的星尘，把要消失的节点吞进去。
// 与开场一样是纯 DOM canvas 覆盖层，不依赖 2D / WebGL 渲染器，pointer-events 透传。
const TAU = Math.PI * 2;

let layer = null;
let canvas = null;
let ctx = null;
let dpr = 1;
let w = 0;
let h = 0;
let raf = 0;
let state = null;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

function ensureLayer() {
  if (layer) return;
  layer = document.createElement('div');
  layer.id = 'blackholeLayer';
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '55',
    pointerEvents: 'none',
    overflow: 'hidden'
  });
  layer.setAttribute('aria-hidden', 'true');
  canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  layer.appendChild(canvas);
  document.body.appendChild(layer);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function draw(t) {
  const { x: cx, y: cy, seeds } = state;
  const open = smoothstep(0, 0.16, t);
  const close = smoothstep(0.64, 0.95, t);
  const fade = open * (1 - close);
  const coreR = Math.max(0, 10 + 62 * smoothstep(0, 0.34, t) - 74 * smoothstep(0.6, 0.96, t));

  // 把节点周围压暗，让吞噬感更明确。
  const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, 380);
  shade.addColorStop(0, `rgba(0,0,0,${0.66 * fade})`);
  shade.addColorStop(0.42, `rgba(1,3,9,${0.44 * fade})`);
  shade.addColorStop(1, 'rgba(1,3,9,0)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(cx, cy, 380, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 螺旋内落的星尘，每颗带一小段拖尾。
  for (const seed of seeds) {
    const p = (t * 1.55 + seed.offset) % 1;
    const rr = Math.pow(1 - p, 1.7) * (190 + seed.spread * 210) * (1 - close * 0.55) + coreR * 0.5;
    const ang = seed.ang + p * 3.4 + t * 2.6;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr * 0.82;
    const a = (1 - p) * 0.95 * fade;
    const ta = ang - 0.18;
    const tx = cx + Math.cos(ta) * rr * 1.05;
    const ty = cy + Math.sin(ta) * rr * 0.86;
    const warm = seed.hue > 0.72;
    ctx.strokeStyle = warm ? `rgba(255,214,160,${a * 0.4})` : `rgba(176,214,255,${a * 0.4})`;
    ctx.lineWidth = seed.size * 0.7;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.fillStyle = warm ? `rgba(255,232,198,${a})` : `rgba(214,236,255,${a})`;
    ctx.beginPath();
    ctx.arc(px, py, seed.size * (0.6 + (1 - p) * 0.9), 0, TAU);
    ctx.fill();
  }

  // 吸积盘：四层错开的椭圆弧，越靠内转得越快。
  const spin = t * 5.4 + state.spin;
  for (let i = 0; i < 4; i++) {
    const rr = coreR * (1.26 + i * 0.34) + 4;
    const alpha = (0.6 - i * 0.12) * fade;
    if (alpha <= 0.004) continue;
    ctx.strokeStyle =
      i === 0
        ? `rgba(214,238,255,${alpha})`
        : i === 1
          ? `rgba(168,196,255,${alpha})`
          : i === 2
            ? `rgba(128,178,255,${alpha})`
            : `rgba(120,206,255,${alpha})`;
    ctx.lineWidth = 2.3 - i * 0.45;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr * 0.78, spin * (1 + i * 0.1) + i * 0.9, 0.25, TAU * 0.82);
    ctx.stroke();
  }

  // 视界下方的引力透镜亮弧：背景星光被掰弯后挤在黑洞边缘。
  if (coreR > 2) {
    ctx.strokeStyle = `rgba(236,246,255,${0.55 * fade})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, coreR * 1.16, coreR * 1.0, 0, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
  }
  ctx.restore();

  // 事件视界本体。
  if (coreR > 0.5) {
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(0.76, 'rgba(0,2,6,1)');
    hole.addColorStop(0.93, 'rgba(10,20,40,0.92)');
    hole.addColorStop(1, 'rgba(24,48,94,0.18)');
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, TAU);
    ctx.fill();

    // 光子环：黑洞边缘一圈很亮很细的光。
    ctx.strokeStyle = `rgba(244,250,255,${0.8 * fade})`;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, coreR * 1.02), 0, TAU);
    ctx.stroke();
  }

  // 收尾：中心一点闪光 + 一圈向外散开的余波。
  if (t > 0.78) {
    const ft = (t - 0.78) / 0.22;
    ctx.fillStyle = `rgba(236,246,255,${(1 - ft) * 0.85})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.4 * (1 - ft) + 0.6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(190,220,255,${(1 - ft) * 0.5})`;
    ctx.lineWidth = 1.6 * (1 - ft) + 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, 10 + ft * 320, 0, TAU);
    ctx.stroke();
  }
}

function frame(now) {
  if (!state || !ctx) return;
  const t = Math.min(1, (now - state.start) / state.dur);
  if (!state.swallowed && t >= 0.42) {
    state.swallowed = true;
    try {
      if (state.onSwallow) state.onSwallow();
    } catch (err) {
      console.error('[blackhole] swallow failed', err);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  draw(t);
  if (t < 1) raf = requestAnimationFrame(frame);
  else finish(true);
}

function finish(notify) {
  const done = state && state.onDone;
  state = null;
  cancelAnimationFrame(raf);
  raf = 0;
  if (ctx) ctx.clearRect(0, 0, w, h);
  if (notify && typeof done === 'function') done();
}

/**
 * 在屏幕坐标 (x, y) 播放一次黑洞吞噬。
 * onSwallow 在黑洞张开到最大时触发（此刻把节点从数据里删掉，消失被视界遮住）；
 * onDone 在动画完全结束后触发（再更新统计、提示）。
 */
export function playBlackhole({ x, y, onSwallow, onDone, dur = 920 } = {}) {
  ensureLayer();
  if (state) finish(false);
  state = {
    x: Number(x) || w / 2,
    y: Number(y) || h / 2,
    start: performance.now(),
    dur: Math.max(520, dur),
    onSwallow,
    onDone,
    swallowed: false,
    spin: Math.random() * TAU,
    seeds: Array.from({ length: 34 }, () => ({
      ang: Math.random() * TAU,
      offset: Math.random(),
      spread: Math.random(),
      size: 0.5 + Math.random() * 1.5,
      hue: Math.random()
    }))
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}