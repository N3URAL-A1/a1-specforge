/* a1-ux-studio tweaks panel (dev copy only). Vanilla JS, CSS custom properties only.
   Injected by scripts/tweaks/tweaks.cjs build into result/result.dev.html. Never part of result.html. */
(function () {
  'use strict';
  var FONTS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans 3', 'Lora', 'Georgia'];
  var DEFAULTS = { font: '', size: 16, accent: '#3355ff', motion: 1 };
  var root = document.documentElement;
  var state = Object.assign({}, DEFAULTS);
  var comparing = false;

  var style = document.createElement('style');
  style.setAttribute('data-a1-tweaks', 'style');
  style.textContent =
    ':root[data-a1-tweaks-on] body{font-family:var(--a1-font,inherit);font-size:var(--a1-size,inherit)}' +
    ':root[data-a1-tweaks-on]{accent-color:var(--a1-accent,auto);--accent:var(--a1-accent)}' +
    ':root[data-a1-tweaks-on] *{animation-duration:calc(var(--a1-motion,1) * 1s)!important;transition-duration:calc(var(--a1-motion,1) * .3s)!important}' +
    '[data-a1-tweaks=panel]{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:220px;padding:10px;' +
    'font:12px/1.4 system-ui,sans-serif;color:#111;background:#fff;border:1px solid #888;border-radius:6px}' +
    '[data-a1-tweaks=panel] label{display:block;margin:6px 0 2px}' +
    '[data-a1-tweaks=panel] input,[data-a1-tweaks=panel] select{width:100%;box-sizing:border-box}' +
    '[data-a1-tweaks=panel] button{margin:8px 4px 0 0}';
  document.head.appendChild(style);

  function apply() {
    if (comparing) { root.removeAttribute('data-a1-tweaks-on'); return; }
    root.setAttribute('data-a1-tweaks-on', '');
    if (state.font) root.style.setProperty('--a1-font', '"' + state.font + '", sans-serif'); else root.style.removeProperty('--a1-font');
    root.style.setProperty('--a1-size', state.size + 'px');
    root.style.setProperty('--a1-accent', state.accent);
    root.style.setProperty('--a1-motion', String(state.motion));
  }

  function field(label, control) {
    var l = document.createElement('label');
    l.textContent = label;
    l.appendChild(control);
    return l;
  }
  function input(type, attrs) {
    var el = document.createElement('input');
    el.type = type;
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function button(text, name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('data-a1-tweaks-control', name);
    return b;
  }

  var panel = document.createElement('div');
  panel.setAttribute('data-a1-tweaks', 'panel');
  var font = document.createElement('select');
  font.setAttribute('data-a1-tweaks-control', 'font');
  [''].concat(FONTS).forEach(function (f) {
    var o = document.createElement('option');
    o.value = f; o.textContent = f || '(original)';
    font.appendChild(o);
  });
  var size = input('range', { min: '12', max: '28', step: '1', value: String(DEFAULTS.size), 'data-a1-tweaks-control': 'size' });
  var accent = input('color', { value: DEFAULTS.accent, 'data-a1-tweaks-control': 'accent' });
  var motion = input('range', { min: '0', max: '2', step: '0.1', value: String(DEFAULTS.motion), 'data-a1-tweaks-control': 'motion' });
  var reset = button('Reset', 'reset');
  var compare = button('Compare to original', 'compare');
  var out = document.createElement('output');
  out.setAttribute('data-a1-tweaks-control', 'values');
  [field('Font', font), field('Size (px)', size), field('Accent colour', accent), field('Motion weight', motion), reset, compare, out]
    .forEach(function (n) { panel.appendChild(n); });

  function show() { out.textContent = JSON.stringify({ font: state.font, size: state.size, accent: state.accent, motion: state.motion }); }
  function sync() { state = { font: font.value, size: Number(size.value), accent: accent.value, motion: Number(motion.value) }; apply(); show(); }
  [font, size, accent, motion].forEach(function (el) { el.addEventListener('input', sync); });
  reset.addEventListener('click', function () {
    font.value = ''; size.value = String(DEFAULTS.size); accent.value = DEFAULTS.accent; motion.value = String(DEFAULTS.motion);
    comparing = false; sync();
  });
  compare.addEventListener('click', function () { comparing = !comparing; apply(); });

  document.body.appendChild(panel);
  show();
})();
