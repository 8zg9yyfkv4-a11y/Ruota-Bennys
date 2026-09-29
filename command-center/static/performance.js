(() => {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const narrow = matchMedia('(max-width: 900px)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lite = coarse || narrow || reduced;

  if (lite) document.documentElement.classList.add('perf-lite');

  // On touch/mobile, skip the two pointer-move visual effects that force
  // layout reads and style writes continuously. Click/touch behaviour is untouched.
  if (lite) {
    const nativeAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const isCard = typeof Element !== 'undefined' && this instanceof Element && this.classList?.contains('card');
      if (type === 'pointermove' && (this === document || isCard)) return;
      return nativeAdd.call(this, type, listener, options);
    };

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('cursor-glow')?.remove();
    }, { once: true });
  }
})();
