// OneDrive-koppeling: Microsoft-login (MSAL, redirect-flow) en opslag van verzoeken via Microsoft Graph.
// Gebruikt de app-registratie van de projectfoto's-app (zelfde tenant). clientId/tenantId zijn geen geheimen.
(function () {
  'use strict';

  var CLIENT_ID = '265a29ca-f690-45a5-9d60-375a9ab6cc96';
  var TENANT_ID = 'ab81a85c-999b-4a6d-80dc-238143505131';
  var MSAL_URL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.13.0/+esm';
  var SCOPES = ['User.Read', 'Files.ReadWrite.All'];
  var MAP = 'Wijzigingsverzoeken website';
  var GRAPH = 'https://graph.microsoft.com/v1.0';

  var msal = null, mod = null, klaar = null;

  function fout(code, status) { var e = new Error(code); e.code = code; e.status = status; return e; }

  // Laadt MSAL en verwerkt een eventuele terugkeer van de login-redirect. Geeft het account of null.
  function init() {
    if (!klaar) {
      klaar = import(MSAL_URL).then(function (m) {
        mod = m;
        msal = new m.PublicClientApplication({
          auth: {
            clientId: CLIENT_ID,
            authority: 'https://login.microsoftonline.com/' + TENANT_ID,
            redirectUri: location.origin + location.pathname
          },
          cache: { cacheLocation: 'localStorage' }
        });
        return msal.initialize();
      }).then(function () {
        return msal.handleRedirectPromise();
      }).then(function (r) {
        var a = (r && r.account) || msal.getAllAccounts()[0] || null;
        if (a) msal.setActiveAccount(a);
        return a;
      }).catch(function (e) { klaar = null; throw e; });
    }
    return klaar;
  }
  function account() { return msal ? (msal.getActiveAccount() || msal.getAllAccounts()[0] || null) : null; }
  // Een eerder afgebroken login (terug met de knop Vorige) laat een vlag achter waardoor MSAL
  // elke nieuwe poging weigert met interaction_in_progress. Die vlag ruimen we op en we proberen het opnieuw.
  function wisInteractie() {
    [sessionStorage, localStorage].forEach(function (opslag) {
      try {
        Object.keys(opslag).forEach(function (k) { if (k.indexOf('interaction.status') >= 0) opslag.removeItem(k); });
      } catch (e) { /* opslag geblokkeerd */ }
    });
  }
  function login() {
    function poging() { return msal.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); }
    return init().catch(function () { wisInteractie(); klaar = null; return init(); }).then(function () {
      return poging().catch(function (e) {
        if (e && e.errorCode === 'interaction_in_progress') { wisInteractie(); return poging(); }
        throw e;
      });
    });
  }
  // Alleen op deze computer afmelden (lokale tokens wissen), niet overal bij Microsoft.
  function logout() {
    return init().then(function () {
      return msal.logoutRedirect({ account: account(), onRedirectNavigate: function () { return false; } });
    });
  }

  // Stil een token ophalen; nooit automatisch wegsturen naar Microsoft tijdens het werk.
  function token() {
    return init().then(function () {
      var a = account();
      if (!a) throw fout('NIET_AANGEMELD');
      return msal.acquireTokenSilent({ scopes: SCOPES, account: a }).then(function (r) { return r.accessToken; }, function (e) {
        if (mod && e instanceof mod.InteractionRequiredAuthError) throw fout('OPNIEUW_INLOGGEN');
        throw e;
      });
    });
  }
  function graph(url, opt) {
    opt = opt || {};
    return token().then(function (t) {
      var h = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {});
      return fetch(url.indexOf('https://') === 0 ? url : GRAPH + url, Object.assign({}, opt, { headers: h }));
    });
  }
  function pad(naam) {
    return '/me/drive/root:/' + encodeURIComponent(MAP) + (naam ? '/' + encodeURIComponent(naam) : '');
  }

  // Alle bestanden in de map: [{ naam, etag, download }]. Map bestaat nog niet = lege lijst.
  function lijst() {
    var items = [];
    function haal(url) {
      return graph(url).then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw fout('GRAPH', r.status);
        return r.json();
      }).then(function (j) {
        if (!j) return items;
        items = items.concat(j.value || []);
        return j['@odata.nextLink'] ? haal(j['@odata.nextLink']) : items;
      });
    }
    return haal(pad() + ':/children?$top=200').then(function (alle) {
      return alle.filter(function (i) { return i.file; }).map(function (i) {
        return { naam: i.name, etag: i.eTag, download: i['@microsoft.graph.downloadUrl'] };
      });
    });
  }
  function lees(item) {
    return fetch(item.download).then(function (r) {
      if (!r.ok) throw fout('GRAPH', r.status);
      return r.json();
    });
  }
  function maakMap() {
    return graph('/me/drive/root/children', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: MAP, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
    }).then(function (r) { if (!r.ok && r.status !== 409) throw fout('GRAPH', r.status); });
  }
  // Schrijft een JSON-bestand en geeft de nieuwe eTag terug.
  function schrijf(naam, data) {
    var body = JSON.stringify(data);
    function put() {
      return graph(pad(naam) + ':/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body });
    }
    return put().then(function (r) {
      return r.status === 404 ? maakMap().then(put) : r;
    }).then(function (r) {
      if (!r.ok) throw fout('GRAPH', r.status);
      return r.json();
    }).then(function (item) { return item.eTag; });
  }
  function verwijder(naam) {
    return graph(pad(naam), { method: 'DELETE' }).then(function (r) {
      if (!r.ok && r.status !== 404) throw fout('GRAPH', r.status);
    });
  }

  window.OneDrive = {
    init: init, account: account, login: login, logout: logout,
    lijst: lijst, lees: lees, schrijf: schrijf, verwijder: verwijder, map: MAP
  };
})();
