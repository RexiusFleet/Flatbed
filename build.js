/* Builds app.js from the section files in src/js/ (no dependencies, node only).
     node build.js           rebuild app.js
     node build.js --check   change nothing; exit 1 if app.js is out of date
   app.js is committed, because GitHub Pages serves the files as they are.
   Edit src/js/, never app.js, then run `node build.js`. */
"use strict";
var fs = require("fs"), path = require("path");
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

if (check && stale.length) {
  console.error("Out of date: " + stale.join(", ") + ". Run: node build.js");
  process.exit(1);
}
console.log(stale.length ? "Rebuilt: " + stale.join(", ") : "Up to date.");
