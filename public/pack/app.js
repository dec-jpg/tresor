/* Policy pack signing: on-screen rendering and the signed PDF. Used by sign.html. */
(function (root) {
  'use strict';

  function fmtDate(d) {
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(d.getDate()) + '-' + two(d.getMonth() + 1) + '-' + d.getFullYear();
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- on-screen version ---------- */
  function runsHTML(runs) {
    return runs.map(function (r) { return r.b ? '<strong>' + esc(r.t) + '</strong>' : esc(r.t); }).join(' ');
  }
  function policyHTML(policy, company) {
    var h = '<section class="policy" id="p-' + policy.id + '"><h2>' + esc(policy.title) + '</h2><p class="co">' + esc(company) + '</p>';
    var inList = false;
    policy.blocks.forEach(function (b) {
      if (b.k !== 'li' && inList) { h += '</ul>'; inList = false; }
      if (b.k === 'h') h += (b.lvl === 1 ? '<h3 class="big">' : '<h3>') + runsHTML(b.runs) + '</h3>';
      else if (b.k === 'p') h += '<p>' + runsHTML(b.runs) + '</p>';
      else if (b.k === 'li') { if (!inList) { h += '<ul>'; inList = true; } h += '<li>' + runsHTML(b.runs) + '</li>'; }
      else if (b.k === 'sign') h += '<p class="signnote">Signed by a director when the pack is signed below.</p>';
    });
    if (inList) h += '</ul>';
    return h + '</section>';
  }

  /* ---------- signed PDF ---------- */
  // pack: { company, ref, version, packName, policies }   sign: { name, role, date (Date), image (PNG data URL) }
  function buildPDF(jsPDF, pack, sign) {
    var doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    var W = 210, H = 297, ML = 20, MR = 20, MT = 22, MB = 22, CW = W - ML - MR;
    var y = MT;
    var policies = pack.policies;
    var dateStr = fmtDate(sign.date);

    function font(bold, size) { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); }
    function newPage() { doc.addPage(); y = MT; }
    function ensure(h) { if (y + h > H - MB) newPage(); }

    function splitLong(word, maxW) {
      var parts = [], cur = '';
      for (var i = 0; i < word.length; i++) {
        if (doc.getTextWidth(cur + word[i]) > maxW && cur) { parts.push(cur); cur = ''; }
        cur += word[i];
      }
      if (cur) parts.push(cur);
      return parts;
    }
    // Lay out runs of normal and bold text into lines no wider than maxW.
    function layout(runs, size, maxW, forceBold) {
      var lines = [], line = [], lineW = 0;
      font(false, size);
      var spaceW = doc.getTextWidth(' ');
      runs.forEach(function (r) {
        var bold = forceBold || !!r.b;
        font(bold, size);
        r.t.split(/\s+/).forEach(function (word) {
          if (!word) return;
          var pieces = doc.getTextWidth(word) > maxW ? splitLong(word, maxW) : [word];
          pieces.forEach(function (w) {
            var ww = doc.getTextWidth(w);
            if (line.length && lineW + spaceW + ww > maxW) { lines.push(line); line = []; lineW = 0; }
            if (line.length) lineW += spaceW;
            line.push({ t: w, b: bold, w: ww });
            lineW += ww;
          });
        });
      });
      if (line.length) lines.push(line);
      return { lines: lines, spaceW: spaceW };
    }
    function drawLines(lay, size, x, lh, align) {
      lay.lines.forEach(function (line) {
        ensure(lh);
        var total = 0;
        line.forEach(function (s, i) { total += s.w + (i ? lay.spaceW : 0); });
        var cx = align === 'center' ? ML + (CW - total) / 2 : x;
        var i = 0;
        while (i < line.length) {
          var j = i, txt = line[i].t, w = line[i].w;
          while (j + 1 < line.length && line[j + 1].b === line[i].b) { j++; txt += ' ' + line[j].t; w += lay.spaceW + line[j].w; }
          font(line[i].b, size);
          doc.text(txt, cx, y);
          cx += w + lay.spaceW;
          i = j + 1;
        }
        y += lh;
      });
    }
    function para(runs, size, x, maxW, lh, opts) {
      opts = opts || {};
      var lay = layout(runs, size, maxW, opts.bold);
      if (opts.keep) ensure(lay.lines.length * lh + opts.keep);
      drawLines(lay, size, x, lh, opts.align);
    }
    function signBlock() {
      ensure(46);
      y += 4;
      font(true, 10); doc.text('Signed:', ML, y + 10);
      if (sign.image) doc.addImage(sign.image, 'PNG', ML + 22, y, 52, 18, 'signature', 'FAST');
      doc.setDrawColor(120); doc.setLineWidth(0.2); doc.line(ML + 22, y + 19, ML + 82, y + 19);
      y += 26;
      [['Name:', sign.name], ['Position:', sign.role], ['Date:', dateStr]].forEach(function (row) {
        font(true, 10); doc.text(row[0], ML, y);
        font(false, 10); doc.text(String(row[1]), ML + 22, y);
        y += 5.5;
      });
      y += 4;
    }

    // Cover
    font(true, 22); doc.text(pack.packName, W / 2, 95, { align: 'center' });
    font(false, 15); doc.text(doc.splitTextToSize(pack.company, CW), W / 2, 110, { align: 'center' });
    font(false, 10); doc.text('Signed ' + dateStr, W / 2, 124, { align: 'center' });
    y = 150;
    font(true, 11); doc.text('Policies in this pack', ML, y); y += 7;
    policies.forEach(function (p, i) { font(false, 10); doc.text((i + 1) + '.  ' + p.title, ML + 2, y); y += 5.5; });

    // Policies
    policies.forEach(function (p) {
      newPage();
      para([{ t: p.title.toUpperCase(), b: true }], 14, ML, CW, 6.5, { align: 'center' });
      para([{ t: pack.company }], 11, ML, CW, 5.5, { align: 'center' });
      y += 5;
      p.blocks.forEach(function (b) {
        if (b.k === 'h') {
          if (b.brk) newPage();
          if (b.lvl === 1) { y += 3; para(b.runs, 12, ML, CW, 5.8, { bold: true, align: 'center', keep: 14 }); y += 2.5; }
          else { y += 2.5; para(b.runs, 10.5, ML, CW, 5.2, { bold: true, keep: 12 }); y += 1.2; }
        } else if (b.k === 'p') {
          para(b.runs, 10, ML, CW, 4.7); y += 2;
        } else if (b.k === 'li') {
          ensure(4.7);
          font(false, 10); doc.text('•', ML + 4, y);
          para(b.runs, 10, ML + 9, CW - 9, 4.7); y += 1.3;
        } else if (b.k === 'sign') {
          signBlock();
        }
      });
    });

    // Footers
    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      font(false, 8); doc.setTextColor(110);
      doc.text(pack.company + '  |  ' + pack.packName + '  |  Version ' + pack.version + '  |  Ref ' + pack.ref, ML, H - 10);
      doc.text('Page ' + i + ' of ' + n, W - MR, H - 10, { align: 'right' });
      doc.setTextColor(0);
    }
    return doc;
  }

  root.PolicyPack = { fmtDate: fmtDate, esc: esc, policyHTML: policyHTML, buildPDF: buildPDF };
})(typeof window !== 'undefined' ? window : globalThis);
