(function () {
  'use strict';

  var SOORTEN = ['Tekst vervangen', 'Tekst toevoegen', 'Tekst verwijderen', 'Knop of link', 'Afbeelding', 'Opmaak', 'Overig'];
  var STANDAARD_INTRO = 'Hierbij de gewenste aanpassingen. Per pagina zie je een screenshot met rode nummers; daaronder staat per nummer de huidige en de nieuwe tekst. Met de knop "Kopieer" neem je de nieuwe tekst exact over.';
  var MAX_BREEDTE = 2000;

  var staat;
  var tekenDoel = null; // id van de wijziging waarvan het kader opnieuw getekend wordt
  var $ = function (id) { return document.getElementById(id); };
  var uid = function () { return Math.random().toString(36).slice(2, 10); };

  function vandaag() {
    return new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function leegStaat(vorige) {
    var m = vorige ? vorige.meta : {};
    return {
      versie: 1,
      meta: {
        titel: 'Wijzigingsverzoek website', website: m.website || '', datum: vandaag(),
        afzender: m.afzender || '', ontvanger: m.ontvanger || '', intro: STANDAARD_INTRO
      },
      paginas: []
    };
  }

  // ---------- opslag in de browser (IndexedDB; screenshots passen niet in localStorage) ----------
  var dbBelofte = null;
  function db() {
    if (!dbBelofte) {
      dbBelofte = new Promise(function (res, rej) {
        var r = indexedDB.open('wijzigingsverzoek', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('staat'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    return dbBelofte;
  }
  function laadOpslag() {
    return db().then(function (d) {
      return new Promise(function (res) {
        var q = d.transaction('staat').objectStore('staat').get('huidig');
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  var bewaarTimer = null;
  function bewaar() {
    $('status').textContent = 'Opslaan...';
    clearTimeout(bewaarTimer);
    bewaarTimer = setTimeout(function () {
      db().then(function (d) {
        var tx = d.transaction('staat', 'readwrite');
        tx.objectStore('staat').put(staat, 'huidig');
        tx.oncomplete = function () { $('status').textContent = 'Bewaard in deze browser'; };
        tx.onerror = function () { $('status').textContent = 'Niet bewaard: download het verzoek als back-up'; };
      }).catch(function () { $('status').textContent = 'Browseropslag niet beschikbaar'; });
    }, 400);
  }

  var meldTimer = null;
  function meld(tekst) {
    var m = $('melding');
    m.textContent = tekst; m.classList.add('zichtbaar');
    clearTimeout(meldTimer);
    meldTimer = setTimeout(function () { m.classList.remove('zichtbaar'); }, 2600);
  }

  // ---------- nummering: doorlopend over alle pagina's ----------
  function nummers() {
    var map = {}, n = 0;
    staat.paginas.forEach(function (p) { p.wijzigingen.forEach(function (w) { map[w.id] = ++n; }); });
    return map;
  }
  function zoekWijziging(id) {
    for (var i = 0; i < staat.paginas.length; i++) {
      var p = staat.paginas[i];
      for (var j = 0; j < p.wijzigingen.length; j++) if (p.wijzigingen[j].id === id) return { p: p, w: p.wijzigingen[j], i: j };
    }
    return null;
  }
  function nieuweWijziging(rect) {
    return { id: uid(), rect: rect || null, soort: SOORTEN[0], waar: '', huidig: '', nieuw: '', toelichting: '' };
  }

  // ---------- algemene gegevens ----------
  function vulMeta() {
    document.querySelectorAll('[data-meta]').forEach(function (el) { el.value = staat.meta[el.dataset.meta] || ''; });
  }
  document.querySelectorAll('[data-meta]').forEach(function (el) {
    el.addEventListener('input', function () { staat.meta[el.dataset.meta] = el.value; bewaar(); });
  });

  // ---------- weergave ----------
  function el(tag, cls, tekst) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  function knop(tekst, cls, titel, actie) {
    var b = el('button', cls, tekst); b.type = 'button';
    if (titel) { b.title = titel; b.setAttribute('aria-label', titel); }
    b.addEventListener('click', actie);
    return b;
  }
  function invoer(obj, veld, cls, placeholder, rijen) {
    var e = rijen ? el('textarea', cls) : el('input', cls);
    if (rijen) e.rows = rijen;
    e.value = obj[veld] || '';
    if (placeholder) e.placeholder = placeholder;
    e.addEventListener('input', function () { obj[veld] = e.value; bewaar(); });
    return e;
  }

  function render() {
    var nrs = nummers();
    var bak = $('paginas');
    bak.innerHTML = '';
    staat.paginas.forEach(function (p, pi) { bak.appendChild(renderPagina(p, pi, nrs)); });
  }

  function renderPagina(p, pi, nrs) {
    var s = el('section', 'pagina'); s.dataset.id = p.id;

    var kop = el('div', 'pagina-kop');
    kop.appendChild(invoer(p, 'pagina', 'naam', 'Paginanaam, bijv. Home of Contact'));
    kop.appendChild(invoer(p, 'url', 'url', 'Adres van de pagina, bijv. https://www.energiebehoud.nl/contact'));
    kop.appendChild(knop('Nieuw screenshot', 'klein', 'Screenshot opnieuw maken vanaf het adres', function (e) { vernieuwScreenshot(p, e.currentTarget); }));
    kop.appendChild(knop('↑', 'klein', 'Pagina omhoog', function () { verplaats(pi, -1); }));
    kop.appendChild(knop('↓', 'klein', 'Pagina omlaag', function () { verplaats(pi, 1); }));
    kop.appendChild(knop('Verwijderen', 'klein gevaar', 'Pagina met screenshot verwijderen', function () {
      if (!confirm('Deze pagina en ' + p.wijzigingen.length + ' wijziging(en) verwijderen?')) return;
      staat.paginas.splice(pi, 1); bewaar(); render();
    }));
    s.appendChild(kop);

    var body = el('div', 'pagina-body');
    var kolom = el('div', 'shot-kolom');
    var shot = el('div', 'shot');
    var img = el('img'); img.src = p.bron; img.alt = 'Screenshot ' + (p.pagina || ''); img.draggable = false;
    shot.appendChild(img);
    var laag = el('div', 'laag');
    var doelOpDezePagina = tekenDoel && p.wijzigingen.some(function (w) { return w.id === tekenDoel; });
    if (doelOpDezePagina) laag.classList.add('doel');
    p.wijzigingen.forEach(function (w) { if (w.rect) laag.appendChild(renderMarker(p, w, nrs[w.id])); });
    koppelTekenen(laag, p);
    shot.appendChild(laag);
    kolom.appendChild(shot);
    kolom.appendChild(el('p', 'hint', doelOpDezePagina
      ? 'Teken nu het nieuwe kader voor nr. ' + nrs[tekenDoel] + '. Esc om te annuleren.'
      : 'Sleep een kader over wat er anders moet. Klik op een nummer om naar de tekst te gaan.'));
    body.appendChild(kolom);

    var kaarten = el('div', 'kaarten');
    if (!p.wijzigingen.length) kaarten.appendChild(el('p', 'leeg-kaarten', 'Nog geen wijzigingen. Sleep een kader op het screenshot.'));
    p.wijzigingen.forEach(function (w) { kaarten.appendChild(renderKaart(p, w, nrs[w.id])); });
    kaarten.appendChild(knop('+ Wijziging zonder kader', 'klein', null, function () {
      var w = nieuweWijziging(null); p.wijzigingen.push(w); bewaar(); render(); focusKaart(w.id, true);
    }));
    body.appendChild(kaarten);
    s.appendChild(body);
    return s;
  }

  function renderMarker(p, w, nr) {
    var m = el('div', 'mark'); m.dataset.id = w.id;
    zetPositie(m, w.rect);
    m.appendChild(el('span', 'nr-badge', String(nr)));
    m.appendChild(el('span', 'greep'));
    m.addEventListener('mouseenter', function () { markeer(w.id, true); });
    m.addEventListener('mouseleave', function () { markeer(w.id, false); });
    koppelVerslepen(m, w);
    return m;
  }

  function renderKaart(p, w, nr) {
    var k = el('div', 'kaart'); k.dataset.id = w.id;
    var kop = el('div', 'kaart-kop');
    kop.appendChild(el('span', 'nr' + (w.rect ? '' : ' zonder'), String(nr)));
    var sel = el('select');
    SOORTEN.forEach(function (s) { var o = el('option', null, s); o.value = s; sel.appendChild(o); });
    if (SOORTEN.indexOf(w.soort) < 0 && w.soort) { var o = el('option', null, w.soort); o.value = w.soort; sel.appendChild(o); }
    sel.value = w.soort || SOORTEN[0];
    sel.addEventListener('change', function () { w.soort = sel.value; bewaar(); });
    kop.appendChild(sel);
    kop.appendChild(invoer(w, 'waar', 'waar', 'Waar? bijv. kop boven het formulier'));
    kop.appendChild(knop(w.rect ? 'Kader' : '+ Kader', 'klein' + (tekenDoel === w.id ? ' aan' : ''),
      w.rect ? 'Kader opnieuw tekenen' : 'Kader tekenen op het screenshot', function () {
        tekenDoel = tekenDoel === w.id ? null : w.id; render();
      }));
    kop.appendChild(knop('✕', 'klein gevaar', 'Wijziging verwijderen', function () {
      var f = zoekWijziging(w.id); if (!f) return;
      if ((w.huidig || w.nieuw || w.toelichting) && !confirm('Wijziging nr. ' + nr + ' verwijderen?')) return;
      f.p.wijzigingen.splice(f.i, 1); if (tekenDoel === w.id) tekenDoel = null; bewaar(); render();
    }));
    k.appendChild(kop);

    var l1 = el('label', null, 'Huidige tekst');
    l1.appendChild(invoer(w, 'huidig', 'huidig', 'Wat er nu staat (leeg laten bij nieuwe tekst)', 3)); k.appendChild(l1);
    var l2 = el('label', null, 'Nieuwe tekst');
    l2.appendChild(invoer(w, 'nieuw', 'nieuw', 'Wat er moet komen te staan (leeg laten bij verwijderen)', 3)); k.appendChild(l2);
    var l3 = el('label', null, 'Toelichting (optioneel)');
    l3.appendChild(invoer(w, 'toelichting', 'toel', 'Bijv. zelfde opmaak houden, link naar /offerte', 2)); k.appendChild(l3);

    k.addEventListener('mouseenter', function () { markeer(w.id, true); });
    k.addEventListener('mouseleave', function () { markeer(w.id, false); });
    return k;
  }

  function zetPositie(e, r) {
    e.style.left = r.x + '%'; e.style.top = r.y + '%'; e.style.width = r.b + '%'; e.style.height = r.h + '%';
  }
  function markeer(id, aan) {
    document.querySelectorAll('[data-id="' + id + '"]').forEach(function (e) {
      if (e.classList.contains('mark') || e.classList.contains('kaart')) e.classList.toggle('actief', aan);
    });
  }
  function focusKaart(id, metFocus) {
    var k = document.querySelector('.kaart[data-id="' + id + '"]');
    if (!k) return;
    k.scrollIntoView({ behavior: 'smooth', block: 'center' });
    k.classList.add('actief'); setTimeout(function () { k.classList.remove('actief'); }, 1200);
    if (metFocus) { var t = k.querySelector('textarea'); if (t) t.focus({ preventScroll: true }); }
  }
  function verplaats(i, d) {
    var j = i + d; if (j < 0 || j >= staat.paginas.length) return;
    var p = staat.paginas.splice(i, 1)[0]; staat.paginas.splice(j, 0, p); bewaar(); render();
  }

  // ---------- kaders tekenen, verslepen en schalen ----------
  var rond = function (v) { return Math.round(v * 10) / 10; };
  var klem = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function procent(laag, ev) {
    var r = laag.getBoundingClientRect();
    return { x: klem((ev.clientX - r.left) / r.width * 100, 0, 100), y: klem((ev.clientY - r.top) / r.height * 100, 0, 100), r: r };
  }

  function koppelTekenen(laag, p) {
    laag.addEventListener('pointerdown', function (ev) {
      if (ev.target !== laag || ev.button !== 0) return;
      ev.preventDefault();
      var start = procent(laag, ev);
      var concept = el('div', 'concept'); laag.appendChild(concept);
      var rect = { x: start.x, y: start.y, b: 0, h: 0 };
      laag.setPointerCapture(ev.pointerId);
      function beweeg(e) {
        var q = procent(laag, e);
        rect = { x: Math.min(start.x, q.x), y: Math.min(start.y, q.y), b: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) };
        zetPositie(concept, rect);
      }
      function los() {
        laag.removeEventListener('pointermove', beweeg);
        laag.removeEventListener('pointerup', los);
        laag.removeEventListener('pointercancel', los);
        concept.remove();
        var r = start.r;
        if (rect.b * r.width / 100 < 8 && rect.h * r.height / 100 < 8) {
          // klik zonder slepen: standaardkader van ca. 240 x 44 px rond het klikpunt
          var b = Math.min(240 / r.width * 100, 100), h = Math.min(44 / r.height * 100, 100);
          rect = { x: klem(start.x - b / 2, 0, 100 - b), y: klem(start.y - h / 2, 0, 100 - h), b: b, h: h };
        }
        rect = { x: rond(rect.x), y: rond(rect.y), b: rond(rect.b), h: rond(rect.h) };
        var doel = tekenDoel && zoekWijziging(tekenDoel);
        var id;
        if (doel && doel.p === p) { doel.w.rect = rect; id = doel.w.id; tekenDoel = null; }
        else { var w = nieuweWijziging(rect); p.wijzigingen.push(w); id = w.id; }
        bewaar(); render(); focusKaart(id, true);
      }
      laag.addEventListener('pointermove', beweeg);
      laag.addEventListener('pointerup', los);
      laag.addEventListener('pointercancel', los);
    });
  }

  function koppelVerslepen(m, w) {
    m.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      var laag = m.parentNode;
      var schalen = ev.target.classList.contains('greep');
      var start = procent(laag, ev);
      var orig = { x: w.rect.x, y: w.rect.y, b: w.rect.b, h: w.rect.h };
      var bewogen = false;
      m.setPointerCapture(ev.pointerId);
      function beweeg(e) {
        var q = procent(laag, e);
        var dx = q.x - start.x, dy = q.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.3) bewogen = true;
        if (schalen) {
          w.rect.b = klem(orig.b + dx, 1, 100 - orig.x);
          w.rect.h = klem(orig.h + dy, 1, 100 - orig.y);
        } else {
          w.rect.x = klem(orig.x + dx, 0, 100 - orig.b);
          w.rect.y = klem(orig.y + dy, 0, 100 - orig.h);
        }
        zetPositie(m, w.rect);
      }
      function los() {
        m.removeEventListener('pointermove', beweeg);
        m.removeEventListener('pointerup', los);
        m.removeEventListener('pointercancel', los);
        if (bewogen) {
          w.rect = { x: rond(w.rect.x), y: rond(w.rect.y), b: rond(w.rect.b), h: rond(w.rect.h) };
          bewaar();
        } else {
          focusKaart(w.id, true);
        }
      }
      m.addEventListener('pointermove', beweeg);
      m.addEventListener('pointerup', los);
      m.addEventListener('pointercancel', los);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tekenDoel) { tekenDoel = null; render(); }
  });

  // ---------- screenshots toevoegen: plakken, slepen, kiezen ----------
  function verwerkAfbeelding(bestand) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(bestand);
      var img = new Image();
      img.onload = function () {
        var schaal = Math.min(1, MAX_BREEDTE / img.naturalWidth);
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * schaal); c.height = Math.round(img.naturalHeight * schaal);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var bron = c.toDataURL('image/png');
        if (bron.length > 2500000) bron = c.toDataURL('image/jpeg', 0.9); // grote screenshots als JPG, scheelt mailgrootte
        res(bron);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Afbeelding niet te lezen')); };
      img.src = url;
    });
  }
  function voegScreenshotsToe(bestanden) {
    var lijst = Array.prototype.filter.call(bestanden, function (f) { return f.type && f.type.indexOf('image/') === 0; });
    if (!lijst.length) { meld('Geen afbeelding gevonden'); return; }
    var eerste = null;
    lijst.reduce(function (vorige, f) {
      return vorige.then(function () {
        return verwerkAfbeelding(f).then(function (bron) {
          var p = { id: uid(), pagina: '', url: '', bron: bron, wijzigingen: [] };
          staat.paginas.push(p); if (!eerste) eerste = p.id;
        });
      });
    }, Promise.resolve()).then(function () {
      bewaar(); render();
      var s = document.querySelector('.pagina[data-id="' + eerste + '"]');
      if (s) { s.scrollIntoView({ behavior: 'smooth', block: 'start' }); var n = s.querySelector('.naam'); if (n) n.focus({ preventScroll: true }); }
      meld(lijst.length === 1 ? 'Screenshot toegevoegd' : lijst.length + ' screenshots toegevoegd');
    }).catch(function (e) { meld(e.message); });
  }

  // ---------- screenshot maken vanaf een URL (via Microlink; de browser mag zelf geen andere site vastleggen) ----------
  var APPARATEN = {
    desktop: { 'viewport.width': 1366, 'viewport.height': 900, 'viewport.deviceScaleFactor': 1 },
    mobiel: { 'viewport.width': 390, 'viewport.height': 844, 'viewport.deviceScaleFactor': 2, 'viewport.isMobile': true }
  };
  function haalScreenshot(url, apparaat, heel) {
    var q = { url: url, screenshot: true, meta: false, force: true, 'screenshot.fullPage': !!heel };
    var a = APPARATEN[apparaat] || APPARATEN.desktop;
    Object.keys(a).forEach(function (k) { q[k] = a[k]; });
    var qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    return fetch('https://api.microlink.io/?' + qs).then(function (r) {
      if (r.status === 429) throw new Error('Daglimiet van de screenshotdienst bereikt. Plak het screenshot zelf (Ctrl+V).');
      return r.json().catch(function () { throw new Error('Screenshotdienst gaf geen geldig antwoord'); });
    }).then(function (j) {
      if (j.status !== 'success' || !j.data || !j.data.screenshot) {
        throw new Error('Screenshot mislukt' + (j.message ? ': ' + j.message : '') + '. Klopt het adres?');
      }
      return fetch(j.data.screenshot.url);
    }).then(function (r) {
      if (!r.ok) throw new Error('Screenshot kon niet worden opgehaald');
      return r.blob();
    }).then(verwerkAfbeelding);
  }
  function naamUitUrl(url) {
    try {
      var u = new URL(url);
      var deel = u.pathname.split('/').filter(Boolean).pop();
      if (!deel) return 'Home';
      deel = decodeURIComponent(deel).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ');
      return deel.charAt(0).toUpperCase() + deel.slice(1);
    } catch (e) { return ''; }
  }
  function normaliseerUrl(v) {
    v = v.trim();
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }
  $('url-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = normaliseerUrl($('url-invoer').value);
    if (!url) return;
    var apparaat = $('url-apparaat').value, heel = $('url-heel').checked;
    var k = $('url-knop'); k.disabled = true; k.textContent = 'Bezig (10-30 sec.)...';
    haalScreenshot(url, apparaat, heel).then(function (bron) {
      var p = { id: uid(), pagina: naamUitUrl(url), url: url, bron: bron, apparaat: apparaat, heel: heel, wijzigingen: [] };
      staat.paginas.push(p);
      if (!staat.meta.website) { try { staat.meta.website = new URL(url).origin; vulMeta(); } catch (er) {} }
      $('url-invoer').value = '';
      bewaar(); render();
      var s = document.querySelector('.pagina[data-id="' + p.id + '"]');
      if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
      meld('Screenshot gemaakt. Sleep nu een kader over wat er anders moet.');
    }).catch(function (er) { meld(er.message); }).then(function () {
      k.disabled = false; k.textContent = 'Screenshot maken';
    });
  });
  function vernieuwScreenshot(p, knopEl) {
    var url = normaliseerUrl(p.url || '');
    if (!url) { meld('Vul eerst het adres van de pagina in'); return; }
    if (p.wijzigingen.some(function (w) { return w.rect; }) &&
        !confirm('Nieuw screenshot maken? De kaders blijven staan; controleer daarna of ze nog op de goede plek zitten.')) return;
    knopEl.disabled = true; knopEl.textContent = 'Bezig...';
    haalScreenshot(url, p.apparaat || 'desktop', p.heel !== false).then(function (bron) {
      p.bron = bron; p.url = url; bewaar(); render(); meld('Screenshot vernieuwd');
    }).catch(function (er) { meld(er.message); knopEl.disabled = false; knopEl.textContent = 'Nieuw screenshot'; });
  }

  document.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var beelden = [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) beelden.push(items[i].getAsFile());
    if (!beelden.length) return; // gewone tekst plakken in een veld blijft werken
    e.preventDefault();
    voegScreenshotsToe(beelden);
  });
  $('bestand-shot').addEventListener('change', function (e) { voegScreenshotsToe(e.target.files); e.target.value = ''; });
  $('dropzone').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('bestand-shot').click(); } });
  var sleepTeller = 0;
  window.addEventListener('dragenter', function (e) { if (heeftBestand(e)) { sleepTeller++; document.body.classList.add('slepen'); } });
  window.addEventListener('dragleave', function () { if (--sleepTeller <= 0) { sleepTeller = 0; document.body.classList.remove('slepen'); } });
  window.addEventListener('dragover', function (e) { if (heeftBestand(e)) e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    if (!heeftBestand(e)) return;
    e.preventDefault(); sleepTeller = 0; document.body.classList.remove('slepen');
    voegScreenshotsToe(e.dataTransfer.files);
  });
  function heeftBestand(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }

  // ---------- verzoek voor de webbouwer maken ----------
  var sjabloonCache = null;
  function sjabloon() {
    if (sjabloonCache) return Promise.resolve(sjabloonCache);
    return fetch('sjabloon.html', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('Sjabloon niet gevonden');
      return r.text();
    }).then(function (t) { sjabloonCache = t; return t; });
  }
  function exportData() {
    var nrs = nummers();
    var meta = staat.meta;
    return {
      titel: meta.titel, website: meta.website, datum: meta.datum, afzender: meta.afzender, ontvanger: meta.ontvanger, intro: meta.intro,
      paginas: staat.paginas.map(function (p) {
        return {
          pagina: p.pagina || 'Pagina', url: p.url,
          screenshots: [{
            bron: p.bron,
            markeringen: p.wijzigingen.filter(function (w) { return w.rect; }).map(function (w) {
              return { nr: nrs[w.id], x: w.rect.x, y: w.rect.y, b: w.rect.b, h: w.rect.h };
            })
          }],
          wijzigingen: p.wijzigingen.map(function (w) {
            return { nr: nrs[w.id], soort: w.soort, waar: w.waar, huidig: w.huidig, nieuw: w.nieuw, toelichting: w.toelichting };
          })
        };
      })
    };
  }
  function bouwHtml() {
    return sjabloon().then(function (t) {
      var json = JSON.stringify(exportData()).replace(/</g, '\\u003c');
      return t.replace('/*DATA*/', function () { return json; });
    });
  }
  function controleer() {
    if (!staat.paginas.length) { meld('Plak eerst een screenshot'); return false; }
    var leeg = 0;
    staat.paginas.forEach(function (p) { p.wijzigingen.forEach(function (w) { if (!w.nieuw && !w.huidig && !w.toelichting) leeg++; }); });
    if (leeg && !confirm(leeg + ' wijziging(en) zijn nog leeg. Toch doorgaan?')) return false;
    return true;
  }
  function bestandsnaam() {
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'wijzigingsverzoek-website-' + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + '.html';
  }

  $('btn-bekijk').addEventListener('click', function () {
    if (!staat.paginas.length) { meld('Plak eerst een screenshot'); return; }
    var venster = window.open('', '_blank');
    bouwHtml().then(function (html) {
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (venster) venster.location = url; else window.location = url;
    }).catch(function (e) { if (venster) venster.close(); meld(e.message); });
  });
  $('btn-download').addEventListener('click', function () {
    if (!controleer()) return;
    bouwHtml().then(function (html) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = bestandsnaam();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      meld('Gedownload. Voeg het bestand toe aan je mail aan de webbouwer.');
    }).catch(function (e) { meld(e.message); });
  });

  // ---------- eerder verzoek openen (ook verzoeken uit de Claude-skill) ----------
  $('btn-open').addEventListener('click', function () { $('bestand-open').click(); });
  $('bestand-open').addEventListener('change', function (e) {
    var f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then(function (tekst) {
      var m = tekst.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) throw new Error('Dit is geen wijzigingsverzoek');
      var d = JSON.parse(m[1]);
      if (staat.paginas.length && !confirm('Het huidige verzoek vervangen door "' + f.name + '"?')) return;
      staat = naarStaat(d); tekenDoel = null;
      vulMeta(); render(); bewaar(); meld('Verzoek geopend');
    }).catch(function (err) { meld(err.message); });
  });
  function naarStaat(d) {
    var s = {
      versie: 1,
      meta: { titel: d.titel || '', website: d.website || '', datum: d.datum || '', afzender: d.afzender || '', ontvanger: d.ontvanger || '', intro: d.intro || '' },
      paginas: []
    };
    (d.paginas || []).forEach(function (p) {
      var shots = (p.screenshots && p.screenshots.length) ? p.screenshots : [{ bron: '', markeringen: [] }];
      var gebruikt = {};
      shots.forEach(function (sh, si) {
        var pagina = { id: uid(), pagina: p.pagina || '', url: p.url || '', bron: sh.bron, wijzigingen: [] };
        var perNr = {};
        (sh.markeringen || []).forEach(function (mk) { perNr[mk.nr] = mk; });
        (p.wijzigingen || []).forEach(function (w) {
          var mk = perNr[w.nr];
          var hoortHier = mk || (si === 0 && !shots.some(function (x) { return (x.markeringen || []).some(function (y) { return y.nr === w.nr; }); }));
          if (!hoortHier || gebruikt[w.nr]) return;
          gebruikt[w.nr] = true;
          var nw = nieuweWijziging(mk ? { x: mk.x, y: mk.y, b: mk.b, h: mk.h } : null);
          nw.soort = w.soort || SOORTEN[0]; nw.waar = w.waar || ''; nw.huidig = w.huidig || ''; nw.nieuw = w.nieuw || ''; nw.toelichting = w.toelichting || '';
          pagina.wijzigingen.push(nw);
        });
        if (pagina.bron) s.paginas.push(pagina);
      });
    });
    return s;
  }

  $('btn-nieuw').addEventListener('click', function () {
    if (staat.paginas.length && !confirm('Nieuw verzoek beginnen? Het huidige verzoek wordt gewist (download het eerst als je het wilt bewaren).')) return;
    staat = leegStaat(staat); tekenDoel = null;
    vulMeta(); render(); bewaar();
  });

  // ---------- start ----------
  staat = leegStaat();
  vulMeta();
  laadOpslag().then(function (opgeslagen) {
    // niet overschrijven als er al geplakt is voordat de opslag geladen was
    if (opgeslagen && opgeslagen.versie === 1 && !staat.paginas.length) {
      staat = opgeslagen; vulMeta(); render();
      $('status').textContent = 'Bewaard in deze browser';
    }
  });
})();
