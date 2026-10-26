/* Diff View — Myers O(ND) diff on lines, then again on words inside changed line pairs. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var CONTEXT = 3;

  // ---------- Myers diff ----------
  // Returns ops in order: {t:"=", a, b} | {t:"-", a} | {t:"+", b}; a/b are indexes into the inputs.
  function diff(A, B) {
    var pre = 0, ea = A.length, eb = B.length;
    while (pre < ea && pre < eb && A[pre] === B[pre]) pre++;
    while (ea > pre && eb > pre && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    var a = A.slice(pre, ea), b = B.slice(pre, eb), n = a.length, m = b.length, max = n + m, off = max + 1;
    var v = new Int32Array(2 * max + 3), trace = [], D = 0;
    outer: for (var d = 0; d <= max; d++) {
      trace.push(v.slice(off - d, off + d + 1)); // snapshot covering k ∈ [-d, d]
      for (var k = -d; k <= d; k += 2) {
        var x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1, y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) { D = d; break outer; }
      }
    }
    var mid = [], cx = n, cy = m;
    for (var dd = D; dd >= 0; dd--) {
      var tv = trace[dd], kk = cx - cy, at = function (k) { return tv[k + dd]; };
      var pk = (kk === -dd || (kk !== dd && at(kk - 1) < at(kk + 1))) ? kk + 1 : kk - 1;
      var px = dd === 0 ? 0 : at(pk), py = dd === 0 ? 0 : px - pk;
      while (cx > px && cy > py) { cx--; cy--; mid.push({ t: "=", a: cx + pre, b: cy + pre }); }
      if (dd > 0) { if (cx === px) mid.push({ t: "+", b: py + pre }); else mid.push({ t: "-", a: px + pre }); }
      cx = px; cy = py;
    }
    var ops = [];
    for (var i = 0; i < pre; i++) ops.push({ t: "=", a: i, b: i });
    for (var j = mid.length - 1; j >= 0; j--) ops.push(mid[j]);
    for (var s = 0; s < A.length - ea; s++) ops.push({ t: "=", a: ea + s, b: eb + s });
    return ops;
  }

  function lines(t) { if (!t) return []; var l = t.split(/\r?\n/); if (l[l.length - 1] === "") l.pop(); return l; }
  function keyer(o) {
    return function (s) { if (o.ws) s = s.replace(/\s+/g, " ").trim(); if (o.ic) s = s.toLowerCase(); return s; };
  }

  function unified(aL, bL, ops, nameA, nameB) {
    var out = ["--- " + (nameA || "original"), "+++ " + (nameB || "changed")], i = 0, posA = [], posB = [], pa = 0, pb = 0;
    ops.forEach(function (o, k) { posA[k] = pa; posB[k] = pb; if (o.t !== "+") pa++; if (o.t !== "-") pb++; });
    while (i < ops.length) {
      while (i < ops.length && ops[i].t === "=") i++;
      if (i >= ops.length) break;
      var start = Math.max(0, i - CONTEXT), end = i;
      for (;;) { // extend through changes closer than 2*CONTEXT equal lines apart
        while (end < ops.length && ops[end].t !== "=") end++;
        var e = end; while (e < ops.length && ops[e].t === "=" && e - end < 2 * CONTEXT + 1) e++;
        if (e < ops.length && ops[e].t !== "=" && e - end <= 2 * CONTEXT) { end = e; continue; }
        end = Math.min(ops.length, end + CONTEXT); break;
      }
      var ca = 0, cb = 0, body = [];
      for (var k = start; k < end; k++) {
        var o = ops[k];
        if (o.t === "=") { body.push(" " + aL[o.a]); ca++; cb++; }
        else if (o.t === "-") { body.push("-" + aL[o.a]); ca++; }
        else { body.push("+" + bL[o.b]); cb++; }
      }
      var sa = ca ? posA[start] + 1 : posA[start], sb = cb ? posB[start] + 1 : posB[start];
      out.push("@@ -" + (ca === 1 ? sa : sa + "," + ca) + " +" + (cb === 1 ? sb : sb + "," + cb) + " @@");
      out.push.apply(out, body);
      i = end;
    }
    return out.length > 2 ? out.join("\n") + "\n" : "";
  }

  // ---------- word-level highlight ----------
  function tokens(s) { return s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []; }
  function wordDiff(l, r, key) {
    var ta = tokens(l), tb = tokens(r);
    if (ta.length * tb.length > 4e6) return null; // very long lines: line-level only
    var ops = diff(ta.map(key), tb.map(key)), L = [], R = [];
    ops.forEach(function (o) {
      if (o.t === "=") { L.push([ta[o.a], 0]); R.push([tb[o.b], 0]); }
      else if (o.t === "-") L.push([ta[o.a], 1]); else R.push([tb[o.b], 1]);
    });
    return [L, R];
  }
  function cellText(parts, text) {
    var td = S3.h("td", { "class": "dv-code", dir: "auto" });
    if (!parts) { td.textContent = text; return td; }
    parts = parts.reduce(function (acc, p) { // merge neighbours so "Oat milk" is one highlight, not three
      var l = acc[acc.length - 1];
      if (l && l[1] === p[1]) l[0] += p[0]; else acc.push([p[0], p[1]]);
      return acc;
    }, []);
    parts.forEach(function (p) { td.appendChild(p[1] ? S3.h("mark", { text: p[0] }) : document.createTextNode(p[0])); });
    return td;
  }

  // ---------- model ----------
  // Rows for rendering: {k:"eq"|"chg", ...}. Change blocks pair the i-th removed line with the i-th added line.
  function buildRows(aL, bL, ops, key) {
    var rows = [], i = 0;
    while (i < ops.length) {
      if (ops[i].t === "=") { rows.push({ k: "eq", a: ops[i].a, b: ops[i].b }); i++; continue; }
      var del = [], ins = [];
      while (i < ops.length && ops[i].t !== "=") { if (ops[i].t === "-") del.push(ops[i].a); else ins.push(ops[i].b); i++; }
      var block = { k: "chg", del: del, ins: ins, words: [] };
      for (var p = 0; p < Math.min(del.length, ins.length); p++) block.words[p] = wordDiff(aL[del[p]], bL[ins[p]], key);
      rows.push(block);
    }
    return rows;
  }

  // ---------- render ----------
  var st = { view: S3.store("diff.view") || "split", text: "", stats: null };
  function ln(n) { return S3.h("td", { "class": "dv-ln", text: n == null ? "" : String(n + 1) }); }
  function sign(s) { return S3.h("td", { "class": "dv-sign", text: s }); }

  function eqRow(aL, r) {
    var t = aL[r.a];
    return st.view === "split"
      ? S3.h("tr", { "class": "dv-eq" }, [ln(r.a), cellText(null, t), ln(r.b), cellText(null, t)])
      : S3.h("tr", { "class": "dv-eq" }, [ln(r.a), ln(r.b), sign(" "), cellText(null, t)]);
  }
  function chgRows(aL, bL, r) {
    var out = [], n = Math.max(r.del.length, r.ins.length);
    if (st.view === "split") {
      for (var i = 0; i < n; i++) {
        var w = r.words[i], hasA = i < r.del.length, hasB = i < r.ins.length;
        out.push(S3.h("tr", null, [
          ln(hasA ? r.del[i] : null), hasA ? cellText(w && w[0], aL[r.del[i]]) : S3.h("td", { "class": "dv-blank" }),
          ln(hasB ? r.ins[i] : null), hasB ? cellText(w && w[1], bL[r.ins[i]]) : S3.h("td", { "class": "dv-blank" })
        ]));
        if (hasA) out[out.length - 1].children[1].classList.add("dv-del");
        if (hasB) out[out.length - 1].children[3].classList.add("dv-ins");
      }
    } else {
      r.del.forEach(function (a, i) { out.push(S3.h("tr", { "class": "dv-del" }, [ln(a), ln(null), sign("−"), cellText(r.words[i] && r.words[i][0], aL[a])])); });
      r.ins.forEach(function (b, i) { out.push(S3.h("tr", { "class": "dv-ins" }, [ln(null), ln(b), sign("+"), cellText(r.words[i] && r.words[i][1], bL[b])])); });
    }
    return out;
  }

  function render() {
    var aT = $("#a").value, bT = $("#b").value, out = $("#out");
    var opt = { ws: $("#ws").checked, ic: $("#case").checked }, key = keyer(opt);
    S3.store("diff.opts", { ws: opt.ws, ic: opt.ic, fold: $("#fold").checked });
    var aL = lines(aT), bL = lines(bT);
    out.textContent = "";
    if (!aL.length && !bL.length) {
      out.appendChild(S3.h("div", { "class": "empty" }, [S3.h("b", { text: "Paste two texts to compare" }), "Changes appear here as you type."]));
      setStats(0, 0, 0); st.text = ""; return;
    }
    var ops = diff(aL.map(key), bL.map(key));
    var add = 0, rem = 0, same = 0;
    ops.forEach(function (o) { if (o.t === "+") add++; else if (o.t === "-") rem++; else same++; });
    setStats(add, rem, same);
    st.text = unified(aL, bL, ops);
    if (!add && !rem) {
      out.appendChild(S3.h("div", { "class": "empty" }, [S3.h("b", { text: "No differences" }), opt.ws || opt.ic ? "The texts match with the current ignore options." : "The two texts are identical."]));
      return;
    }
    var rows = buildRows(aL, bL, ops, key), tbody = S3.h("tbody"), fold = $("#fold").checked;
    var table = S3.h("table", { "class": "dv-tbl dv-" + st.view }, [st.view === "split"
      ? S3.h("colgroup", null, [S3.h("col", { "class": "c-ln" }), S3.h("col"), S3.h("col", { "class": "c-ln" }), S3.h("col")])
      : S3.h("colgroup", null, [S3.h("col", { "class": "c-ln" }), S3.h("col", { "class": "c-ln" }), S3.h("col", { "class": "c-sign" }), S3.h("col")]), tbody]);
    var i = 0, drawn = 0;
    while (i < rows.length && drawn < 20000) {
      if (rows[i].k === "chg") { chgRows(aL, bL, rows[i]).forEach(function (tr) { tbody.appendChild(tr); drawn++; }); i++; continue; }
      var j = i; while (j < rows.length && rows[j].k === "eq") j++;
      var run = rows.slice(i, j), head = i === 0 ? 0 : CONTEXT, tail = j === rows.length ? 0 : CONTEXT;
      if (fold && run.length > head + tail + 1) {
        run.slice(0, head).forEach(function (r) { tbody.appendChild(eqRow(aL, r)); });
        tbody.appendChild(foldRow(aL, run.slice(head, run.length - tail)));
        run.slice(run.length - tail).forEach(function (r) { tbody.appendChild(eqRow(aL, r)); });
      } else run.forEach(function (r) { tbody.appendChild(eqRow(aL, r)); });
      drawn += run.length; i = j;
    }
    out.appendChild(table);
    if (i < rows.length) out.appendChild(S3.h("p", { "class": "faint dv-note", text: "Very large diff: showing the first 20,000 lines. Copy or download gets the full diff." }));
  }
  function foldRow(aL, hidden) {
    var tr = S3.h("tr", { "class": "dv-fold" }, [S3.h("td", { colspan: "4" }, [S3.h("button", { type: "button", text: "⋯ " + hidden.length + " unchanged line" + (hidden.length === 1 ? "" : "s") + " — show" })])]);
    tr.querySelector("button").addEventListener("click", function () {
      var frag = document.createDocumentFragment();
      hidden.forEach(function (r) { frag.appendChild(eqRow(aL, r)); });
      tr.replaceWith(frag);
    });
    return tr;
  }
  function setStats(add, rem, same) {
    $("#added").textContent = "+" + add.toLocaleString();
    $("#removed").textContent = "−" + rem.toLocaleString();
    $("#same").textContent = same.toLocaleString() + " unchanged";
  }

  // ---------- wiring ----------
  var o = S3.store("diff.opts") || {};
  $("#ws").checked = !!o.ws; $("#case").checked = !!o.ic; if (o.fold === false) $("#fold").checked = false;
  $$("#view button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.v === st.view));
    b.addEventListener("click", function () {
      $$("#view button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      st.view = b.dataset.v; S3.store("diff.view", st.view); render();
    });
  });
  var renderSoon = S3.debounce(render, 200);
  $("#a").addEventListener("input", renderSoon); $("#b").addEventListener("input", renderSoon);
  ["#ws", "#case", "#fold"].forEach(function (s) { $(s).addEventListener("change", render); });
  $("#swap").addEventListener("click", function () { var t = $("#a").value; $("#a").value = $("#b").value; $("#b").value = t; render(); });
  $("#clear").addEventListener("click", function () { $("#a").value = ""; $("#b").value = ""; render(); $("#a").focus(); });
  $("#copy").addEventListener("click", function () { if (st.text) { S3.copy(st.text, "Unified diff copied"); S3.done(); } else S3.toast("No differences to copy", "error"); });
  $("#save").addEventListener("click", function () { if (st.text) { S3.download(st.text, "changes.diff", "text/x-diff"); S3.done(); } else S3.toast("No differences to save", "error"); });

  var SAMPLE_A = "# Shopping list\nApples: 6\nBread: 1 loaf\nMilk: 2 litres\nEggs: 12\nCoffee beans\nOlive oil\nRice: 1 kg\nTea\nHoney\n\nPay at the counter.";
  var SAMPLE_B = "# Shopping list\nApples: 8\nBread: 1 loaf\nOat milk: 2 litres\nEggs: 12\nCoffee beans (dark roast)\nOlive oil\nRice: 1 kg\nTea\nHoney\nDates\n\nPay by card at the counter.";
  $("#sample").addEventListener("click", function () { $("#a").value = SAMPLE_A; $("#b").value = SAMPLE_B; render(); });

  render();

  window.S3_DEMO = function () { $("#sample").click(); };

  window.S3_SELFTEST = function () {
    var A = "abcdefghij".split(""), B = "abcdEfghijk".split("");
    var expect = "--- original\n+++ changed\n@@ -2,9 +2,10 @@\n b\n c\n d\n-e\n+E\n f\n g\n h\n i\n j\n+k\n";
    if (unified(A, B, diff(A, B)) !== expect) return "unified 1: " + unified(A, B, diff(A, B));
    var a2 = ["one", "two", "three"], b2 = ["zero", "one", "three"];
    if (unified(a2, b2, diff(a2, b2)) !== "--- original\n+++ changed\n@@ -1,3 +1,3 @@\n+zero\n one\n-two\n three\n") return "unified 2";
    // Classic Myers paper example: ABCABBA → CBABAC has edit distance 5
    var ops = diff("ABCABBA".split(""), "CBABAC".split(""));
    if (ops.filter(function (o) { return o.t !== "="; }).length !== 5) return "myers D";
    if (diff([], ["x"]).length !== 1 || diff(["x"], []).length !== 1 || unified(["x"], ["x"], diff(["x"], ["x"])) !== "") return "edges";
    var far = []; for (var i = 0; i < 20; i++) far.push("l" + i);
    var far2 = far.slice(); far2[1] = "X"; far2[18] = "Y";
    if ((unified(far, far2, diff(far, far2)).match(/^@@/gm) || []).length !== 2) return "hunk split";
    var k = keyer({ ws: true, ic: true });
    if (k("  Hello   World ") !== "hello world") return "ignore opts";
    var w = wordDiff("the quick fox", "the slow fox", function (s) { return s; });
    if (w[0].filter(function (p) { return p[1]; }).map(function (p) { return p[0]; }).join("") !== "quick" || w[1].filter(function (p) { return p[1]; })[0][0] !== "slow") return "word diff";
    if (lines("a\nb\n").length !== 2 || lines("a\r\nb").length !== 2) return "lines";
    // Fuzz: the ops must rebuild both sides and be minimal (edits = n + m - 2·LCS).
    for (var t = 0; t < 150; t++) {
      var ra = [], rb = [], na = Math.random() * 12 | 0, nb = Math.random() * 12 | 0;
      for (var x = 0; x < na; x++) ra.push("abc"[Math.random() * 3 | 0]);
      for (var y = 0; y < nb; y++) rb.push("abc"[Math.random() * 3 | 0]);
      var o2 = diff(ra, rb), ga = [], gb = [], edits = 0;
      o2.forEach(function (q) { if (q.t !== "+") ga.push(ra[q.a]); if (q.t !== "-") gb.push(rb[q.b]); if (q.t !== "=") edits++; else if (ra[q.a] !== rb[q.b]) edits = -999; });
      var L = []; for (var p = 0; p <= na; p++) { L.push(new Array(nb + 1).fill(0)); for (var q2 = 1; q2 <= nb && p; q2++) L[p][q2] = ra[p - 1] === rb[q2 - 1] ? L[p - 1][q2 - 1] + 1 : Math.max(L[p - 1][q2], L[p][q2 - 1]); }
      if (ga.join("") !== ra.join("") || gb.join("") !== rb.join("") || edits !== na + nb - 2 * L[na][nb]) return "fuzz " + ra.join("") + "/" + rb.join("");
    }
    return true;
  };
})();
