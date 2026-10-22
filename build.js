/* Builds app.js from the section files in src/js/ and sets the ?v= cache tags
   in the three pages (no dependencies, node only).
     node build.js           rebuild app.js, update the ?v= tags
     node build.js --check   change nothing; exit 1 if anything is out of date
   app.js is committed, because GitHub Pages serves the files as they are.
   Edit src/js/, never app.js, then run `node build.js` before committing. */
"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var ROOT = __dirname, check = process.argv.includes("--check");

// In order. head.js opens the one shared IIFE, tail.js closes it.
var JS_PARTS = ["head.js", "01-core.js", "02-chips-extract.js", "03-drawer-billing.js",
  "04-views.js", "05-settings-nav-search.js", "06-modals-grids.js", "07-events.js",
  "08-undo.js", "09-color.js", "10-select.js", "11-toolbar.js", "12-touch-boot.js",
  "13-history.js", "tail.js"];

function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

var built = JS_PARTS.map(function (f) { return read("src/js/" + f); }).join("");
var stale = [];
if (read("app.js") !== built) {
  stale.push("app.js");
  if (!check) fs.writeFileSync(path.join(ROOT, "app.js"), built);
}

// Every local <script src="…?v=…"> / <link href="…?v=…"> gets a tag made from
// the file's contents, so a browser fetches a file again exactly when it
// changed, and every page agrees on the same file's tag.
var PAGES = ["index.html", "driver/index.html", "bagplant/index.html"];
PAGES.forEach(function (page) {
  var html = read(page), dir = path.dirname(page);
  var out = html.replace(/((?:src|href)=")([^"?]+)\?v=[^"]*"/g, function (m, pre, url) {
    var file = path.join(dir, url);
    var bytes = check && file === "app.js" ? built : fs.readFileSync(path.join(ROOT, file));
    return pre + url + "?v=" + crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 8) + '"';
  });
  if (out !== html) {
    stale.push(page);
    if (!check) fs.writeFileSync(path.join(ROOT, page), out);
  }
});

if (check && stale.length) {
  console.error("Out of date: " + stale.join(", ") + ". Run: node build.js");
  process.exit(1);
}
console.log(stale.length ? "Rebuilt: " + stale.join(", ") : "Up to date.");
