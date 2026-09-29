/* Runtime performance overrides loaded after app.js. */
(() => {
  const lite = document.documentElement.classList.contains('perf-lite');
  const finePointer = matchMedia('(pointer:fine)').matches;

  // Replace the original navigation routine: remove the intentional 120 ms wait,
  // stop dashboard timers when they are no longer visible, and only enable
  // per-card pointer lighting on devices that can render it smoothly.
  navigate = async function(key) {
    if (!state.user?.modules?.includes(key)) return;

    if (key !== 'dashboard' && state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }

    setActive(key);
    const content = $('#content');
    content.style.transition = lite ? 'none' : 'opacity .16s ease, transform .16s ease';
    content.style.opacity = lite ? '1' : '.72';
    content.style.transform = lite ? 'none' : 'translateY(3px)';

    try {
      await renderModule(key);
    } catch (e) {
      content.innerHTML = pageHead('SYSTEM','Errore','Impossibile caricare questa sezione.') + card('Dettaglio',`<div class="empty">${esc(e.message)}</div>`);
    }

    requestAnimationFrame(() => {
      content.style.opacity = '1';
      content.style.transform = 'none';
      if (!lite && finePointer) attachCardGlow();
      attachTableSearch();
    });
    closeDrawer();
  };

  // Pause the live timer when the browser/tab is not visible.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    } else if (!document.hidden && state.active === 'dashboard') {
      startLiveTimers();
    }
  });
})();
