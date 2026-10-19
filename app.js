(function () {
  'use strict';

  // ── Roterende natuurfoto-achtergrond (wisselt elke 3 uur) ──
  (function () {
    var fotos = [
      'photo-1506744038136-46273834b3fb', // bergmeer
      'photo-1470071459604-3b5ec3a7fe05', // mistige heuvels
      'photo-1441974231531-c6227db76b6e', // bospad zonlicht
      'photo-1472214103451-9374bd1c798e', // groen dal
      'photo-1465146344425-f00d5f5c8f07', // bloemenveld
      'photo-1501854140801-50d01698950b', // herfstbos
      'photo-1518173946687-a544bf38a58a', // ochtenddauw
      'photo-1507003211169-0a1dd7228f2d', // kustlijn
      'photo-1464822759023-fed622ff2c3b', // bergtoppen
      'photo-1469474968028-56623f02e42e', // zonsondergang heuvels
      'photo-1426604966848-d7adac402bff', // lavendelveld
      'photo-1500534314263-0869cef34a40'  // meeuw kust
    ];
    var uur = Math.floor(Date.now() / (3 * 3600000));
    var foto = fotos[uur % fotos.length];
    var url = 'https://images.unsplash.com/' + foto + '?w=1920&q=75&auto=format&fit=crop';
    var img = new Image();
    img.onload = function () { document.documentElement.style.setProperty('--natuur-foto', 'url(' + url + ')'); };
    img.src = url;
  })();

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
    zetCloud('fout', 'OneDrive niet bereikbaar' + (e && e.status ? ' (' + e.status + ')' : '') + '. ' + uitleg(e) + 'Je werk staat veilig in deze browser en wordt later bijgewerkt.');
  }
  // Leesbare reden bij een fout van Microsoft, zodat je ziet wat er mis is in plaats van alleen "fout".
  function uitleg(e) {
    var t = String((e && (e.errorMessage || e.message)) || '') + ' ' + String((e && e.errorCode) || '');
    if (/AADSTS50011|redirect_uri|redirect uri/i.test(t)) return 'Het adres van deze app staat niet als redirect-URI in de Azure-app-registratie. ';
    if (/AADSTS65001|consent/i.test(t)) return 'De rechten voor OneDrive zijn nog niet goedgekeurd in Azure. ';
    if (e && e.status === 403) return 'Microsoft geeft geen toegang tot OneDrive (403). Controleer de API-rechten (Files.ReadWrite.All). ';
    var kort = t.trim().split(/\r?\n/)[0];
    return kort ? 'Melding: ' + kort.slice(0, 200) + '. ' : '';
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

      // Instellingen (API-sleutel + tooltips) van een andere computer overnemen
      if (instellingen) {
        taken.push(OneDrive.lees(instellingen).then(function (i) {
          if (!i) return;
          if (i.anthropicKey && !leesSleutel()) zetSleutel(i.anthropicKey);
          if (i.tooltips && window.Tips && !Object.keys(Tips.leesRuw()).length) Tips.schrijf(i.tooltips);
        }));
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
  function instellingenNaarCloud() {
    if (!cloud.aan) return;
    var obj = { anthropicKey: leesSleutel() || '' };
    var tips = window.Tips ? Tips.leesRuw() : {};
    if (Object.keys(tips).length) obj.tooltips = tips;
    OneDrive.schrijf(INSTELLINGEN, obj).catch(cloudFout);
  }
  function sleutelNaarCloud(sleutel) { instellingenNaarCloud(); }
  function tooltipsNaarCloud() { instellingenNaarCloud(); }

  function startCloud() {
    if (!window.OneDrive) return;
    zetCloud('laden');
    OneDrive.init().then(function (a) {
      if (!a) { zetCloud('uit'); return; }
      cloud.aan = true; cloud.naam = a.name || a.username || '';
      return sync();
    }).catch(function (e) {
      // terugkeer van Microsoft met een foutmelding: laten zien in plaats van stil op "uit" zetten
      console.warn('OneDrive', e);
      if (/[?#&](error|code)=/.test(location.search + location.hash) || (e && /AADSTS/.test(e.errorMessage || e.message || ''))) {
        cloudFout(e); meld('Inloggen bij Microsoft lukte niet. ' + uitleg(e));
      } else zetCloud('uit');
    });
  }
  function koppel() {
    zetCloud('laden');
    (bewaarTimer ? bewaarNu() : Promise.resolve()).then(function () { return OneDrive.login(); })
      .catch(function (e) { cloudFout(e); meld('Inloggen lukte niet. ' + uitleg(e)); });
  }
  window.addEventListener('focus', function () { if (cloud.aan && Date.now() - laatsteSync > 20000) sync(); });
  window.addEventListener('storage', function (e) { if (e.key === 'ww_tooltips') instellingenNaarCloud(); });
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
    if (window.Tips) Tips.koppel();
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
    var kolom = el('div', 'shot-kolom'); kolom.dataset.tip = 'screenshot';
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

    var kaarten = el('div', 'kaarten'); kaarten.dataset.tip = 'kaarten';
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
  function bestandsnaam(ext) {
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'wijzigingsverzoek-website-' + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + '.' + (ext || 'html');
  }
  function downloadBlob(blob, naam) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = naam;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
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
      downloadBlob(new Blob([html], { type: 'text/html' }), bestandsnaam('html'));
      meld('Gedownload. Voeg het bestand toe aan je mail aan de webbouwer.');
    }).catch(function (e) { meld(e.message); });
  });

  // ---------- PDF: voor webbouwers die een HTML-bijlage niet kunnen openen ----------
  // Echte tekst (selecteerbaar en kopieerbaar), screenshots met de rode kaders erin getekend.
  var JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
  var M = 15, INHOUD = 180, BOVEN = 16, ONDER = 282, LH = 4.6; // A4 in mm; LH = regelhoogte bij 10 pt
  var KLEUR = { tekst: [29, 36, 32], zacht: [91, 102, 95], lijn: [217, 223, 219], vlak: [244, 246, 245], merk: [47, 107, 58],
    oud: [138, 47, 47], oudVlak: [251, 240, 240], nieuwVlak: [238, 246, 239], marker: [224, 38, 43] };
  var jspdfBelofte = null;
  function jspdf() {
    if (!jspdfBelofte) {
      jspdfBelofte = import(JSPDF_URL).then(function (m) { return m.jsPDF || (m.default && m.default.jsPDF) || m.default; })
        .catch(function (e) { jspdfBelofte = null; throw e; });
    }
    return jspdfBelofte;
  }
  // De standaardletters van een PDF kennen alleen West-Europese tekens: de rest omzetten of weglaten.
  var WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  var VERVANG = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'v', '✔': 'v', ' ': ' ' };
  function pdfTekst(s) {
    return String(s || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[^\n\x20-\xff]/g, function (c) {
      if (WINANSI.indexOf(c) >= 0) return c;
      return VERVANG[c] != null ? VERVANG[c] : '';
    });
  }
  function kleur(doc, soort, k) {
    if (soort === 'tekst') doc.setTextColor(k[0], k[1], k[2]);
    else if (soort === 'vul') doc.setFillColor(k[0], k[1], k[2]);
    else doc.setDrawColor(k[0], k[1], k[2]);
  }
  function letter(doc, stijl, grootte) { doc.setFont('helvetica', stijl); doc.setFontSize(grootte); }
  function nieuweBlz(doc, pos) { doc.addPage(); pos.y = BOVEN; }

  function laadBeeld(bron) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Screenshot niet te laden')); };
      img.src = bron;
    });
  }
  // Screenshot met de genummerde kaders erin getekend, zoals in de HTML-weergave.
  function metKaders(img, markeringen) {
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    var s = c.width / (c.width < 1000 ? 450 : 900); // mobiel wordt smaller afgedrukt, dus relatief dikkere lijnen
    markeringen.forEach(function (m) {
      var x = m.x / 100 * c.width, y = m.y / 100 * c.height, b = m.b / 100 * c.width, h = m.h / 100 * c.height;
      ctx.lineWidth = 7 * s; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.strokeRect(x, y, b, h);
      ctx.lineWidth = 3 * s; ctx.strokeStyle = '#e0262b'; ctx.strokeRect(x, y, b, h);
      var r = 13 * s, cx = Math.max(x, r + 2 * s), cy = Math.max(y, r + 2 * s);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e0262b'; ctx.fill();
      ctx.lineWidth = 2 * s; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(14 * s) + 'px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(m.nr), cx, cy + s);
    });
    return c;
  }
  // Lange (hele-pagina-)screenshots worden over meerdere PDF-pagina's verdeeld.
  function tekenScreenshot(doc, pos, c) {
    var breedte = c.width < 1000 ? 90 : INHOUD;
    var schaal = breedte / c.width, x = M + (INHOUD - breedte) / 2, boven = 0;
    while (boven < c.height) {
      var ruimte = ONDER - pos.y, rest = (c.height - boven) * schaal;
      if (rest > ruimte && ruimte < 50) { nieuweBlz(doc, pos); ruimte = ONDER - pos.y; }
      var stukPx = Math.min(c.height - boven, Math.floor(ruimte / schaal));
      var stuk = document.createElement('canvas');
      stuk.width = c.width; stuk.height = stukPx;
      stuk.getContext('2d').drawImage(c, 0, boven, c.width, stukPx, 0, 0, c.width, stukPx);
      var h = stukPx * schaal;
      doc.addImage(stuk.toDataURL('image/jpeg', 0.85), 'JPEG', x, pos.y, breedte, h);
      kleur(doc, 'lijn', KLEUR.lijn); doc.setLineWidth(0.2); doc.rect(x, pos.y, breedte, h);
      pos.y += h; boven += stukPx;
    }
    pos.y += 6;
  }
  // Eén of twee tekstvakken naast elkaar; lopen ze over de pagina heen, dan gaan ze verder op de volgende.
  function tekenVakken(doc, pos, vakken) {
    var breedte = INHOUD / vakken.length;
    letter(doc, 'normal', 10);
    vakken.forEach(function (v) { v.regels = doc.splitTextToSize(pdfTekst(v.tekst), breedte - 6); });
    var n = Math.max.apply(null, vakken.map(function (v) { return v.regels.length; }));
    var i = 0, eerste = true;
    while (i < n) {
      var kop = eerste ? 7 : 2.5;
      var past = Math.floor((ONDER - pos.y - kop - 2.5) / LH);
      if (past < 1) { nieuweBlz(doc, pos); continue; }
      var aantal = Math.min(n - i, past), h = kop + aantal * LH + 2.5;
      vakken.forEach(function (v, j) {
        var x = M + j * breedte;
        kleur(doc, 'vul', v.vlak); doc.rect(x, pos.y, breedte, h, 'F');
        if (j > 0) { kleur(doc, 'lijn', KLEUR.lijn); doc.setLineWidth(0.2); doc.line(x, pos.y, x, pos.y + h); }
        if (eerste) { letter(doc, 'bold', 7.5); kleur(doc, 'tekst', KLEUR.zacht); doc.text(v.titel, x + 3, pos.y + 4.8); }
        letter(doc, v.leeg ? 'italic' : 'normal', 10); kleur(doc, 'tekst', v.leeg ? KLEUR.zacht : v.kleur);
        v.regels.slice(i, i + aantal).forEach(function (r, ri) { doc.text(r, x + 3, pos.y + kop + (ri + 1) * LH - 1.3); });
      });
      pos.y += h; i += aantal; eerste = false;
    }
  }
  function tekenWijziging(doc, pos, w) {
    letter(doc, 'normal', 9);
    var waar = w.waar ? doc.splitTextToSize(pdfTekst(w.waar), INHOUD - 18) : [];
    var kopH = 10 + waar.length * 4;
    if (pos.y + kopH + 7 + 3 * LH + 3 > ONDER) nieuweBlz(doc, pos); // kop niet los onderaan een pagina
    kleur(doc, 'vul', KLEUR.vlak); doc.rect(M, pos.y, INHOUD, kopH, 'F');
    kleur(doc, 'vul', KLEUR.marker); doc.circle(M + 6.5, pos.y + 5, 3.4, 'F');
    letter(doc, 'bold', 10); kleur(doc, 'tekst', [255, 255, 255]);
    doc.text(String(w.nr), M + 6.5, pos.y + 6.3, { align: 'center' });
    letter(doc, 'bold', 10.5); kleur(doc, 'tekst', KLEUR.tekst);
    doc.text(pdfTekst(w.soort || 'Wijziging'), M + 13, pos.y + 6.4);
    letter(doc, 'normal', 9); kleur(doc, 'tekst', KLEUR.zacht);
    waar.forEach(function (r, i) { doc.text(r, M + 13, pos.y + 10.6 + i * 4); });
    pos.y += kopH;
    tekenVakken(doc, pos, [
      { titel: 'HUIDIGE TEKST', tekst: w.huidig || '(nieuw toe te voegen)', leeg: !w.huidig, vlak: KLEUR.oudVlak, kleur: KLEUR.oud },
      { titel: 'NIEUWE TEKST', tekst: w.nieuw || '(verwijderen)', leeg: !w.nieuw, vlak: KLEUR.nieuwVlak, kleur: KLEUR.tekst }
    ]);
    if (w.toelichting) {
      kleur(doc, 'lijn', KLEUR.lijn); doc.setLineWidth(0.2); doc.line(M, pos.y, M + INHOUD, pos.y);
      tekenVakken(doc, pos, [{ titel: 'TOELICHTING', tekst: w.toelichting, vlak: [255, 255, 255], kleur: KLEUR.tekst }]);
    }
    pos.y += 5;
  }
  function tekenRegels(doc, pos, tekst, stijl, grootte, k, regelH) {
    letter(doc, stijl, grootte); kleur(doc, 'tekst', k);
    doc.splitTextToSize(pdfTekst(tekst), INHOUD).forEach(function (r) {
      if (pos.y + regelH > ONDER) nieuweBlz(doc, pos);
      pos.y += regelH; doc.text(r, M, pos.y);
    });
  }

  function maakPdf() {
    var d = exportData();
    var titel = d.titel || 'Wijzigingsverzoek website';
    return jspdf().then(function (JsPDF) {
      var doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
      doc.setProperties({ title: pdfTekst(titel), author: pdfTekst(d.afzender), subject: 'Wijzigingsverzoek website' });
      var pos = { y: BOVEN - 4 };

      // kop
      tekenRegels(doc, pos, titel, 'bold', 20, KLEUR.tekst, 8);
      var meta = [];
      if (d.website) meta.push('Website: ' + d.website);
      if (d.datum) meta.push('Datum: ' + d.datum);
      if (d.afzender) meta.push('Van: ' + d.afzender);
      if (d.ontvanger) meta.push('Aan: ' + d.ontvanger);
      pos.y += 1.5;
      if (meta.length) tekenRegels(doc, pos, meta.join('     '), 'normal', 9.5, KLEUR.zacht, 4.6);
      pos.y += 4; kleur(doc, 'lijn', KLEUR.merk); doc.setLineWidth(0.8); doc.line(M, pos.y, M + INHOUD, pos.y); pos.y += 3;
      if (d.intro) { tekenRegels(doc, pos, d.intro, 'normal', 10, KLEUR.tekst, LH); pos.y += 3; }

      // overzicht
      var totaal = 0;
      d.paginas.forEach(function (p) { totaal += p.wijzigingen.length; });
      letter(doc, 'normal', 9.5);
      var lijst = [];
      d.paginas.forEach(function (p, i) {
        var nrs = p.wijzigingen.map(function (w) { return w.nr; }).join(', ');
        lijst = lijst.concat(doc.splitTextToSize(pdfTekst((i + 1) + '. ' + p.pagina + (nrs ? ' (nr. ' + nrs + ')' : '')), INHOUD - 10));
      });
      var ovH = 10 + lijst.length * 4.4 + 2;
      pos.y += 3;
      if (pos.y + ovH > ONDER) nieuweBlz(doc, pos);
      kleur(doc, 'vul', KLEUR.vlak); doc.roundedRect(M, pos.y, INHOUD, ovH, 2, 2, 'F');
      letter(doc, 'bold', 10); kleur(doc, 'tekst', KLEUR.tekst);
      doc.text(totaal + (totaal === 1 ? ' wijziging' : ' wijzigingen') + ' op ' + d.paginas.length + (d.paginas.length === 1 ? ' pagina' : " pagina's"), M + 5, pos.y + 6.5);
      letter(doc, 'normal', 9.5);
      lijst.forEach(function (r, i) { doc.text(r, M + 5, pos.y + 11.5 + i * 4.4); });
      pos.y += ovH + 8;

      // pagina's: elke pagina begint op een nieuw blad, behalve de eerste als die nog past
      return d.paginas.reduce(function (vorige, p, pi) {
        return vorige.then(function () {
          if (pi > 0 || pos.y > ONDER - 80) nieuweBlz(doc, pos);
          tekenRegels(doc, pos, p.pagina, 'bold', 15, KLEUR.tekst, 6.5);
          if (p.url) {
            letter(doc, 'normal', 9); kleur(doc, 'tekst', KLEUR.merk);
            doc.splitTextToSize(pdfTekst(p.url), INHOUD).forEach(function (r) { pos.y += 4.4; doc.textWithLink(r, M, pos.y, { url: p.url }); });
          }
          pos.y += 5;
          return p.screenshots.filter(function (sh) { return sh.bron; }).reduce(function (v, sh) {
            return v.then(function () { return laadBeeld(sh.bron); }).then(function (img) {
              tekenScreenshot(doc, pos, metKaders(img, sh.markeringen || []));
            });
          }, Promise.resolve()).then(function () {
            p.wijzigingen.forEach(function (w) { tekenWijziging(doc, pos, w); });
          });
        });
      }, Promise.resolve()).then(function () {
        pos.y += 2;
        tekenRegels(doc, pos, 'De rode nummers in de screenshots verwijzen naar de genummerde wijzigingen.' +
          (d.afzender ? ' Vragen? Neem contact op met ' + d.afzender + '.' : ''), 'normal', 9, KLEUR.zacht, 4.4);
        // voettekst met paginanummers
        var n = doc.getNumberOfPages();
        for (var i = 1; i <= n; i++) {
          doc.setPage(i);
          letter(doc, 'normal', 8); kleur(doc, 'tekst', KLEUR.zacht);
          doc.text(pdfTekst(titel + (d.datum ? ' · ' + d.datum : '')), M, 290);
          doc.text('Pagina ' + i + ' van ' + n, M + INHOUD, 290, { align: 'right' });
        }
        return doc.output('blob');
      });
    });
  }

  function knopBezig(k, tekst) {
    var oud = k.textContent; k.disabled = true; k.textContent = tekst;
    return function () { k.disabled = false; k.textContent = oud; };
  }
  $('btn-pdf').addEventListener('click', function (e) {
    if (!controleer()) return;
    var klaar = knopBezig(e.currentTarget, 'PDF maken...');
    maakPdf().then(function (blob) {
      downloadBlob(blob, bestandsnaam('pdf'));
      meld('PDF gedownload. Voeg hem toe aan je mail aan de webbouwer.');
    }).catch(function (er) { console.warn('PDF', er); meld('PDF maken lukte niet: ' + ((er && er.message) || er)); }).then(klaar);
  });

  // ---------- deellink: PDF in OneDrive, link voor iedereen (alleen lezen) ----------
  function pdfNaam(s) {
    var t = (s.meta.titel || 'Wijzigingsverzoek website').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return t + ' (' + s.id + ').pdf';
  }
  function toonLink(link) {
    $('deel-link').value = link;
    if (!$('deel').open) $('deel').showModal();
    $('deel-link').select();
  }
  $('btn-deel').addEventListener('click', function (e) {
    if (!controleer()) return;
    if (!cloud.aan) {
      if (confirm('Voor een deellink zet de app de PDF in je OneDrive. Die is nog niet gekoppeld. Nu koppelen? Je logt eenmalig in met je Microsoft-account; daarna klik je opnieuw op Deel link.')) koppel();
      return;
    }
    var s = staat, k = e.currentTarget, klaar = knopBezig(k, 'PDF maken...');
    // eenmaal gedeeld = vaste bestandsnaam, zodat de link gelijk blijft als de titel later verandert
    var naam = (s.deel && s.deel.naam) || pdfNaam(s);
    maakPdf().then(function (blob) {
      k.textContent = 'Uploaden...';
      return OneDrive.deel(naam, blob);
    }).then(function (link) {
      s.deel = { naam: naam, link: link, tijd: Date.now() };
      if (s === staat) bewaar(); else dbZet('verzoeken', s, s.id);
      toonLink(link);
    }).catch(function (er) {
      console.warn('Delen', er);
      if (er && er.code === 'GEEN_OPENBARE_LINK') {
        alert('De PDF staat in je OneDrive (map "' + OneDrive.map + '"), maar Microsoft staat geen link voor "iedereen met de link" toe.\n\n' +
          'Zet dat aan in het SharePoint-beheercentrum (Beleid > Delen > OneDrive: "Iedereen"). Tot die tijd: gebruik Download PDF.');
      } else if (er && (er.code || er.status)) { cloudFout(er); meld('Delen lukte niet. ' + uitleg(er)); }
      else meld('Delen lukte niet: ' + ((er && er.message) || er));
    }).then(klaar);
  });
  $('deel-sluit').addEventListener('click', function () { $('deel').close(); });
  $('deel-kopieer').addEventListener('click', function () {
    var v = $('deel-link').value;
    function klaar() { meld('Link gekopieerd. Plak hem in je mail aan de webbouwer.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(klaar, function () { $('deel-link').select(); document.execCommand('copy'); klaar(); });
    } else { $('deel-link').select(); document.execCommand('copy'); klaar(); }
  });
  $('deel-open').addEventListener('click', function () { window.open($('deel-link').value, '_blank', 'noopener'); });

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
  if (window.Tips) Tips.init();
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
