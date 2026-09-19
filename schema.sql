-- Nefuda · esquema D1 (v3)
-- Cambios respecto a v2:
--   · `status` y `condition` dejan de ser CHECK y pasan a tabla -> nunca hay que
--     reconstruir la tabla para añadir un valor
--   · nueva tabla `flags` para defectos (manual dañado, caja golpeada...), que son
--     acumulables y no excluyentes como el grado
--   · los estados llevan dos banderas de comportamiento, para que el código sepa
--     qué hacer con un estado que te inventes tú
--
--   npx wrangler d1 execute nefuda --remote --file=./schema.sql

-- ---------------------------------------------------------------- usuarios

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                      -- sub del JWT de Cloudflare Access
  email       TEXT NOT NULL UNIQUE,
  lang        TEXT NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en', 'ja')),
  currency    TEXT NOT NULL DEFAULT 'JPY' CHECK (currency IN ('JPY', 'EUR')),
  webhook_url TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- vocabularios
-- Las cuatro tablas siguen el mismo patrón:
--   owner_id NULL     = de fábrica, la ve todo el mundo
--   owner_id = usuario = privada, solo la ve quien la creó
-- Consulta siempre con:  WHERE owner_id IS NULL OR owner_id = ?1

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  slug     TEXT NOT NULL,
  name_es  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  name_ja  TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 100
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug
  ON categories (COALESCE(owner_id, ''), slug);

INSERT OR IGNORE INTO categories (owner_id, slug, name_es, name_en, name_ja, sort) VALUES
  (NULL, 'figure',   'Figura',        'Figure',        'フィギュア',   10),
  (NULL, 'game',     'Juego',         'Game',          'ゲーム',       20),
  (NULL, 'plamo',    'Maqueta',       'Model kit',     'プラモデル',   30),
  (NULL, 'artbook',  'Libro/artbook', 'Book/artbook',  '書籍・画集',   40),
  (NULL, 'manga',    'Manga',         'Manga',         '漫画',         50),
  (NULL, 'goods',    'Merchandising', 'Merch',         'グッズ',       60),
  (NULL, 'cards',    'Cartas',        'Trading cards', 'トレカ',       70),
  (NULL, 'music',    'Música',        'Music',         '音楽',         80),
  (NULL, 'hardware', 'Consolas',      'Hardware',      'ハード',       90),
  (NULL, 'other',    'Otros',         'Other',         'その他',      999);

