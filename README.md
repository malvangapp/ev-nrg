# EV-NRG

Letvægts-app til at følge elforbrug og ladepriser for Skoda Elroq og VW ID.3.
Statisk webside (installeres på iPhone-hjemmeskærmen) + Google Sheet som database via Google Apps Script.

## 1. Opret Google Sheet og backend
1. Opret et nyt Google Sheet (fx "EV-NRG data").
2. **Extensions → Apps Script**. Slet standardkoden og indsæt indholdet af `apps-script/Code.gs`.
3. Vælg funktionen `setup` og tryk **Run** (godkend adgang). Det opretter fanerne `Charges`, `Odometer` og `Cars`.
4. **Project Settings → Script properties**: ret `PASSPHRASE` til din egen adgangskode.
5. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Kopiér URL'en (slutter på `/exec`).
   Ændrer du koden senere: Deploy → Manage deployments → rediger → New version.
6. Indsæt URL'en i `config.js` (`API_URL`).

Uden `API_URL` kører appen i demo-tilstand med eksempeldata (intet gemmes).

## 2. Hosting (GitHub Pages)
1. Opret et GitHub-repo og push mappen.
2. **Settings → Pages → Deploy from branch → main / root**.
3. Åbn `https://<brugernavn>.github.io/<repo>/` i Safari → Del → **Føj til hjemmeskærm**.

## Filer
- `index.html`, `styles.css`, `app.js` – brugerflade
- `calc.js` – beregninger (kWh pr. 100 km m.m.)
- `api.js` – kald til Apps Script
- `sw.js`, `manifest.webmanifest` – installation / offline-skal
- `apps-script/Code.gs` – backend

## Ladning væk hjemme
Fanen `Charges` har kolonnen `non_home` (afkrydsning). Marker rækker hvor bilen ikke blev ladet hjemme
(eller slå "Ladet ikke hjemme" til i formularen). På Bildetaljer kan du slå "Inkl. ladning ude" til/fra.
Efter en opdatering af `Code.gs`: kør `setup` igen og udgiv en **ny version** under Deploy → Manage deployments.

## Noter
- Adgangskoden ligger kun i Apps Script; appen gemmer et signeret login-token i ca. 180 dage.
- kWh / 100 km beregnes ud fra ladninger til og med datoen for den seneste km-stand.
