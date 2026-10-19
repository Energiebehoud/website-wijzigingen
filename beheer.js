(function () {
  'use strict';

  var meldTimer = null;
  function meld(tekst) {
    var m = document.getElementById('melding');
    m.textContent = tekst; m.classList.add('zichtbaar');
    clearTimeout(meldTimer);
    meldTimer = setTimeout(function () { m.classList.remove('zichtbaar'); }, 2600);
  }

  function bouw() {
    var bak = document.getElementById('tips-lijst');
    var huidig = Tips.lees();
    var ruw = Tips.leesRuw();
    var sleutels = Object.keys(Tips.standaard);

    sleutels.forEach(function (k) {
      var blok = document.createElement('section');
      blok.className = 'kaartblok tip-blok';

      var kop = document.createElement('div');
      kop.className = 'tip-kop';

      var label = document.createElement('strong');
      label.textContent = Tips.labels[k] || k;
      kop.appendChild(label);

      var sleutel = document.createElement('code');
      sleutel.className = 'tip-sleutel';
      sleutel.textContent = k;
      kop.appendChild(sleutel);

      if (ruw[k]) {
        var badge = document.createElement('span');
        badge.className = 'tip-badge';
        badge.textContent = 'aangepast';
        kop.appendChild(badge);
      }

      blok.appendChild(kop);

      var standaard = document.createElement('div');
      standaard.className = 'tip-standaard';
      standaard.textContent = 'Standaard: ' + Tips.standaard[k];
      blok.appendChild(standaard);

      var veld = document.createElement('textarea');
      veld.className = 'tip-veld';
      veld.rows = 3;
      veld.placeholder = Tips.standaard[k];
      veld.value = ruw[k] || '';
      veld.dataset.sleutel = k;
      blok.appendChild(veld);

      var acties = document.createElement('div');
      acties.className = 'tip-item-acties';
      var herstel = document.createElement('button');
      herstel.type = 'button';
      herstel.className = 'klein';
      herstel.textContent = 'Standaard herstellen';
      herstel.addEventListener('click', function () {
        veld.value = '';
        var badge = blok.querySelector('.tip-badge');
        if (badge) badge.remove();
        meld(Tips.labels[k] + ': standaardtekst hersteld');
      });
      acties.appendChild(herstel);
      blok.appendChild(acties);

      bak.appendChild(blok);
    });
  }

  document.getElementById('btn-opslaan').addEventListener('click', function () {
    var velden = document.querySelectorAll('.tip-veld');
    var obj = {};
    var aantal = 0;
    velden.forEach(function (v) {
      var tekst = v.value.trim();
      if (tekst && tekst !== Tips.standaard[v.dataset.sleutel]) {
        obj[v.dataset.sleutel] = tekst;
        aantal++;
      }
    });
    if (aantal) Tips.schrijf(obj); else Tips.wis();
    meld('Opgeslagen (' + aantal + ' aangepaste ' + (aantal === 1 ? 'tekst' : 'teksten') + ')');
    // badges bijwerken
    document.querySelectorAll('.tip-blok').forEach(function (blok) {
      var veld = blok.querySelector('.tip-veld');
      var badge = blok.querySelector('.tip-badge');
      var isAangepast = obj[veld.dataset.sleutel];
      if (isAangepast && !badge) {
        badge = document.createElement('span');
        badge.className = 'tip-badge';
        badge.textContent = 'aangepast';
        blok.querySelector('.tip-kop').appendChild(badge);
      } else if (!isAangepast && badge) {
        badge.remove();
      }
    });
  });

  document.getElementById('btn-reset').addEventListener('click', function () {
    if (!confirm('Alle hoverteksten terugzetten naar de standaardwaarden?')) return;
    Tips.wis();
    document.querySelectorAll('.tip-veld').forEach(function (v) { v.value = ''; });
    document.querySelectorAll('.tip-badge').forEach(function (b) { b.remove(); });
    meld('Alle standaardteksten hersteld');
  });

  bouw();
})();
