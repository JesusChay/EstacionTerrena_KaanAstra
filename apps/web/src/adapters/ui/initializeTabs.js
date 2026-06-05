export function initializeTabs({ onMapTabActivated, onModelTabActivated }) {
  const buttons = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('[data-tab-panel]');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tab;

      buttons.forEach((entry) => {
        entry.classList.toggle('is-active', entry === button);
      });

      panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.tabPanel === target);
      });

      if (target === 'map') {
        globalThis.window?.setTimeout(() => onMapTabActivated?.(), 50);
      }

      if (target === 'model') {
        onModelTabActivated?.();
      }
    });
  });
}
