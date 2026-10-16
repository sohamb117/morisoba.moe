const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../shared/panel-effects.js'), 'utf8');
function setup({ reduced = false, failAnimation = false } = {}) {
  let handler, closes = 0, stops = 0;
  const classes = new Set(), animations = [], nodes = [];
  const motion = { matches: reduced, addEventListener() {}, removeEventListener() {} };
  const panel = {
    inert: false,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ left: 5, top: 10 }) }],
    animate() {
      if (failAnimation) throw new Error('Animation unavailable');
      let resolve;
      const animation = { finished: new Promise(r => { resolve = r; }), finish: () => resolve(), cancel: () => resolve() };
      animations.push(animation); return animation;
    }
  };
  const button = {
    isConnected: true, closest: () => panel,
    click() {
      let blocked = false;
      handler({ target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() { blocked = true; stops++; } });
      if (!blocked) closes++;
    }
  };
  const document = {
    querySelectorAll: () => [], addEventListener: (_, fn) => { handler = fn; },
    body: { appendChild: n => nodes.push(n) },
    createElement: () => ({ style: {}, setAttribute() {}, animate: panel.animate, remove() { nodes.splice(nodes.indexOf(this), 1); } })
  };
  vm.runInNewContext(source, { document, window: { matchMedia: () => motion } });
  return { button, panel, classes, animations, nodes, closes: () => closes, stops: () => stops };
}
test('reduced motion uses the existing close handler immediately', () => {
  const s = setup({ reduced: true }); s.button.click();
  assert.equal(s.closes(), 1); assert.equal(s.animations.length, 0); assert.equal(s.stops(), 0);
});
test('repeated close clicks replay once and clean up before restore', async () => {
  const s = setup(); s.button.click(); s.button.click();
  assert.equal(s.closes(), 0); assert(s.classes.has('disconnecting')); assert(s.panel.inert);
  s.animations.forEach(a => a.finish()); await new Promise(setImmediate);
  assert.equal(s.closes(), 1); assert.equal(s.nodes.length, 0); assert.equal(s.panel.inert, false);
  assert.equal(s.classes.size, 0);
  s.button.click(); s.animations.forEach(a => a.finish()); await new Promise(setImmediate);
  assert.equal(s.closes(), 2);
});
test('animation failure still closes and releases temporary DOM', async () => {
  const s = setup({ failAnimation: true }); s.button.click(); await new Promise(setImmediate);
  assert.equal(s.closes(), 1); assert.equal(s.nodes.length, 0); assert.equal(s.panel.inert, false);
});
