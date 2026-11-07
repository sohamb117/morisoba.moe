/* Keep native form values and labels; render menus in the site's own chrome. */
(() => {
  let active = null, search = '', searchTimer;
  const eligible = el => el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled;
  function close() {
    if (!active) return;
    active.select.setAttribute('aria-expanded', 'false');
    active.select.removeAttribute('aria-activedescendant');
    active.select.removeAttribute('aria-controls');
    active.menu.remove(); active = null;
  }
  function highlight(index) {
    if (!active) return;
    const item = active.items.find(item => item.index === index);
    if (!item) return;
    active.index = index;
    for (const entry of active.items) entry.node.classList.toggle('highlighted', entry === item);
    active.select.setAttribute('aria-activedescendant', item.node.id);
    item.node.scrollIntoView({block: 'nearest'});
  }
  function choose(index) {
    const select = active?.select;
    if (!select || select.options[index]?.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close(); select.focus({preventScroll: true});
    if (changed) { select.dispatchEvent(new Event('input', {bubbles: true})); select.dispatchEvent(new Event('change', {bubbles: true})); }
  }
  function open(select) {
    if (active?.select === select) { close(); return; }
    close(); search = '';
    const menu = document.createElement('div');
    menu.className = 'site-select-menu'; menu.id = 'site-select-menu'; menu.popover = 'manual'; menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', select.getAttribute('aria-label') || [...select.labels || []].map(label => label.textContent.trim()).join(' ') || 'Options');
    const items = [];
    let group = null;
    [...select.options].forEach((option, index) => {
      if (option.hidden) return;
      const parent = option.parentElement;
      if (parent instanceof HTMLOptGroupElement && parent !== group) {
        const heading = document.createElement('div'); heading.className = 'site-select-group'; heading.textContent = parent.label; menu.append(heading); group = parent;
      }
      const node = document.createElement('div'); node.id = `site-option-${index}`; node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', String(option.selected)); node.textContent = option.label;
      const disabled = option.disabled || (parent instanceof HTMLOptGroupElement && parent.disabled);
      node.setAttribute('aria-disabled', String(disabled));
      node.addEventListener('pointerdown', event => event.preventDefault());
      if (!disabled) { node.addEventListener('click', () => choose(index)); items.push({index, node}); }
      menu.append(node);
    });
    (select.closest('dialog[open]') || document.body).append(menu);
    active = {select, menu, items, index: select.selectedIndex};
    select.setAttribute('aria-controls', menu.id); select.setAttribute('aria-expanded', 'true');
    menu.style.font = getComputedStyle(select).font;
    menu.showPopover();
    const rect = select.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 8, above = rect.top - 8;
    const down = below >= Math.min(240, menu.scrollHeight) || below >= above;
    menu.style.width = `${Math.min(Math.max(rect.width, 180), innerWidth - 16)}px`;
    menu.style.maxHeight = `${Math.max(60, Math.min(320, down ? below : above))}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${down ? rect.bottom + 3 : Math.max(8, rect.top - menu.offsetHeight - 3)}px`;
    select.focus({preventScroll: true}); highlight(select.selectedIndex);
  }
  document.addEventListener('pointerdown', event => {
    if (eligible(event.target)) { event.preventDefault(); open(event.target); }
    else if (active && !active.menu.contains(event.target)) close();
  });
  document.addEventListener('click', event => {
    if (eligible(event.target)) { event.preventDefault(); if (event.detail === 0) open(event.target); }
  });
  document.addEventListener('keydown', event => {
    const select = event.target;
    if (!eligible(select)) return;
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { if (active) { event.preventDefault(); event.stopPropagation(); close(); } return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!active) { open(select); return; }
      if (event.key === 'Enter' || event.key === ' ') { choose(active.index); return; }
      const {items} = active, position = items.findIndex(item => item.index === active.index);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, position + (event.key === 'ArrowDown' ? 1 : -1)));
      highlight(items[next]?.index);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (!active) open(select);
      clearTimeout(searchTimer); search += event.key.toLocaleLowerCase();
      const match = active.items.find(item => select.options[item.index].label.toLocaleLowerCase().startsWith(search));
      if (match) highlight(match.index);
      searchTimer = setTimeout(() => { search = ''; }, 650);
    }
  }, true);
  addEventListener('resize', close);
  document.addEventListener('scroll', event => { if (active && event.target !== active.menu && !active.menu.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', event => { if (active && event.target !== active.select && !active.menu.contains(event.target)) close(); });
})();
