'use strict';
// Runs the script block of a built result.dev.html against a minimal DOM stub and checks the motion override and the font list.
//   node panel-harness.cjs <result.dev.html>       prints "ok" or the first failed expectation; exit 0 / 1
// Source of the test, not data: no browser is needed, the panel only uses createElement, appendChild, attributes, listeners and style.

const fs = require('node:fs');
const vm = require('node:vm');

function makeElement(tag) {
  const el = {
    tag, attrs: {}, children: [], listeners: {}, textContent: '', value: '', type: '',
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    fire(name) { (this.listeners[name] || []).forEach((fn) => fn({})); },
  };
  return el;
}

function find(el, name, out = []) {
  if (el.attrs && el.attrs['data-a1-tweaks-control'] === name) out.push(el);
  (el.children || []).forEach((c) => find(c, name, out));
  return out;
}

const html = fs.readFileSync(process.argv[2], 'utf8');
const m = /<script data-a1-tweaks="script">\n([\s\S]*?)\n<\/script>/.exec(html);
if (!m) { console.log('no tweaks script block'); process.exit(1); }
const root = makeElement('html');
const head = makeElement('head');
const body = makeElement('body');
const document = { documentElement: root, head, body, createElement: makeElement };
vm.runInNewContext(m[1], { document, JSON, Number, String, Object });

const panel = body.children.find((c) => c.attrs['data-a1-tweaks'] === 'panel');
const ctl = (n) => find(panel, n)[0];
const css = head.children.map((c) => c.textContent).join('\n');
const checks = [];
const expect = (name, cond) => { if (!cond) { console.log(`failed: ${name}`); process.exit(1); } checks.push(name); };

const durationRule = css.split('}').find((r) => /animation-duration/.test(r)) || '';
expect('duration rule is keyed on data-a1-motion-on', /\[data-a1-motion-on\]/.test(durationRule));
expect('motion override off at start', !('data-a1-motion-on' in root.attrs));
const motion = ctl('motion');
motion.value = '0.5'; motion.fire('input');
expect('motion 0.5 turns the override on', 'data-a1-motion-on' in root.attrs && root.style.props['--a1-motion'] === '0.5');
motion.value = '1'; motion.fire('input');
expect('motion back at its default turns it off', !('data-a1-motion-on' in root.attrs));
motion.value = '1.5'; motion.fire('input');
ctl('compare').fire('click');
expect('compare removes both attributes', !('data-a1-tweaks-on' in root.attrs) && !('data-a1-motion-on' in root.attrs));
ctl('compare').fire('click');
expect('compare off restores the override', 'data-a1-motion-on' in root.attrs);
ctl('reset').fire('click');
expect('reset switches the override off', !('data-a1-motion-on' in root.attrs) && 'data-a1-tweaks-on' in root.attrs);
const options = ctl('font').children.map((o) => o.value);
expect('font select lists the original plus the allowlist', options[0] === '' && options.length === 24 && !options.includes('Georgia') && options.includes('Source Sans 3'));
console.log('ok');
