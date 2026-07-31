/* bridge.js — forwards a permanent GitHub link to the resort PC's current address.
 *
 * The free Cloudflare quick tunnel both ROTATES its hostname and drops out
 * (20-40 down-events a day). So we never redirect blindly: we probe the target
 * first, and if it is not answering we show a calm "restarting" screen with a
 * retry, plus the read-only catalogue (served from GitHub, so it is always up)
 * — instead of dumping staff on a browser DNS error.
 *
 * Pages set window.BRIDGE_TARGET to 'app' | 'hk' before loading this.
 */
(function () {
  var TARGET = window.BRIDGE_TARGET || 'app';
  var el = function (id) { return document.getElementById(id); };
  var show = function (id) {
    ['loading', 'manual', 'fail'].forEach(function (s) {
      var n = el(s); if (n) n.style.display = (s === id) ? 'block' : 'none';
    });
  };

  // An opaque (no-cors) fetch still resolves when the host answers, and rejects
  // when DNS fails or the connection is refused — enough to tell alive from dead.
  function probe(url) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(false); } }, 7000);
      fetch(url + '/login', { mode: 'no-cors', cache: 'no-store' })
        .then(function () { if (!done) { done = true; clearTimeout(timer); resolve(true); } })
        .catch(function () { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
    });
  }

  function go() {
    show('loading');
    fetch('./link.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var url = d && d[TARGET];
        if (!url) throw new Error('sem url');
        var base = d.app || url;
        return probe(base).then(function (alive) {
          if (!alive) { show('fail'); return; }
          var a = el('go'); if (a) a.href = url;
          // Some in-app browsers block automatic redirects — offer a button too.
          setTimeout(function () { show('manual'); }, 2500);
          location.replace(url);
        });
      })
      .catch(function () { show('fail'); });
  }

  var retry = el('retry');
  if (retry) retry.addEventListener('click', function (e) { e.preventDefault(); go(); });
  go();
})();
