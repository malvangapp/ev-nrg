-- EV-NRG database (Cloudflare D1 / SQLite).
-- Apply with: npx wrangler d1 execute ev-nrg --remote --file=schema.sql   (use --local for wrangler dev)

CREATE TABLE IF NOT EXISTS cars (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  km_at_purchase REAL NOT NULL DEFAULT 0,
  image          TEXT NOT NULL DEFAULT '',
  license_plate  TEXT NOT NULL DEFAULT '',
  vin            TEXT NOT NULL DEFAULT '',
  sort           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS charges (
  id        TEXT PRIMARY KEY,
  date      TEXT NOT NULL,              -- yyyy-mm-dd
  car       TEXT NOT NULL REFERENCES cars(id),
  kwh       REAL NOT NULL,
  price_dkk REAL NOT NULL,
  non_home  INTEGER NOT NULL DEFAULT 0,
  created   TEXT NOT NULL,
  updated   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS charges_car_date ON charges(car, date);

CREATE TABLE IF NOT EXISTS odometer (
  id   TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  car  TEXT NOT NULL REFERENCES cars(id),
  km   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS odometer_car_date ON odometer(car, date);

-- Tire register: one row per physical tire, belonging to one car.
CREATE TABLE IF NOT EXISTS tires (
  id       TEXT PRIMARY KEY,
  car      TEXT NOT NULL REFERENCES cars(id),
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('summer', 'winter', 'all')),
  start_km REAL NOT NULL DEFAULT 0
);

-- Fitting log: one row each time a tire goes on a car; km_off is NULL while it is still mounted.
CREATE TABLE IF NOT EXISTS fittings (
  id       TEXT PRIMARY KEY,
  tire     TEXT NOT NULL REFERENCES tires(id) ON DELETE CASCADE,
  position TEXT NOT NULL CHECK (position IN ('FL', 'FR', 'RL', 'RR')),
  date_on  TEXT NOT NULL DEFAULT '',
  km_on    REAL NOT NULL,
  date_off TEXT NOT NULL DEFAULT '',
  km_off   REAL
);
CREATE INDEX IF NOT EXISTS fittings_tire ON fittings(tire);

INSERT OR IGNORE INTO cars (id, name, km_at_purchase, image, sort) VALUES
  ('elroq', 'Skoda Elroq', 0, 'assets/cars/elroq.png', 1),
  ('id3',   'VW ID.3',     0, 'assets/cars/id3.png',   2);
