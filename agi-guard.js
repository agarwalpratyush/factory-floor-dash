/* agi-guard.js — location capture for the staff dashboard and every tool opened from it.
 *
 * Pratyush's rule (15 Sep 2026): every visit is logged with an approximate IP location, and a signed-in
 * person cannot use the dashboard or a connected tool until they allow exact (GPS) location.
 *
 *   AGIGuard.visit('dashboard')                               - on page load, before sign-in
 *   await AGIGuard.requireLocation({ app, getToken, onSignOut }) - after sign-in; resolves only once a
 *                                                               GPS fix has been logged
 *
 * Rows go to public.access_log through the edge function `log-access` (admin read only). Browsers only
 * give GPS with the person's permission and only on https or localhost, so refusing shows a blocking
 * screen with instructions and a retry, never the tool.
 * Published at https://agarwalgabions.com/agi-guard.js (a root file - the site is flat; deploy it with the pages).
 */
(function () {
  var FN = 'https://qqzkqaedroeehuewmiic.supabase.co/functions/v1/log-access';
  var KEY = 'sb_publishable_2kQnRCAIxSyOfi4wsQrKDA_KHFHOJsr';

  function send(body, token) {
    var h = { 'Content-Type': 'application/json', apikey: KEY };
    if (token) h.Authorization = 'Bearer ' + token;
    body.path = body.path || (location.pathname + location.hash).slice(0, 300);
    return fetch(FN, { method: 'POST', headers: h, body: JSON.stringify(body), keepalive: true })
      .catch(function () {});
  }

  function getFix() {
    return new Promise(function (resolve, reject) {
      if (!('geolocation' in navigator)) { reject({ code: 0, message: 'geolocation not supported' }); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject,
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 60000 });
    });
  }

  var css =
    '#agi-guard{position:fixed;inset:0;z-index:2147483647;background:#0d2b45;color:#fff;display:flex;' +
    'align-items:center;justify-content:center;padding:24px;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '#agi-guard .b{max-width:440px;background:#14395c;border-radius:14px;padding:28px}' +
    '#agi-guard h2{margin:0 0 10px;font-size:20px;color:#fff}' +
    '#agi-guard p{margin:0 0 12px;color:#d5dee7}' +
    '#agi-guard ol{margin:0 0 14px;padding-left:20px;color:#d5dee7}' +
    '#agi-guard button{font:600 15px system-ui,sans-serif;border:0;border-radius:9px;padding:11px 18px;cursor:pointer;margin:4px 8px 0 0}' +
    '#agi-guard .go{background:#e2892f;color:#0d2b45}#agi-guard .out{background:transparent;color:#d5dee7;border:1px solid #3a5a78}' +
    '#agi-guard .err{color:#ffb4a8;font-size:13.5px;min-height:1em}';

  function overlay() {
    var el = document.getElementById('agi-guard');
    if (el) return el;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'agi-guard';
    document.body.appendChild(el);
    return el;
  }

  function render(el, state, msg) {
    var denied = state === 'denied';
    el.innerHTML =
      '<div class="b"><h2>Location required</h2>' +
      '<p>For security, Agarwal Gabions staff tools can only be used with your location switched on. ' +
      'Your location is recorded each time you open a tool.</p>' +
      (denied
        ? '<p><b>Location is blocked for this site.</b> To allow it:</p><ol>' +
          '<li>Tap the lock / settings icon next to the web address.</li>' +
          '<li>Set <b>Location</b> to <b>Allow</b>.</li>' +
          '<li>Make sure location is on for your phone or computer, then press Try again.</li></ol>'
        : '<p>When your browser asks, choose <b>Allow</b>.</p>') +
      '<div class="err">' + (msg || '') + '</div>' +
      '<button class="go" id="agi-guard-go">' + (state === 'waiting' ? 'Waiting for location…' : (denied ? 'Try again' : 'Allow location')) + '</button>' +
      '<button class="out" id="agi-guard-out">Sign out</button></div>';
  }

  function permissionState() {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve('prompt');
    return navigator.permissions.query({ name: 'geolocation' }).then(function (p) { return p.state; })
      .catch(function () { return 'prompt'; });
  }

  window.AGIGuard = {
    visit: function (app) { send({ app: app, event: 'visit' }); },

    requireLocation: function (opt) {
      var app = opt.app, getToken = opt.getToken || function () { return null; };
      return new Promise(function (resolve) {
        var el = overlay(), busy = false;   // cover the tool at once; nothing shows until located

        function attempt(fromClick) {
          if (busy) return; busy = true;
          render(el, 'waiting');
          var go = document.getElementById('agi-guard-go'); if (go) go.disabled = true;
          getFix().then(function (pos) {
            return Promise.resolve(getToken()).then(function (tok) {
              return send({ app: app, event: 'location',
                            gps: { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy } }, tok);
            }).then(function () {
              if (el) el.remove();
              resolve(true);
            });
          }).catch(function (err) {
            busy = false;
            var refused = err && err.code === 1;
            Promise.resolve(getToken()).then(function (tok) {
              send({ app: app, event: refused ? 'location_refused' : 'location_unavailable',
                     error: (err && err.message) || 'unknown' }, tok);
            });
            permissionState().then(function (s) {
              render(el, refused || s === 'denied' ? 'denied' : 'prompt',
                refused ? (fromClick ? 'Location is still blocked.' : '')
                        : 'Could not get your location (' + ((err && err.message) || 'unknown') + '). Check location is on and try again.');
              document.getElementById('agi-guard-go').onclick = function () { attempt(true); };
              document.getElementById('agi-guard-out').onclick = function () {
                if (opt.onSignOut) opt.onSignOut(); else location.reload();
              };
            });
          });
        }
        attempt(false);
      });
    }
  };
})();
