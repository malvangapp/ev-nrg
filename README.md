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
(eller slå "Ladet ude" til i formularen). På Bildetaljer kan du slå "Inkl. ladning ude" til/fra.
Efter en opdatering af `Code.gs`: kør `setup` igen og udgiv en **ny version** under Deploy → Manage deployments.

## Nummerplade og dæk
- `Cars` har kolonnen `license_plate` (rettes ved at trykke på pladen på Bildetaljer).
- Dæk registreres enkeltvis og hører til én bil. To faner (oprettes automatisk):
  - `TireStock`: dækregisteret (navn, type sommer/vinter/helår, mærke, `start_km` = km dækket allerede havde).
  - `TireLog`: hver montering (dæk, position FL/FR/RL/RR, dato og km på og af). Tom `km_off` = sidder stadig på bilen.
- Et dæks km = `start_km` + alle moneringer; en montering der stadig sidder på tæller op til bilens seneste km-stand.
  Når du tilføjer en km-stand, opdateres dækkenes km altså af sig selv, og et dæk fortsætter hvor det slap når det monteres igen.
- På Bildetaljer: "Skift dæk" vælger pladser (forrest, bagerst eller enkelte) og hvilke dæk fra lageret der skal på. "Nyt dæk" tilføjer til lageret.
  Første gang bruges "Registrér nuværende dæk", som regner de fire dæk på bilen med fra købet.
- Opdater `Code.gs` og udgiv en **ny version** (Deploy → Manage deployments) for at få det med.

## Billigst (billigste ladetidspunkt)
Fanen henter timepriser for DK2 fra [elprisenligenu.dk](https://www.elprisenligenu.dk/elpris-api) og finder den billigste
sammenhængende ladeblok, der er færdig inden "Klar kl.". Priserne er uden afgifter og moms, så appen lægger OK-tillæg,
Energinet, elafgift, nettarif og moms til (Indstillinger). Nettariffen er forudfyldt med N1's 2026-satser
(fra [elselskaber.dk](https://elselskaber.dk/nettarif/), omregnet til uden moms). Batteristørrelser (netto) står i `planner.js` (Elroq 77 kWh, ID.3 58 kWh).
Morgendagens priser udkommer ca. kl. 13.

## Noter
- Adgangskoden ligger kun i Apps Script; appen gemmer et signeret login-token i ca. 180 dage.
- kWh / 100 km beregnes ud fra ladninger til og med datoen for den seneste km-stand.
