# Wijzigingsverzoek website

Webapp van Energiebehoud BV om wijzigingen voor de websitebouwer door te geven.
Vul een pagina-adres in (de app maakt het screenshot via Microlink) of plak zelf een screenshot, sleep kaders over wat er anders moet en vul per nummer de huidige
en nieuwe tekst in. Download levert één zelfstandig HTML-bestand op dat de bouwer in
elke browser opent (met kopieerknoppen) en dat als PDF te printen is.

Live: https://energiebehoud.github.io/website-wijzigingen/

## Opbouw

- `index.html`, `style.css`, `app.js`: de app (statisch, geen build-stap).
- `sjabloon.html`: de weergave voor de webbouwer. De app vult `/*DATA*/` met de gegevens.
  Hetzelfde sjabloon zit in de Claude-skill `website-wijzigingen` (repo `energiebehoud-skills`);
  houd ze gelijk.

Alle gegevens blijven in de browser (IndexedDB). Er gaat niets naar een server.
Een gedownload verzoek kan via **Openen** weer worden bewerkt, ook verzoeken die de
Claude-skill heeft gemaakt.

## Lokaal draaien

Geen Node of Python nodig: start een PowerShell-webserver in deze map (zie de aanpak in
`00SKILLS/.claude/launch.json`) of open de live-versie. Via `file://` werkt Download niet,
omdat de browser `sjabloon.html` dan niet mag ophalen.

## Publiceren

Push naar `main`; GitHub Pages publiceert automatisch.
