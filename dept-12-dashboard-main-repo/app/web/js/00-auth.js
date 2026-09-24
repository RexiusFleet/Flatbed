/* ── Dormant Supabase / Microsoft auth shell ────────────────────────────────
   DEPT12_AUTH_ENABLED=false is the default. In that state this file performs
   no SDK load, redirect, cookie write, or external request; the local app works
   exactly as it did before authentication was scaffolded. */
var APP_AUTH = window.DEPT12_APP_CONFIG || { enabled: false, outlookEnabled: false };
var AUTH_CLIENT = null, AUTH_SESSION = null, AUTH_SDK_PROMISE = null;

function authCookieStorage() {
  var maxChunk = 3000;
  function cookieMap() {
    var out = {};
    (document.cookie || "").split(";").forEach(function (part) {
      var i = part.indexOf("=");
      if (i < 0) return;
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
    });
    return out;
  }
  function attrs(maxAge) {
    var s = "; Path=/; SameSite=Lax; Max-Age=" + maxAge;
    if (APP_AUTH.cookieDomain) s += "; Domain=" + APP_AUTH.cookieDomain;
    if (location.protocol === "https:") s += "; Secure";
    return s;
  }
  function remove(name) {
    var map = cookieMap(), count = parseInt(map[name + ".count"] || "0", 10) || 0;
    document.cookie = encodeURIComponent(name) + "=" + attrs(0);
    document.cookie = encodeURIComponent(name + ".count") + "=" + attrs(0);
    for (var i = 0; i < Math.max(count, 8); i++)
      document.cookie = encodeURIComponent(name + "." + i) + "=" + attrs(0);
  }
  return {
    getItem: function (name) {
      var map = cookieMap(), count = parseInt(map[name + ".count"] || "0", 10) || 0;
      if (!count) return map[name] || null;
      var value = "";
      for (var i = 0; i < count; i++) value += map[name + "." + i] || "";
      return value || null;
    },
    setItem: function (name, value) {
      remove(name);
      var chunks = [];
      for (var i = 0; i < value.length; i += maxChunk) chunks.push(value.slice(i, i + maxChunk));
      document.cookie = encodeURIComponent(name + ".count") + "=" + chunks.length + attrs(2592000);
      chunks.forEach(function (chunk, idx) {
        document.cookie = encodeURIComponent(name + "." + idx) + "=" + encodeURIComponent(chunk) + attrs(2592000);
      });
    },
    removeItem: remove
  };
}

function loadAuthSdk() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  if (AUTH_SDK_PROMISE) return AUTH_SDK_PROMISE;
  AUTH_SDK_PROMISE = new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = APP_AUTH.sdkUrl; s.async = true; s.crossOrigin = "anonymous";
    s.onload = function () {
      if (window.supabase && window.supabase.createClient) resolve(window.supabase);
      else reject(new Error("Supabase Auth did not initialize."));
    };
    s.onerror = function () { reject(new Error("Could not load Supabase Auth.")); };
    document.head.appendChild(s);
  });
  return AUTH_SDK_PROMISE;
}

function authLoginRedirect() {
  var login = new URL(APP_AUTH.loginUrl, location.href);
  login.searchParams.set("returnTo", location.href);
  location.replace(login.toString());
}

function cleanAuthCode() {
  var u = new URL(location.href);
  u.searchParams.delete("code");
  u.searchParams.delete("outlook");
  history.replaceState({}, document.title, u.pathname + u.search + u.hash);
}

function initDashboardAuth() {
  if (!APP_AUTH.enabled) return Promise.resolve({ configured: false, session: null });
  if (location.hostname === "127.0.0.1") {
    location.replace("http://localhost:" + location.port + location.pathname + location.search + location.hash);
    return Promise.resolve({ redirecting: true });
  }
  return loadAuthSdk().then(function (sdk) {
    AUTH_CLIENT = sdk.createClient(APP_AUTH.supabaseUrl, APP_AUTH.publishableKey, {
      auth: {
        flowType: "pkce", autoRefreshToken: true, persistSession: true,
        detectSessionInUrl: false, storageKey: APP_AUTH.storageKey,
        storage: authCookieStorage()
      }
    });
    AUTH_CLIENT.auth.onAuthStateChange(function (event, session) {
      AUTH_SESSION = session || null;
      if (event === "SIGNED_OUT") authLoginRedirect();
    });
    var code = new URLSearchParams(location.search).get("code");
    var sessionPromise = code
      ? AUTH_CLIENT.auth.exchangeCodeForSession(code).then(function (r) {
          if (r.error) throw r.error; cleanAuthCode(); return r.data.session;
        })
      : AUTH_CLIENT.auth.getSession().then(function (r) {
          if (r.error) throw r.error; return r.data.session;
        });
    return sessionPromise.then(function (session) {
      AUTH_SESSION = session || null;
      if (!session) { authLoginRedirect(); return { redirecting: true }; }
      return { configured: true, session: session };
    });
  });
}