-- Estados. Las dos banderas son lo importante: cuando te inventes un estado
-- nuevo ("prestado", "reservado"), el código sabe qué hacer con él sin tocar nada.
--   in_collection = 1  -> suma al valor de tu colección
--   track_price   = 1  -> el cron sigue mirando su precio
CREATE TABLE IF NOT EXISTS statuses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT REFERENCES users (id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name_es       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_ja       TEXT NOT NULL,
  in_collection INTEGER NOT NULL DEFAULT 1,
  track_price   INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 100
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_slug
  ON statuses (COALESCE(owner_id, ''), slug);

INSERT OR IGNORE INTO statuses
  (owner_id, slug, name_es, name_en, name_ja, in_collection, track_price, sort) VALUES
  (NULL, 'owned',    'En colección', 'In collection', '所有',   1, 1, 10),
  (NULL, 'ordered',  'Pedido',       'Ordered',       '注文済', 0, 1, 20),
  (NULL, 'wishlist', 'Deseado',      'Wishlist',      'ほしい物', 0, 1, 30),
  (NULL, 'sold',     'Vendido',      'Sold',          '売却済', 0, 0, 40);

-- Condiciones: el GRADO, uno solo por ejemplar.
--   grade      -> orden de mejor a peor, para comparar y ordenar
--   from_api   -> 1 si las tiendas devuelven precios con esa condición
CREATE TABLE IF NOT EXISTS conditions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  slug     TEXT NOT NULL,
  name_es  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  name_ja  TEXT NOT NULL,
  grade    INTEGER NOT NULL DEFAULT 50,
  from_api INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conditions_slug
  ON conditions (COALESCE(owner_id, ''), slug);

INSERT OR IGNORE INTO conditions
  (owner_id, slug, name_es, name_en, name_ja, grade, from_api) VALUES
  (NULL, 'new',    'Nuevo',        'New',          '新品',   100, 1),
  (NULL, 'sealed', 'Sin abrir',    'Sealed',       '未開封',  90, 0),
  (NULL, 'used',   'Usado',        'Used',         '中古',    50, 1),
  (NULL, 'junk',   'Para piezas',  'Junk',         'ジャンク', 10, 0);

-- Defectos: acumulables. Un juego puede ser 'used' Y tener el manual dañado
-- Y la caja golpeada a la vez.
CREATE TABLE IF NOT EXISTS flags (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  slug     TEXT NOT NULL,
  name_es  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  name_ja  TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 100
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_slug
  ON flags (COALESCE(owner_id, ''), slug);

INSERT OR IGNORE INTO flags (owner_id, slug, name_es, name_en, name_ja, sort) VALUES
  (NULL, 'manual_damage',  'Manual dañado',   'Manual damage',   '説明書に傷み', 10),
  (NULL, 'box_damage',     'Caja dañada',     'Box damage',      '箱に傷み',     20),
  (NULL, 'no_box',         'Sin caja',        'No box',          '箱なし',       30),
  (NULL, 'missing_parts',  'Faltan piezas',   'Missing parts',   'パーツ欠品',   40),
  (NULL, 'yellowing',      'Amarilleado',     'Yellowing',       '黄ばみ',       50),
  (NULL, 'opened_blister', 'Blíster abierto', 'Blister opened',  'ブリスター開封', 60);

-- Tiendas: compartidas, con alias para que 駿河屋 y Suruga-ya sean la misma fila.
CREATE TABLE IF NOT EXISTS shops (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  aliases TEXT,                                      -- JSON: ["駿河屋","Suruga-ya"]
  kind    TEXT NOT NULL DEFAULT 'online' CHECK (kind IN ('online', 'physical')),
  is_api  INTEGER NOT NULL DEFAULT 0                 -- 1 = el cron la consulta
);

INSERT OR IGNORE INTO shops (slug, name, aliases, kind, is_api) VALUES
  ('yahoo',    'Yahoo!ショッピング', '["ヤフーショッピング"]',     'online',   1),
  ('rakuten',  '楽天市場',           '["Rakuten","楽天ブックス"]', 'online',   1),
  -- Mercari es C2C y no tiene API pública para consultar precios ajenos, y su
  -- scraping está prohibido: is_api = 0 y los precios entran a mano desde la ficha.
  ('mercari',  'メルカリ',           '["Mercari"]',                'online',   0),
  -- 駿河屋 y ブックオフ tienen tienda oficial en 楽天市場, así que sus precios de
  -- segunda mano entran por la API de Rakuten, sin rascar sus webs (que ambas
  -- prohíben). Por eso is_api = 1: el cron sí los consulta, vía Rakuten.
  ('surugaya', '駿河屋',             '["Suruga-ya","surugaya"]',   'online',   1),
  ('bookoff',  'ブックオフ',          '["BookOff","Book Off"]',     'online',   1),
  ('mandarake','まんだらけ',          '["Mandarake"]',              'online',   0),
  ('store',    'Tienda física',      NULL,                         'physical', 0);

-- INSERT OR IGNORE no toca las filas que ya existen, y 駿河屋 ya estaba con
-- is_api = 0. Sobre una base ya creada hace falta este UPDATE aparte.
UPDATE shops SET is_api = 1 WHERE slug IN ('surugaya', 'bookoff');

-- ---------------------------------------------------------------- catálogo

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jan          TEXT UNIQUE,
  name         TEXT NOT NULL,                         -- tal cual lo devuelve la tienda
  maker        TEXT,
  api_category TEXT,                                  -- lo que dijo la API, sin tocar
  image_url    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);

CREATE TABLE IF NOT EXISTS price_points (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  shop_id      INTEGER NOT NULL REFERENCES shops (id),
  condition_id INTEGER NOT NULL REFERENCES conditions (id),
  price        INTEGER NOT NULL,                      -- yenes enteros
  url          TEXT,
  seen_on      TEXT    NOT NULL,                      -- 'YYYY-MM-DD'
  source       TEXT    NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_points_daily
  ON price_points (product_id, shop_id, condition_id, seen_on);

CREATE INDEX IF NOT EXISTS idx_price_points_history
  ON price_points (product_id, seen_on DESC);

-- ---------------------------------------------------------------- colección

CREATE TABLE IF NOT EXISTS user_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories (id),
  status_id    INTEGER NOT NULL REFERENCES statuses (id),
  condition_id INTEGER NOT NULL REFERENCES conditions (id),
  paid_price   INTEGER,
  paid_on      TEXT,
  paid_shop_id INTEGER REFERENCES shops (id),
  sold_price   INTEGER,
  sold_on      TEXT,
  target_price INTEGER,
  photo_key    TEXT,                                  -- R2: fotos/{user_id}/{uuid}.jpg
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_items_unique
  ON user_items (user_id, product_id);

CREATE INDEX IF NOT EXISTS idx_user_items_owner
  ON user_items (user_id, status_id);

CREATE INDEX IF NOT EXISTS idx_user_items_category
  ON user_items (user_id, category_id);

-- Defectos de tu ejemplar concreto.
CREATE TABLE IF NOT EXISTS user_item_flags (
  user_item_id INTEGER NOT NULL REFERENCES user_items (id) ON DELETE CASCADE,
  flag_id      INTEGER NOT NULL REFERENCES flags (id) ON DELETE CASCADE,
  PRIMARY KEY (user_item_id, flag_id)
);

CREATE TABLE IF NOT EXISTS alert_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_item_id INTEGER NOT NULL REFERENCES user_items (id) ON DELETE CASCADE,
  price        INTEGER NOT NULL,
  shop_id      INTEGER NOT NULL REFERENCES shops (id),
  notified_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_log_item
  ON alert_log (user_item_id, notified_at DESC);

-- ---------------------------------------------------------------- vistas

-- Productos que el cron debe consultar: los que alguien sigue con un estado
-- marcado como track_price. Un estado nuevo tuyo entra aquí solo si lo pides.
CREATE VIEW IF NOT EXISTS tracked_products AS
SELECT DISTINCT p.id, p.jan, p.name
FROM products p
JOIN user_items ui ON ui.product_id = p.id
JOIN statuses   s  ON s.id = ui.status_id
WHERE p.jan IS NOT NULL
  AND s.track_price = 1;

CREATE VIEW IF NOT EXISTS latest_prices AS
SELECT product_id, shop_id, condition_id, price, url, seen_on
FROM (
  SELECT
    pp.*,
    ROW_NUMBER() OVER (
      PARTITION BY pp.product_id, pp.shop_id, pp.condition_id
      ORDER BY pp.seen_on DESC, pp.id DESC
    ) AS rn
  FROM price_points pp
)
WHERE rn = 1;

-- Las tres cifras de la cabecera, calculadas con la bandera in_collection.
CREATE VIEW IF NOT EXISTS collection_totals AS
SELECT
  ui.user_id,
  COUNT(*)                AS pieces,
  SUM(COALESCE(ui.paid_price, 0)) AS spent,
  SUM(COALESCE(
    (SELECT MIN(lp.price) FROM latest_prices lp WHERE lp.product_id = ui.product_id),
    ui.paid_price, 0
  ))                      AS worth
FROM user_items ui
JOIN statuses s ON s.id = ui.status_id
WHERE s.in_collection = 1
GROUP BY ui.user_id;

-- Nefuda · añadido de autenticación (pégalo al final de schema.sql antes de ejecutarlo)
--
-- Sustituye a Cloudflare Access. Ahora `users.id` es un UUID que genera el propio
-- Worker en el momento del registro, no el `sub` de un JWT externo.

CREATE TABLE IF NOT EXISTS credentials (
  -- Credential ID que devuelve el navegador, en base64url.
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Clave pública en base64url. Se guarda como TEXT y no como BLOB para no
  -- depender de cómo D1 enlaza los buffers entre versiones.
  public_key   TEXT NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                                 -- JSON: ["internal","hybrid"]
  device_name  TEXT,                                 -- "iPhone de Ana", para poder revocar
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials (user_id);
