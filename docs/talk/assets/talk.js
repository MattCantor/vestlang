/* talk.js — placeholder animation runtime for the OCTC talk.
 *
 * For now this just renders each `.vl-anim` mount point as a labeled placeholder
 * so the whole deck reads and rehearses end-to-end. The real hero animations
 * (A1 pulse/train/stack, A2 forward build, A3 matching-pursuit decomposition)
 * get built in a later pass and registered in ANIMATIONS below, keyed by the
 * div's `data-anim` value. They share one visual grammar (bars on a date line +
 * component rows that sum), so it's one component reused — forward in Acts I/II,
 * backward in Act III. That forward/backward reuse IS the talk's thesis.
 */
(function () {
  'use strict';

  // data-anim value -> render function. Empty for now; fill in during the
  // animation build pass. Each fn receives (mountEl, { caption }).
  var ANIMATIONS = {
    // 'A1': function (el, opts) { ... },
    // 'A2': function (el, opts) { ... },
    // 'A3': function (el, opts) { ... },
  };

  function renderPlaceholder(el) {
    var key = el.getAttribute('data-anim') || 'anim';
    var caption = el.getAttribute('data-caption') || '';
    var body = el.textContent.trim();
    el.innerHTML = '';

    var tag = document.createElement('span');
    tag.className = 'vl-anim__tag';
    tag.textContent = '▶ ' + key;

    var bodyEl = document.createElement('div');
    bodyEl.className = 'vl-anim__body';
    bodyEl.textContent = body || '[ animation placeholder ]';

    el.appendChild(tag);
    el.appendChild(document.createElement('br'));
    el.appendChild(bodyEl);

    if (caption) {
      var cap = document.createElement('span');
      cap.className = 'vl-anim__caption';
      cap.textContent = caption;
      el.appendChild(cap);
    }
  }

  function mountAll() {
    var mounts = document.querySelectorAll('.vl-anim');
    for (var i = 0; i < mounts.length; i++) {
      var el = mounts[i];
      var key = el.getAttribute('data-anim');
      if (key && typeof ANIMATIONS[key] === 'function') {
        var caption = el.getAttribute('data-caption') || '';
        el.innerHTML = '';
        ANIMATIONS[key](el, { caption: caption });
      } else {
        renderPlaceholder(el);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