function authFetch(url, options) {
  options = options || {};
  if (!APP_AUTH.enabled) return fetch(url, options);
  var headers = new Headers(options.headers || {});
  if (AUTH_SESSION && AUTH_SESSION.access_token)
    headers.set("Authorization", "Bearer " + AUTH_SESSION.access_token);
  if (APP_AUTH.outlookEnabled && /\/api\/create-draft$/.test(String(url)) &&
      AUTH_SESSION && AUTH_SESSION.provider_token)
    headers.set("X-Microsoft-Provider-Token", AUTH_SESSION.provider_token);
  var next = {};
  Object.keys(options).forEach(function (k) { next[k] = options[k]; });
  next.headers = headers;
  return fetch(url, next).then(function (response) {
    if (response.status === 401 && !/\/api\/create-draft$/.test(String(url))) authLoginRedirect();
    return response;
  });
}

function connectOutlook() {
  if (!APP_AUTH.enabled || !APP_AUTH.outlookEnabled || !AUTH_CLIENT)
    return Promise.reject(new Error("Outlook integration is not enabled."));
  var redirect = new URL(location.href);
  redirect.searchParams.set("outlook", "connected");
  redirect.searchParams.delete("code");
  return AUTH_CLIENT.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: APP_AUTH.outlookScopes, redirectTo: redirect.toString() }
  }).then(function (result) {
    if (result.error) throw result.error;
    return result.data;
  });
}

/* ── Local test login (D125) ────────────────────────────────────────────────
   A small, dependency-free, password-free login layered UNDER the Supabase
   scaffold above — separate concern (authorization once inside, not identity
   verification), off by default alongside it. Only active when the server's
   DEPT12_LOCAL_AUTH_ENABLED flag is on; otherwise localAuthCheck() reports
   {enabled:false} and the boot sequence never shows the gate. */
var LOCAL_AUTH = { enabled: false, user: null };
function localAuthCheck() {
  return fetch("/api/local-session").then(function (r) { return r.json(); }).then(function (j) {
    LOCAL_AUTH.enabled = !!j.enabled; LOCAL_AUTH.user = j.user || null;
    return LOCAL_AUTH;
  });
}
function localLogin(username) {
  return fetch("/api/local-login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.error) throw new Error(j.error);
    LOCAL_AUTH.user = j.user; return j.user;
  });
}
function localLogout() {
  return fetch("/api/local-logout", { method: "POST" }).then(function () {
    LOCAL_AUTH.user = null;
  });
}
function renderLoginGate() {
  var main = document.querySelector("#main") || document.body;
  // Nothing but the sign-in card exists pre-session — header, toolbar, nav,
  // and Staging are all dashboard content (app.css `body.pre-auth` rule).
  document.body.classList.add("pre-auth");
  main.innerHTML = '<div class="login-gate">' +
    '<div class="login-card">' +
    '<div class="brand" aria-label="Dept 12 Flatbed Trucking">' +
    '<span class="brand-mark"><img src="rexius-logo.png" alt="Rexius"></span>' +
    '<span class="brand-copy"><b>Dept 12</b><span>Flatbed Trucking</span></span></div>' +
    '<h2>Sign in</h2>' +
    '<p>Type your username — no password for this test roster.</p>' +
    '<input id="login-username" autocomplete="off" placeholder="Username">' +
    '<button class="btn pri" id="login-go">Continue</button>' +
    '<div id="login-err" class="login-err"></div></div></div>';
  var go = function () {
    var name = (document.querySelector("#login-username").value || "").trim();
    if (!name) return;
    localLogin(name).then(function () {
      return bootDashboard();
    }).catch(function (e) {
      document.querySelector("#login-err").textContent = e.message;
    });
  };
  document.querySelector("#login-go").addEventListener("click", go);
  document.querySelector("#login-username").addEventListener("keydown", function (e) {
    if (e.key === "Enter") go();
  });
  document.querySelector("#login-username").focus();
}

var dashboardAuth = {
  config: APP_AUTH,
  initialize: initDashboardAuth,
  fetch: authFetch,
  session: function () { return AUTH_SESSION; },
  user: function () { return AUTH_SESSION && AUTH_SESSION.user; },
  microsoftToken: function () { return AUTH_SESSION && AUTH_SESSION.provider_token; },
  connectOutlook: connectOutlook,
  signOut: function () {
    if (!AUTH_CLIENT) return Promise.resolve();
    return AUTH_CLIENT.auth.signOut().then(function (r) { if (r.error) throw r.error; });
  }
};
