(function () {
  'use strict';

  var OPSLAG = 'ww_tooltips';

  var STANDAARD = {
    'btn-cloud':     'Koppel je OneDrive om verzoeken op al je computers beschikbaar te hebben. Na het koppelen worden wijzigingen automatisch gesynchroniseerd.',
    'btn-ai':        'Stel je Claude API-sleutel in. Hiermee kun je de Herschrijven-knop gebruiken: Claude herschrijft je teksten in correct Nederlands.',
    'btn-verzoeken': 'Bekijk al je opgeslagen verzoeken. Open een eerder verzoek om verder te gaan, of verwijder verzoeken die je niet meer nodig hebt.',
    'btn-nieuw':     'Begin een nieuw, leeg verzoek. Het huidige verzoek wordt automatisch bewaard bij Mijn verzoeken.',
    'btn-open':      'Open een eerder gedownload HTML-bestand (.html) om het verzoek te bewerken of aan te vullen.',
    'btn-bekijk':    'Bekijk een voorbeeld van het verzoek zoals de webbouwer het zal ontvangen.',
    'btn-download':  'Download het verzoek als HTML-bestand met kopieerknoppen. Dit bestand kun je ook later weer openen met Openen.',
    'btn-pdf':       'Download het verzoek als PDF. Handig als bijlage bij een e-mail aan de webbouwer.',
    'btn-deel':      'Zet de PDF in je OneDrive en maak een deellink. De webbouwer bekijkt de wijzigingen online als PDF, zonder in te loggen.',
    'gegevens':      'Vul hier de basisgegevens in: wie stuurt het verzoek, aan welke webbouwer, voor welke website. De datum wordt automatisch op vandaag gezet.',
    'url-form':      'Vul het webadres (URL) in en klik op Screenshot maken. De gratis dienst Microlink maakt het screenshot (max. ~25 per dag). Pagina\'s achter een inlog moet je zelf screenshotten met Win+Shift+S.',
    'dropzone':      'Plak een screenshot met Ctrl+V, sleep een afbeelding hierheen, of klik om een bestand te kiezen. Accepteert PNG, JPG en andere afbeeldingsformaten.',
    'screenshot':    'Sleep een kader over het deel dat aangepast moet worden. Elk kader krijgt een nummer. Versleep kaders of maak ze groter/kleiner via het hoekje rechtsonder.',
    'kaarten':       'Vul per genummerd kader in wat de huidige tekst is en wat de nieuwe tekst moet worden. Gebruik Herschrijven om de tekst door Claude te laten verbeteren.'
  };

  var LABELS = {
    'btn-cloud':     'OneDrive-knop',
    'btn-ai':        'AI-instellingen',
    'btn-verzoeken': 'Mijn verzoeken',
    'btn-nieuw':     'Nieuw verzoek',
    'btn-open':      'Openen',
    'btn-bekijk':    'Bekijken',
    'btn-download':  'Download HTML',
    'btn-pdf':       'Download PDF',
    'btn-deel':      'Deel link',
    'gegevens':      'Gegevenssectie',
    'url-form':      'Screenshot maken',
    'dropzone':      'Screenshot plakken/slepen',
    'screenshot':    'Screenshotweergave',
    'kaarten':       'Wijzigingskaarten'
  };

  function lees() {
    var r = {};
    Object.keys(STANDAARD).forEach(function (k) { r[k] = STANDAARD[k]; });
    try {
      var o = JSON.parse(localStorage.getItem(OPSLAG));
      if (o && typeof o === 'object') {
        Object.keys(o).forEach(function (k) { if (k in STANDAARD && o[k]) r[k] = o[k]; });
      }
    } catch (e) {}
    return r;
  }

  function leesRuw() {
    try {
      var o = JSON.parse(localStorage.getItem(OPSLAG));
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function schrijf(obj) {
    try { localStorage.setItem(OPSLAG, JSON.stringify(obj)); } catch (e) {}
  }

  function wis() {
    try { localStorage.removeItem(OPSLAG); } catch (e) {}
  }

  var tipEl, toonT, bergT;

  function init() {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    koppel();
  }

  function koppel() {
    var tips = lees();
    document.querySelectorAll('[data-tip]').forEach(function (el) {
      if (el._tipOk) return;
      el._tipOk = true;
      el.addEventListener('mouseenter', function () {
        var t = tips[el.dataset.tip];
        if (!t) return;
        clearTimeout(bergT);
        toonT = setTimeout(function () { toon(el, t); }, 350);
      });
      el.addEventListener('mouseleave', function () {
        clearTimeout(toonT);
        bergT = setTimeout(function () { if (tipEl) tipEl.classList.remove('zichtbaar'); }, 80);
      });
    });
  }

  function toon(doel, tekst) {
    tipEl.textContent = tekst;
    tipEl.classList.add('zichtbaar');
    var r = doel.getBoundingClientRect();
    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var l = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    var t = r.bottom + 8;
    if (t + th > window.innerHeight - 8) t = r.top - th - 8;
    tipEl.style.left = l + 'px';
    tipEl.style.top = t + 'px';
  }

  window.Tips = {
    standaard: STANDAARD, labels: LABELS,
    lees: lees, leesRuw: leesRuw, schrijf: schrijf, wis: wis,
    init: init, koppel: koppel
  };
})();
