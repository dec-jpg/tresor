/* Policy pack signing: on-screen rendering and the signed PDF. Used by sign.html. */
(function (root) {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDate(d) {
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(d.getDate()) + '-' + two(d.getMonth() + 1) + '-' + d.getFullYear();
  }
  function longDate(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // The wording carries {{company}}, {{about}}, {{signer}} and {{role}} where the client's own details belong.
  function fill(t, v) {
    return String(t).replace(/\{\{about\}\}/g, v.about || 'a contractor in the construction industry').replace(/\{\{company\}\}/g, v.company).replace(/\{\{signer\}\}/g, v.signer).replace(/\{\{role\}\}/g, v.role);
  }

  /* ---------- on-screen version ---------- */
  function runsHTML(runs, v) {
    return runs.map(function (r) { return r.b ? '<strong>' + esc(fill(r.t, v)) + '</strong>' : esc(fill(r.t, v)); }).join(' ');
  }
  function policyHTML(policy, v, n) {
    var h = '<section class="policy" id="p-' + policy.id + '"><p class="pno">Policy ' + n + '</p><h2>' + esc(policy.title) + '</h2><p class="co">' + esc(v.company) + '</p>';
    var inList = false;
    policy.blocks.forEach(function (b) {
      if (b.k !== 'li' && inList) { h += '</ul>'; inList = false; }
      if (b.k === 'h') h += '<h3>' + runsHTML(b.runs, v) + '</h3>';
      else if (b.k === 'p') h += '<p>' + runsHTML(b.runs, v) + '</p>';
      else if (b.k === 'li') { if (!inList) { h += '<ul>'; inList = true; } h += '<li>' + runsHTML(b.runs, v) + '</li>'; }
      else if (b.k === 'sign') h += '<p class="signnote">Approved and authorised by a director when the pack is signed below.</p>';
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
    var v = { company: pack.company, signer: sign.name, role: sign.role, about: pack.about };
    var dateStr = longDate(sign.date);
    var review = new Date(sign.date.getTime()); review.setFullYear(review.getFullYear() + 1);
    var versionStr = String(pack.version).indexOf('.') === -1 ? pack.version + '.0' : String(pack.version);

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
        fill(r.t, v).split(/\s+/).forEach(function (word) {
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
    function drawLines(lay, size, x, lh) {
      lay.lines.forEach(function (line) {
        ensure(lh);
        var cx = x, i = 0;
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
      drawLines(lay, size, x, lh);
    }
    function label(t, x, yy) { font(false, 7); doc.setTextColor(95); doc.text(t.split('').join(' '), x, yy); doc.setTextColor(0); }
    function signBlock() {
      ensure(52);
      y += 5;
      font(true, 10.5); doc.text('This policy has been approved and authorised by:', ML, y); y += 8;
      label('NAME', ML, y); label('POSITION', ML + 85, y); y += 5;
      font(true, 10.5); doc.text(String(sign.name), ML, y); doc.text(String(sign.role), ML + 85, y); y += 8;
      label('SIGNED', ML, y); y += 2;
      if (sign.image) doc.addImage(sign.image, 'PNG', ML, y, 52, 18, 'signature', 'FAST');
      y += 23;
      label('DATE', ML, y); y += 5;
      font(true, 10.5); doc.text(dateStr, ML, y); y += 6;
    }

    // Cover, in the same form as the Business Policy Pack
    label('BUSINESS POLICY PACK', ML, 46);
    font(true, 26); doc.text(doc.splitTextToSize('Company Policies & Management Arrangements', CW), ML, 60);
    font(false, 15); doc.setTextColor(70); doc.text(doc.splitTextToSize(pack.company, CW), ML, 86); doc.setTextColor(0);
    var cy = 106;
    [['VERSION', versionStr], ['ISSUE DATE', dateStr], ['APPROVED BY', sign.name + ', ' + sign.role], ['REVIEW DUE', longDate(review)]].forEach(function (r, i) {
      var cx = ML + (i % 2) * 85, yy = cy + Math.floor(i / 2) * 16;
      label(r[0], cx, yy); font(true, 11); doc.text(doc.splitTextToSize(String(r[1]), 80), cx, yy + 5.5);
    });
    font(false, 10); doc.text('Signed by ' + sign.name + ' · ' + dateStr, ML, cy + 38);
    y = cy + 50;
    font(true, 11); doc.text('Contents', ML, y); y += 7;
    policies.forEach(function (p, i) { ensure(5.5); font(false, 10); doc.text((i + 1) + '.  ' + p.title, ML + 2, y); y += 5.5; });

    // Policies
    policies.forEach(function (p, n) {
      newPage();
      label('POLICY ' + (n + 1), ML, y); y += 7;
      para([{ t: p.title, b: true }], 16, ML, CW, 7);
      font(false, 10); doc.setTextColor(95); doc.text(pack.company, ML, y); doc.setTextColor(0);
      y += 9;
      p.blocks.forEach(function (b) {
        if (b.k === 'h') {
          y += 2.5; para(b.runs, 11, ML, CW, 5.4, { bold: true, keep: 12 }); y += 1.2;
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
    var total = doc.getNumberOfPages();
    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      font(false, 8); doc.setTextColor(110);
      doc.text(pack.company + '  |  ' + pack.packName + ' v' + versionStr + '  |  Ref ' + pack.ref, ML, H - 10);
      doc.text(i + '/' + total, W - MR, H - 10, { align: 'right' });
      doc.setTextColor(0);
    }
    return doc;
  }

  root.PolicyPack = { fmtDate: fmtDate, longDate: longDate, esc: esc, fill: fill, policyHTML: policyHTML, buildPDF: buildPDF };
})(typeof window !== 'undefined' ? window : globalThis);
