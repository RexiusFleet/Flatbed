/* Dept 12 Dashboard — rate con reader.
 *
 * Dept12RateCon.parse(text, opts) reads the text of a rate confirmation (OCR of a scan, a PDF text
 * layer, or an email body someone pasted) and returns what the order needs:
 *
 *   { family, fields: { load_no, po, rate, broker, rexius_order_no },
 *     pickup / delivery: { name, address, city, state, zip, appt, ref },
 *     stops: [ ...every stop in order, each with type "pickup" | "delivery" ],
 *     conf:  { load_no: "ok" | "check", ... }  ← "ok" = read from a labeled spot and passed a sanity check,
 *                                                 "check" = a guess; the side window marks it so it gets a look.
 *     missing: [ field names nothing was found for ] }
 *
 * Each broker has its own layout. A family handler reads the layouts we have seen (tuned on 194 real
 * rate cons); anything else goes through the generic reader, which marks what it finds "check".
 *
 * opts: { filename, brokers: ["Name", ...], locations: [{ id, name, address, city, state }] }
 * Works in the browser (window.Dept12RateCon) and in node (module.exports) so it can be tested on its own.
 */
(function (root) {
"use strict";

var ST = "(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)";
var CSZ = new RegExp("([A-Za-z][A-Za-z.'\\- ]{1,28}?)\\s*,?\\s+(" + ST + ")\\b[\\s,.\\-]*(?:US(?:A)?\\b[\\s,]*)?(\\d{5})?(?:-\\d{4})?");
var REXIUS_ADDR = /bailey\s*hill|rexius|1275\s*bailey/i;

function clean(t) {
  return String(t || "")
    .replace(/\r/g, "")
    .replace(/[|¦]+/g, " ")
    .replace(/_{1,}/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}
function lines(t) { return t.split("\n").map(function (l) { return l.trim(); }); }
// the next n non-empty lines after index i
function nextLines(L, i, n) { var o = []; for (var k = i + 1; k < L.length && o.length < n; k++) if (L[k]) o.push(L[k]); return o; }
function money(s) {
  if (s == null) return null;
  var n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}
function title(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
// Cut a line at the first right-hand-column label ("Time:", "Quantity:", ...) so a two-column layout leaves only the left cell.
function leftCell(l, cuts) {
  var re = new RegExp("\\s+(?:" + cuts + ")(?![A-Za-z0-9]).*$", "i");
  return l.replace(re, "").trim();
}
var ZIP_OK = { OR: /^97/, WA: /^98|^99/, ID: /^83/, CA: /^9[0-6]/, NV: /^89/, MT: /^59/, UT: /^84/, AZ: /^85|^86/ };
function cityStateZip(line) {
  var m = CSZ.exec(line || "");
  if (!m) return null;
  var zip = m[3] || "";
  if (zip && ZIP_OK[m[2]] && !ZIP_OK[m[2]].test(zip)) zip = "";   // OCR misread: better blank than wrong
  return { city: title(m[1]).replace(/^[\d\s\-#.]+/, ""), state: m[2], zip: zip };
}
function looksLikeStreet(l) {
  return /^\d{1,6}[A-Za-z]?\s+\S/.test(l) || /^p\.?\s?o\.?\s*box\b/i.test(l) || /^\d{1,6}-\d{1,6}\s/.test(l);
}

/* ---------------------------------------------------------------- families */
function detectFamily(t, filename) {
  var u = t.toUpperCase(), f = String(filename || "").toLowerCase();
  if (/CARRIER CONFIRMATION/.test(u) && /FREIGHT BILL/.test(u)) return "tradewinds";
  if (/TRADEWINDS/.test(u) && /SHIPPER:/.test(u)) return "tradewinds";
  if (/NATIONWIDE TRANSPORT/.test(u) || /OUR BILLING/.test(u)) return "nationwide";
  if (/AARON WILSON/.test(u) && /RATE CONFIRMATION/.test(u)) return "aaronwilson";
  if (/SMOKEY MOUNTAIN/.test(u) || (/PLEASE REFER TO THIS # ON INVOICE/.test(u) && /PICK-UP/.test(u))) return "aaronwilson";
  if (/OPENROAD|OPEN ROAD/.test(u) && /CARRIER RATE CONFIRMATION/.test(u)) return "openroad";
  if (/IOSCO/.test(u) || /DISPATCH CONFIRMATION/.test(u)) return "iosco";
  if (/ITS DISPATCH/.test(u) || /RATE & LOAD CONFIRMATION/.test(u)) return "its";
  if (/OASIS FREIGHT/.test(u)) return "oasis";
  if (/VANPORT/.test(u)) return "vanport";
  if (/INLAND TRANSPORT/.test(u) || /BMCA/.test(u)) return "inland";
  if (/ALLTRAN/.test(u)) return "alltran";
  return "generic";
}

var FAMILY_BROKER = {
  tradewinds: "Tradewinds", nationwide: "Nationwide Transport Services", aaronwilson: "Aaron Wilson",
  openroad: "OpenRoad", iosco: "Iosco Transportation", its: "", oasis: "Oasis Freight Transport",
  vanport: "Vanport Transportation", inland: "Inland Transport", alltran: "AllTran Logistics"
};

/* ------------------------------------------------------------- labeled pulls */
var NUM = "(?=[A-Z0-9,\\-]*[0-9])([A-Z0-9][A-Z0-9,\\-]{2,})";
function pull(t, re, group) {
  var m = re.exec(t);
  return m ? (m[group || 1] || "").replace(/,/g, "").trim() : "";
}
function rateIn(t, pats) {
  for (var i = 0; i < pats.length; i++) {
    var m = pats[i].exec(t);
    if (m) { var v = money(m[1]); if (v && v >= 50 && v < 100000) return v; }
  }
  return null;
}
var MQ = "\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)";
var M = "\\$?" + MQ;
var GENERIC_RATE = [
  new RegExp("\\btotal\\s*pay\\b\\D{0,15}" + M, "i"),
  new RegExp("\\bnet\\s*pay\\b\\D{0,15}" + M, "i"),
  new RegExp("\\btotal\\s*agreed\\s*(?:to\\s*)?charges\\b\\D{0,15}" + M, "i"),
  new RegExp("\\bgrand\\s*total\\b\\D{0,15}" + M, "i"),
  new RegExp("\\bcarrier\\s*pay\\b[^\\n]{0,60}?\\btotal\\b\\D{0,15}" + M, "i"),
  new RegExp("\\btotal\\s*rate\\b\\D{0,15}" + M, "i"),
  new RegExp("\\bagreed\\s*(?:rate|amount)\\b[^\\n]{0,80}?\\$\\s*" + MQ, "i"),
  new RegExp("\\bsurcharges?\\s*\\$\\s*\\$?\\s*" + MQ, "i"),
  new RegExp("\\bline\\s*haul\\s*rate\\b\\D{0,15}" + M, "i"),
  new RegExp("\\bflat\\b\\D{0,6}\\$\\s*" + MQ, "i"),
  new RegExp("\\brate\\b[^\\n$]{0,20}\\$\\s*" + MQ, "i"),
  new RegExp("\\btotal\\b[^\\n$]{0,15}(?:\\$|USD)\\s*" + MQ, "i"),
  new RegExp("(?:\\$|USD)\\s*" + MQ + "\\s*(?:USD)?\\s*(?:total|flat|all.?in)", "i")
];

/* ------------------------------------------------------------ stop builders */
function stop(type, o) {
  o = o || {};
  return { type: type, name: title(o.name), address: title(String(o.address || "").replace(/^Address\s*[:;]?\s*/i, "")), city: title(o.city), state: o.state || "",
           zip: o.zip || "", appt: title(o.appt), ref: title(o.ref), phone: o.phone || "" };
}
function nameClean(s) {
  return title(String(s || "").replace(/^\s*(?:pick\s*-?up|pickup|delivery|deliver(?:y)? to|ship\s*(?:from|to)|shipper|consignee|origin|destination|drop(?:\s*off)?|PU|DEL)\s*[:\-]\s*/i, "").replace(/\s*\*\s*/g, " - ").replace(/\s+[-–—]\s*$/, "").replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, ""));
}

// Tradewinds: "SHIPPER: NAME*CITY Quantity: n" / address / "CITY, ST ZIP" with Appt Start/End on the right.
function stopsTradewinds(t) {
  var out = [], re = /(SHIPPER|CONSIGNEE):\s*([^\n]*)\n([^\n]*)\n([^\n]*)/gi, m;
  while ((m = re.exec(t))) {
    var type = /shipper/i.test(m[1]) ? "pickup" : "delivery";
    var name = leftCell(m[2], "Quantity:"), addr = leftCell(m[3], "Appointment:|Appt Start:|Appt End:"), cl = leftCell(m[4], "Appt Start:|Appt End:|Appointment:");
    var csz = cityStateZip(cl) || {};
    var tail = t.slice(m.index, m.index + 420);
    var a1 = /Appt Start:\s*([0-9\/]+)\s*([0-9:]+\s*[AP]M)/i.exec(tail), a2 = /Appt End:\s*([0-9\/]+)\s*([0-9:]+\s*[AP]M)/i.exec(tail);
    var appt = a1 ? a1[1].replace(/\/\d{4}$/, "") + " " + a1[2] + (a2 ? (a2[1] === a1[1] ? "-" + a2[2] : " to " + a2[1].replace(/\/\d{4}$/, "") + " " + a2[2]) : "") : "";
    out.push(stop(type, { name: nameClean(name), address: addr, city: csz.city, state: csz.state, zip: csz.zip, appt: appt }));
  }
  return out;
}

// "1 Pick-up / 2 Stop-off" tables (Aaron Wilson, Smokey Mountain).
function stopsAaron(t) {
  var L = lines(t), out = [];
  for (var i = 0; i < L.length; i++) {
    var m = /^\d+\s+(Pick-?up|Stop-?off|Drop|Delivery)\b/i.exec(L[i]);
    if (!m) continue;
    var type = /pick/i.test(m[1]) ? "pickup" : "delivery";
    var j = i + 1; if (/^Facility\b/i.test(L[j] || "")) j++;
    var first = L[j] || "", rest = [];
    for (var k = j + 1; k < Math.min(j + 6, L.length) && !/^\d+\s+(Pick-?up|Stop-?off)/i.test(L[k]); k++) {
      if (!L[k]) continue; rest.push(L[k]); if (cityStateZip(L[k]) && /\d{5}/.test(L[k])) break;
    }
    var pm = /^(.*?)\s*\(\d{3}\)\s*-?\s*\d{3}-?\d{4}\s*(\S+)?/.exec(first) || /^(.*?)\s+\(?\d{3}\)?[- ]?\d{3}-?\d{4}/.exec(first);
    var name = (pm ? pm[1] : first).replace(/\s+(?:PO\b|P\.O\b|\d{5,}).*$/i, "");
    var date = (/(\d{2}\/\d{2}\/\d{4})\s*(\d{1,2}:\d{2})?\s*$/.exec(first) || [])[1] || "";
    var ref = pm && pm[2] && /\d/.test(pm[2]) ? pm[2] : "";
    var cityLine = rest.filter(function (l) { return cityStateZip(l) && /\d{5}/.test(l); })[0] || rest[rest.length - 1] || "";
    var addr = rest.filter(looksLikeStreet)[0] || "";
    var csz = cityStateZip(cityLine) || {};
    var extra = rest.filter(function (l) { return l !== cityLine && l !== addr && !/^\d+\s+(Pick|Stop)/i.test(l); })[0] || "";
    out.push(stop(type, { name: nameClean(name), address: addr, city: csz.city, state: csz.state, zip: csz.zip,
      appt: date.replace(/\/\d{4}$/, ""), ref: ref }));
    if (extra && /^[A-Za-z .&'-]{3,30}$/.test(extra) && out.length) out[out.length - 1].note = extra;
  }
  return out;
}

// OpenRoad: "Shipper Pickup (Stop 1)" ... name / street / "City, ST US ZIP", "Consignee Delivery (Stop 2)".
function stopsOpenRoad(t) {
  var L = lines(t), out = [];
  for (var i = 0; i < L.length; i++) {
    var m = /(Shipper|Consignee)\s*(?:\S+\s*)?(Pickup|Delivery)?\s*\(Stop\.?\s*(\d+)\)/i.exec(L[i]);
    if (!m) continue;
    var type = /shipper|pickup/i.test(m[1] + " " + (m[2] || "")) ? "pickup" : "delivery";
    if (/consignee/i.test(m[1])) type = "delivery";
    var name = "", addr = "", csz = null, ref = "", appt = "";
    for (var k = i; k < Math.min(i + 12, L.length); k++) {
      var l = L[k];
      if (k > i && /\(Stop\.?\s*\d+\)/i.test(l)) break;
      if (!csz && cityStateZip(l) && /\d{5}/.test(l) && !/appoint|date/i.test(l)) { csz = cityStateZip(l); continue; }
      var rf = /Pickup\/Delivery Number:\s*(.+)$/i.exec(l); if (rf) ref = rf[1];
      var ap = /Appointment Time:\s*(\S+)/i.exec(l); if (ap) appt = ap[1];
      var ed = /(?:Expected|Pick Up|Delivery) Date:\s*([0-9\/]+)/i.exec(l); if (ed && !appt) appt = ed[1].replace(/\/\d{4}$/, "");
    }
    // name = the first non-label line after the header (or on the header line, before "Pick Up Date")
    var head = leftCell(L[i].replace(m[0], ""), "Pick Up Date|Delivery Date|Expected|Delivery Instructions");
    var cand = [];
    for (var q = i + 1; q < Math.min(i + 6, L.length); q++) { if (L[q] && !/Pickup\/Delivery Number|Expected Date|Appointment|Contact|Shipping/i.test(L[q].split(" ")[0] + " " + L[q])) cand.push(leftCell(L[q], "Delivery Instructions|Pickup/Delivery Number")); }
    var pool = [head].concat(cand).filter(Boolean);
    name = pool.filter(function (l) { return !looksLikeStreet(l) && !cityStateZip(l); })[0] || "";
    addr = pool.filter(looksLikeStreet)[0] || "";
    out.push(stop(type, { name: nameClean(name.replace(/^[^A-Za-z0-9]+/, "")), address: addr, city: csz && csz.city, state: csz && csz.state, zip: csz && csz.zip, ref: ref, appt: appt }));
  }
  return out;
}

// Iosco: "1 PU 8/11 8/11 NAME (CIT CITY ST ref No" then "07:00 15:30 ADDRESS phone [zip] contact". The numbering and
// PU/Del markers get lost in some scans, so a stop line is anything ending "... CITY ST [ref] Yes|No".
function stopsIosco(t) {
  var L = lines(t), out = [];
  var re = new RegExp("^(?:[\\d.]*\\s*(PU|Del)\\s+([0-9\\/]+)\\s+([0-9\\/]+)\\s+)?(.+?)(?:\\s+|\\()([A-Z][A-Za-z.]+)\\s+(" + ST + ")\\b\\s*[^\\n]*?\\b(?:Yes|No)\\s*$");
  for (var i = 0; i < L.length; i++) {
    var m = re.exec(L[i]);
    if (!m || /^(carrier|driver|ship|pay|notes)\b/i.test(m[4]) || /transportation|invoice|signature/i.test(L[i])) continue;
    var nx = nextLines(L, i, 1)[0] || "";
    var am = /^(?:(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+)?(\d+.*?)(?:\s+\d{3}-\d{3}-\d{4}.*?)?(?:\s+(\d{5}))?(?:\s+[A-Z][A-Za-z\/ ]*)?$/.exec(nx) || [];
    var addr = (am[3] || "").replace(/^(\d+)([A-Za-z])/, "$1 $2").replace(/([a-z])([A-Z])/g, "$1 $2");
    var name = m[4].replace(/\(\w*$/, "").replace(/^[\d.]+\s*/, "").trim();
    var type = m[1] ? (/pu/i.test(m[1]) ? "pickup" : "delivery") : (out.length ? "delivery" : "pickup");
    var win = m[2] ? (am[1] ? m[2] + " " + am[1] + "-" + am[2] : m[2]) : "";
    out.push(stop(type, { name: nameClean(name), address: addr, city: m[5], state: m[6], zip: am[4] || "", appt: win }));
  }
  return out;
}

// ITS Dispatch family (Jenks, Witham, Bob Murray): "Shipper 1 ... Consignee 1" blocks in two columns.
function stopsITS(t) {
  var L = lines(t), out = [], RC = "Time:|Type:|Quantity:|Weight:|Purchase Order|Major Intersection|Shipping Hours|Receiving Hours|Appointment:|Description:|Notes:|Phone:|Date:";
  function cell(l) { return leftCell(l.replace(/^Date:\s*[\d\/\-]+\s*/i, ""), RC); }
  for (var i = 0; i < L.length; i++) {
    var m = /^(Shipper|Consignee)\s+(\d+)\b(.*)$/i.exec(L[i]);
    if (!m) continue;
    var type = /shipper/i.test(m[1]) ? "pickup" : "delivery";
    var dm = /Date:\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/.exec(m[3] || "") || (function () { for (var d = i + 1; d < Math.min(i + 7, L.length); d++) { var x = /^Date:\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/.exec(L[d]); if (x) return x; } return null; })();
    var blk = L.slice(i + 1, i + 9).map(cell).filter(function (l) { return l && !/^(Shipper|Consignee)\b/i.test(l) && !/^(Notes?|Shipper Notes|Consignee Notes)\b/i.test(l); });
    var ci = -1; for (var k = 0; k < blk.length; k++) if (cityStateZip(blk[k]) && /,|\d{5}/.test(blk[k]) && !looksLikeStreet(blk[k])) { ci = k; break; }
    var csz = ci >= 0 ? cityStateZip(blk[ci]) : null;
    var pre = ci >= 0 ? blk.slice(0, ci) : blk.slice(0, 2);
    var addr = pre.filter(looksLikeStreet).pop() || "";
    var name = pre.filter(function (l) { return !looksLikeStreet(l); }).join(" ");
    var date = dm ? (dm[1].indexOf("-") === 4 ? dm[1].slice(5).replace("-", "/") : dm[1].replace(/\/\d{4}$/, "")) : "";
    out.push(stop(type, { name: nameClean(name), address: addr, city: csz && csz.city, state: csz && csz.state, zip: csz && csz.zip, appt: date }));
  }
  return out;
}

// "Name: / Address: / CITY, ST ZIP" blocks (Oasis, CTE, Ryan, Destination, Fairchild and other brokers that use the same form),
// with PU1 / SO2 markers or "Shipper / Consignee Information" headings.
function stopsLabeled(t) {
  var L = lines(t), out = [];
  for (var i = 0; i < L.length; i++) {
    var m = /^(?:(PU|S[O0P]|DEL|DR)\s*\d*\s+)?Name:\s*(.+?)(?:\s+(?:Date|Contact|Phone):.*)?$/i.exec(L[i]);
    if (!m) continue;
    var nx = nextLines(L, i, 4), addr = "", csz = null, dt = "";
    for (var k = 0; k < nx.length; k++) {
      var am = /^Address\s*[:;]\s*(.+?)(?:\s+(?:Phone|Contact):.*)?$/i.exec(nx[k]);
      if (am && !addr) { addr = am[1]; var dm = /(\d{2}\/\d{2})\/\d{4}\s+(\d{4})/.exec(addr); if (dm) { dt = dm[1] + " " + dm[2].replace(/^(\d\d)(\d\d)$/, "$1:$2"); addr = addr.replace(/\s*\d{2}\/\s?\d{1,2}\/\d{4}.*$/, ""); } continue; }
      if (!csz && !/^Address/i.test(nx[k])) { var c = cityStateZip(leftCell(nx[k], "Close|Contact|Time:|Ready|Phone|Driver")); if (c && (c.zip || /,/.test(nx[k]))) csz = c; }
    }
    var dtm = /Date:\s*(\d{2}\/\d{2})\/\d{4}\s*(\d{4})?/.exec(L[i]);
    if (dtm) dt = dtm[1] + (dtm[2] ? " " + dtm[2].replace(/^(\d\d)(\d\d)$/, "$1:$2") : "");
    var isCons = !!(m[1] && !/^pu$/i.test(m[1]));
    for (var b = i - 1; b >= Math.max(0, i - 4); b--) { if (/consignee/i.test(L[b])) isCons = true; if (/shipper|pick/i.test(L[b])) isCons = false; }
    if (!m[1] && !isCons && out.length) isCons = true;
    out.push(stop(isCons ? "delivery" : "pickup", { name: nameClean(m[2]), address: addr, city: csz && csz.city, state: csz && csz.state, zip: csz && csz.zip, appt: dt }));
  }
  return out;
}

function stopsVanport(t) {
  var L = lines(t), out = [];
  for (var i = 0; i < L.length; i++) {
    var m = /^(?:Pickup|Drop)?\s*\W*\s*Company\s+(.+?)\s+Sched Arrival\s*(\S+)?/i.exec(L[i]);
    if (!m) continue;
    var isDrop = /\bdrop\b/i.test(L[i]) || /\bdrop\b/i.test(L[i + 1] || "") || out.length > 0;
    var nv = nextLines(L, i, 3);
    var am = /Address\s+(.+)$/i.exec(nv[0] || "") || /Address\s+(.+)$/i.exec(nv[1] || "") || [];
    var full = am[1] || "", parts = full.split(/,\s*/);
    var csz = cityStateZip(full.replace(/^[^,]*,\s*/, "")) || cityStateZip(full) || {};
    out.push(stop(isDrop ? "delivery" : "pickup", { name: nameClean(m[1]), address: parts[0] || "", city: csz.city, state: csz.state, zip: csz.zip, appt: (m[2] || "").replace(/\/\d{2}$/, "") }));
  }
  return out;
}

function stopsInland(t) {
  var L = lines(t), out = [];
  for (var i = 0; i < L.length; i++) {
    var m = /^(PICK|STOP)\s*\d+\b/i.exec(L[i]);
    if (!m) continue;
    var n = nextLines(L, i, 4), name = n[0] || "", ad = n[1] || "", cl = n[2] || "";
    var ap = /Appointment\s+(\S+)/i.exec(ad) || [];
    var csz = cityStateZip(cl) || {};
    out.push(stop(/pick/i.test(m[1]) ? "pickup" : "delivery", { name: nameClean(leftCell(name, "Appointment")), address: leftCell(ad, "Appointment"), city: csz.city, state: csz.state, zip: csz.zip, appt: (ap[1] || "").replace(/\/\d{2}$/, "") }));
  }
  return out;
}

// Nationwide: the page is a two-column table (pickup on the left, delivery on the right). Street numbers and ZIPs split
// it reliably; the names are split by length. The dashboard matches the addresses to the Pick/Drop List, so a repeat
// location comes back with its proper name.
function stopsNationwide(t) {
  var L = lines(t), start = -1;
  for (var i = 0; i < L.length; i++) if (/Pick Up:/i.test(L[i])) { start = i; break; }
  if (start < 0) return [];
  var blk = L.slice(start + 1, start + 9).map(function (l) {
    return l.replace(/[‘’`"\[\](){}~]/g, " ").replace(/\S*ationwide\S*\.?com\S*/ig, " ").replace(/\s+/g, " ").trim();
  }).filter(Boolean);
  var ai = -1; for (var k = 0; k < blk.length; k++) if (looksLikeStreet(blk[k]) || /\s\d{1,6}\s+[A-Z]/.test(blk[k])) { ai = k; break; }
  if (ai < 0) return [];
  var nameLine = ai > 0 ? blk[ai - 1] : "", addrLine = blk[ai], cityLine = blk.slice(ai + 1, ai + 3).join(" ");
  nameLine = nameLine.split(/\s+/).filter(function (w) { return !/^[a-z]{1,2}$/.test(w) && !/^[^A-Za-z0-9]+$/.test(w); }).join(" ");
  var addrs = addrLine.split(/\s+(?=\d{1,6}(?:-\d+)?\s+[A-Za-z])/).filter(Boolean);
  var cities = [], cre = new RegExp("([A-Za-z][A-Za-z.'\\- ]{1,24}?)\\s+(" + ST + ")\\s*(\\d{5})?", "g"), cm;
  while ((cm = cre.exec(cityLine))) cities.push({ city: title(cm[1]), state: cm[2], zip: cm[3] || "" });
  var names = [nameLine];
  if (addrs.length >= 2) {
    var words = nameLine.split(/\s+/), lw = addrs[0].length, rw = addrs[1].length, kk = Math.max(1, Math.round(words.length * lw / (lw + rw)));
    for (var w = 1; w < words.length; w++) if (/^(INC|LLC|CO|COMPANY|CORP|LUMBER|SUPPLY|JOB|YARD|DEPOT|LINNTON)\.?$/i.test(words[w - 1]) && Math.abs(w - kk) <= 2) { kk = w; break; }
    names = [words.slice(0, kk).join(" "), words.slice(kk).join(" ")];
  }
  var d1 = /Pick Up:\s*(\d{1,2}\/\d{1,2})/i.exec(L[start]) || [], d2 = /Last Drop:\s*(\d{1,2}\/\d{1,2})/i.exec(L[start]) || [];
  var out = [], n = Math.min(2, Math.max(addrs.length, cities.length));
  for (var s2 = 0; s2 < n; s2++) {
    out.push(stop(s2 === 0 ? "pickup" : "delivery", { name: nameClean(names[s2] || ""), address: addrs[s2] || "", city: cities[s2] && cities[s2].city, state: cities[s2] && cities[s2].state, zip: cities[s2] && cities[s2].zip, appt: s2 === 0 ? d1[1] : d2[1] }));
  }
  var la = /Load At>>\s*(.+?)(?:\s+\d{1,2}:\d{2}.*)?$/im.exec(t);
  if (la && out[0]) out[0].name = nameClean(la[1]);
  return out;
}

// Emails and typed notes: "Pickup: Name, 123 Street, City, ST 97000 ... Delivery: ..." on one line or several.
function stopsInline(t) {
  var lab = /\b(pick\s*-?up|pu|origin|ship\s*from|shipper|deliver(?:y|ed)?(?:\s*to)?|del|drop(?:\s*off)?|destination|ship\s*to|consignee)\b(?:\s*(?:date|appt\.?|address|location))?(?:\s+\d{1,2}\/\d{1,2})?\s*[:\-]/gi;
  var hits = [], m;
  while ((m = lab.exec(t))) hits.push({ i: m.index, end: m.index + m[0].length, label: m[1] });
  var out = [];
  hits.forEach(function (h, k) {
    var seg = t.slice(h.end, k + 1 < hits.length ? hits[k + 1].i : h.end + 400);
    var toks = seg.split(/[,\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    var ci = -1, csz = null;
    for (var j = 0; j < toks.length; j++) {
      var joined = toks[j] + (toks[j + 1] ? ", " + toks[j + 1] : "");
      var c = cityStateZip(toks[j]);
      if (c && c.zip) { ci = j; csz = c; break; }
      var c2 = /\d/.test(toks[j]) ? null : cityStateZip(joined);
      if (c2 && c2.zip && j + 1 < toks.length) { ci = j; csz = c2; break; }
    }
    var pre = ci >= 0 ? toks.slice(0, ci) : toks.slice(0, 2);
    var addr = pre.filter(looksLikeStreet)[0] || "";
    var name = pre.filter(function (x) { return !looksLikeStreet(x) && !/^\d{1,2}\/\d{1,2}/.test(x) && /[A-Za-z]{3}/.test(x); })[0] || "";
    var tail = seg.slice(0, 260), dm = /(\d{1,2}\/\d{1,2})(?:\s*(?:at|@|,)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?))?/i.exec(tail);
    var type = /^(pick|pu|origin|ship\s*from|shipper)/i.test(h.label) ? "pickup" : "delivery";
    if (!csz && !addr && !name) return;
    out.push(stop(type, { name: nameClean(name), address: addr, city: csz && csz.city, state: csz && csz.state, zip: csz && csz.zip, appt: dm ? (dm[1] + (dm[2] ? " " + dm[2].trim() : "")) : "" }));
  });
  return out;
}

/* Fallback: every "City, ST ZIP" that is not Rexius or the broker's own letterhead, with the two lines above it as name and street. */
function stopsGeneric(t) {
  var L = lines(t), out = [], seen = {};
  var firstDeliveryWord = -1;
  for (var i = 0; i < L.length; i++) {
    var csz = cityStateZip(L[i]);
    if (!csz || !csz.zip) continue;
    if (REXIUS_ADDR.test(L[i]) || REXIUS_ADDR.test(L[i - 1] || "") || /p\.?\s?o\.?\s*box/i.test(L[i] + " " + (L[i - 1] || ""))) continue;
    var ctx = L.slice(Math.max(0, i - 3), i + 1).join(" ");
    var addr = "", name = "";
    for (var b = i - 1; b >= Math.max(0, i - 3); b--) {
      if (!addr && looksLikeStreet(L[b])) { addr = L[b]; continue; }
      if (!name && L[b] && !looksLikeStreet(L[b]) && !/^(phone|tel|fax|contact|notes?|date|time)\b/i.test(L[b]) && /[A-Za-z]{3}/.test(L[b])) name = L[b];
    }
    var label = /consignee|deliver|receiver|drop|destination|stop-?off|ship\s*to/i.test(ctx) ? "delivery" : /shipper|pick|origin|ship\s*from|load at/i.test(ctx) ? "pickup" : "";
    var key = (addr || name) + "|" + csz.city;
    if (seen[key]) continue; seen[key] = 1;
    out.push(stop(label, { name: nameClean(leftCell(name, "Phone|Tel|Contact")), address: addr, city: csz.city, state: csz.state, zip: csz.zip }));
  }
  // the first address on a rate con is nearly always the broker's own letterhead: drop it when it has no pickup/delivery label
  if (out.length > 2 && !out[0].type) out.shift();
  out.forEach(function (s, i) { if (!s.type) s.type = i === 0 ? "pickup" : "delivery"; });
  if (out.length >= 2) out[out.length - 1].type = "delivery";
  return out;
}

// Letterhead, footer and table-header text that the readers sometimes mistake for a stop.
function isJunk(s) {
  var x = (s.name + " " + s.address).toLowerCase();
  return /signature|invoice|unprocessed|conditions|carrier|facility phone|pallets|rexius|transportation,? llc|po box 426|\bmc\s*#|us mail|bill to|load number|^phone\b/.test(x) ||
    (/^p\.?o\.? box/i.test(s.address) && !s.name);
}

/* ---------------------------------------------------------- field readers */
function loadAndPo(fam, t) {
  var r = { load_no: "", po: "", ok: true };
  switch (fam) {
    case "tradewinds":
      r.load_no = pull(t, new RegExp("freight\\s*bill\\s*#?\\s*:?\\s*" + NUM, "i"));
      r.po = pull(t, new RegExp("\\bPO\\s*#\\s*:?\\s*" + NUM, "i")) || pull(t, new RegExp("Billing\\s*Reference\\s*#\\s*[:;]?\\s*" + NUM, "i"));
      break;
    case "nationwide":
      r.load_no = pull(t, /our\s*billing\s*#?\s*[:=]?\s*(?:company\s*:?\s*)?([0-9]{4,9})/i) ||
        pull(t, /our\s*bi\w*[^0-9\n]{0,14}([0-9]{6})\b/i) || pull(t.slice(0, 700), /\b(1[0-9]{5})\b/);
      r.po = pull(t, new RegExp("\\bPO#\\s*:?\\s*(?!NATIONWIDE)" + NUM, "i")) || pull(t, new RegExp("Drop\\s*PO#\\s*:?\\s*" + NUM, "i"));
      break;
    case "aaronwilson":
      r.load_no = pull(t, /refer\s*to\s*this\s*#\s*on\s*invoice\s*:?\s*([0-9]{4,9})/i) || pull(t, /\bpro\s*#\s*:?\s*([0-9]{4,9})/i);
      r.po = "";
      break;
    case "openroad":
      r.load_no = pull(t, /load\s*number\s*:?\s*([A-Z]{0,3}[0-9]{4,10})/i);
      r.po = pull(t, /PO\s*Number\s*:?\s*([0-9][0-9 \-]{3,20})/i).replace(/\s+/g, "-");
      break;
    case "iosco":
      r.load_no = pull(t, /LOAD\s*NUMBER\s*\n?\s*([0-9]{4,8})/i);
      r.po = pull(t, /\bORDER\s*#\s*:?\s*([A-Z0-9\-]{4,})/i) || pull(t, /\bDROP\s*#\s*:?\s*([A-Z0-9\-]{4,})/i);
      break;
    case "its":
      r.load_no = pull(t, /LOAD\s*#\s*:?\s*([0-9]{3,8})/i);
      var tag = {}, tre = /\b(PU|PO|DEL)\s*#\s*:?\s*(?=[A-Z0-9\-]*[0-9])([A-Z0-9][A-Z0-9\-]{2,})/gi, tm;
      while ((tm = tre.exec(t))) { var tk = tm[1].toUpperCase(); if (!tag[tk]) tag[tk] = tm[2]; }
      r.po = tag.PO || tag.DEL || tag.PU || pull(t, /Purchase\s*Order\s*#?\s*:\s*(?=[A-Z0-9\-]*[0-9])([A-Z0-9][A-Z0-9\-]{2,})/i);
      break;
    case "oasis":
      r.load_no = pull(t, /\bLoad\s*#\s*:?\s*([0-9]{5,12})/i);
      r.po = pull(t, /Customer\s*PO\s*Number\s*:?\s*([A-Z0-9\-]{3,})/i);
      break;
    case "vanport":
      r.load_no = pull(t, /\bOrder\s*#\s*:?\s*([0-9]{4,8})/i);
      break;
    case "inland":
      r.load_no = pull(t, /\bPRO\s*#\s*:?\s*([0-9]{4,9})/i);
      r.po = pull(t, /\bRef\s*#\s*:?\s*([A-Z0-9\-]{4,})/i);
      break;
    case "alltran":
      r.load_no = pull(t, /Load\s*Number\s*:?\s*([0-9]{4,8})/i);
      r.po = pull(t, /PO\s*Number\s*:?\s*([A-Z0-9\-]{3,})/i);
      break;
  }
  return r;
}
var GENERIC_LOAD = [
  new RegExp("freight\\s*bill\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUM, "i"),
  new RegExp("load\\s*(?:confirmation\\s*)?(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUM, "i"),
  new RegExp("load\\s*confirmation\\s+" + NUM, "i"),
  new RegExp("(?:trip|order|pro|dispatch|shipment|confirmation|booking|tender)\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUM, "i"),
  new RegExp("\\bpro\\s*:\\s*" + NUM, "i"),
  new RegExp("ref(?:erence)?\\s*(?:#|num(?:ber)?|no\\.?)\\s*:?\\s*" + NUM, "i")
];
var GENERIC_PO = /\b(?:PO|P\.O\.|Purchase\s*Order)(?![A-Za-z])\s*(?:#|number|no\.?)?\s*[:\-]?\s*(?!BOX\b)(?=[A-Z0-9\-]*[0-9])([A-Z0-9\-]{3,})/i;

function familyRate(fam, t) {
  switch (fam) {
    case "tradewinds": return rateIn(t, [new RegExp("total\\s*pay\\s*:?\\s*" + M, "i")]);
    case "nationwide": return rateIn(t, [new RegExp("surcharges?\\s*\\$\\s*\\$?\\s*" + MQ, "i"), new RegExp("surcharges?[^\\n]*\\$\\s*" + MQ, "i")]);
    case "aaronwilson": return rateIn(t, [new RegExp("net\\s*pay\\s*:?\\s*" + M, "i"), new RegExp("flat\\s*:?\\s*" + M, "i")]);
    case "openroad": return rateIn(t, [new RegExp("(?:total|rate|flat)[^\\n]{0,30}\\$\\s*" + MQ, "i")]);
    case "iosco": return rateIn(t, [new RegExp("\\bTotal\\s+" + M, "i"), new RegExp("\\bFlat\\s+" + M, "i")]);
    case "its": return rateIn(t, [new RegExp("TOTAL\\s*:\\s*" + M, "i"), new RegExp("Agreed\\s*Amount[\\s\\S]{0,120}?\\$\\s*" + MQ, "i")]);
    case "oasis": return rateIn(t, [new RegExp("TOTAL\\s*:\\s*(?:USD)?\\s*\\$?\\s*" + MQ, "i")]);
    case "vanport": return rateIn(t, [new RegExp("Total\\s*Agreed\\s*to\\s*Charges\\s*:?\\s*" + M, "i")]);
    case "inland": return rateIn(t, [new RegExp("TOTAL\\s*RATE\\s*" + M, "i")]);
  }
  return null;
}

/* OCR drops or swaps digits ("704510" read as "70451" in the header, correctly in the body), and the same load
   number is printed in several places. Tally every label-plus-number in the text; a value that shows up twice
   wins, and a value that is one digit longer than the one we read (same start) is the likelier real one. */
function loadConsensus(chosen, t) {
  var re = /\b(?:pro|load|order|billing|invoice|trip|confirmation|dispatch|freight\s*bill|ref(?:erence)?)\s*(?:#|no\.?|number)?\s*[:=#]?\s*(?=[A-Z0-9\-]*\d)([A-Z]{0,3}\d[A-Z0-9\-]{3,11})\b/gi, m, tally = {};
  while ((m = re.exec(t))) { var v = m[1].toUpperCase().replace(/,/g, ""); tally[v] = (tally[v] || 0) + 1; }
  var c = chosen ? chosen.toUpperCase() : "", best = "", bestN = 0;
  Object.keys(tally).forEach(function (k) { if (tally[k] > bestN || (tally[k] === bestN && k.length > best.length)) { best = k; bestN = tally[k]; } });
  if (c && tally[c] >= 2) return { value: chosen, conf: "ok" };
  if (bestN >= 2 && best !== c && (!c || best.indexOf(c) === 0 || c.indexOf(best) === 0 || Math.abs(best.length - c.length) <= 1)) return { value: best, conf: "ok" };
  if (c) {
    var longer = Object.keys(tally).filter(function (k) { return k !== c && k.length > c.length && k.length <= c.length + 4 && (k.indexOf(c) === 0 || k.slice(-c.length) === c); })[0];
    if (longer) return { value: longer, conf: "check" };
  }
  return null;
}

/* -------------------------------------------------------------- the parser */
function parse(text, opts) {
  opts = opts || {};
  var raw = String(text || ""), t = clean(raw);
  var fam = detectFamily(t, opts.filename);
  var fields = {}, conf = {}, missing = [];
  function set(k, v, c) { if (v !== "" && v != null) { fields[k] = v; conf[k] = c; } else missing.push(k); }

  // load number
  var lp = loadAndPo(fam, t), load = lp.load_no, loadC = load ? "ok" : "check", po = lp.po, poC = po ? "ok" : "check";
  if (!load) {
    for (var i = 0; i < GENERIC_LOAD.length; i++) { var m = GENERIC_LOAD[i].exec(t); if (m) { load = m[1].replace(/,/g, ""); loadC = "check"; break; } }
  }
  if (!po) { var pm = GENERIC_PO.exec(t); if (pm && !/^NATIONWIDE$/i.test(pm[1])) { po = pm[1]; poC = "check"; } }
  if (!load && opts.filename) { var fm = String(opts.filename).match(/\b(\d{5,9})\b/); if (fm) { load = fm[1]; loadC = "check"; } }
  var cons = loadConsensus(load, t);
  if (cons) { load = cons.value; loadC = cons.conf; }
  set("load_no", load, loadC);
  set("po", po, poC);

  // rate
  var rate = familyRate(fam, t), rateC = "ok";
  if (rate == null) { rate = rateIn(t, GENERIC_RATE); rateC = "check"; }
  set("rate", rate, rateC);

  // Rexius' own order number, when the text carries it (an email or a Rexius document)
  var sm = /\b\d{2}-\d{4}-\d{4}\b/.exec(t);
  set("rexius_order_no", sm ? sm[0] : "", "ok");

  // stops
  var stops;
  switch (fam) {
    case "tradewinds": stops = stopsTradewinds(t); break;
    case "aaronwilson": stops = stopsAaron(t); break;
    case "openroad": stops = stopsOpenRoad(t); break;
    case "iosco": stops = stopsIosco(t); break;
    case "its": stops = stopsITS(t); break;
    case "oasis": stops = stopsLabeled(t); break;
    case "vanport": stops = stopsVanport(t); break;
    case "inland": stops = stopsInland(t); break;
    case "nationwide": stops = stopsNationwide(t); break;
    default: stops = stopsLabeled(t);
  }
  var stopsC = "ok";
  stops = stops.filter(function (s) { return (s.name || s.address || s.city) && !isJunk(s); });
  var hasP = stops.some(function (s) { return s.type === "pickup"; }), hasD = stops.some(function (s) { return s.type === "delivery"; });
  if (!stops.length) {
    var g = stopsInline(t);
    if (!g.some(function (x) { return x.type === "pickup"; }) || !g.some(function (x) { return x.type === "delivery"; })) g = stopsGeneric(t);
    if (g.length) { stops = g; stopsC = "check"; }
  } else if (!hasP || !hasD) {
    var g2 = stopsGeneric(t).filter(function (s) { return s.type === (hasP ? "delivery" : "pickup"); });
    if (g2.length) { var pick = hasP ? g2[g2.length - 1] : g2[0]; pick.conf = "check"; stops.push(pick); stopsC = "check"; }
  }
  var pickups = stops.filter(function (s) { return s.type === "pickup"; }), drops = stops.filter(function (s) { return s.type === "delivery"; });
  var pickup = pickups[0] || null, delivery = drops[drops.length - 1] || null;
  // a stop with no address and no city/state is a name only: always worth a second look
  [pickup, delivery].forEach(function (s) { if (s) s.conf = s.conf === "check" ? "check" : (s.city && s.state && s.address && s.name && !/[^\w&.,'()\/#:\- ]/.test(s.name + s.address)) ? "ok" : "check"; });
  if (!pickup) missing.push("pickup");
  if (!delivery) missing.push("delivery");

  // broker
  var brokers = opts.brokers || [], low = t.toLowerCase(), hit = "", hitIdx = Infinity;
  brokers.forEach(function (b) { var ix = b ? low.indexOf(String(b).toLowerCase()) : -1; if (ix !== -1 && ix < hitIdx) { hitIdx = ix; hit = b; } });
  var brokerC = hit ? "ok" : "check";
  if (!hit) hit = FAMILY_BROKER[fam] || "";
  if (!hit) {
    var head = t.split("\n").filter(function (l) { return /[A-Za-z]{4}/.test(l); }).slice(0, 6).join(" ");
    var lm = /([A-Z][A-Za-z&. ]{3,40}(?:LOGISTICS|TRANSPORT(?:ATION)?|TRUCKING|FREIGHT|BROKERAGE|LLC|INC))/i.exec(head);
    if (lm && !/rexius/i.test(lm[1])) hit = title(lm[1]);
  }
  set("broker", hit, brokerC);

  return {
    family: fam, fields: fields, conf: conf, missing: missing,
    pickup: pickup, delivery: delivery, stops: stops
  };
}

var API = { parse: parse, detectFamily: detectFamily, clean: clean, cityStateZip: cityStateZip };
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Dept12RateCon = API;
})(typeof window !== "undefined" ? window : globalThis);
