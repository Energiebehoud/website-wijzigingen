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
      versie: 1, id: uid(), gewijzigd: Date.now(),
      meta: {
        titel: 'Wijzigingsverzoek website', website: m.website || '', datum: vandaag(),
        afzender: m.afzender || '', ontvanger: m.ontvanger || '', intro: STANDAARD_INTRO
      },
      paginas: []
    };
  }

  // ---------- opslag in de browser (IndexedDB; screenshots passen niet in localStorage) ----------
  // Elk verzoek wordt apart bewaard in 'verzoeken' (sleutel = id); 'staat' onthoudt welk verzoek open was.
  var dbBelofte = null;
  function db() {
    if (!dbBelofte) {
      dbBelofte = new Promise(function (res, rej) {
        var r = indexedDB.open('wijzigingsverzoek', 2);
        r.onupgradeneeded = function () {
          var d = r.result, tx = r.transaction;
          if (!d.objectStoreNames.contains('staat')) d.createObjectStore('staat');
          if (!d.objectStoreNames.contains('verzoeken')) d.createObjectStore('verzoeken');
          // versie 1 bewaarde één verzoek onder 'huidig': overzetten naar de lijst
          var q = tx.objectStore('staat').get('huidig');
          q.onsuccess = function () {
            var oud = q.result;
            if (oud && oud.paginas) {
              oud.id = oud.id || uid(); oud.gewijzigd = oud.gewijzigd || Date.now();
              tx.objectStore('verzoeken').put(oud, oud.id);
              tx.objectStore('staat').put(oud.id, 'actief');
            }
            tx.objectStore('staat').delete('huidig');
          };
        };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    return dbBelofte;
  }
  function dbGet(store, sleutel) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var q = d.transaction(store).objectStore(store).get(sleutel);
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function dbAlles() {
    return db().then(function (d) {
      return new Promise(function (res) {
        var q = d.transaction('verzoeken').objectStore('verzoeken').getAll();
        q.onsuccess = function () { res(q.result || []); };
        q.onerror = function () { res([]); };
      });
    }).catch(function () { return []; });
  }
  function dbVerwijder(id) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction('verzoeken', 'readwrite');
        tx.objectStore('verzoeken').delete(id);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }
  function dbZet(store, waarde, sleutel) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction(store, 'readwrite');
        tx.objectStore(store).put(waarde, sleutel);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }

  // ---------- OneDrive: alle verzoeken op elke computer ----------
  // Elk verzoek staat als verzoek-<id>.json in de OneDrive-map. Lokaal (IndexedDB) blijft de werkkopie,
  // zodat de app ook zonder verbinding werkt. _etag/_gesynct onthouden welke versie in OneDrive staat.
  var cloud = { aan: false, naam: '', status: 'uit', melding: '', eersteSync: true };
  var BESTAND = function (id) { return 'verzoek-' + id + '.json'; };
  var ID_UIT = /^verzoek-([a-z0-9]+)\.json$/i;
  var INSTELLINGEN = 'instellingen.json';
  var pushTimers = {};
  var syncBezig = null, laatsteSync = 0;

  function schoon(s) {
    var c = {};
    Object.keys(s).forEach(function (k) { if (k.charAt(0) !== '_') c[k] = s[k]; });
    return c;
  }
  function isVuil(s) { return !s._etag || s.gewijzigd !== s._gesynct; }

  function zetCloud(status, melding) {
    cloud.status = status; cloud.melding = melding || '';
    var k = $('btn-cloud'), b = $('cloud-banner');
    if (!k) return;
    k.classList.toggle('primair', status === 'uit' || status === 'login');
    k.classList.toggle('waarschuwing', status === 'fout');
    k.disabled = status === 'laden';
    k.textContent = {
      laden: 'OneDrive...', uit: 'Koppel OneDrive', login: 'Opnieuw inloggen', bezig: 'OneDrive: bezig...',
      ok: 'OneDrive ✓', fout: 'OneDrive: fout'
    }[status] || 'OneDrive';
    k.title = status === 'ok'
      ? 'Gekoppeld met de OneDrive van ' + cloud.naam + (laatsteSync ? '. Laatst bijgewerkt om ' + new Date(laatsteSync).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '') + '. Klik om nu bij te werken.'
      : (melding || '');
    b.hidden = !(status === 'uit' || status === 'login');
    $('cloud-banner-tekst').textContent = status === 'login'
      ? 'De koppeling met OneDrive is verlopen. Log opnieuw in, dan worden je wijzigingen weer op al je computers bewaard.'
      : 'Koppel je OneDrive, dan staan al je verzoeken op elke computer klaar. Je logt eenmalig in met je Microsoft-account.';
    var afm = $('cloud-afmelden');
    if (afm) afm.textContent = cloud.aan ? 'Ontkoppelen' : 'Koppel OneDrive';
    var info = $('cloud-info');
    if (info) info.textContent = cloud.aan
      ? 'Je verzoeken staan in je OneDrive, map "' + OneDrive.map + '" (' + cloud.naam + ').'
      : 'Je verzoeken staan alleen in deze browser. Koppel OneDrive om ze op al je computers te hebben.';
  }
  function cloudFout(e) {
    console.warn('OneDrive', e);
    if (e && (e.code === 'OPNIEUW_INLOGGEN' || e.status === 401)) { zetCloud('login'); return; }
    if (e && e.code === 'NIET_AANGEMELD') { cloud.aan = false; zetCloud('uit'); return; }
    zetCloud('fout', 'OneDrive niet bereikbaar' + (e && e.status ? ' (' + e.status + ')' : '') + '. Je werk staat veilig in deze browser en wordt later bijgewerkt.');
  }

  function planPush(s) {
    if (!cloud.aan) return;
    clearTimeout(pushTimers[s.id]);
    pushTimers[s.id] = setTimeout(function () { push(s); }, 2500);
  }
  function push(s) {
    clearTimeout(pushTimers[s.id]); delete pushTimers[s.id];
    if (!cloud.aan || isLeeg(s) || !isVuil(s)) return Promise.resolve();
    var versie = s.gewijzigd;
    zetCloud('bezig');
    return OneDrive.schrijf(BESTAND(s.id), schoon(s)).then(function (etag) {
      s._etag = etag; s._gesynct = versie;
      return dbZet('verzoeken', s, s.id);
    }).then(function () { zetCloud('ok'); }, cloudFout);
  }

  function sync() {
    if (!cloud.aan) return Promise.resolve();
    if (syncBezig) return syncBezig;
    zetCloud('bezig');
    syncBezig = (bewaarTimer ? bewaarNu() : Promise.resolve()).then(function () {
      return Promise.all([OneDrive.lijst(), dbAlles(), dbGet('staat', 'verwijderd')]);
    }).then(function (r) {
      var remote = {}, lokaal = {}, weg = r[2] || [], instellingen = null, taken = [];
      r[0].forEach(function (i) {
        var m = i.naam.match(ID_UIT);
        if (m) remote[m[1]] = i; else if (i.naam === INSTELLINGEN) instellingen = i;
      });
      r[1].forEach(function (v) { lokaal[v.id] = v; });

      // verwijderd op deze computer: ook in OneDrive weghalen
      weg.forEach(function (id) {
        if (remote[id]) taken.push(OneDrive.verwijder(BESTAND(id)));
        delete remote[id]; delete lokaal[id];
      });

      Object.keys(lokaal).forEach(function (id) {
        var l = id === staat.id ? staat : lokaal[id], rem = remote[id];
        if (!rem) {
          // was al eens in OneDrive en is daar weg: op een andere computer verwijderd
          if (l._etag && !isVuil(l)) {
            taken.push(dbVerwijder(id).then(function () {
              if (id === staat.id) {
                staat = leegStaat(staat); tekenDoel = null; vulMeta(); render(); bewaarNu();
                meld('Dit verzoek is op een andere computer verwijderd');
              }
            }));
          }
          // nog niet bewaarde wijzigingen hier: niet weggooien, opnieuw in OneDrive zetten
          else if (!isLeeg(l)) { delete l._etag; taken.push(push(l)); }
          return;
        }
        if (rem.etag === l._etag) { if (isVuil(l)) taken.push(push(l)); return; }
        // op een andere computer gewijzigd: nieuwste versie wint
        taken.push(OneDrive.lees(rem).then(function (d) {
          var nu = id === staat.id ? staat : l;
          if (isVuil(nu) && (nu.gewijzigd || 0) > (d.gewijzigd || 0)) { nu._etag = rem.etag; return push(nu); }
          d._etag = rem.etag; d._gesynct = d.gewijzigd;
          clearTimeout(pushTimers[d.id]); delete pushTimers[d.id]; // geen oude versie meer wegschrijven
          return dbZet('verzoeken', d, d.id).then(function () {
            if (d.id === staat.id) { staat = d; tekenDoel = null; vulMeta(); render(); meld('Bijgewerkt met de versie van een andere computer'); }
          });
        }));
      });

      Object.keys(remote).forEach(function (id) {
        if (lokaal[id]) return;
        taken.push(OneDrive.lees(remote[id]).then(function (d) {
          d._etag = remote[id].etag; d._gesynct = d.gewijzigd;
          return dbZet('verzoeken', d, d.id);
        }));
      });

      // API-sleutel van een andere computer overnemen als hier nog geen sleutel is
      if (instellingen && !leesSleutel()) {
        taken.push(OneDrive.lees(instellingen).then(function (i) { if (i && i.anthropicKey) zetSleutel(i.anthropicKey); }));
      }
      return Promise.all(taken).then(function () { if (weg.length) return dbZet('staat', [], 'verwijderd'); });
    }).then(function () {
      laatsteSync = Date.now(); zetCloud('ok');
      // nieuwe computer: open het laatst bewerkte verzoek in plaats van een leeg verzoek
      if (cloud.eersteSync && isLeeg(staat)) {
        return dbAlles().then(function (lijst) {
          var beste = lijst.filter(function (v) { return !isLeeg(v); })
            .sort(function (a, b) { return (b.gewijzigd || 0) - (a.gewijzigd || 0); })[0];
          if (beste) return wisselNaar(beste).then(function () { meld('Laatst bewerkte verzoek geopend'); });
        });
      }
    }, cloudFout).then(function () { cloud.eersteSync = false; syncBezig = null; });
    return syncBezig;
  }

  function verwijderVerzoek(id) {
    return dbGet('staat', 'verwijderd').then(function (weg) {
      weg = weg || [];
      if (weg.indexOf(id) < 0) weg.push(id);
      return dbZet('staat', weg, 'verwijderd');
    }).then(function () { return dbVerwijder(id); }).then(function () { if (cloud.aan) sync(); });
  }
  function sleutelNaarCloud(sleutel) {
    if (cloud.aan) OneDrive.schrijf(INSTELLINGEN, { anthropicKey: sleutel || '' }).catch(cloudFout);
  }

  function startCloud() {
    if (!window.OneDrive) return;
    zetCloud('laden');
    OneDrive.init().then(function (a) {
      if (!a) { zetCloud('uit'); return; }
      cloud.aan = true; cloud.naam = a.name || a.username || '';
      return sync();
    }).catch(function (e) { console.warn('OneDrive', e); zetCloud('uit'); });
  }
  function koppel() {
    zetCloud('laden');
    (bewaarTimer ? bewaarNu() : Promise.resolve()).then(function () { return OneDrive.login(); })
      .catch(function (e) { cloudFout(e); meld('Inloggen lukte niet'); });
  }
  window.addEventListener('focus', function () { if (cloud.aan && Date.now() - laatsteSync > 20000) sync(); });
  var bewaarTimer = null;
  function bewaar() {
    staat.gewijzigd = Date.now();
    $('status').textContent = 'Opslaan...';
    clearTimeout(bewaarTimer);
    bewaarTimer = setTimeout(bewaarNu, 400);
  }
  function bewaarNu() {
    clearTimeout(bewaarTimer); bewaarTimer = null;
    var s = staat;
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction(['verzoeken', 'staat'], 'readwrite');
        tx.objectStore('verzoeken').put(s, s.id);
        tx.objectStore('staat').put(s.id, 'actief');
        tx.oncomplete = function () { $('status').textContent = 'Opgeslagen'; planPush(s); res(); };
        tx.onerror = function () { $('status').textContent = 'Niet opgeslagen: download het verzoek als back-up'; res(); };
      });
    }).catch(function () { $('status').textContent = 'Browseropslag niet beschikbaar'; });
  }
  // openstaande wijziging direct wegschrijven als het tabblad sluit of naar de achtergrond gaat
  document.addEventListener('visibilitychange', function () { if (document.hidden && bewaarTimer) bewaarNu(); });
  window.addEventListener('pagehide', function () { if (bewaarTimer) bewaarNu(); });
  // vraag de browser de opslag niet op te ruimen bij ruimtegebrek
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  function wisselNaar(nieuw) {
    var klaar = bewaarTimer ? bewaarNu() : Promise.resolve();
    return klaar.then(function () {
      staat = nieuw; tekenDoel = null;
      vulMeta(); render(); return bewaarNu();
    });
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
    var nieuwVeld = invoer(w, 'nieuw', 'nieuw', 'Wat er moet komen te staan (leeg laten bij verwijderen)', 3);
    l2.appendChild(nieuwVeld); k.appendChild(l2);
    var herschrijf = el('div', 'herschrijf');
    herschrijf.appendChild(knop('Herschrijven', 'klein ai', 'Laat Claude de nieuwe tekst in correct Nederlands en de juiste vorm zetten', function (e) {
      herschrijfTekst(staatPagina(w.id), w, nieuwVeld, herschrijf, e.currentTarget);
    }));
    k.appendChild(herschrijf);
    var l3 = el('details', 'toel-blok');
    if (w.toelichting) l3.open = true;
    l3.appendChild(el('summary', null, 'Toelichting (optioneel)'));
    var toel = invoer(w, 'toelichting', 'toel', 'Bijv. zelfde opmaak houden, link naar /offerte', 2);
    toel.setAttribute('aria-label', 'Toelichting');
    l3.appendChild(toel);
    l3.addEventListener('toggle', function () { if (l3.open) toel.focus({ preventScroll: true }); });
    k.appendChild(l3);

    k.addEventListener('mouseenter', function () { markeer(w.id, true); });
    k.addEventListener('mouseleave', function () { markeer(w.id, false); });
    return k;
  }

  function staatPagina(id) { var f = zoekWijziging(id); return f ? f.p : null; }

  // ---------- tekst herschrijven met Claude (sleutel van de gebruiker, alleen in deze browser) ----------
  var SLEUTEL = 'ww_anthropic_key';
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
  var SYSTEEM = [
    'Je bent eindredacteur van websiteteksten voor Energiebehoud BV en Labellift (energielabels, maatwerkadvies en verduurzaming van woningen).',
    'Je krijgt een nieuwe tekst die op een webpagina moet komen. Herschrijf die in correct, natuurlijk Nederlands en in de juiste vorm voor die plek op de pagina.',
    'Stijl: nuchter, vakkundig en warm. Gewone taal, korte zinnen, de lezer aanspreken met je/jij. Geen verkooppraat, geen overdreven bijvoeglijke naamwoorden, geen uitroeptekens, geen emoji, geen gedachtestreepjes.',
    'Behoud de betekenis en alle feiten (bedragen, termijnen, namen, labels). Verzin niets bij.',
    'Vorm: een kop wordt een korte kop zonder punt; een knoptekst wordt een korte actie (bijv. "Vraag een offerte aan"); een alinea blijft een alinea. Houd de lengte vergelijkbaar met de huidige tekst, tenzij de toelichting iets anders vraagt. Behoud regelafbrekingen en opsommingen.',
    'Geef alleen de herschreven tekst terug, zonder aanhalingstekens, uitleg of inleiding.'
  ].join('\n');

  function leesSleutel() { try { return localStorage.getItem(SLEUTEL) || ''; } catch (e) { return ''; } }
  function zetSleutel(v) { try { if (v) localStorage.setItem(SLEUTEL, v); else localStorage.removeItem(SLEUTEL); } catch (e) {} }

  var sdkBelofte = null;
  function claude() {
    var sleutel = leesSleutel();
    if (!sleutel) return Promise.reject(new Error('GEEN_SLEUTEL'));
    if (!sdkBelofte) sdkBelofte = import(SDK_URL).catch(function (e) { sdkBelofte = null; throw e; });
    return sdkBelofte.then(function (mod) {
      var Anthropic = mod.default || mod.Anthropic;
      return new Anthropic({ apiKey: sleutel, dangerouslyAllowBrowser: true });
    });
  }

  function vraagVoor(p, w) {
    var regels = [];
    if (p && p.pagina) regels.push('Pagina: ' + p.pagina);
    if (p && p.url) regels.push('Adres: ' + p.url);
    regels.push('Soort wijziging: ' + (w.soort || 'Tekst vervangen'));
    if (w.waar) regels.push('Plek op de pagina: ' + w.waar);
    if (w.huidig) regels.push('Huidige tekst op de website:\n<huidig>\n' + w.huidig + '\n</huidig>');
    if (w.toelichting) regels.push('Toelichting van de opdrachtgever:\n<toelichting>\n' + w.toelichting + '\n</toelichting>');
    regels.push('Nieuwe tekst om te herschrijven:\n<nieuw>\n' + w.nieuw + '\n</nieuw>');
    return regels.join('\n\n');
  }

  function herschrijfTekst(p, w, veld, bak, knopEl) {
    if (!w.nieuw || !w.nieuw.trim()) { meld('Typ eerst een nieuwe tekst'); veld.focus(); return; }
    knopEl.disabled = true; knopEl.textContent = 'Bezig...';
    var oud = bak.querySelector('.voorstel'); if (oud) oud.remove();
    claude().then(function (client) {
      return client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 4000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEEM,
        messages: [{ role: 'user', content: vraagVoor(p, w) }]
      });
    }).then(function (antwoord) {
      if (antwoord.stop_reason === 'refusal') throw new Error('Claude wilde deze tekst niet herschrijven');
      var tekst = antwoord.content.filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; }).join('').trim()
        .replace(/^<nieuw>\s*|\s*<\/nieuw>$/g, '');
      if (!tekst) throw new Error('Geen tekst ontvangen');
      toonVoorstel(w, veld, bak, tekst);
    }).catch(function (e) {
      if (e && e.message === 'GEEN_SLEUTEL') { openSleutel(); meld('Vul eerst je Claude API-sleutel in'); return; }
      var status = e && e.status;
      if (status === 401) { meld('De API-sleutel klopt niet. Controleer hem bij AI-instellingen.'); openSleutel(); }
      else if (status === 429) meld('Even te veel verzoeken. Probeer het over een minuut opnieuw.');
      else if (status === 400 && /credit/i.test(e.message || '')) meld('Je API-tegoed is op. Waardeer het op in de Claude Console.');
      else meld('Herschrijven mislukt: ' + ((e && e.message) || 'onbekende fout'));
    }).then(function () {
      knopEl.disabled = false; knopEl.textContent = 'Herschrijven';
    });
  }

  function toonVoorstel(w, veld, bak, tekst) {
    var v = el('div', 'voorstel');
    v.appendChild(el('div', 'voorstel-kop', 'Voorstel'));
    v.appendChild(el('div', 'voorstel-tekst', tekst));
    var acties = el('div', 'voorstel-acties');
    acties.appendChild(knop('Overnemen', 'klein primair', null, function () {
      w.nieuw = tekst; veld.value = tekst; bewaar(); v.remove(); meld('Nieuwe tekst overgenomen');
      if (!document.body.contains(veld)) render();
    }));
    acties.appendChild(knop('Nog een keer', 'klein', null, function (e) {
      herschrijfTekst(staatPagina(w.id), w, veld, bak, bak.querySelector('button.ai'));
    }));
    acties.appendChild(knop('Niet gebruiken', 'klein', null, function () { v.remove(); }));
    v.appendChild(acties);
    bak.appendChild(v);
  }

  function openSleutel() {
    $('ai-sleutel').value = leesSleutel();
    $('ai-status').textContent = leesSleutel() ? 'Er is een sleutel opgeslagen in deze browser.' : 'Nog geen sleutel opgeslagen.';
    if (!$('ai-instellingen').open) $('ai-instellingen').showModal();
  }
  $('btn-ai').addEventListener('click', openSleutel);
  $('ai-sluit').addEventListener('click', function () { $('ai-instellingen').close(); });
  $('ai-wis').addEventListener('click', function () {
    zetSleutel(''); sleutelNaarCloud(''); $('ai-sleutel').value = ''; $('ai-status').textContent = 'Sleutel verwijderd.';
  });
  $('ai-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('ai-sleutel').value.trim();
    if (!v) return;
    zetSleutel(v); sleutelNaarCloud(v);
    $('ai-status').textContent = 'Testen...';
    claude().then(function (client) {
      return client.models.retrieve('claude-opus-5-5');
    }).then(function () {
      $('ai-status').textContent = 'Werkt. De sleutel is opgeslagen in deze browser.';
    }).catch(function (er) {
      $('ai-status').textContent = er && er.status === 401 ? 'Deze sleutel wordt niet geaccepteerd.' : 'Opgeslagen, maar testen lukte niet: ' + ((er && er.message) || er);
    });
  });

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
      // geopend bestand wordt een eigen verzoek in de lijst; het huidige blijft bewaard
      return wisselNaar(naarStaat(d)).then(function () { meld('Verzoek geopend en opgeslagen'); });
    }).catch(function (err) { meld(err.message); });
  });
  function naarStaat(d) {
    var s = {
      versie: 1, id: uid(), gewijzigd: Date.now(),
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

  function isLeeg(s) { return !s.paginas.length; }

  $('btn-nieuw').addEventListener('click', function () {
    if (isLeeg(staat)) { meld('Dit verzoek is nog leeg'); return; }
    wisselNaar(leegStaat(staat)).then(function () { meld('Nieuw verzoek. Het vorige staat bij Mijn verzoeken.'); });
  });

  // ---------- mijn verzoeken ----------
  function tijdTekst(t) {
    return new Date(t).toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toonVerzoeken(zonderSync) {
    // eerst direct de lijst tonen, daarna bijwerken met wat er in OneDrive staat
    if (!zonderSync && cloud.aan) sync().then(function () { if ($('verzoeken').open) toonVerzoeken(true); });
    var klaar = bewaarTimer ? bewaarNu() : Promise.resolve();
    klaar.then(dbAlles).then(function (lijst) {
      lijst = lijst.filter(function (v) { return v.id === staat.id || !isLeeg(v); })
        .sort(function (a, b) { return (b.gewijzigd || 0) - (a.gewijzigd || 0); });
      var ul = $('verzoeken-lijst'); ul.innerHTML = '';
      if (!lijst.length) ul.appendChild(el('li', 'leeg-kaarten', 'Nog geen verzoeken bewaard.'));
      lijst.forEach(function (v) {
        var li = el('li', 'verzoek' + (v.id === staat.id ? ' huidig' : ''));
        var info = el('div', 'verzoek-info');
        var aantal = v.paginas.reduce(function (n, p) { return n + p.wijzigingen.length; }, 0);
        var namen = v.paginas.map(function (p) { return p.pagina || 'Pagina'; }).join(', ');
        info.appendChild(el('strong', null, (v.meta.titel || 'Wijzigingsverzoek') + (v.id === staat.id ? ' (open)' : '')));
        info.appendChild(el('span', null, [v.meta.website, namen].filter(Boolean).join(' · ')));
        info.appendChild(el('span', null, v.paginas.length + (v.paginas.length === 1 ? ' pagina, ' : " pagina's, ") +
          aantal + (aantal === 1 ? ' wijziging' : ' wijzigingen') + ' · laatst bewerkt ' + tijdTekst(v.gewijzigd || 0)));
        li.appendChild(info);
        var acties = el('div', 'verzoek-acties');
        if (v.id !== staat.id) {
          acties.appendChild(knop('Openen', 'klein primair', null, function () {
            wisselNaar(v).then(function () { $('verzoeken').close(); meld('Verzoek geopend'); });
          }));
        }
        acties.appendChild(knop('Verwijderen', 'klein gevaar', null, function () {
          if (!confirm('"' + (v.meta.titel || 'Wijzigingsverzoek') + '" definitief verwijderen?')) return;
          verwijderVerzoek(v.id).then(function () {
            if (v.id === staat.id) { staat = leegStaat(staat); vulMeta(); render(); bewaarNu(); }
            toonVerzoeken();
          });
        }));
        li.appendChild(acties);
        ul.appendChild(li);
      });
      if (!$('verzoeken').open) $('verzoeken').showModal();
    });
  }
  $('btn-verzoeken').addEventListener('click', toonVerzoeken);
  $('verzoeken-sluit').addEventListener('click', function () { $('verzoeken').close(); });

  // ---------- start ----------
  staat = leegStaat();
  vulMeta();
  dbGet('staat', 'actief').then(function (id) { return id ? dbGet('verzoeken', id) : null; }).then(function (opgeslagen) {
    // niet overschrijven als er al geplakt is voordat de opslag geladen was
    if (opgeslagen && opgeslagen.versie === 1 && isLeeg(staat)) {
      staat = opgeslagen; vulMeta(); render();
      $('status').textContent = 'Opgeslagen';
      cloud.eersteSync = false;
    }
  }).then(startCloud);
  $('btn-cloud').addEventListener('click', function () {
    if (cloud.status === 'uit' || cloud.status === 'login') koppel(); else if (cloud.aan) sync();
  });
  $('cloud-koppel').addEventListener('click', koppel);
  $('cloud-afmelden').addEventListener('click', function () {
    if (!cloud.aan) { koppel(); return; }
    if (!confirm('OneDrive ontkoppelen op deze computer? Je verzoeken blijven in OneDrive en in deze browser staan.')) return;
    (bewaarTimer ? bewaarNu() : Promise.resolve()).then(function () { return OneDrive.logout(); }).then(function () {
      cloud.aan = false; cloud.naam = ''; zetCloud('uit'); meld('OneDrive ontkoppeld op deze computer');
    }).catch(cloudFout);
  });
})();
