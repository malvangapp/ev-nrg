# EV-NRG

Letvægts-app til at følge elforbrug og ladepriser for Skoda Elroq og VW ID.3.
Webside (installeres på iPhone-hjemmeskærmen) med API og database på Cloudflare (Workers + D1).

## 1. Opsætning på Cloudflare (første gang)
Kræver Node.js og en gratis Cloudflare-konto.
```bash
npm install
npx wrangler login
npx wrangler d1 create ev-nrg          # kopiér database_id ind i wrangler.jsonc
npm run db:init:remote                 # opretter tabellerne og de to biler
npx wrangler secret put PASSPHRASE     # din adgangskode til appen
npx wrangler secret put TOKEN_SECRET   # en lang tilfældig tekst
npm run deploy
```
Appen ligger derefter på `https://ev-nrg.<dit-subdomæne>.workers.dev` (eget domæne kan tilføjes under
Workers → ev-nrg → Settings → Domains). Åbn den i Safari → Del → **Føj til hjemmeskærm**.
Senere ændringer udgives med `npm run deploy`.

## 2. Flyt data fra Google Sheets
1. Åbn den gamle app (GitHub Pages) → **Indstillinger** → **Eksportér alle data** (JSON-fil).
2. Åbn den nye app på Cloudflare → **Indstillinger** → **Importér data** → vælg filen → **Erstat alt**.

Bilernes id skal være `elroq` og `id3` (det er de som standard). Importen kører samlet: fejler den, ændres intet.

## Udvikling lokalt
```bash
npm run db:init:local
npm run dev                            # http://localhost:8787
```
Lokale hemmeligheder ligger i `.dev.vars` (ikke i git), fx `PASSPHRASE=test-kode` og `TOKEN_SECRET=...`.
Sættes `API_URL` i `public/config.js` til `''`, kører appen i demo-tilstand med eksempeldata (intet gemmes).

## Filer
- `public/` – brugerfladen (`index.html`, `styles.css`, `app.js`, `calc.js`, `planner.js`, `api.js`, `sw.js` …)
- `src/worker.js` – API (Cloudflare Worker): `POST /api` med `{ action, token, ... }`, svarer altid med alle data
- `schema.sql` – databasens tabeller (D1)
- `wrangler.jsonc` – Cloudflare-opsætning
- `apps-script/Code.gs` – den gamle Google Sheets-backend (bruges ikke længere)

## Ladning væk hjemme
Ladninger har feltet `non_home`. Slå "Ladet ude" til i formularen for ladninger der ikke er sket hjemme.
På Bildetaljer kan du slå "Inkl. ladning ude" til/fra.

## Eksport og import (Indstillinger)
Fanen **Indstillinger** har:
- **Eksportér alle data**: en komplet JSON-fil (`ev-nrg-<dato>.json`). På iPhone åbnes Del-menuen, så den kan gemmes i Filer.
- **Eksportér ladninger**: en CSV-fil til Excel (semikolon, decimalkomma).
- **Importér data**: vælg en JSON-fil. Vælg **Tilføj det der mangler** (springer poster med samme id over, sletter intet)
  eller **Erstat alt** (sletter nuværende ladninger, km-stande og dæk og indlæser filens).
- **Log ud**.

Filformat:
```json
{
  "app": "ev-nrg", "format": 1, "exportedAt": "2026-11-07T10:00:00.000Z",
  "cars":     [{ "id": "elroq", "name": "Skoda Elroq", "kmAtPurchase": 1200, "image": "assets/cars/elroq.png", "licensePlate": "AB12345", "vin": "" }],
  "charges":  [{ "id": "…", "date": "2026-10-01", "car": "elroq", "kwh": 40, "price": 100, "nonHome": false }],
  "odometer": [{ "id": "…", "date": "2026-10-05", "car": "elroq", "km": 5000 }],
  "tires":    [{ "id": "…", "car": "elroq", "name": "Sommer 1", "type": "summer", "startKm": 0 }],
  "fittings": [{ "id": "…", "tire": "<tire id>", "pos": "FL", "dateOn": "", "kmOn": 1200, "dateOff": "", "kmOff": null }]
}
```
`type` er `summer`, `winter` eller `all`; `pos` er `FL`, `FR`, `RL` eller `RR`; `kmOff: null` betyder at dækket sidder på bilen.

## Nummerplade og dæk
- Nummerpladen rettes ved at trykke på pladen på Bildetaljer; stelnummer (VIN, 17 tegn) ved at trykke på
  "Stelnummer (VIN)" over "Km ved køb".
- Dæk registreres enkeltvis og hører til én bil. To tabeller:
  - `tires`: dækregisteret (navn, type sommer/vinter/helår, `start_km` = km dækket allerede havde).
  - `fittings`: hver montering (dæk, position FL/FR/RL/RR, dato og km på og af). Tom `km_off` = sidder stadig på bilen.
- Et dæks km = `start_km` + alle monteringer; en montering der stadig sidder på tæller op til bilens seneste km-stand.
  Når du tilføjer en km-stand, opdateres dækkenes km altså af sig selv, og et dæk fortsætter hvor det slap når det monteres igen.
- På Bildetaljer: "Skift dæk" vælger pladser (forrest, bagerst eller enkelte) og hvilke dæk fra lageret der skal på. "Nyt dæk" tilføjer til lageret.
  Første gang bruges "Registrér nuværende dæk", som regner de fire dæk på bilen med fra købet.
  Lagerdækkene vises kun når "På lager" foldes ud. Tryk på et dæk for historik, afmontering, redigering eller sletning.

## Billigst (billigste ladetidspunkt)
Fanen henter timepriser for DK2 fra [elprisenligenu.dk](https://www.elprisenligenu.dk/elpris-api) og finder den billigste
sammenhængende ladeblok, der er færdig inden "Klar kl.". Priserne er uden afgifter og moms, så appen lægger OK-tillæg,
Energinet, elafgift, nettarif og moms til (Indstillinger). Nettariffen er forudfyldt med N1's 2026-satser
(fra [elselskaber.dk](https://elselskaber.dk/nettarif/), omregnet til uden moms). Batteristørrelser (netto) står i `public/planner.js` (Elroq 77 kWh, ID.3 58 kWh).
Morgendagens priser udkommer ca. kl. 13.

## Noter
- Adgangskoden ligger kun som hemmelighed i Cloudflare; appen gemmer et signeret login-token i ca. 180 dage.
- kWh / 100 km beregnes ud fra ladninger til og med datoen for den seneste km-stand.
