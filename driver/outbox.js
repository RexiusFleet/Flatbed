/* Flatbed Schedule — the outbox: things a driver sent that have not reached the office yet.
 *
 *   Dept12Outbox.add(item) -> Promise<id>      save one (a note, or a scan with its PDF) on this phone
 *   Dept12Outbox.all()     -> Promise<[item]>  everything waiting, oldest first
 *   Dept12Outbox.put(item) -> Promise          save changes to one (tries, last error)
 *   Dept12Outbox.remove(id)-> Promise          it went through (or was thrown away)
 *
 * It lives in the browser's own database (IndexedDB), so a scan survives the page being closed or the phone restarting while there is no signal.
 * Sending, retrying and the "waiting to send" notices are in driver.js; this file only keeps the items safe.
 */
(function () {
"use strict";

var DB = null;
function db() {
  if (DB) return DB;
  DB = new Promise(function (ok, fail) {
    if (!window.indexedDB) { fail(new Error("no storage")); return; }
    var rq = indexedDB.open("dept12-outbox", 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore("items", { keyPath: "id" }); };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { DB = null; fail(rq.error); };
  });
  return DB;
}
function run(mode, fn) {
  return db().then(function (d) {
    return new Promise(function (ok, fail) {
      var tx = d.transaction("items", mode), st = tx.objectStore("items"), out = fn(st);
      tx.oncomplete = function () { ok(out && out.result !== undefined ? out.result : undefined); };
      tx.onerror = tx.onabort = function () { fail(tx.error); };
    });
  });
}
function add(item) {
  item.id = item.id || String(Date.now()) + Math.random().toString(36).slice(2, 7);
  item.at = item.at || Date.now();
  return run("readwrite", function (st) { st.put(item); }).then(function () { return item.id; });
}
function put(item) { return run("readwrite", function (st) { st.put(item); }); }
function remove(id) { return run("readwrite", function (st) { st.delete(id); }); }
function all() {
  return run("readonly", function (st) { return st.getAll(); }).then(function (list) {
    return (list || []).sort(function (a, b) { return a.at - b.at; });
  });
}

window.Dept12Outbox = { add: add, put: put, remove: remove, all: all };
})();
