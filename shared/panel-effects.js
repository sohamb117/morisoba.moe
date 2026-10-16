/* Connector release and panel drop. Existing page close/restore handlers remain
   authoritative; replay the close once the short visual transition has ended. */
(function () {
  'use strict';
  const replay = new WeakSet();
  const pending = new WeakSet();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('.panel:not(.world), #resume-container .content > header, .jp-hud > header, .jp-hud dialog').forEach(panel => {
    const terminals = document.createElement('span');
    terminals.className = 'panel-terminals';
    terminals.setAttribute('aria-hidden', 'true');
    terminals.innerHTML = '<i class="panel-terminal"></i><i class="panel-terminal"></i>';
    panel.appendChild(terminals);
  });

  document.addEventListener('click', function (event) {
    const button = event.target.closest('.pbtn[data-act="close"], #closeDossier, #closeGuide');
    if (!button || button.closest(".panel-popup")) return;
    if (replay.has(button)) { replay.delete(button); return; }
    const panel = button.closest('.panel, dialog');
    if (!panel || motion.matches || typeof panel.animate !== 'function') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending.has(panel)) return;
    pending.add(panel);
    release(panel, button);
  }, true);

  async function release(panel, button) {
    const plugs = [];
    const animations = [];
    const wasInert = panel.inert;
    const redraw = () => { if (typeof window.drawWires === 'function') window.drawWires(); };
    const cancel = () => animations.forEach(animation => animation.cancel());
    try {
      panel.querySelectorAll('.panel-terminal').forEach((terminal, index) => {
        const rect = terminal.getBoundingClientRect();
        const plug = document.createElement('i');
        plug.className = 'detached-terminal';
        plug.setAttribute('aria-hidden', 'true');
        plug.style.left = rect.left + 'px';
        plug.style.top = rect.top + 'px';
        document.body.appendChild(plug);
        plugs.push(plug);
        const side = index ? 1 : -1;
        animations.push(plug.animate([
          { transform: 'translate(0,0)', opacity: 1 },
          { transform: `translate(${side * 16}px,4px) rotate(${side * 15}deg)`, opacity: 1, offset: .35 },
          { transform: `translate(${side * 24}px,48px) rotate(${side * 35}deg)`, opacity: 0 }
        ], { duration: 420, easing: 'ease-in', fill: 'forwards' }));
      });
      panel.classList.add('disconnecting');
      panel.inert = true;
      redraw();
      animations.push(panel.animate([
        { translate: '0 0', rotate: '0deg', opacity: 1 },
        { translate: '0 3px', rotate: '-1deg', opacity: 1, offset: .3 },
        { translate: '0 150px', rotate: '7deg', opacity: 0 }
      ], { duration: 460, easing: 'cubic-bezier(.4,0,.85,.5)', fill: 'forwards' }));
      motion.addEventListener('change', cancel, { once: true });
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    } catch (_) {
      // Animation failure must never prevent the underlying close action.
    } finally {
      motion.removeEventListener('change', cancel);
      cancel();
      plugs.forEach(plug => plug.remove());
      panel.inert = wasInert;
      panel.classList.remove('disconnecting');
      pending.delete(panel);
      // Keep custom library/journal readers and map dialogs on their own close paths.
      if (button.isConnected) {
        replay.add(button);
        button.click();
        replay.delete(button);
      }
      redraw();
    }
  }
})();
