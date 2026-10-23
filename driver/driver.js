/* Dept 12 Driver Schedule (also the bag plant page, in bag plant mode).
 *
 * Drivers pick their name (no password) and see Current Week plus their own
 * tab. Everything shown is the latest PUBLISHED schedule (public_published_schedule),
 * so dispatch edits reach drivers only when the dashboard's Publish Schedule is
 * pressed. Notes, POD/BOL scans and "opened" times go back to Supabase through
 * the public_* functions. Add ?demo to the address for built-in sample data.
 */
(function () {
    "use strict";

    var CFG = window.DEPT12_CONFIG || {};
    var SB_URL = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
    var SB_KEY = String(CFG.supabaseKey || "");
    var DEFAULT_SB_URL = SB_URL, DEFAULT_SB_KEY = SB_KEY;
    function appProject(j) {
        if (!j || !j.projectKey || !j.APIKey) return false;
        var ref = String(j.projectKey).trim();
        if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("Invalid Supabase project ID returned by RexiusApp.");
        SB_URL = "https://" + ref + ".supabase.co";
        SB_KEY = String(j.APIKey);
        return true;
    }
    function appDefaultProject() { SB_URL = DEFAULT_SB_URL; SB_KEY = DEFAULT_SB_KEY; }
    var SESSION_KEY = "dept12-supabase-session";   // shared with the dashboard
    var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var $ = function (s) { return document.querySelector(s); };

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }
    function store(k, v) {
        try {
            if (v === undefined) return localStorage.getItem(k);
            if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        } catch (e) { /* private mode */ }
        return null;
    }
    function storeJson(k, v) {
        if (v !== undefined) return store(k, JSON.stringify(v));
        try { return JSON.parse(store(k) || "null"); } catch (e) { return null; }
    }
    function toast(m, bad) {
        var t = $("#toast"); t.textContent = m;
        t.className = "show" + (bad ? " bad" : "");
        clearTimeout(t._h); t._h = setTimeout(function () { t.className = ""; }, 3200);
    }

    /* ── Appearance: the driver and bag plant pages keep their own look. The dashboard's accent color and font setting do NOT apply here
       (they used to, because both pages share the same browser storage). Only the scheduler size settings are still read from the dashboard. ── */
    function rgbOf(hex) { var x = String(hex || "").replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(x.slice(i, i + 2), 16) || 0; }); }
    function lum(hex) {
        return rgbOf(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
            .reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
    }
    function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    function applyPrefs() {
        // Light theme only (the dashboard's own theme setting does not apply here).
        var root = document.documentElement, theme = "light";   // these pages are light only
        var accent = "#3F7D3A", font = "";
        if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme); else root.removeAttribute("data-theme");
        var rgb = rgbOf(accent);
        root.style.setProperty("--brand", accent);
        root.style.setProperty("--brand-soft", "rgba(" + rgb.join(",") + ",.14)");
        root.style.setProperty("--brand-ink", contrast(accent, "#FFFFFF") >= contrast(accent, "#111315") ? "#FFFFFF" : "#111315");
        if (font) root.style.setProperty("--font", font);
        var rowH = parseInt(store("pref_rowHeight"), 10), colW = parseInt(store("pref_colWidth"), 10);
        root.style.setProperty("--row-h", (rowH >= 56 && rowH <= 160 ? rowH : 84) + "px");
        root.style.setProperty("--col-w", (colW >= 100 && colW <= 320 ? colW : 150) + "px");
    }
    applyPrefs();
    window.addEventListener("storage", function (e) { if (e.key && e.key.indexOf("pref_") === 0) applyPrefs(); });

    /* Readable text on a filled cell — same threshold as the dashboard's textOn. */
    function textOn(hex) {
        if (!hex || hex.charAt(0) !== "#" || hex.length < 7) return "";
        var c = rgbOf(hex);
        return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? "#1a1a1a" : "#ffffff";
    }
    function fillStyle(hex) { return hex ? "background:" + esc(hex) + ";color:" + textOn(hex) + ";" : ""; }

    var SYNC_ICON = '<span class="ico" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2M12 2v3h-3M4 14v-3h3"/></svg></span>';

    /* ── State ────────────────────────────────────────────────────────────── */
    // The bag plant has its own page (bagplant/index.html sets FLATBED_MODE):
    // Current Week only, no sign-in, no tabs, bag orders front and center.
    var BAG_PLANT = window.FLATBED_MODE === "bagplant";
    var DEMO = /[?&]demo\b/.test(location.search);   // built-in sample schedule for design work

    /* ── The app's sign-in ───────────────────────────────────────────────────────────────────────────────────
       Today these pages are open: they use only the public key. App mode puts the SAME kind of sign-in on them that the dashboard has
       (Supabase email and password, a session kept in the browser and refreshed automatically): until someone is signed in, the page is
       dead and empty and asks nothing of the database. The Rexius app signs in as its own login (flatbedauth@rexius.com, which can call
       only the driver and bag plant functions) and tells the page which EMPLOYEE NUMBER is looking; the database turns the number into the
       driver and truck. Nothing the page types decides who someone is.
       REQUIRE_APP_LOGIN is the switch: false = the pages stay open as they are today; true = sign-in required. For trying it first, add
       ?app=1 to the address (works while the switch is false). The app can hand the page what it needs three ways:
         1. in the link:        .../driver/#access_token=...&refresh_token=...&emp=4521      (the hash is erased from the address at once)
         2. from its own code:  window.dept12App.setSession({access_token, refresh_token, expires_in}); window.dept12App.setEmployee("4521")
         3. by typing:          fill #login-email and #login-password and click #login-go (the same form a person sees) */
    var REQUIRE_APP_LOGIN = true;
    var APP_MODE = !DEMO && (REQUIRE_APP_LOGIN || /[?&]app\b/.test(location.search));
    var APP_SESSION_KEY = "dept12-app-session";
    var APP = { session: null, emp: "", empState: "", err: "", busy: false };
    var REXIUS_AUTH_URL = "https://app.rexius.com/API/authAPI.php";
    function jwtExpiry(token) {
        try { var part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return Number(JSON.parse(atob(part)).exp) || 0; }
        catch (e) { return 0; }
    }
    function rexiusAuth(header, code) {
        var headers = { "Accept": "application/json" }; headers[header] = code;
        return fetch(REXIUS_AUTH_URL, { method: "POST", headers: headers, cache: "no-store" })
            .catch(function (e) { e.network = true; throw e; })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    if (!r.ok || Number(j.success) !== 1 || !j.token || !j.code) {
                        var e = new Error(j.message || ("RexiusApp authentication failed (" + r.status + ")")); e.status = r.status; throw e;
                    }
                    return j;
                });
            });
    }
    function rexiusSave(j) {
        var exp = jwtExpiry(j.token);
        if (!exp || exp <= Date.now() / 1000) throw new Error("RexiusApp returned an expired or invalid JWT.");
        var old = APP.session || {};
        var projectKey = j.APIKey || old.projectKey;
        var projectId = j.projectKey || old.projectId;
        if (projectKey && projectId) appProject({ projectKey: projectId, APIKey: projectKey });
        appSaveSession({ access_token: j.token, refresh_token: "", expires_at: exp, rexius_code: j.code, source: "rexius", projectKey: projectKey, projectId: projectId });
        var employee = j.employee;

        if (typeof employee === "string") {
            try {
                employee = JSON.parse(employee);
            } catch (e) {
                console.error("Invalid RexiusApp employee JSON:", e);
                employee = null;
            }
        }
        var empId = employee?.EmpID;

        if (empId != null && String(empId).trim() !== "") {
            appSetEmp(empId);
            APP.session.emp = String(empId).trim();
            storeJson(APP_SESSION_KEY, APP.session);
        }

        console.log("Rexius login employee:", {
            returnedEmp: empId,
            sessionEmp: APP.session.emp,
            resolvedEmp: appEmp()
        });
    }
    function rexiusLogin(code) {
        APP.busy = true; APP.err = ""; render();
        return rexiusAuth("X-Auth-Code", code).then(function (j) {
            rexiusSave(j); APP.busy = false; return appStart();
        }).catch(function (e) {
            APP.busy = false; APP.err = e.message || "RexiusApp authentication failed"; render();
        });
    }
    function appNeedLogin() { var e = new Error("Sign in to see the schedule."); e.needLogin = true; return e; }
    function appSaveSession(j) {
        var prev = APP.session || {};
        APP.session = {
            access_token: j.access_token, refresh_token: j.refresh_token || prev.refresh_token || "",
            expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (parseInt(j.expires_in, 10) || 3600)),
            email: (j.user && j.user.email) || prev.email || "",
            source: j.source || "supabase", rexius_code: j.source === "rexius" ? j.rexius_code : "",
            projectKey: j.source === "rexius" ? (j.projectKey || prev.projectKey || "") : "",
            projectId: j.source === "rexius" ? (j.projectId || prev.projectId || "") : "",
            emp: j.source === "rexius" ? (j.emp || prev.emp || APP.emp || "") : ""
        };
        storeJson(APP_SESSION_KEY, APP.session);
    }
    function appClearSession() { APP.session = null; store(APP_SESSION_KEY, null); appSetEmp(""); appDefaultProject(); }
    function appAuth(path, body) {
        return fetch(SB_URL + "/auth/v1/" + path, { method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) })
            .catch(function (e) { e.network = true; throw e; })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    if (!r.ok) { var e = new Error(j.error_description || j.msg || j.message || ("Sign-in failed (" + r.status + ")")); e.status = r.status; throw e; }
                    return j;
                });
            });
    }
    var APP_REFRESHING = null;
    // A valid access token, refreshed a minute before it runs out. A refused refresh signs the page out; no answer at all does not.
    function appToken() {
        var s = APP.session;
        if (!s) return Promise.reject(appNeedLogin());
        if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s.access_token);
        if (s.source === "rexius") {
            if (!s.rexius_code) { appClearSession(); return Promise.reject(appNeedLogin()); }
            if (!APP_REFRESHING) APP_REFRESHING = rexiusAuth("X-Auth-Refresh", s.rexius_code).then(function (j) {
                rexiusSave(j); APP_REFRESHING = null; return APP.session.access_token;
            }, function (e) { APP_REFRESHING = null; if (!e.network) appClearSession(); throw e.network ? e : appNeedLogin(); });
            return APP_REFRESHING;
        }
        if (!s.refresh_token) { appClearSession(); return Promise.reject(appNeedLogin()); }
        if (!APP_REFRESHING) APP_REFRESHING = appAuth("token?grant_type=refresh_token", { refresh_token: s.refresh_token }).then(function (j) {
            APP_REFRESHING = null; appSaveSession(j); return APP.session.access_token;
        }, function (e) { APP_REFRESHING = null; if (!e.network) appClearSession(); throw e.network ? e : appNeedLogin(); });
        return APP_REFRESHING;
    }
    function appEmp() {
        if (APP.session && APP.session.source === "rexius") return String(APP.session.emp || APP.emp || "");
        if (APP.emp) return APP.emp;
        try { return sessionStorage.getItem("dept12-app-emp") || ""; } catch (e) { return ""; }     // kept for this tab, so a reload still knows who it is
    }
    function appSetEmp(n) {
        APP.emp = String(n == null ? "" : n).trim();
        try { if (APP.emp) sessionStorage.setItem("dept12-app-emp", APP.emp); else sessionStorage.removeItem("dept12-app-emp"); } catch (e) { /* private mode */ }
    }
    // Whatever the link carries: tokens only in the hash (so they never reach a server log), the employee number in the hash or ?emp=.
    function appReadLink() {
        var h = {}, q = {};
        try { new URLSearchParams(location.hash.replace(/^#/, "")).forEach(function (v, k) { h[k] = v; }); } catch (e) { /* no hash */ }
        try { new URLSearchParams(location.search).forEach(function (v, k) { q[k] = v; }); } catch (e) { /* no query */ }
        if (h.access_token) appSaveSession({ access_token: h.access_token, refresh_token: h.refresh_token, expires_at: parseInt(h.expires_at, 10) || 0, expires_in: h.expires_in });
        var emp = h.emp || h.employee || q.emp || q.employee;
        if (emp) appSetEmp(emp);
        if (h.access_token || h.emp || h.employee) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* old browser */ } }
    }
    // Employee number -> the driver and truck (the database decides). Sets S.who, or says why not.
    function appResolve() {
        if (BAG_PLANT) return Promise.resolve();
        var emp = appEmp();
        if (!emp) { APP.empState = "none"; S.who = null; return Promise.resolve(); }
        return rpcPublic("app_driver_by_employee", { p_emp: emp }).then(function (r) {
            if (!r) { APP.empState = "unknown"; S.who = null; return; }
            APP.empState = "ok"; S.who = { role: "driver", truck: r.truck == null ? "" : String(r.truck), name: r.name, emp: emp, all: !!r.all_tabs };
            storeJson("dept12-who-cache", { emp: emp, who: S.who });
            S.tab = S.who.truck ? S.who.truck : "cw"; store("dept12DriverTab", S.tab);
        }, function (e) {
            if (e && e.needLogin) return;
            var c = storeJson("dept12-who-cache");
            if (e && e.network && c && c.emp === emp && c.who) { S.who = c.who; APP.empState = "ok"; S.tab = S.who.truck ? S.who.truck : "cw"; return; }   // no signal: the last answer for this number
            APP.empState = "error"; APP.err = e.message || String(e); S.who = null;
        });
    }
    function appStart() {            // after a sign-in or a hand-off: work out who, then show the schedule
        return appResolve().then(function () { S.payload = null; S.source = ""; render(); load(); loadScans(); });
    }
    function appLogin() {
        var em = ($("#login-email") || {}).value, pw = ($("#login-password") || {}).value;
        if (APP.busy || !em || !pw) return;
        appDefaultProject();
        APP.busy = true; APP.err = ""; var b = $("#login-go"); if (b) b.disabled = true; var er = $("#login-err"); if (er) er.textContent = "";
        appAuth("token?grant_type=password", { email: em.trim(), password: pw }).then(function (j) { appSaveSession(j); APP.busy = false; return appStart(); }, function (e) {
            APP.busy = false; APP.err = e.message || "Sign-in failed"; var b2 = $("#login-go"); if (b2) b2.disabled = false; var e2 = $("#login-err"); if (e2) e2.textContent = APP.err;
        });
    }
    window.dept12App = {
        setSession: function (j) { if (j && j.access_token) { appSaveSession(j); if (APP_MODE) appStart(); } },
        setEmployee: function (n) {
            appSetEmp(n);

            if (APP.session && APP.session.source === "rexius") {
                APP.session.emp = APP.emp;
                storeJson(APP_SESSION_KEY, APP.session);
            }

            if (APP_MODE && APP.session) appStart();
        },
        signOut: function () { appClearSession(); APP.empState = ""; S.who = BAG_PLANT ? { role: "bagplant", name: "Bag Plant" } : null; S.payload = null; render(); }
    };

    // Functions in Supabase. With the public key alone today; in app mode with the signed-in session (the page sends the session's token).
    // Every request has a time limit: on a weak signal a request can hang for minutes, so it gives up (as a "no signal" failure) and the retry logic takes over.
    function fetchTimeout(url, opts, ms) {
        var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
        if (ctl) opts = Object.assign({}, opts, { signal: ctl.signal });
        return fetch(url, opts).then(function (r) { clearTimeout(t); return r; }, function (e) {
            clearTimeout(t);
            if (e && e.name === "AbortError") e = new Error("The connection timed out");
            e.network = true; throw e;      // no answer at all (Safari says "Load failed")
        });
    }
    function rpcPublic(fn, args) {
        if (!SB_URL || !SB_KEY) return Promise.reject(new Error("The schedule isn't connected yet."));
        return (APP_MODE ? appToken() : Promise.resolve(null)).then(function (token) {
            var h = { "apikey": SB_KEY, "Content-Type": "application/json" };
            if (token) h["Authorization"] = "Bearer " + token;
            return fetchTimeout(SB_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: h, body: JSON.stringify(args || {}) }, 20000);
        }).then(function (r) {
            return r.text().then(function (t) {
                var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* plain text */ }
                if (!r.ok) {
                    if (APP_MODE && r.status === 401) { appClearSession(); APP.err = "Your sign-in ended. Sign in again."; try { render(); } catch (x) { /* nothing to draw yet */ } }
                    var fail = new Error((j && j.message) || ("Request failed (" + r.status + ")")); fail.status = r.status; throw fail;
                }
                return j;
            });
        });
    }
    /* Reading is safe to repeat. Safari on an iPad often drops the very first request after a page reload or a wake from sleep
       ("Load failed") and answers the next one fine, so a read that got no answer is tried again a moment later, up to three times.
       Writes (notes, scans, views) are never repeated this way, so nothing can be saved twice. */
    function rpcPublicRead(fn, args) {
        var delays = [400, 1500, 4000], i = 0;
        function go() {
            return rpcPublic(fn, args).catch(function (e) {
                if (!e || !e.network || i >= delays.length) throw e;
                return new Promise(function (ok) { setTimeout(ok, delays[i++]); }).then(go);
            });
        }
        return go();
    }
    // S.who: null (sign-in screen) | {role:"driver", truck, name} | {role:"bagplant"} on the bag plant page
    var S = {
        who: BAG_PLANT ? { role: "bagplant", name: "Bag Plant" } :
            APP_MODE ? null : (function (w) { return w && w.role === "driver" ? w : null; })(storeJson("dept12DriverWho")), tab: BAG_PLANT ? "cw" : (store("dept12DriverTab") || "cw"),
        payload: null, loadKeys: {}, source: "", loadedAt: null, error: "", loading: false,
        scrollTo: null, keepScroll: false, loadOrder: {}, noteKey: null, scans: {}, chipTitle: {},
        serverNotes: {}, scanList: {}, viewSent: {}, refreshedAt: null,
        ticker: store(BAG_PLANT ? "dept12-ticker-b" : "dept12-ticker-d") || "", zoom: Number(store("dept12-bp-zoom2")) || 1, pz: [0.85, 1, 1.15, 1.3, 1.5, 1.75].indexOf(Number(store("dept12-drv-zoom"))) < 0 ? 1 : Number(store("dept12-drv-zoom"))
    };

    /* ── Sign-in (just remembers a name on this device) ───────────────────
       NAME_PICKER: the "type or pick your name" screen (and the Log Out button that leads back to it) is switched OFF while
       sign-in by employee number is built. Nothing below was deleted: set it to true and the old screen comes back exactly as it was.
       With it off, a tablet that already signed in keeps working as before (its name is remembered on the device); a tablet with
       nobody signed in shows Current Week only, with a note, and has no own tab, notes or scans until the new sign-in is in. */
    var NAME_PICKER = false;
    function signInAs(who) {
        S.who = who; storeJson("dept12DriverWho", who);
        S.tab = who.role === "bagplant" ? "cw" : String(who.truck);
        store("dept12DriverTab", S.tab);
        logView("opened");
        render(); load();
    }
    function signOut() {
        S.noteKey = null;
        S.who = null; store("dept12DriverWho", null);
        render(); load();
    }

    /* ── View log: tells the dashboard when each truck last opened what.
       Sent at most once every 5 minutes per kind. ───────────────────────── */
    function logView(kind) {
        if (DEMO || !S.who || S.who.role !== "driver") return;
        var last = S.viewSent[kind] || 0;
        if (Date.now() - last < 300000) return;
        S.viewSent[kind] = Date.now();
        (APP_MODE ? rpcPublic("app_log_view", { p_emp: S.who.emp, p_kind: kind })
            : rpcPublic("public_log_view", { p_truck: String(S.who.truck), p_kind: kind, p_driver: S.who.name })).catch(function () { S.viewSent[kind] = 0; });
    }

    /* ── Data ─────────────────────────────────────────────────────────────── */
    // The last schedule that loaded is kept on the phone, so reopening the page with no signal still shows it (with a "No signal" note).
    function cacheSave(pub) {
        try { localStorage.setItem("dept12-sched-cache", JSON.stringify({ payload: pub.payload, raw: pub.raw, published_at: pub.published_at, saved_at: Date.now() })); } catch (e) { /* storage full: skip */ }
    }
    function cacheLoad() { try { return JSON.parse(localStorage.getItem("dept12-sched-cache") || "null"); } catch (e) { return null; } }
    function load() {
        if (S.loading || (APP_MODE && !APP.session)) return;      // nothing is asked of the database until someone is signed in
        S.loading = true; renderBusy();
        var raw = null;
        var first;
        if (DEMO) {
            first = window.Dept12BuildSchedule({ start_date: null, days: 5 }, function (fn, a) {
                return sampleRpc(fn, a).then(function (r) { if (fn === "driver_week_data") raw = r; return r; });
            }).then(function (p) { S.payload = p; S.source = "sample"; S.loadedAt = new Date(); S.refreshedAt = new Date(); S.error = ""; });
        } else {
            first = rpcPublicRead("public_published_schedule", {}).then(function (pub) {
                if (!pub) { S.payload = null; S.source = ""; S.error = ""; return; }   // nothing published yet
                S.payload = pub.payload; raw = pub.raw; S.source = "published";
                S.loadedAt = new Date(pub.published_at); S.refreshedAt = new Date(); S.error = "";
                cacheSave(pub);
            }, function (e) {
                S.error = e.message || String(e);   // keep whatever was on screen
                // No signal and nothing on screen yet (the page was just reopened): show the copy saved on this phone.
                var c = e && e.network && !S.payload ? cacheLoad() : null;
                if (c) { S.payload = c.payload; raw = c.raw; S.source = "saved"; S.savedAt = c.saved_at; S.loadedAt = new Date(c.published_at); S.refreshedAt = null; S.error = ""; }
            });
        }
        first.then(function () {
            // Which truck/day/slot holds a real load (vs. a plain schedule note) —
            // only real loads get POD/BOL buttons.
            if (raw) {
                S.loadKeys = {}; S.loadOrder = {}; S.loadKind = {}; S.orders = {}; S.stopsByKey = {}; S.stopsByOrder = {};
                var byLoad = {};
                (raw.stops || []).forEach(function (st) { (byLoad[st.load_id] = byLoad[st.load_id] || []).push(st); });
                Object.keys(byLoad).forEach(function (id) { byLoad[id].sort(function (a, b) { return a.sequence - b.sequence; }); });
                (raw.orders || []).forEach(function (o) { S.orders[o.id] = o; });
                var kinds = {};
                (raw.orders || []).forEach(function (o) { kinds[o.id] = o.is_transfer ? "xfer" : o.kind === "internal" ? "bag" : "ext"; });
                (raw.loads || []).forEach(function (l) {
                    if (!(l.order_ids || []).length) return;
                    var k = l.truck_id + "|" + String(l.scheduled_date).slice(0, 10) + "|" + l.slot;
                    S.loadKeys[k] = true; S.loadOrder[k] = l.order_ids[0]; S.loadKind[k] = kinds[l.order_ids[0]] || "ext";
                    if (byLoad[l.id]) { S.stopsByKey[k] = byLoad[l.id]; S.stopsByOrder[l.order_ids[0]] = byLoad[l.id]; }
                });
            }
            S.loading = false;
            reconcileWho();
            if (S.noteKey) { renderHeader(); } else render();
            loadActivity(); tickerLoad();
        }).catch(function (e) {
            // Anything unexpected: say what it was on the page instead of sitting blank.
            S.loading = false; S.error = (e && e.message) || String(e);
            try { render(); } catch (e2) { showFatal(e2); }
        });
    }
    // Notes and scan status other people (and this driver, earlier) put on these loads.
    function loadActivity() {
        if (DEMO || !S.orders || !S.who) return;
        var ids = Object.keys(S.orders);
        if (!ids.length) return;
        rpcPublicRead("public_driver_activity", { p_order_ids: ids }).then(function (a) {
            S.serverNotes = {}; S.scanList = {};
            (a.notes || []).forEach(function (n) { (S.serverNotes[n.order_id] = S.serverNotes[n.order_id] || []).push({ id: n.id, truck: n.truck, driver: n.driver, text: n.body, at: n.created_at }); });
            (a.scans || []).slice().sort(function (x, y) { return x.created_at < y.created_at ? -1 : 1; }).forEach(function (x) {
                (S.scanList[x.order_id] = S.scanList[x.order_id] || []).push({ pages: x.pages || 1, at: new Date(x.created_at), bucket: x.bucket || "driver-scans", path: x.path || "" });
            });
            if (S.who && S.payload && !S.noteKey) { S.keepScroll = true; render(); }
        }).catch(function () { /* the schedule still works without them */ });
    }
    function showFatal(e) {
        var m = $("#main");
        if (m) m.innerHTML = '<div class="drv-note"><b>Something went wrong showing the schedule.</b> ' + esc((e && e.message) || String(e)) +
            (e && e.stack ? "<br><small>" + esc(String(e.stack).split("\n").slice(0, 3).join(" | ")) + "</small>" : "") + "</div>";
    }

    /* ── Helpers ──────────────────────────────────────────────────────────── */
    function dParts(ds) {
        // Dates normally arrive as "2026-10-05"; also cope with a trailing time or
        // any other format Safari can read, and never throw on a odd one.
        var s = String(ds == null ? "" : ds), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        var d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(s);
        if (isNaN(d.getTime())) return { dow: "", md: s };
        return { dow: DOW[d.getUTCDay()], md: (d.getUTCMonth() + 1) + "/" + d.getUTCDate() };
    }
    function todayIso() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
    function dateTimeLabel(d) {
        return d ? d.toLocaleDateString([], { month: "short", day: "numeric" }) + " at " + timeLabel(d) : "";
    }
    function timeLabel(d) { return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; }
    function whenLabel(iso) {
        if (!iso) return "";
        var d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
        if (mins < 1) return "Just now";
        if (mins < 60) return mins + " min ago";
        var sameDay = d.toDateString() === new Date().toDateString();
        return (sameDay ? "Today" : DOW[d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate()) + " " + timeLabel(d);
    }
    // Same words the Google push bolds, so a driver's eye lands in the same places.
    function loadTextHtml(text) {
        return esc(text).replace(/(Broker\/Customer:|Broker:|PICK:|DROP:|Rexius Order:|Load:|\b07-\d{4}-\d{4}\b)/g, "<b>$1</b>");
    }

    /* Driver tab chip. External loads read "Broker: X" with the pick and drop
       under it; everything else (bag orders, internal freight, typed notes) keeps
       the text from the schedule. */
    // Full address for a stop: name, street, city and state.
    function stopLine(name, address, city, state) {
        var place = [city, state].filter(Boolean).join(" ");
        return [name, address, place].filter(Boolean).join(", ");
    }
    function apptTime12(t) {
        var m = /^(\d{1,2}):(\d{2})/.exec(t || "");
        if (!m) return "";
        var h = +m[1];
        return (h % 12 || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
    }
    // "MON 10/6 · 7:00–9:00 AM" (window) or "TUE 10/7 · 1:00 PM"
    function apptText(a, loadDay) {
        var ds = a.date || loadDay || "", day = "";
        if (ds) { var dt = new Date(ds + "T12:00:00Z"); day = DOW[dt.getUTCDay()].toUpperCase() + " " + (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate(); }
        var from = apptTime12(a.from), to = apptTime12(a.to), t = from || to;
        if (from && to) t = from.slice(-2) === to.slice(-2) ? from.slice(0, -3) + "–" + to : from + "–" + to;
        return [day, t].filter(Boolean).join(" · ");
    }
    // Appointments are typed text. Loads published before that stored a date and times instead; show those the old way.
    function apptLabel(o, which, day) {
        var t = o && o[which + "_appt_text"];
        if (t) return String(t);
        var a = o && o[which + "_appt"];
        return a && (a.from || a.to || a.date) ? apptText(a, day) : "";
    }
    function apptTag(text) { return text ? ' <span class="appt">APPT ' + esc(text) + "</span>" : ""; }
    // The extra picks and drops of a multi-stop route (published with the load); null for a normal pick and drop.
    function routeStops(o, key) { return o && o.route_mode === "custom" && S.stopsByKey && S.stopsByKey[key] && S.stopsByKey[key].length ? S.stopsByKey[key] : null; }
    function hasAppt(o) {
        if (!o) return false;
        if (o.pick_appt_text || o.drop_appt_text || o.pick_appt || o.drop_appt) return true;
        var st = o.route_mode === "custom" && S.stopsByOrder && S.stopsByOrder[o.id];
        return !!(st && st.some(function (x) { return x.notes; }));
    }
    function orderForKey(key) { return S.orders && S.orders[S.loadOrder[key]] || null; }
    // Each part of a load (broker, pick, drop) is its own block with a small gap, instead of blank lines that eat the space.
    function lsHtml(lines) { return lines.filter(Boolean).map(function (l) { return '<div class="ls">' + l + "</div>"; }).join(""); }
    function tabChipHtml(key, r) {
        var o = orderForKey(key);
        if (o && o.kind !== "internal" && !o.is_transfer) {
            // The PICK: and DROP: labels always print, even when empty, so the layout
            // reads the same on every load.
            var day = key.split("|")[1], stops = routeStops(o, key), lines = ["<b>Broker/Customer:</b> " + esc(o.broker_name || "—")];
            if (stops) {
                // A multi-stop route: every pick and drop in order, each with its appointment text.
                var nP = stops.filter(function (x) { return x.stop_type === "pickup"; }).length, nD = stops.length - nP, cp = 0, cd = 0;
                stops.forEach(function (x) {
                    var isP = x.stop_type === "pickup", n = isP ? ++cp : ++cd, tot = isP ? nP : nD;
                    lines.push("", "<b>" + (isP ? "PICK" : "DROP") + (tot > 1 ? " " + n : "") + ":</b> " + esc(stopLine(x.name, x.address, x.city, x.state)) + apptTag(x.notes));
                });
                return lsHtml(lines);
            }
            var pick = stopLine(o.pickup_name, o.pickup_address, o.pickup_city, o.pickup_state);
            var drop = stopLine(o.delivery_name, o.delivery_address, o.delivery_city, o.delivery_state);
            return lsHtml(lines.concat(["<b>PICK:</b> " + esc(pick) + apptTag(apptLabel(o, "pick", day)),
            "<b>DROP:</b> " + esc(drop) + apptTag(apptLabel(o, "drop", day))]));
        }
        // Bag orders: the same EARLY / ANYTIME and FORKLIFT boxes as Current Week.
        var fl = o && o.kind === "internal" && !o.is_transfer ? flagsHtml(bagFlags(o)) : "";
        return loadTextHtml(r.chip) + (fl ? '<div style="margin-top:6px">' + fl + "</div>" : "");
    }
    function ordNo(o) { return o && o.rexius_order_no || ""; }
    function rexiusOrderNo(key) { return ordNo(orderForKey(key)); }
    function loadNo(key) { var o = orderForKey(key); return o && o.broker_load_no || ""; }
    function fleet() { return (S.payload && S.payload.drivers || []).filter(function (d) { return d.driver; }); }
    /* Names are kept in full in the database; the pages show the first name. Two drivers with the same first name get a last initial (Matt S.). */
    function dFirst(full) {
        var parts = String(full || "").trim().split(/\s+/); if (!parts[0]) return "";
        var first = parts[0], same = fleet().filter(function (d) { return String(d.driver).trim().split(/\s+/)[0].toLowerCase() === first.toLowerCase(); });
        if (same.length > 1 && parts.length > 1) return first + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
        return first;
    }
    // A typed name matches a driver regardless of case/spacing, or by a first
    // name / start of a name when only one driver fits.
    function driverByName(txt) {
        var t = String(txt || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (!t) return null;
        var list = fleet(), exact = list.filter(function (d) { return d.driver.toLowerCase().replace(/\s+/g, " ") === t; });
        if (exact.length) return exact[0];
        var starts = list.filter(function (d) { return d.driver.toLowerCase().indexOf(t) === 0; });
        return starts.length === 1 ? starts[0] : null;
    }
    /* The page remembers who signed in. After each load, check that driver is
       still in the list: same name on a different truck → follow them to it;
       not in the list at all → back to the name box. Only forget them for good
       when this is the real schedule (a brief outage showing sample data must
       not sign everyone out). */
    function reconcileWho() {
        if (APP_MODE) return;       // in app mode the database says who this is (by employee number); the published list does not override it
        if (!S.who || S.who.role !== "driver" || !S.payload) return;
        var me = driverByTruck(S.who.truck);
        if (me && me.driver === S.who.name) return;
        var byName = fleet().filter(function (d) { return d.driver === S.who.name; })[0];
        if (byName) {
            S.who = { role: "driver", truck: String(byName.truck), name: byName.driver };
            if (S.source === "live") storeJson("dept12DriverWho", S.who);
            if (S.tab !== "cw") S.tab = String(byName.truck);
            return;
        }
        if (S.source === "live") store("dept12DriverWho", null);
        S.who = null; S.noteKey = null;
    }
    function driverByTruck(num) {
        return (S.payload && S.payload.drivers || []).filter(function (d) { return String(d.truck) === String(num); })[0] || null;
    }
    // Drivers get Current Week and their own tab; the bag plant gets Current Week.
    function isBagPlant() { return !!(S.who && S.who.role === "bagplant"); }
    function allowedTab(tab) {
        if (tab === "cw") return true;
        if (isBagPlant()) return false;
        return !!driverByTruck(tab) && !!S.who && (!!S.who.all || String(S.who.truck) === String(tab));
    }

    /* ── Header + tabs ────────────────────────────────────────────────────── */
    function renderHeader() {
        var whoEl = $("#hdr-who");   // the driver page has no name/truck in the header
        if (whoEl) whoEl.innerHTML = !S.who ? "" : isBagPlant() ? "<b>Current Week</b><span>Bag Orders · View Only</span>" :
            "<b>" + esc(dFirst(S.who.name)) + "</b><span>Truck " + esc(S.who.truck) + "</span>";
        // The bag order color code sits in the header; the page zoom is at the far left.
        $("#hdr").innerHTML = S.who ? bagKeyHtml() : "";
        var hz = $("#hdr-zoom"); if (hz) hz.innerHTML = S.who && !BAG_PLANT ? pageZoomHtml() : "";
    }
    function renderTabs() {
        var tabs = $("#tabs");
        if (!S.who || !S.payload || isBagPlant()) { tabs.hidden = true; tabs.innerHTML = ""; return; }
        tabs.hidden = false;
        var tab = function (id, label, sub, cls) {
            return '<button class="sub-tab' + (cls ? " " + cls : "") + '" role="tab" data-tab="' + esc(id) + '" aria-selected="' + (String(S.tab) === String(id)) + '">' +
                esc(label) + (sub ? '<span class="trk">' + esc(sub) + "</span>" : "") + "</button>";
        };
        var h = tab("cw", "Current Week");
        S.payload.drivers.forEach(function (d) {
            if (allowedTab(String(d.truck))) h += tab(d.truck, dFirst(d.driver) || "Unassigned", d.truck);
        });
        tabs.innerHTML = h;
        var on = tabs.querySelector("[aria-selected=true]");
        if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    /* ── Sign-in screen ───────────────────────────────────────────────────── */
    function vLogin() {
        var brand = '<div class="brand drv-login-brand"><span class="brand-mark"><img src="../rexius-logo.png" alt="Rexius"></span>' +
            "<h1>Flatbed Schedule</h1></div>";
        var h = '<div class="drv-login login-gate"><div class="login-card">' + brand;
        var list = fleet();
        // Type your name or pick it from the list (the list shows as you tap in).
        h += "<p>Type or pick your name to see your loads.</p>" +
            '<input id="login-driver" list="login-names" autocomplete="off" autocapitalize="words" spellcheck="false" ' +
            'aria-label="Your name" placeholder="' + (S.payload ? "Your name" : "Loading drivers…") + '">' +
            '<datalist id="login-names">' + list.map(function (d) { return '<option value="' + esc(d.driver) + '">'; }).join("") + "</datalist>" +
            '<button class="btn pri" id="login-go" disabled>View Schedule</button>' +
            '<div id="login-err" class="login-err"></div>';
        return h + "</div></div>";
    }

    // The sign-in screen of app mode (same look as the dashboard's): shown, and nothing else, until someone is signed in.
    /* The same sign-in card as the dashboard (renderLoginGate in supabase-api.js): same markup, same app.css styles, same accounts. */
    function vAppLogin() {
        return '<div class="drv-login login-gate"><div class="login-card">' +
            '<div class="brand" aria-label="Dept 12 Flatbed Trucking">' +
            '<span class="brand-mark"><img src="../rexius-logo.png" alt="Rexius"></span>' +
            '<span class="brand-copy"><b>Dept 12</b><span>Flatbed Trucking</span></span></div>' +
            "<h2>Sign in</h2><p>Sign in with your Dept 12 account.</p>" +
            '<input id="login-email" type="email" autocomplete="username" placeholder="Email">' +
            '<input id="login-password" type="password" autocomplete="current-password" placeholder="Password">' +
            '<button class="btn pri" id="login-go" type="button">Continue</button><div id="login-err" class="login-err">' + esc(APP.err) + "</div></div></div>";
    }

    /* ── Toolbar ──────────────────────────────────────────────────────────── */
    function bagKeyHtml() {
        var items = [["Early", "#D9EAD3"], ["Anytime", "#FFF2CC"], ["Early East", "#F1C232"], ["Anytime East", "#783F04"]];
        return '<span class="bagkey" aria-label="Bag order color code"><span class="bagkey-t">Bag order color code</span>' +
            items.map(function (x) { return '<span class="bk"><i style="background:' + x[1] + '"></i>' + x[0] + "</span>"; }).join("") + "</span>";
    }
    // The banner the office types on the dashboard's Current Week bar (40 characters), one for this page. Nothing shows when it is empty.
    function tickerHtml() { return S.ticker ? '<span class="drv-tick">' + esc(S.ticker) + "</span>" : ""; }
    function tickerLoad() {
        if (DEMO || (APP_MODE && !APP.session)) return;
        rpcPublicRead("app_ticker", {}).then(function (t) {
            var v = String((t && (BAG_PLANT ? t.bagger : t.drivers)) || "").slice(0, 40);
            store(BAG_PLANT ? "dept12-ticker-b" : "dept12-ticker-d", v);
            if (v !== (S.ticker || "")) { S.ticker = v; if (S.payload && !S.noteKey) { S.keepScroll = true; render(); } }
        }, function () { /* no signal or not set up yet: keep what is showing */ });
    }
    // Bag plant TV: the zoom buttons (100% to start; remembered on that screen).
    var ZOOMS = [0.5, 0.6, 0.75, 0.9, 1];
    var PZOOMS = [0.85, 1, 1.15, 1.3, 1.5, 1.75];   // the driver page's own zoom (bigger only helps on a phone)
    function pageZoomHtml() {
        return '<span class="tv-zoom" aria-label="Zoom"><button class="btn sm" data-pzoom="-1" title="Zoom out" aria-label="Zoom out">&minus;</button><span class="lbl">' + Math.round(S.pz * 100) + '%</span><button class="btn sm" data-pzoom="1" title="Zoom in" aria-label="Zoom in">+</button></span>';
    }
    function zoomHtml() {
        return BAG_PLANT ? '<span class="tv-zoom" aria-label="Zoom"><button class="btn sm" data-zoom="-1" title="Zoom out">&minus;</button><span class="lbl">' + Math.round(S.zoom * 100) + '%</span><button class="btn sm" data-zoom="1" title="Zoom in">+</button></span>' : "";
    }
    function toolbarHtml(title) {
        return '<div class="toolbar cw-toolbar">' + (BAG_PLANT ? "" : "<h2>" + esc(title) + "</h2>") + tickerHtml() +
            '<span style="flex:1"></span>' + zoomHtml() +
            (S.source === "published" ? '<span class="lbl" style="color:var(--good)">Last updated ' + esc(dateTimeLabel(S.loadedAt)) + "</span>" +
                '<span class="lbl">|</span><span class="lbl">Last refreshed ' + esc(timeLabel(S.refreshedAt)) + "</span>" :
                S.source === "live" ? '<span class="lbl" style="color:var(--good)">Updated ' + esc(timeLabel(S.loadedAt)) + "</span>" :
                S.source === "saved" ? '<span class="lbl" style="color:var(--good)">Last updated ' + esc(dateTimeLabel(S.loadedAt)) + "</span>" : "") +
            (BAG_PLANT ? "" : '<button class="btn pri" id="refresh"' + (S.loading ? " disabled" : "") + ">" + SYNC_ICON + (S.loading ? "Refreshing" : "Refresh") + "</button>") + "</div>";
    }
    function noticeHtml() { return noticeCore(); }
    function noticeCore() {
        if (APP_MODE && !BAG_PLANT && !S.who) {
            // No employee number, or one the database doesn't know: just Current Week, no personal tab and no banner. Only a real failure is said out loud.
            return (APP.empState === "error" ? '<div class="drv-note"><b>Couldn\'t check who you are.</b> ' + esc(APP.err) + "</div>" : "") +
                (S.error ? '<div class="drv-note"><b>Couldn\'t refresh.</b> ' + esc(S.error) + " Showing the last loaded schedule.</div>" : "");
        }
        if (!S.who && !NAME_PICKER && !DEMO) return '<div class="drv-note"><b>Current Week.</b> Your own tab, notes and scans return with the new sign-in.</div>' +
            (S.error ? '<div class="drv-note"><b>Couldn\'t refresh.</b> ' + esc(S.error) + " Showing the last loaded schedule.</div>" : "");
        if (DEMO) return '<div class="drv-note"><b>Demo data.</b> Built-in sample schedule for testing the layout.</div>';
        if (S.error) return '<div class="drv-note"><b>Couldn\'t refresh.</b> ' + esc(S.error) + " Showing the last loaded schedule.</div>";
        return "";
    }

    /* ── Current Week ─────────────────────────────────────────────────────── */
    function vCurrentWeek() {
        var p = S.payload, cw = p.current_week.filter(function (t) { return t.driver; }), today = todayIso(), mine = S.who && S.who.role === "driver" ? String(S.who.truck) : "";
        // Bag plant only: loads given to an outside carrier get one extra column at the far right (headed just "Outside Carrier"); who is hauling it goes in the order's driver note, which shows on the chip.
        if (isBagPlant() && p.outside) cw.push({ outside: true, truck: "", truck_id: null, driver: "Outside Carrier", equipment_type: "", driver_color: null, rows: p.outside.rows });
        // Bag plant: the whole fleet fills the screen, columns as wide as they fit.
        // Bag plant: columns share the screen exactly (its date column is 96px).
        var dateW = 88;   // the bagger page uses exactly the drivers' sizes
        var z = isBagPlant() ? (S.zoom || 1) : (S.pz || 1);
        var big = isBagPlant() ? ' style="--col-w:' + Math.max(150, Math.min(330, Math.floor((window.innerWidth / z - dateW - 4) / Math.max(1, cw.length)))) + 'px"' : "";
        var h = '<div class="grid-wrap"' + big + '><table class="grid" style="' + (z !== 1 ? "zoom:" + z + ";" : "") + 'width:calc(' + dateW + 'px + ' + cw.length + ' * var(--col-w,150px))"><thead><tr>' +
            '<th class="corner"><span class="lbl">Date</span></th>';
        cw.forEach(function (t) {
            if (t.outside) { h += '<th class="trkcol carriercol" style="width:var(--col-w,150px);cursor:default"><span class="drv">' + esc(t.driver) + "</span></th>"; return; }
            var open = allowedTab(String(t.truck));
            h += '<th class="trkcol' + (t.driver_color ? " has-dc" : "") + '" style="' + (t.driver_color ? "--dc:" + esc(/^#[0-9a-f]{8}$/i.test(t.driver_color) ? t.driver_color.slice(0, 7) : t.driver_color) + ";" : "") + 'width:var(--col-w,150px)' + (open ? "" : ";cursor:default") + '"' +
                (open ? ' data-tab="' + esc(t.truck) + '" title="Open ' + esc(dFirst(t.driver) || t.truck) + '\'s tab"' : "") + ">" +
                '<span class="drv"' + (t.driver_color ? ' style="--dc:' + esc(t.driver_color) + '"' : "") + ">" + esc(dFirst(t.driver) || "— unassigned —") + "</span>" +
                '<span class="trk">' + esc(t.truck) + " " + esc(t.equipment_type || "") + "</span></th>";
        });
        h += "</tr></thead><tbody>";
        p.dates.forEach(function (ds, di) {
            var dp = dParts(ds);
            for (var s = 0; s < p.slots_per_day; s++) {
                h += '<tr class="slotrow' + (ds === today ? " today" : "") + (ds < today ? " past" : "") + (s === 0 ? " dstart" : "") + '">';
                if (s === 0) h += '<td class="rowhd" rowspan="' + p.slots_per_day + '"><span class="dwk">' + dp.dow.toUpperCase() +
                    '</span><br><span class="dnum">' + (+ds.slice(5, 7)) + "/" + ds.slice(8, 10) + "</span></td>";
                cw.forEach(function (t) {
                    var r = t.rows[di * p.slots_per_day + s] || {}, open = allowedTab(String(t.truck));
                    if (r.off) { h += '<td class="offday">' + (s === Math.ceil(p.slots_per_day / 2) - 1 ? '<div class="off-label">OFF</div>' : "") + "</td>"; return; }
                    if (!r.chip) { h += "<td></td>"; return; }
                    // A typed Scheduler cell (no load behind it) reads as plain text in
                    // the cell, exactly like the dashboard's Current Week.
                    if (!S.loadKeys[t.truck_id + "|" + ds + "|" + (s + 1)]) {
                        h += "<td" + (r.color ? ' style="background-color:' + esc(r.color) + ";color:" + textOn(r.color) + '"' : "") + '><div class="cell"' +
                            (open ? ' data-go="' + esc(t.truck) + "|" + ds + '" style="cursor:pointer"' : "") + '><div class="txt">' + esc(r.chip) + "</div></div></td>";
                        return;
                    }
                    var key = t.truck_id + "|" + ds + "|" + (s + 1), lines = r.chip.split("\n").filter(function (x) { return x.trim(); });
                    var ord = S.orders && S.orders[S.loadOrder[key]];
                    var go = open ? ' role="button" tabindex="0" data-go="' + esc(t.truck) + "|" + ds + '"' : "";
                    // Bag plant: the dashboard's chip (title, City → City, order numbers,
                    // flags), big for bag orders and quieter for everything else.
                    if (ord && (isBagPlant() || (ord.kind !== "internal" && !ord.is_transfer))) {
                        var kindCls = !isBagPlant() ? "" : S.loadKind[key] === "bag" ? "bp-bag" : ord.kind !== "internal" && !ord.is_transfer ? "bp-ext" : "bp-other";
                        h += '<td><div class="cell">' + dashChipHtml(ord, r, go, kindCls, isBagPlant() ? "" : t.driver_color) + "</div></td>"; return;
                    }
                    if (isBagPlant()) { h += bagPlantCell(lines, r, S.loadKind[key]); return; }
                    h += '<td><div class="cell"><div class="chip' + (r.color ? " filled" : "") + '"' +
                        (open ? go : ' style="cursor:default;' + fillStyle(r.color) + '"') +
                        (open && r.color ? ' style="' + fillStyle(r.color) + '"' : "") + '><div class="who">' + esc(lines[0]) + "</div>" +
                        lines.slice(1).map(function (x) { return '<div class="dnote">' + esc(x) + "</div>"; }).join("") +
                        (ord && ord.kind === "internal" && !ord.is_transfer ? flagsHtml(bagFlags(ord)) : "") + "</div></div></td>";
                });
                h += "</tr>";
            }
        });
        return h + "</tbody></table></div>";
    }


    /* The dashboard's load chip, built from the same order fields: customer or
       broker on top, City → City and the load/order numbers (or pallets and the
       07- number) underneath, then timing/forklift flags and the driver note. */
    function cityState(city, state) { return city ? city + (state ? ", " + state : "") : "?"; }
    // FORKLIFT / NO FORKLIFT / SPYDER boxes for a bag order (timing is the color key in the header).
    function bagFlags(o) {
        var flags = [];
        var fk = String(o.cust_forklift || "").trim().toLowerCase();
        if (fk) flags.push(fk === "nf" || fk === "none" || fk === "no" || fk === "no forklift" ? "NO FORKLIFT" : fk.indexOf("spyder") >= 0 ? "SPYDER" : "FORKLIFT");
        return flags;
    }
    function flagsHtml(flags) {
        return flags.length ? '<div class="flags">' + flags.map(function (x) { return '<span class="flag">' + esc(x) + "</span>"; }).join("") + "</div>" : "";
    }
    // dcolor (drivers' page only): the truck's driver color as set on the dashboard. The published row color is
    // that color already washed out for the old sheet, so tinting it again made these chips almost white.
    function dashChipHtml(o, r, attrs, cls, dcolor) {
        var ext = o.kind !== "internal" && !o.is_transfer, flags = [], title, meta;
        if (o.is_transfer) {
            title = o.notes || o.driver_note || "(no load info)";   // the whole Load Info box, not the department
            meta = "";
        } else if (ext) {
            // Broker and City → City only: the order and load numbers are on the
            // driver's own tab, and too much here is confusing.
            title = o.broker_name || "(no customer)";
            var cst = o.route_mode === "custom" && S.stopsByOrder && S.stopsByOrder[o.id], routeTxt;
            if (cst && cst.length) {
                var lastD = cst.slice().reverse().filter(function (x) { return x.stop_type === "delivery"; })[0] || cst[cst.length - 1];
                routeTxt = cityState(cst[0].city, cst[0].state) + " → " + cityState(lastD.city, lastD.state) + " · " + cst.length + " stops";
            } else routeTxt = cityState(o.pickup_city, o.pickup_state) + " → " + cityState(o.delivery_city, o.delivery_state);
            meta = '<div class="meta meta-2line meta-route"><span class="route-line">' + esc(routeTxt) + "</span></div>";
        } else {
            title = o.customer_name || "(no customer)";
            meta = '<div class="meta meta-2line">' + (o.pallet_count ? "<span>" + esc(o.pallet_count) + " PAL</span>" : "") +
                '<span class="nowrap">' + esc(ordNo(o) || "no order #") + "</span></div>";
            flags = bagFlags(o);
        }
        var note = o.driver_note && !(o.is_transfer && !o.notes) ? '<div class="dnote">&#9998; ' + esc(o.driver_note) + "</div>" : "";
        if (ext) {
            // Every load a driver sees has been pushed, so it wears the pushed look:
            // a soft tint of the driver's color with the solid color as the edge.
            var tint = dcolor || r.color;
            var edge = tint || "var(--ext)";
            var appt = hasAppt(o);
            return '<div class="chip xchip' + (tint ? " tinted" : "") + (appt ? " has-appt" : "") + (cls ? " " + cls : "") + '" style="--edge:' + edge +
                (tint ? ";background:color-mix(in srgb," + esc(tint) + " 17%,var(--panel))" : "") + '"' + (attrs || "") + ">" +
                (appt ? '<span class="appt-ind">APPT</span>' : "") + '<div class="who">' + esc(title) + "</div>" + meta + note + "</div>";
        }
        var edge2 = r.color || (o.cust_timing === "early" ? "var(--early)" : "var(--anytime)");
        return '<div class="chip' + (r.color ? " filled" : "") + (o.is_transfer ? " xfer" : "") + (cls ? " " + cls : "") + '" style="--edge:' + edge2 + ";" + fillStyle(r.color) + '"' + (attrs || "") + ">" +
            '<div class="who">' + esc(title) + "</div>" + meta +
            (flags.length ? '<div class="flags">' + flags.map(function (x) { return '<span class="flag">' + esc(x) + "</span>"; }).join("") + "</div>" : "") +
            note + "</div>";
    }

    /* Bag plant cell: a bag order (07-) is the whole point of this screen — its
       store color, customer and order number big and bold. External loads and
       internal freight stay visible but quiet, so the plant knows the truck's
       busy without reading it. */
    // "07-0826-0049 - 24 PAL" → the order number big, pallets beside it.
    function bpOrderLine(ord) {
        var m = String(ord).match(/^(.*?)\s*-\s*(\d+\s*PAL)\s*$/i);
        return '<div class="bp-ord"><b>' + esc(m ? m[1] : ord) + "</b>" + (m ? '<span class="bp-pal">' + esc(m[2]) + "</span>" : "") + "</div>";
    }
    function bagPlantCell(lines, r, kind) {
        if (kind === "bag") {
            var ord = lines[lines.length - 1] || "", mid = lines.slice(1, -1);
            return '<td><div class="cell"><div class="chip filled bp-bag" style="' + fillStyle(r.color) + '">' +
                '<div class="bp-cust">' + esc(lines[0]) + "</div>" +
                mid.map(function (x) { return '<div class="bp-where">' + esc(x) + "</div>"; }).join("") +
                bpOrderLine(ord) + "</div></div></td>";
        }
        return '<td><div class="cell"><div class="chip bp-other"><div class="who">' + esc(lines[0]) + "</div>" +
            (lines[1] ? '<div class="dnote">' + esc(lines[1]) + "</div>" : "") + "</div></div></td>";
    }

    /* ── One driver's tab ─────────────────────────────────────────────────── */
    /* Driver notes on a load, keyed by order id. Prototype: kept in this
       browser's storage, which the dashboard on the same address also reads
       (order drawer → Driver notes). The real version saves to Supabase. */
    // A real load keys its notes by order id; a typed Scheduler cell (no order)
    // keys them by the cell itself.
    function noteId(key) { return S.loadOrder[key] || "cell:" + key; }
    function notesFor(key) {
        var oid = noteId(key);
        if (!oid) return [];
        var list = DEMO ? ((storeJson("dept12DriverNotes") || {})[oid] || []) : (S.serverNotes[oid] || []);
        list = list.concat(OUTBOX.items.filter(function (it) { return it.type === "note" && it.oid === oid; }).map(function (it) {
            return { id: it.id, text: it.text, at: new Date(it.at).toISOString(), pending: true };
        }));
        return list.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    }
    // Resolves true when kept (sent, or saved on the phone and waiting for signal), false when there was nothing to save.
    function saveNote(key, text) {
        var oid = noteId(key), t = String(text || "").trim();
        if (!oid || !t || !S.who) return Promise.resolve(false);
        if (DEMO) {   // sample mode: kept on this device only
            var all = storeJson("dept12DriverNotes") || {};
            (all[oid] = all[oid] || []).push({ id: String(Date.now()), truck: S.who.truck, driver: S.who.name, text: t, at: new Date().toISOString() });
            storeJson("dept12DriverNotes", all);
            return Promise.resolve(true);
        }
        return Dept12Outbox.add({ type: "note", key: key, oid: oid, emp: S.who.emp, driver: S.who.name, truck: String(S.who.truck), text: t, tries: 0 })
            .then(function (id) { return outboxFlush().then(function () { return true; }); });
    }
    function notesHtml(key) {
        var list = notesFor(key), h = "";
        if (list.length) h += '<div class="drv-notes">' + list.map(function (n) {
            return '<div class="drv-note-item' + (n.pending ? " pending" : "") + '"><span>' + esc(n.pending ? "Waiting to send" : whenLabel(n.at)) + "</span>" + esc(n.text) + "</div>";
        }).join("") + "</div>";
        if (S.noteKey === key) h += '<div class="drv-note-edit"><textarea id="note-draft" rows="3" aria-label="Note for dispatch" ' +
            'placeholder="Waiting at the receiver, bad site, anything dispatch should know"></textarea>' +
            '<div class="drv-note-acts"><button class="btn" data-note-cancel>Cancel</button><button class="btn pri" data-note-save="' + esc(key) + '">Save Note</button></div></div>';
        return h;
    }
    /* Scanned POD / BOL for a load. The PDF goes to Supabase (private bucket "driver-scans")
       and becomes that order's POD on the dashboard. A copy also stays on this device
       (IndexedDB) so the driver can open "View PDF" without a signal. */
    function scanDb() {
        return new Promise(function (ok, fail) {
            var rq = indexedDB.open("dept12-prototype", 1);
            rq.onupgradeneeded = function () { rq.result.createObjectStore("scans", { keyPath: "id" }); };
            rq.onsuccess = function () { ok(rq.result); };
            rq.onerror = function () { fail(rq.error); };
        });
    }
    function saveScan(key, blob, pages) {
        var rec = {
            id: String(Date.now()) + Math.random().toString(36).slice(2, 6), key: key, order_id: S.loadOrder[key] || null,
            truck: S.who.truck, driver: S.who.name, at: new Date().toISOString(), pages: pages, blob: blob
        };
        return scanDb().then(function (db) {
            return new Promise(function (ok, fail) {
                var tx = db.transaction("scans", "readwrite"); tx.objectStore("scans").put(rec);
                tx.oncomplete = function () { ok(rec); }; tx.onerror = function () { fail(tx.error); };
            });
        });
    }
    // A scan can carry a name ("Signed BOL Walmart.pdf"): it travels in the stored file's name, "<time>__Signed_BOL_Walmart.pdf", and is read back by scanNameOf().
    function scanSafeName(name) {
        var n = String(name || "").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
        return n ? "__" + n : "";
    }
    function scanNameOf(path) {
        var m = /\/\d+__([^/]+)\.pdf$/.exec(String(path || ""));
        return m ? m[1].replace(/_/g, " ") + ".pdf" : "";
    }
    /* ── Outbox: notes and scans that have not reached the office yet ───────────
       They are kept on the phone (outbox.js) and sent one at a time. No signal, a timeout or a closed page just leaves them waiting: they go again after 15 s, 30 s, 1 min, then every 2 min,
       when the phone comes back online, and when the screen wakes. Sending again is safe: a scan keeps the same file name on every try and the database recognises a repeat. */
    var OUTBOX = { items: [], busy: false, timer: null, tries: 0, urls: {} };
    function outboxUrl(it) { return OUTBOX.urls[it.id] || (OUTBOX.urls[it.id] = it.blob ? URL.createObjectURL(it.blob) : ""); }
    function outboxLoad() {
        if (!window.Dept12Outbox) return Promise.resolve();
        return Dept12Outbox.all().then(function (l) { OUTBOX.items = l; }, function () { OUTBOX.items = []; });
    }
    function outboxSendOne(it) {
        if (it.type === "note") {
            return APP_MODE ? rpcPublic("app_add_driver_note", { p_emp: it.emp, p_order_id: it.oid, p_body: it.text })
                : rpcPublic("public_add_driver_note", { p_order_id: it.oid, p_driver: it.driver, p_truck: it.truck, p_body: it.text });
        }
        return (APP_MODE ? appToken() : Promise.resolve(null)).then(function (token) {
            var h = { "apikey": SB_KEY, "Content-Type": "application/pdf", "x-upsert": "false" };
            if (token) h["Authorization"] = "Bearer " + token;
            return fetchTimeout(SB_URL + "/storage/v1/object/driver-scans/" + it.path, { method: "POST", headers: h, body: it.blob }, 90000);
        }).then(function (r) {
            if (r.ok) return null;
            return r.text().then(function (t) {
                if (/"statusCode":"?409|Duplicate/i.test(t)) return null;      // this exact file is already there: an earlier try got through
                var fail = new Error("the upload failed (" + r.status + ")"); fail.status = r.status; throw fail;
            });
        }).then(function () {
            return APP_MODE ? rpcPublic("app_register_scan", { p_emp: it.emp, p_order_id: it.oid, p_path: it.path, p_pages: it.pages })
                : rpcPublic("public_register_scan", { p_order_id: it.oid, p_path: it.path, p_pages: it.pages, p_driver: it.driver, p_truck: it.truck });
        });
    }
    function outboxFlush() {
        if (OUTBOX.busy || DEMO || !window.Dept12Outbox) return Promise.resolve();
        OUTBOX.busy = true; clearTimeout(OUTBOX.timer);
        var sent = 0, paused = false;
        return outboxLoad().then(function () {
            return OUTBOX.items.filter(function (it) { return !it.failed; }).reduce(function (chain, it) {
                return chain.then(function () {
                    if (paused) return;
                    return outboxSendOne(it).then(function () { sent++; return Dept12Outbox.remove(it.id); }, function (err) {
                        if (err && (err.network || err.needLogin || err.status === 401)) { paused = true; return; }   // no signal, or signed out: keep it and try later
                        it.tries = (it.tries || 0) + 1; it.error = (err && err.message) || "Not sent";
                        if (it.tries >= 3) it.failed = true;
                        return Dept12Outbox.put(it);
                    });
                });
            }, Promise.resolve());
        }).then(outboxLoad).then(function () {
            OUTBOX.busy = false;
            Object.keys(OUTBOX.urls).forEach(function (id) { if (!OUTBOX.items.some(function (it) { return it.id === id; })) { URL.revokeObjectURL(OUTBOX.urls[id]); delete OUTBOX.urls[id]; } });
            var waiting = OUTBOX.items.filter(function (it) { return !it.failed; }).length;
            if (waiting) { OUTBOX.tries = paused ? OUTBOX.tries + 1 : 0; OUTBOX.timer = setTimeout(outboxFlush, Math.min(120000, 15000 * Math.pow(2, Math.min(OUTBOX.tries, 3)))); }
            else OUTBOX.tries = 0;
            if (sent) { loadScans(); loadActivity(); if (OUTBOX.had) toast(sent + " waiting " + (sent > 1 ? "items were" : "item was") + " sent"); }
            OUTBOX.had = waiting > 0 || OUTBOX.items.length > 0;
            if (S.who && S.payload && !S.noteKey) { S.keepScroll = true; render(); }
        }, function () { OUTBOX.busy = false; });
    }
    // A scan (or a signed copy) is saved on the phone first, then sent. With no signal it waits in the outbox and goes out by itself; the file is never lost.
    function sendScan(key, blob, pages, name) {
        var oid = S.loadOrder[key];
        if (DEMO || !oid) return saveScan(key, blob, pages);   // sample mode: this device only
        var path = oid + "/" + Date.now() + scanSafeName(name) + ".pdf";
        return Dept12Outbox.add({ type: "scan", key: key, oid: oid, emp: S.who.emp, driver: S.who.name, truck: String(S.who.truck), path: path, blob: blob, pages: pages, tries: 0 })
            .then(function (id) { return outboxFlush().then(function () { return OUTBOX.items.some(function (it) { return it.id === id; }) ? "queued" : "sent"; }); });
    }
    // Latest scan per load made on this device, for the View PDF link.
    function loadScans() {
        if (!window.indexedDB) return;
        scanDb().then(function (db) {
            var all = db.transaction("scans").objectStore("scans").getAll();
            all.onsuccess = function () {
                Object.keys(S.scans).forEach(function (k) { URL.revokeObjectURL(S.scans[k].url); });
                S.scans = {};
                (all.result || []).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).forEach(function (r) {
                    if (S.scans[r.key]) URL.revokeObjectURL(S.scans[r.key].url);
                    S.scans[r.key] = { url: URL.createObjectURL(r.blob), pages: r.pages, at: new Date(r.at) };
                });
                if (S.who && S.payload && !S.noteKey) { S.keepScroll = true; render(); }
            };
        }).catch(function () { /* no IndexedDB: scans still go to the dashboard */ });
    }
    // A scan and paperwork are listed the same way: a PDF file chip with its name. Nothing is shown when there are none.
    var PDF_ICON = '<span class="ico"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2h6l3 3v9H4z"/><path d="M10 2v3h3M6 8h4M6 11h4"/></svg></span>';
    // Every scan of the load's order, oldest first. A scan with no name is "<order> scan1", "<order> scan2" ... counted in that order.
    function scanList(key) {
        var oid = S.loadOrder[key], list = S.scanList && S.scanList[oid], o = orderForKey(key), label = (o && (o.rexius_order_no || o.broker_load_no)) || "Scan", n = 0;
        if (!list || !list.length) {
            var loc = S.scans[key], waiting = OUTBOX.items.some(function (it) { return it.type === "scan" && it.oid === oid; });
            if (!waiting) return loc ? [{ pages: loc.pages, at: loc.at, url: loc.url, name: label + " scan1.pdf" }] : [];
            list = [];
        }
        var out = (list || []).map(function (sc) { return Object.assign({}, sc, { name: scanNameOf(sc.path) || label + " scan" + (++n) + ".pdf" }); });
        OUTBOX.items.filter(function (it) { return it.type === "scan" && it.oid === oid; }).forEach(function (it) {
            out.push({ pages: it.pages, at: new Date(it.at), url: outboxUrl(it), name: scanNameOf(it.path) || label + " scan" + (++n) + ".pdf", pending: true, failed: !!it.failed });
        });
        return out;
    }
    function scanHtml(key) {
        return scanList(key).map(function (sc, i) {
            return (sc.url || sc.path) ? '<button class="pdfchip' + (sc.pending ? " pending" : "") + '" type="button" data-scanview="' + esc(key) + "|" + i + '" title="' + (sc.pending ? (sc.failed ? "Couldn't be sent yet. " : "Waiting to send. ") : "") + "Open " + esc(sc.name) + '">' + PDF_ICON + '<span class="nm">' + esc(sc.name) + "</span>" + (sc.pending ? '<span class="pend">' + (sc.failed ? "Not sent" : "Waiting to send") + "</span>" : "") + "</button>"
                : '<span class="pdfchip" title="Sent to the office">' + PDF_ICON + '<span class="nm">' + esc(sc.name) + "</span></span>";
        }).join("");
    }
    function noteBtn(key, big) {
        return S.noteKey !== key ? '<button class="' + (big ? "btn" : "btn sm") + '" data-note="' + esc(key) + '">Add Note</button>' : "";
    }
    function scanBtn(key, big) {
        return '<button class="' + (big ? "btn" : "btn sm") + '" data-scan="' + esc(key) + '" title="Scan the POD / BOL">Scan</button>';
    }
    // Store map: a picture of the store (PNG in the storeimages folder) for bag orders.
    function storeMapUrl(o) {
        var u = o && o.customer_map_url || "";
        return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u) ? u : "";
    }
    function storeMapBtn(key, big) {
        var o = orderForKey(key);
        return o && o.kind === "internal" && !o.is_transfer && storeMapUrl(o)
            ? '<button class="btn sm smap-btn" data-smap="' + esc(key) + '">Store Map</button>' : "";
    }
    function openStoreMap(key) {
        var o = orderForKey(key), url = storeMapUrl(o);
        if (!url || document.querySelector(".smap")) return;
        var el = document.createElement("div");
        el.className = "smap"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Store map");
        el.innerHTML = '<div class="smap-top"><button class="btn" data-smap-close>Close</button>' +
            '<div class="smap-title"><b>' + esc(o.customer_name || "Store") + "</b><span>Store map</span></div>" +
            '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Open Full Size</a></div>' +
            '<div class="smap-body"><img src="' + esc(url) + '" alt="Store map for ' + esc(o.customer_name || "this store") + '"></div>';
        document.body.appendChild(el);
        document.body.style.overflow = "hidden";
    }
    function closeStoreMap() {
        var el = document.querySelector(".smap");
        if (el) { el.remove(); document.body.style.overflow = ""; }
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeStoreMap(); });
    /* Paperwork the office marked "Show To Driver" for this load's order: [{ id, name, path }], sent in the published schedule.
       It opens in the viewer (paperwork.js), where the driver can sign it; the signed copy goes up the same way a scan does. */
    function paperDocs(key) {
        var m = S.payload && S.payload.docs;
        return APP_MODE && m && m[S.loadOrder[key]] || [];
    }
    function paperChips(key) {
        return paperDocs(key).map(function (d, i) {
            return '<button class="pdfchip" type="button" data-paper="' + esc(key) + "|" + i + '" title="Open ' + esc(d.name) + '">' + PDF_ICON + '<span class="nm">' + esc(d.name) + "</span></button>";
        }).join("");
    }
    function filesHtml(key) {
        var h = scanHtml(key) + paperChips(key);
        return h ? '<span class="chip-files">' + h + "</span>" : "";
    }
    // A file in private storage, fetched with the signed-in login: the bytes of a paperwork PDF or of a scan.
    function storageBytes(bucket, path) {
        return appToken().then(function (token) {
            var h = { "apikey": SB_KEY };
            if (token) h["Authorization"] = "Bearer " + token;
            return fetchTimeout(SB_URL + "/storage/v1/object/authenticated/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/"), { headers: h }, 60000);
        }).then(function (r) {
            if (!r.ok) throw new Error("the file could not be opened (" + r.status + ")");
            return r.arrayBuffer();
        });
    }
    function openPaper(key, i) {
        var d = paperDocs(key)[i];
        if (!d || !window.Dept12Paper) return;
        window.Dept12Paper.open({
            title: S.chipTitle[key] || d.name,
            getBytes: function () { return storageBytes("documents", d.path); },
            onDone: function (blob, pages) {
                return sendScan(key, blob, pages, "Signed " + d.name).then(function (state) {
                    loadScans(); loadActivity();
                    toast(state === "queued" ? "Saved on your phone. It sends when you have signal." : "Signed copy sent · " + pages + " page" + (pages > 1 ? "s" : ""));
                });
            }
        });
    }
    // A scan opens in the same viewer (view only): this phone's own copy if that is all there is, otherwise the file on the server.
    function openScan(key, i) {
        var sc = scanList(key)[i];
        if (!sc || !window.Dept12Paper) return;
        window.Dept12Paper.open({
            title: sc.name,
            readOnly: true,
            getBytes: function () {
                if (sc.url) return fetch(sc.url).then(function (r) { return r.arrayBuffer(); });
                return storageBytes(sc.bucket || "driver-scans", sc.path);
            }
        });
    }
    /* The driver's own tab: each day is a rounded box with a big date; the loads inside it are hard-edged boxes. A line divides one day from the next. */
    function dayHeadHtml(ds, today, cls, loadCount) {
        var dp = dParts(ds);
        return '<div class="' + cls + '" id="d-' + ds + '"><span class="dwk">' + dp.dow.toUpperCase() +
            '</span><span class="dnum">' + dp.md + "</span>" + (ds === today ? '<span class="today-tag">Today</span>' : "") +
            "</div>";
    }
    // Real loads on this truck-day (a typed cell like "Load SPI NOTI" is a note, not a load).
    function dayLoadKeys(d, ds, rows) {
        var out = [];
        rows.forEach(function (r, s) { var key = d.truck_id + "|" + ds + "|" + (s + 1); if (r.chip && S.loadKeys[key]) out.push(key); });
        return out;
    }
    function vDriverGrid(d) {
        var p = S.payload, today = todayIso();
        var h = '<div class="drv-scroll"><div class="drv-pad" style="padding-top:10px">' +
            '<div class="dv dv-head"><div class="hd">' + esc(dFirst(d.driver) || "Load") + '</div><div class="hd">Rexius Order #</div><div class="hd">Dispatch Notes</div><div class="hd">PO / PU #</div>' +
            '<div class="hd">Delivery #</div><div class="hd">Load #</div><div class="hd">Driver Notes</div></div>';
        p.dates.forEach(function (ds, di) {
            var rows = d.rows.slice(di * p.slots_per_day, (di + 1) * p.slots_per_day), keys = dayLoadKeys(d, ds, rows), total = keys.length;
            h += '<div class="dvx-wrap"><section class="dvx-day">' + dayHeadHtml(ds, today, "dvx-hd", total);
            if (rows.some(function (r) { return r.off; })) { h += '<div class="off-cell off-hatch"><div class="off-label">OFF</div></div></section></div>'; return; }
            h += '<div class="dv dvx-body">';
            rows.forEach(function (r, s) {
                var key = d.truck_id + "|" + ds + "|" + (s + 1), isLoad = !!S.loadKeys[key];   // typed cells: text only
                S.chipTitle[key] = String(r.chip || "").split("\n")[0];
                if (!r.chip && !r.notes) return;
                if (!isLoad) { h += '<div class="dvx-note-row">' + esc(r.chip) + "</div>"; return; }
                h += '<div><div class="load-txt' + (r.color ? "" : " unfilled") + '" style="' + fillStyle(r.color) + '">' + storeMapBtn(key) + tabChipHtml(key, r) +
                    '<div class="chip-scan">' + scanBtn(key) + filesHtml(key) + "</div></div></div>" +
                    '<div class="mono">' + esc(rexiusOrderNo(key)) + "</div>" +
                    '<div class="dvx-note">' + esc(r.notes || "") + "</div>" +
                    '<div class="mono">' + esc(r.po_number || "") + "</div>" +
                    '<div class="mono">' + esc(r.delivery_number || "") + "</div>" +
                    '<div class="mono">' + esc(loadNo(key)) + "</div>" +
                    '<div><div class="pod-btns">' + noteBtn(key) + "</div>" + notesHtml(key) + "</div>";
            });
            h += "</div></section></div>";
        });
        return h + "</div></div>";
    }
    function vDriverCards(d) {
        var p = S.payload, today = todayIso(), h = '<div class="drv-scroll"><div class="drv-pad"><div class="drv-days">';
        p.dates.forEach(function (ds, di) {
            var rows = d.rows.slice(di * p.slots_per_day, (di + 1) * p.slots_per_day), keys = dayLoadKeys(d, ds, rows), total = keys.length;
            h += '<div class="dvx-wrap"><section class="drv-day">' + dayHeadHtml(ds, today, "drv-day-hd", total);
            if (rows.some(function (r) { return r.off; })) { h += '<div class="drv-card off off-hatch"><div class="off-label">OFF</div></div></section></div>'; return; }
            var any = false;
            rows.forEach(function (r, s) {
                if (!r.chip) return;
                any = true;
                var key = d.truck_id + "|" + ds + "|" + (s + 1), isLoad = !!S.loadKeys[key];   // typed cells: text only
                S.chipTitle[key] = String(r.chip || "").split("\n")[0];
                if (!isLoad) { h += '<div class="drv-card dvx-note-card">' + esc(r.chip) + "</div>"; return; }
                var fields = [["Rexius Order #", rexiusOrderNo(key)], ["PO / PU #", r.po_number],
                ["Delivery #", r.delivery_number], ["Load #", loadNo(key)]].filter(function (f) { return f[1]; });
                h += '<div class="drv-card"><div class="load-txt' + (r.color ? "" : " unfilled") + '" style="' + fillStyle(r.color) + '">' + storeMapBtn(key) + tabChipHtml(key, r) + "</div>" +
                    (r.notes ? '<div class="dvx-note dvx-note-card-line"><span class="dvx-note-tag">Note</span>' + esc(r.notes) + "</div>" : "") +
                    (fields.length ? "<dl>" + fields.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("") + "</dl>" : "") +
                    '<div class="links">' + scanBtn(key) + '<span class="sp"></span>' + noteBtn(key) + "</div>" +
                    '<div class="drv-card-notes">' + (filesHtml(key) ? '<div class="scan-row">' + filesHtml(key) + "</div>" : "") + notesHtml(key) + "</div></div>";
            });
            if (!any) h += '<div class="drv-empty">Nothing scheduled</div>';
            h += "</section></div>";
        });
        return h + "</div></div></div>";
    }

    /* ── Render ───────────────────────────────────────────────────────────── */
    var NARROW = window.matchMedia("(max-width: 900px)");
    function render() {
        try { renderInner(); } catch (e) { showFatal(e); if (window.console) console.error(e); }
    }
    function renderInner() {
        if (APP_MODE && !APP.session) {            // dead and empty until someone is signed in
            document.body.classList.add("drv-signed-out"); document.body.classList.toggle("drv-bagplant", BAG_PLANT);
            var tb = $("#tabs"); if (tb) { tb.hidden = true; tb.innerHTML = ""; }
            $("#hdr").innerHTML = ""; var w0 = $("#hdr-who"); if (w0) w0.innerHTML = "";
            if (!$("#login-email")) $("#main").innerHTML = vAppLogin(); else { var er = $("#login-err"); if (er) er.textContent = APP.err; }
            return;
        }
        document.body.classList.toggle("drv-signed-out", NAME_PICKER && (!S.who || !S.payload));
        document.body.classList.toggle("drv-bagplant", isBagPlant());
        renderHeader();
        renderTabs();
        // Until a published schedule is on screen, say why: loading, nothing published yet,
        // or a problem reaching it. (The bag plant page never shows the drivers' sign-in box.)
        if (!DEMO && !S.payload) {
            document.body.classList.remove("drv-signed-out");
            var msg = S.loading && !S.loadedAt ? "<b>Loading the schedule…</b>"
                : S.error ? "<b>Couldn't load the schedule.</b> " + esc(S.error) + (BAG_PLANT ? " Trying again automatically." : ' <button class="btn pri" id="refresh">Refresh</button>')
                    : '<b>Nothing has been published yet.</b> Check back once dispatch publishes the schedule.' + (BAG_PLANT ? "" : ' <button class="btn pri" id="refresh">Refresh</button>');
            $("#main").innerHTML = '<div class="drv-note">' + msg + "</div>";
            return;
        }
        if (BAG_PLANT && !S.payload) { $("#main").innerHTML = '<div class="drv-note"><b>Loading the schedule…</b></div>'; return; }
        if (NAME_PICKER && (!S.who || !S.payload)) {
            // Already on the sign-in screen: just refresh the name list, never
            // rebuild the box (that would kick out whoever is mid-typing).
            var box = $("#login-driver");
            if (box) {
                $("#login-names").innerHTML = fleet().map(function (d) { return '<option value="' + esc(d.driver) + '">'; }).join("");
                box.placeholder = S.payload ? "Your name" : "Loading drivers…";
                return;
            }
            $("#main").innerHTML = vLogin();
            return;
        }
        if (!allowedTab(S.tab)) S.tab = S.who && driverByTruck(S.who.truck) ? String(S.who.truck) : "cw";
        var d = S.tab === "cw" ? null : driverByTruck(S.tab);
        var prev = $("#main .grid-wrap, #main .drv-scroll"), top = prev ? prev.scrollTop : 0, left = prev ? prev.scrollLeft : 0;
        var title = d ? (dFirst(d.driver) || "Unassigned") + " · " + d.truck : "Current Week";
        $("#main").innerHTML = toolbarHtml(title) + noticeHtml() +
            (d ? (NARROW.matches ? vDriverCards(d) : vDriverGrid(d)) : vCurrentWeek());
        var pdz = $("#main .drv-pad"); if (pdz && !isBagPlant() && S.pz !== 1) pdz.style.zoom = S.pz;
        logView(d ? "own" : "cw");
        var sc = $("#main .grid-wrap, #main .drv-scroll");
        if (S.scrollTo) {
            var target = document.getElementById("d-" + S.scrollTo);
            if (target && sc) sc.scrollTop = Math.max(0, target.offsetTop - (NARROW.matches ? 0 : 40));
            S.scrollTo = null;
        } else if (sc && S.keepScroll) { sc.scrollTop = top; sc.scrollLeft = left; }
        S.keepScroll = false;
    }
    function renderBusy() {
        var b = $("#refresh");
        if (b) { b.disabled = true; b.innerHTML = SYNC_ICON + "Refreshing"; }
    }
    function openTab(tab, date) {
        if (!allowedTab(tab)) return;
        S.tab = tab; S.scrollTo = date || null; store("dept12DriverTab", tab); render();
    }

    /* ── Events ───────────────────────────────────────────────────────────── */
    document.addEventListener("click", function (e) {
        var t = e.target.closest("[data-tab]");
        if (t) { openTab(t.getAttribute("data-tab")); return; }
        var go = e.target.closest("[data-go]");
        if (go) { var g = go.getAttribute("data-go").split("|"); openTab(g[0], g[1]); return; }
        var nb = e.target.closest("[data-note]");
        if (nb) { S.noteKey = nb.getAttribute("data-note"); S.keepScroll = true; render(); var ta = $("#note-draft"); if (ta) ta.focus(); return; }
        if (e.target.closest("[data-note-cancel]")) { S.noteKey = null; S.keepScroll = true; render(); return; }
        var ns = e.target.closest("[data-note-save]");
        if (ns) {
            ns.disabled = true;
            saveNote(ns.getAttribute("data-note-save"), $("#note-draft").value).then(function (saved) {
                if (!saved) { ns.disabled = false; var d = $("#note-draft"); if (d) d.focus(); return; }
                S.noteKey = null; S.keepScroll = true; render();
                toast(OUTBOX.items.some(function (it) { return it.type === "note" && it.key === ns.getAttribute("data-note-save"); }) ? "Saved. It sends when you have signal." : "Note saved");
            }, function (err) { ns.disabled = false; toast("Couldn't save the note: " + err.message, true); });
            return;
        }
        var smb = e.target.closest("[data-smap]");
        if (smb) { openStoreMap(smb.getAttribute("data-smap")); return; }
        if (e.target.closest("[data-smap-close]")) { closeStoreMap(); return; }
        var pzb = e.target.closest("[data-pzoom]");
        if (pzb) {
            var pi = Math.max(0, Math.min(PZOOMS.length - 1, PZOOMS.indexOf(S.pz) + Number(pzb.getAttribute("data-pzoom"))));
            S.pz = PZOOMS[pi]; store("dept12-drv-zoom", String(S.pz)); S.keepScroll = true; render();
            return;
        }
        var zb = e.target.closest("[data-zoom]");
        if (zb) {
            var zi = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(S.zoom) + Number(zb.getAttribute("data-zoom"))));
            S.zoom = ZOOMS[zi < 0 ? 2 : zi]; store("dept12-bp-zoom2", String(S.zoom)); S.keepScroll = true; render();
            return;
        }
        var vb = e.target.closest("[data-scanview]");
        if (vb) {
            var vp = vb.getAttribute("data-scanview").split("|");
            openScan(vp.slice(0, -1).join("|"), Number(vp[vp.length - 1]));
            return;
        }
        var pb = e.target.closest("[data-paper]");
        if (pb) {
            var pp = pb.getAttribute("data-paper").split("|");
            openPaper(pp.slice(0, -1).join("|"), Number(pp[pp.length - 1]));
            return;
        }
        var sb = e.target.closest("[data-scan]");
        if (sb) {
            var skey = sb.getAttribute("data-scan");
            window.Dept12Scanner.open({
                title: S.chipTitle[skey] || "", onDone: function (blob, pages) {
                    sendScan(skey, blob, pages).then(function (state) {
                        loadScans(); loadActivity();
                        toast(state === "queued" ? "Saved on your phone. It sends when you have signal." : "POD / BOL sent · " + pages + " page" + (pages > 1 ? "s" : ""));
                    }, function (err) { toast("Couldn't send the scan: " + ((err && err.message) || "try again") + ".", true); });
                }
            });
            return;
        }
        var id = (e.target.closest("button") || {}).id;
        if (id === "refresh") {
            S.keepScroll = true; load();
            OUTBOX.items.forEach(function (it) { if (it.failed) { it.failed = false; it.tries = 0; Dept12Outbox.put(it); } });
            outboxFlush();
        }
        else if (id === "signout") signOut();
        else if (id === "login-go" && APP_MODE) appLogin();
        else if (id === "login-go") {
            var d = driverByName($("#login-driver").value);
            if (d) signInAs({ role: "driver", truck: String(d.truck), name: d.driver });
            else $("#login-err").textContent = "That name isn't on the schedule. Pick it from the list.";
        }
    });
    // A tablet keeps a page alive for days. If it opened before anything was published (or hit an error),
    // look again when the page is brought back, but never replace a schedule that is already showing.
    // It also refreshes itself every 45 minutes (skipped while a driver is typing a note).
    var REFRESH_MS = 45 * 60 * 1000;
    function retryIfEmpty() {
        if (DEMO || S.loading || S.noteKey) return;
        if (!S.payload || !S.refreshedAt || Date.now() - S.refreshedAt.getTime() >= REFRESH_MS) { S.keepScroll = true; load(); }
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) retryIfEmpty(); });
    window.addEventListener("pageshow", retryIfEmpty);
    window.addEventListener("online", function () { S.keepScroll = true; if (!DEMO && !S.loading && !S.noteKey) load(); outboxFlush(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) outboxFlush(); });
    outboxLoad().then(function () { if (S.who && S.payload && OUTBOX.items.length) { S.keepScroll = true; render(); } setTimeout(outboxFlush, 2500); });
    setInterval(retryIfEmpty, 60000);
    // Bag plant screen: no Refresh button. Every 2 minutes (and when the screen wakes) it asks when the schedule was last published
    // and loads it again only if that is newer than what is showing. The drivers' page does not do this: they press Refresh themselves.
    var CHECK_MS = 2 * 60 * 1000;
    function checkPublished() {
        if (!BAG_PLANT || DEMO || S.loading || S.noteKey || (APP_MODE && !APP.session)) return;
        tickerLoad();
        rpcPublicRead("public_published_at", {}).then(function (ts) {
            var t = ts ? Date.parse(ts) : 0;
            if (t && (!S.loadedAt || t > S.loadedAt.getTime()) && !S.loading && !S.noteKey) { S.keepScroll = true; load(); }
        }, function () { /* not set up yet, or offline: the 45-minute refresh still runs */ });
    }
    if (BAG_PLANT) {
        setInterval(checkPublished, CHECK_MS);
        document.addEventListener("visibilitychange", function () { if (!document.hidden) checkPublished(); });
        window.addEventListener("pageshow", checkPublished);
    }
    document.addEventListener("input", function (e) {
        if (e.target.id === "login-driver") { $("#login-go").disabled = !e.target.value.trim(); $("#login-err").textContent = ""; }
    });
    document.addEventListener("change", function (e) {
        if (e.target.id === "login-driver") { $("#login-go").disabled = !e.target.value.trim(); return; }

    });
    document.addEventListener("keydown", function (e) {
        if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".chip[data-go]")) { e.preventDefault(); e.target.click(); }
        if (e.key === "Enter" && e.target.id === "login-driver") { e.preventDefault(); $("#login-go").click(); }
        if (e.key === "Enter" && (e.target.id === "login-email" || e.target.id === "login-password")) { e.preventDefault(); appLogin(); }
    });
    NARROW.addEventListener("change", function () { S.keepScroll = true; render(); });
    var resizeT = null;
    window.addEventListener("resize", function () {
        if (!isBagPlant()) return;
        clearTimeout(resizeT); resizeT = setTimeout(function () { S.keepScroll = true; render(); }, 150);
    });
    /* ── Sample data (same shape as driver_week_data) ─────────────────────── */
    function sampleDates(start, count) {
        var out = [], d = start ? new Date(start + "T12:00:00") : new Date(); d.setHours(12, 0, 0, 0);
        while (out.length < count) {
            if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
            d.setDate(d.getDate() + 1);
        }
        return out;
    }
    var SAMPLE_DATES = [];
    function sampleRpc(fn, args) {
        if (fn === "driver_week_dates") { SAMPLE_DATES = sampleDates(args.p_start, args.p_count || 3); return Promise.resolve(SAMPLE_DATES); }
        return Promise.resolve(sampleData(SAMPLE_DATES));
    }
    function sampleData(dates) {
        var trucks = [
            { truck_id: "t1", number: "12-04", eq: "Flatbed", driver_name: "Marco V.", driver_color: "#2F6DB5" },
            { truck_id: "t2", number: "12-07", eq: "Step Deck", driver_name: "Jenna K.", driver_color: "#B5462F" },
            { truck_id: "t3", number: "12-09", eq: "Flatbed", driver_name: "Luis O.", driver_color: "#7A4FB0" },
            { truck_id: "t4", number: "12-11", eq: "Conestoga", driver_name: "Tom W.", driver_color: "#2E8C85" },
            { truck_id: "t5", number: "12-14", eq: "Flatbed", driver_name: "Dana R.", driver_color: "#9A6A15" }
        ];
        var plant3 = { name: "Rexius Plant 3", address: "88110 Territorial Hwy", city: "Eugene", state: "OR", phone: "" };
        function bag(id, cust, city, fork, timing, east, ord, pal, note) {
            return {
                id: id, kind: "internal", is_transfer: false, route_mode: "standard", rexius_order_no: ord, pallet_count: pal,
                customer_name: cust, cust_city: city, cust_state: "OR", cust_forklift: fork, cust_timing: timing, cust_umatilla: east,
                customer_map_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(cust + " " + city + " OR"),
                customer_notes: note || "", driver_note: ""
            };
        }
        function ext(id, broker, ord, load, drop, po, del, note) {
            return {
                id: id, kind: "external", is_transfer: false, route_mode: "standard", rexius_order_no: ord, broker_load_no: load,
                broker_name: broker, po_number: po, delivery_number: del, driver_note: note || "",
                pickup_name: plant3.name, pickup_address: plant3.address, pickup_city: plant3.city, pickup_state: plant3.state,
                delivery_name: drop[0], delivery_address: drop[1], delivery_city: drop[2], delivery_state: "OR", delivery_phone: drop[3] || ""
            };
        }
        function xfer(id, note, dept, color) {
            return { id: id, kind: "external", is_transfer: true, driver_note: note, transfer_department_name: dept, transfer_department_color: color };
        }
        var orders = [
            bag("o1", "Willow Creek Garden Center", "Salem", "Has forklift", "early", false, "07-2609-1142", 22, "Dock 2 in back. Ask for Renee."),
            bag("o2", "Cedar Hollow Nursery", "Albany", "NF", "anytime", false, "07-2609-1150", 14),
            ext("o3", "Northline Logistics", "12-0926-0041", "NL-448213", ["High Desert Builders Yard", "61230 S Hwy 97", "Bend", "541-555-0142"], "PU 55102", "D-88342", "Straps + 4 tarps. Appt 1:00 PM"),
            bag("o4", "Blue Heron Farm Supply", "Hermiston", "Has forklift", "early", true, "07-2609-1201", 26),
            bag("o5", "Three Rivers Feed & Seed", "Pendleton", "Has forklift", "anytime", true, "07-2609-1206", 18),
            xfer("o6", "Haul bark fines, 2 loads", "Dept 4 · Bark Plant", "#CFE2F3"),
            bag("o7", "Coast Range Landscape Supply", "Corvallis", "Has forklift", "early", false, "07-2609-1233", 24),
            ext("o8", "Summit Freight", "12-0926-0038", "SF-20931", ["Mountain View Rock Co", "2200 NE 4th St", "Redmond"], "PO 7719", "", "Call receiver 30 min out"),
            bag("o9", "Riverside Home & Garden", "Roseburg", "NF", "anytime", false, "07-2609-1171", 20),
            bag("o10", "Umpqua Valley Nursery", "Sutherlin", "Has forklift", "early", false, "07-2609-1175", 12),
            bag("o11", "Grants Pass Garden Depot", "Grants Pass", "Spyder", "early", false, "07-2609-1210", 24),
            ext("o12", "Northline Logistics", "12-0926-0047", "NL-448377", ["Klamath Supply Yard", "4100 Washburn Way", "Klamath Falls"], "PU 55240", "D-88501"),
            bag("o13", "Tualatin Valley Garden", "Hillsboro", "Has forklift", "early", false, "07-2609-1144", 26),
            bag("o14", "Forest Grove Feed", "Forest Grove", "Has forklift", "anytime", false, "07-2609-1148", 10),
            xfer("o15", "Chips to Dept 7 yard", "Dept 7 · Soils", "#EAD1DC"),
            bag("o16", "Clackamas Garden Supply", "Oregon City", "NF", "anytime", false, "07-2609-1215", 16),
            bag("o17", "Newberg Nursery & Stone", "Newberg", "Has forklift", "early", false, "07-2609-1222", 22),
            bag("o18", "Columbia Basin Garden", "The Dalles", "Has forklift", "early", true, "07-2609-1152", 24),
            bag("o19", "Blue Mountain Supply", "La Grande", "Has forklift", "anytime", true, "07-2609-1180", 26),
            ext("o20", "Summit Freight", "12-0926-0044", "SF-21044", ["Cascade Pavers Lot", "1800 SE 3rd St", "Bend"], "PO 7788", "D-6120"),
            bag("o21", "Baker City Home & Ranch", "Baker City", "NF", "early", true, "07-2609-1229", 18),
            bag("o22", "McKenzie River Garden", "Springfield", "Has forklift", "early", false, "07-2609-1236", 20),
            bag("o23", "Florence Coast Supply", "Florence", "Has forklift", "anytime", false, "07-2609-1238", 14)
        ];
        // [truck, dayIndex, slot, orderId]
        var plan = [
            ["t1", 0, 1, "o1"], ["t1", 0, 2, "o2"], ["t1", 1, 1, "o3"], ["t1", 2, 1, "o4"], ["t1", 2, 2, "o5"], ["t1", 3, 1, "o6"], ["t1", 4, 1, "o7"],
            ["t2", 0, 1, "o8"], ["t2", 1, 1, "o9"], ["t2", 1, 2, "o10"], ["t2", 2, 1, "o11"], ["t2", 4, 1, "o12"],
            ["t3", 0, 1, "o13"], ["t3", 0, 2, "o14"], ["t3", 1, 1, "o15"], ["t3", 2, 1, "o16"], ["t3", 3, 1, "o17"],
            ["t4", 0, 1, "o18"], ["t4", 1, 1, "o19"], ["t4", 2, 1, "o20"], ["t4", 3, 1, "o21"],
            ["t5", 0, 1, "o22"], ["t5", 1, 1, "o23"]
        ];
        // A couple of demo appointments so the tags and the APPT SET box can be seen.
        orders.forEach(function (o) {
            if (o.id === "o1") o.customer_map_url = "https://raw.githubusercontent.com/NateTooNice/storeimages/main/BM%20655.png";
            if (o.id === "o2") o.customer_map_url = "https://raw.githubusercontent.com/NateTooNice/storeimages/main/BM%20657.png";
        });
        orders.forEach(function (o) {
            if (o.id === "o3") { o.pick_appt_text = "Thu 10/8 between 7 and 9 AM"; o.drop_appt_text = "1:00 PM sharp"; }
            if (o.id === "o8") { o.drop_appt_text = "10:30-11:30 AM, call 30 min out"; }
            if (o.id === "o20") o.route_mode = "custom";
        });
        var loads = plan.filter(function (x) { return dates[x[1]]; }).map(function (x, i) {
            return { id: "l" + i, truck_id: x[0], scheduled_date: dates[x[1]], slot: x[2], order_ids: [x[3]] };
        });
        // Typed Scheduler cells (schedule_notes): [truck, dayIndex, slot, text, fill]
        var notes = [["t1", 0, 3, "Load here\nPlant 3 yard, 22 PAL mulch", null], ["t2", 0, 2, "Deadhead back to Plant 3", null],
        ["t3", 1, 2, "Load here", "#F4CCCC"], ["t4", 2, 2, "Pick up empty pallets at Hermiston", "#D9D2E9"],
        ["t5", 2, 1, "Training ride-along with Luis", null], ["t4", 4, 1, "Shop day: tires and DOT inspection", null], ["t1", 3, 2, "PM service at shop, 1:30", null]]
            .filter(function (x) { return dates[x[1]]; })
            .map(function (x) { return { truck_id: x[0], scheduled_date: dates[x[1]], slot: x[2], body: x[3], fmt: x[4] ? { fill: x[4] } : {}, cat_color: null }; });
        var off = [["t2", 3], ["t3", 4], ["t5", 3], ["t5", 4]].filter(function (x) { return dates[x[1]]; })
            .map(function (x) { return { truck_id: x[0], off_date: dates[x[1]] }; });
        // A multi-stop demo load (o20): one pick and two drops, each with typed appointment text.
        var l20 = loads.filter(function (l) { return l.order_ids[0] === "o20"; })[0], stops = [];
        if (l20) stops = [
            { load_id: l20.id, sequence: 1, stop_type: "pickup", name: plant3.name, address: plant3.address, city: plant3.city, state: plant3.state, notes: "Mon 6:30 AM" },
            { load_id: l20.id, sequence: 2, stop_type: "delivery", name: "Cascade Pavers Lot", address: "1800 SE 3rd St", city: "Bend", state: "OR", notes: "FCFS, ask for Dave" },
            { load_id: l20.id, sequence: 3, stop_type: "delivery", name: "Mountain View Rock Co", address: "2200 NE 4th St", city: "Redmond", state: "OR", notes: "After 1 PM" }];
        return { trucks: trucks, loads: loads, notes: notes, off_days: off, orders: orders, stops: stops };
    }

    if (APP_MODE) {
        var rexiusCode = "";
        try {
            var authUrl = new URL(location.href); rexiusCode = authUrl.searchParams.get("code") || "";
            if (rexiusCode) { authUrl.searchParams.delete("code"); history.replaceState(null, "", authUrl.pathname + authUrl.search + authUrl.hash); }
        } catch (e) { /* malformed URL */ }
        if (rexiusCode) {
            appClearSession(); appSetEmp(""); rexiusLogin(rexiusCode);
        } else {
            appReadLink();                                           // a session / employee number handed over in the link
            if (!APP.session) APP.session = storeJson(APP_SESSION_KEY);   // else the one kept from last time
            if (APP.session && APP.session.source === "rexius" && APP.session.emp) appSetEmp(APP.session.emp);
            if (APP.session && APP.session.source === "rexius" && APP.session.projectKey && APP.session.projectId) {
                try { appProject({ projectKey: APP.session.projectId, APIKey: APP.session.projectKey }); }
                catch (e) { appClearSession(); APP.err = e.message; }
            }
            if (APP.session) appStart(); else render();              // no session: the sign-in screen, nothing else
        }
    } else {
        render();
        load();
        loadScans();
    }
})();
