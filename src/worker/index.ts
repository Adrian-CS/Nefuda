/**
 * Nefuda · Worker
 *
 * Sirve la PWA (estáticos, vía [assets]) y la API. El cron diario refresca
 * precios y dispara alertas.
 *
 * Toda consulta sobre datos de usuario lleva `WHERE user_id = ?`. Sin excepción.
 */

import { handleAuth, currentUserId, type AuthEnv } from './auth';
import { isLookupableJan } from '../lib/jan';

export interface Env extends AuthEnv {
  DB: D1Database;
  FOTOS: R2Bucket;
  YAHOO_APP_ID: string;
  RAKUTEN_APP_ID: string;
}

interface ShopPrice {
  shopSlug: string;
  /** El grado ya no se da por supuesto: 駿河屋 y ブックオフ venden de segunda mano. */
  conditionSlug: 'new' | 'used';
  price: number;
  url: string | null;
  image: string | null;
  name: string;
  maker: string | null;
  category: string | null;
}

/**
 * Tiendas de segunda mano con escaparate oficial en 楽天市場. Se consultan por
 * la API de Rakuten, NO rascando su web: 駿河屋 lo prohíbe en sus términos, y
 * aquí no hace falta, porque su tienda de Rakuten entra por la vía oficial.
 *
 * `code` es el shopCode de Rakuten: el trozo de rakuten.co.jp/<code>/.
 */
const USED_SHOPS: ReadonlyArray<{ code: string; slug: string }> = [
  { code: 'surugaya-a-too', slug: 'surugaya' },
  { code: 'bookoffonline', slug: 'bookoff' },
];

/**
 * Las dos venden nuevo Y usado, así que la tienda por sí sola no dice el grado:
 * lo dice el título del anuncio. Si un anuncio no lleva marca no se guarda, ni
 * como nuevo ni como usado. Antes sin precio que con el precio de otro grado.
 */
const USED_MARKER = /中古|ユーズド|\bused\b/i;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- vocabularios
// shops y conditions son globales (sin owner_id), así que se pueden cachear en
// memoria del isolate. Las categorías y los estados NO se cachean: dependen del
// usuario y cambian cuando alguien crea los suyos.

let slugCache: { shops: Map<string, number>; conditions: Map<string, number> } | null = null;

async function slugs(db: D1Database) {
  if (slugCache) return slugCache;
  const [shops, conditions] = await db.batch<{ id: number; slug: string }>([
    db.prepare(`SELECT id, slug FROM shops`),
    db.prepare(`SELECT id, slug FROM conditions WHERE owner_id IS NULL`),
  ]);
  slugCache = {
    shops: new Map(shops.results.map((r) => [r.slug, r.id])),
    conditions: new Map(conditions.results.map((r) => [r.slug, r.id])),
  };
  return slugCache;
}

async function vocabFor(db: D1Database, userId: string) {
  const mine = `WHERE owner_id IS NULL OR owner_id = ?1`;
  const [categories, statuses, conditions, flags, shops] = await db.batch([
    db.prepare(`SELECT id, slug, name_es, name_en, name_ja, sort FROM categories ${mine} ORDER BY sort, id`).bind(userId),
    db.prepare(`SELECT id, slug, name_es, name_en, name_ja, in_collection, track_price, sort FROM statuses ${mine} ORDER BY sort, id`).bind(userId),
    db.prepare(`SELECT id, slug, name_es, name_en, name_ja, grade, from_api FROM conditions ${mine} ORDER BY grade DESC`).bind(userId),
    db.prepare(`SELECT id, slug, name_es, name_en, name_ja, sort FROM flags ${mine} ORDER BY sort, id`).bind(userId),
    db.prepare(`SELECT id, slug, name, kind, is_api FROM shops ORDER BY is_api DESC, id`),
  ]);
  return {
    categories: categories.results,
    statuses: statuses.results,
    conditions: conditions.results,
    flags: flags.results,
    shops: shops.results,
  };
}

// ---------------------------------------------------------------- tiendas
// Verifica los nombres de campo contra la documentación vigente antes de
// desplegar: ambas APIs han cambiado de forma entre versiones y fallan callando.

async function yahooByJan(jan: string, env: Env): Promise<ShopPrice | null> {
  const url =
    `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch` +
    `?appid=${env.YAHOO_APP_ID}&jan_code=${encodeURIComponent(jan)}&results=5&sort=%2Bprice`;

  const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
  console.log(`[diag] yahoo ${jan} -> HTTP ${res.status}`); // TEMPORAL
  if (!res.ok) return null;

  const hit = ((await res.json()) as any)?.hits?.[0];
  if (!hit) return null;

  return {
    shopSlug: 'yahoo',
    conditionSlug: 'new',
    price: Number(hit.price),
    url: hit.url ?? null,
    image: hit.image?.medium ?? hit.image?.small ?? null,
    name: hit.name ?? '',
    maker: hit.brand?.name ?? null,
    category: hit.genreCategory?.name ?? null,
  };
}

/**
 * Rakuten devuelve VARIOS precios: el de tienda nueva y el de las tiendas de
 * segunda mano que tienen escaparate en 楽天市場.
 *
 * Se piden 30 resultados (el máximo) en vez de 5 y se reparten por tienda, en
 * lugar de hacer una llamada por tienda. Así esto no gasta ni una subrequest
 * más ni otro hueco del límite de una consulta por segundo, que en el plan
 * gratuito de Workers es lo que acaba poniendo el techo.
 */
async function rakutenByJan(jan: string, env: Env): Promise<ShopPrice[]> {
  // Rakuten no filtra por JAN, pero buscarlo como palabra clave funciona bien.
  const url =
    `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601` +
    `?applicationId=${env.RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=30&sort=%2BitemPrice`;

  const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });

  // ------------------------------------------------------------------
  // TEMPORAL: diagnóstico de los shopCode y de la versión del endpoint.
  // Se quita en cuanto sepamos qué devuelve de verdad. Ver `wrangler tail`.
  // ------------------------------------------------------------------
  console.log(`[diag] rakuten ${jan} -> HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`[diag] rakuten ERROR: ${(await res.text()).slice(0, 300)}`);
    return [];
  }

  const items = ((await res.json()) as any)?.Items ?? [];

  console.log(`[diag] rakuten items=${items.length}`);
  console.log(`[diag] rakuten claves=${Object.keys(items[0]?.Item ?? items[0] ?? {}).join(',')}`);
  for (const r of items.slice(0, 30)) {
    const h = r?.Item ?? r;
    console.log(
      `[diag]   ${h?.shopCode ?? '(SIN shopCode)'} | ${h?.itemPrice} | ${String(h?.itemName ?? '').slice(0, 45)}`
    );
  }
  // ------------------------------------------------------------------
  const found: ShopPrice[] = [];
  const seen = new Set<string>();

  // Vienen ordenados por precio ascendente, así que el primero de cada tienda
  // ya es el más barato de esa tienda: con quedarse con ese basta.
  for (const raw of items) {
    const hit = raw?.Item ?? raw;
    const price = Number(hit?.itemPrice);
    if (!hit || !Number.isFinite(price) || price <= 0) continue;

    const name = String(hit.itemName ?? '');
    const used = USED_MARKER.test(name);
    const usedShop = USED_SHOPS.find((s) => s.code === hit.shopCode);

    // Tienda de segunda mano: solo cuenta si el título lo confirma. Cualquier
    // otra: solo cuenta como nueva si el título no lo desmiente. Lo que no se
    // puede clasificar se tira, que es mejor que colocarlo en el grado que no es.
    let slug: string;
    if (usedShop) {
      if (!used) continue;
      slug = usedShop.slug;
    } else {
      if (used) continue;
      slug = 'rakuten';
    }

    if (seen.has(slug)) continue;
    seen.add(slug);

    found.push({
      shopSlug: slug,
      conditionSlug: used ? 'used' : 'new',
      price,
      url: hit.itemUrl ?? null,
      image: hit.mediumImageUrls?.[0]?.imageUrl ?? null,
      name,
      // En los de segunda mano el título va lleno de 【中古】 y marcas de estado,
      // y shopName es la tienda, no el fabricante: no sirve para nombrar la ficha.
      maker: usedShop ? null : (hit.shopName ?? null),
      category: null,
    });
  }

  return found;
}

/**
 * El grado lo trae cada precio. Ya no vale darlo por 'new': 駿河屋 y ブックオフ
 * entran por la API de Rakuten y lo que mandan es segunda mano.
 */
async function savePrices(env: Env, productId: number, prices: ShopPrice[]) {
  if (prices.length === 0) return;
  const map = await slugs(env.DB);
  const day = today();

  const stmt = env.DB.prepare(
    `INSERT INTO price_points (product_id, shop_id, condition_id, price, url, seen_on, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'api')
     ON CONFLICT (product_id, shop_id, condition_id, seen_on)
     DO UPDATE SET price = excluded.price, url = excluded.url`
  );

  // Una tienda o un grado que no esté en su tabla se descarta: es preferible
  // perder ese precio a plantarlo con el id de otra cosa.
  const rows = prices
    .filter((p) => map.shops.has(p.shopSlug) && map.conditions.has(p.conditionSlug))
    .map((p) =>
      stmt.bind(
        productId,
        map.shops.get(p.shopSlug)!,
        map.conditions.get(p.conditionSlug)!,
        p.price,
        p.url,
        day
      )
    );

  // batch([]) revienta: sin filas, no hay nada que escribir.
  if (rows.length > 0) await env.DB.batch(rows);
}

// ---------------------------------------------------------------- rutas

async function lookupJan(jan: string, env: Env) {
  const [yahoo, rakuten] = await Promise.all([yahooByJan(jan, env), rakutenByJan(jan, env)]);
  const found = [...(yahoo ? [yahoo] : []), ...rakuten];

  let product = await env.DB.prepare(
    `SELECT id, jan, name, maker, api_category, image_url FROM products WHERE jan = ?1`
  )
    .bind(jan)
    .first<any>();

  if (!product) {
    if (found.length === 0) return null;
    // La ficha se nombra desde un anuncio NUEVO: los de segunda mano llevan el
    // título lleno de 【中古】 y de marcas de estado, y eso no es el producto.
    const best = found.find((p) => p.conditionSlug === 'new') ?? found[0];
    product = await env.DB.prepare(
      `INSERT INTO products (jan, name, maker, api_category, image_url) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (jan) DO UPDATE SET name = excluded.name
       RETURNING id, jan, name, maker, api_category, image_url`
    )
      .bind(jan, best.name, best.maker, best.category, best.image)
      .first<any>();
  }

  await savePrices(env, product.id, found);

  return {
    product,
    // El grado viaja con cada precio: la pantalla pinta «nuevo en tienda» y
    // «segunda mano» en líneas distintas sin tener que adivinar cuál es cuál.
    prices: found
      .map((p) => ({ shop: p.shopSlug, condition: p.conditionSlug, price: p.price, url: p.url }))
      .sort((a, b) => a.price - b.price),
  };
}

/**
 * La colección. `best_price` se calcula contra el MISMO grado que tu ejemplar:
 * comparar una figura usada con el precio de tienda nueva infla el valor.
 * Si no hay precio de ese grado, cae a lo que pagaste en vez de inventar.
 *
 * `retail_price` es aparte y SOLO del grado 'new': es la línea de «nuevo en
 * tienda». Sin acotarlo, un precio manual de Mercari más barato se colaría ahí
 * y la ficha enseñaría segunda mano diciendo que es precio de tienda.
 */
async function listCollection(userId: string, env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT
       ui.id, ui.product_id, ui.category_id, ui.status_id, ui.condition_id,
       ui.paid_price, ui.paid_on, ui.paid_shop_id, ui.target_price, ui.photo_key, ui.note,
       p.jan, p.name, p.maker, p.image_url,
       (SELECT MIN(lp.price) FROM latest_prices lp
         WHERE lp.product_id = ui.product_id AND lp.condition_id = ui.condition_id) AS best_price,
       (SELECT MIN(lp.price) FROM latest_prices lp
         JOIN conditions c ON c.id = lp.condition_id
         WHERE lp.product_id = ui.product_id
           AND c.owner_id IS NULL AND c.slug = 'new') AS retail_price
     FROM user_items ui
     JOIN products p ON p.id = ui.product_id
     WHERE ui.user_id = ?1
     ORDER BY ui.created_at DESC`
  )
    .bind(userId)
    .all();

  return results;
}

async function addToCollection(userId: string, body: any, env: Env) {
  const row = await env.DB.prepare(
    `INSERT INTO user_items
       (user_id, product_id, category_id, status_id, condition_id,
        paid_price, paid_on, paid_shop_id, target_price, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT (user_id, product_id) DO UPDATE SET
       category_id  = excluded.category_id,
       status_id    = excluded.status_id,
       condition_id = excluded.condition_id,
       paid_price   = excluded.paid_price,
       target_price = excluded.target_price
     RETURNING id`
  )
    .bind(
      userId,
      body.product_id,
      body.category_id,
      body.status_id,
      body.condition_id,
      body.paid_price ?? null,
      body.paid_on ?? today(),
      body.paid_shop_id ?? null,
      body.target_price ?? null,
      body.note ?? null
    )
    .first<{ id: number }>();

  const flagIds: number[] = body.flag_ids ?? [];
  if (flagIds.length > 0) {
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO user_item_flags (user_item_id, flag_id) VALUES (?1, ?2)`
    );
    await env.DB.batch(flagIds.map((f) => stmt.bind(row!.id, f)));
  }

  return row;
}

/** Precio anotado a mano: así entran Mercari, 駿河屋 y la tienda de la esquina. */
async function addManualPrice(userId: string, itemId: string, body: any, env: Env) {
  const owns = await env.DB.prepare(
    `SELECT product_id FROM user_items WHERE id = ?1 AND user_id = ?2`
  )
    .bind(itemId, userId)
    .first<{ product_id: number }>();
  if (!owns) return null;

  await env.DB.prepare(
    `INSERT INTO price_points (product_id, shop_id, condition_id, price, url, seen_on, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual')
     ON CONFLICT (product_id, shop_id, condition_id, seen_on)
     DO UPDATE SET price = excluded.price`
  )
    .bind(
      owns.product_id,
      body.shop_id,
      body.condition_id,
      body.price,
      body.url ?? null,
      body.seen_on ?? today()
    )
    .run();

  return { ok: true };
}

async function priceHistory(userId: string, itemId: string, env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT s.slug AS shop, c.slug AS condition, pp.price, pp.seen_on, pp.source
     FROM price_points pp
     JOIN user_items ui ON ui.product_id = pp.product_id
     JOIN shops s      ON s.id = pp.shop_id
     JOIN conditions c ON c.id = pp.condition_id
     WHERE ui.id = ?1 AND ui.user_id = ?2
     ORDER BY pp.seen_on ASC`
  )
    .bind(itemId, userId)
    .all();

  return results;
}

async function putPhoto(userId: string, itemId: string, request: Request, env: Env) {
  const owns = await env.DB.prepare(`SELECT id FROM user_items WHERE id = ?1 AND user_id = ?2`)
    .bind(itemId, userId)
    .first();
  if (!owns) return null;

  // El prefijo con el user_id es lo que impide que nadie lea las fotos de otro.
  const key = `fotos/${userId}/${crypto.randomUUID()}`;
  await env.FOTOS.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') ?? 'image/jpeg' },
  });

  await env.DB.prepare(`UPDATE user_items SET photo_key = ?2 WHERE id = ?1`)
    .bind(itemId, key)
    .run();

  return { photo_key: key };
}

async function getPhoto(userId: string, key: string, env: Env) {
  if (!key.startsWith(`fotos/${userId}/`)) return null;
  const object = await env.FOTOS.get(key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'image/jpeg',
      'cache-control': 'private, max-age=86400',
    },
  });
}

/**
 * Ficha de un ejemplar. Devuelve los precios AGRUPADOS POR GRADO en vez de un
 * único «ahora vale»: la pantalla pinta una línea por condición (nuevo en
 * tienda / segunda mano) sin tener que adivinar nada.
 */
async function getItem(userId: string, itemId: string, env: Env) {
  const item = await env.DB.prepare(
    `SELECT
       ui.id, ui.product_id, ui.category_id, ui.status_id, ui.condition_id,
       ui.paid_price, ui.paid_on, ui.paid_shop_id, ui.sold_price, ui.sold_on,
       ui.target_price, ui.photo_key, ui.note, ui.created_at,
       p.jan, p.name, p.maker, p.api_category, p.image_url,
       (SELECT MIN(lp.price) FROM latest_prices lp
         WHERE lp.product_id = ui.product_id AND lp.condition_id = ui.condition_id) AS best_price,
       (SELECT MIN(lp.price) FROM latest_prices lp
         JOIN conditions c ON c.id = lp.condition_id
         WHERE lp.product_id = ui.product_id
           AND c.owner_id IS NULL AND c.slug = 'new') AS retail_price
     FROM user_items ui
     JOIN products p ON p.id = ui.product_id
     WHERE ui.id = ?1 AND ui.user_id = ?2`
  )
    .bind(itemId, userId)
    .first<any>();

  if (!item) return null;

  const [flags, prices] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT flag_id FROM user_item_flags WHERE user_item_id = ?1`).bind(item.id),
    // Las columnas sueltas junto a MIN() salen de la fila del mínimo: es una
    // garantía de SQLite, no una casualidad. Así viene la tienda del más barato.
    env.DB.prepare(
      `SELECT c.id AS condition_id, c.slug, c.name_es, c.name_en, c.name_ja, c.grade,
              MIN(lp.price) AS price, lp.shop_id, lp.url, lp.seen_on
       FROM latest_prices lp
       JOIN conditions c ON c.id = lp.condition_id
       WHERE lp.product_id = ?1
       GROUP BY c.id
       ORDER BY c.grade DESC`
    ).bind(item.product_id),
  ]);

  return {
    ...item,
    flag_ids: flags.results.map((r: any) => r.flag_id),
    prices_by_condition: prices.results,
  };
}

/**
 * Campos que se pueden tocar desde la ficha, con su tipo. Lo que no esté aquí
 * se ignora: el cuerpo de la petición no decide qué columnas existen.
 */
const ITEM_FIELDS: Record<string, 'int' | 'text'> = {
  category_id: 'int',
  status_id: 'int',
  condition_id: 'int',
  paid_price: 'int',
  paid_on: 'text',
  paid_shop_id: 'int',
  sold_price: 'int',
  sold_on: 'text',
  target_price: 'int',
  note: 'text',
};

/**
 * El SET se construye solo con las claves presentes. No sirve COALESCE(?, col)
 * como en /api/me: con eso nunca se podría BORRAR un precio objetivo, y quitar
 * un objetivo tiene que ser posible.
 */
async function patchItem(userId: string, itemId: string, body: any, env: Env) {
  const owns = await env.DB.prepare(`SELECT id FROM user_items WHERE id = ?1 AND user_id = ?2`)
    .bind(itemId, userId)
    .first<{ id: number }>();
  if (!owns) return null;

  const sets: string[] = [];
  const values: (number | string | null)[] = [];

  for (const [key, kind] of Object.entries(ITEM_FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];

    if (raw === null || raw === '') {
      sets.push(`${key} = ?${values.length + 1}`);
      values.push(null);
      continue;
    }

    if (kind === 'int') {
      const n = Math.trunc(Number(raw));
      if (!Number.isFinite(n)) return { error: `${key} no es un número` };
      sets.push(`${key} = ?${values.length + 1}`);
      values.push(n);
    } else {
      sets.push(`${key} = ?${values.length + 1}`);
      values.push(String(raw));
    }
  }

  const statements: D1PreparedStatement[] = [];

  if (sets.length > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE user_items SET ${sets.join(', ')}
         WHERE id = ?${values.length + 1} AND user_id = ?${values.length + 2}`
      ).bind(...values, itemId, userId)
    );
  }

  // Los defectos llegan como lista completa: se sustituyen, no se acumulan.
  if (Array.isArray(body.flag_ids)) {
    statements.push(
      env.DB.prepare(`DELETE FROM user_item_flags WHERE user_item_id = ?1`).bind(owns.id)
    );
    const insert = env.DB.prepare(
      `INSERT OR IGNORE INTO user_item_flags (user_item_id, flag_id) VALUES (?1, ?2)`
    );
    for (const flagId of body.flag_ids) {
      statements.push(insert.bind(owns.id, Math.trunc(Number(flagId))));
    }
  }

  // D1 no tiene BEGIN/COMMIT: batch() es lo que da atomicidad.
  if (statements.length > 0) await env.DB.batch(statements);

  return getItem(userId, itemId, env);
}

async function deleteItem(userId: string, itemId: string, env: Env) {
  const res = await env.DB.prepare(`DELETE FROM user_items WHERE id = ?1 AND user_id = ?2`)
    .bind(itemId, userId)
    .run();

  // Las flags y el historial de avisos se van solos por ON DELETE CASCADE.
  // Los price_points NO: son del catálogo común y le sirven al siguiente.
  return res.meta.changes > 0 ? { ok: true } : null;
}

/**
 * Pantalla de alertas: lo que ya avisó el cron, y lo que está vigilando ahora.
 * `track_price` sale de la tabla de estados, nunca de comparar slugs.
 */
async function listAlerts(userId: string, env: Env) {
  const [recent, watching] = await env.DB.batch<any>([
    env.DB.prepare(
      `SELECT al.id, al.price, al.notified_at, s.slug AS shop,
              ui.id AS item_id, ui.target_price, ui.condition_id,
              p.name, p.image_url
       FROM alert_log al
       JOIN user_items ui ON ui.id = al.user_item_id
       JOIN products p    ON p.id = ui.product_id
       JOIN shops s       ON s.id = al.shop_id
       WHERE ui.user_id = ?1
       ORDER BY al.notified_at DESC
       LIMIT 50`
    ).bind(userId),
    env.DB.prepare(
      `SELECT ui.id, ui.target_price, ui.condition_id, ui.status_id,
              p.name, p.image_url,
              (SELECT MIN(lp.price) FROM latest_prices lp
                WHERE lp.product_id = ui.product_id AND lp.condition_id = ui.condition_id) AS best_price,
              (SELECT MIN(lp.price) FROM latest_prices lp
                JOIN conditions c ON c.id = lp.condition_id
                WHERE lp.product_id = ui.product_id
                  AND c.owner_id IS NULL AND c.slug = 'new') AS retail_price
       FROM user_items ui
       JOIN products p  ON p.id = ui.product_id
       JOIN statuses st ON st.id = ui.status_id
       WHERE ui.user_id = ?1 AND st.track_price = 1
       ORDER BY ui.target_price IS NULL, ui.created_at DESC`
    ).bind(userId),
  ]);

  return { recent: recent.results, watching: watching.results };
}

// ---- passkeys: listarlas y revocarlas desde Ajustes -------------------------

async function listCredentials(userId: string, env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, device_name, transports, created_at, last_used_at
     FROM credentials WHERE user_id = ?1 ORDER BY created_at DESC`
  )
    .bind(userId)
    .all();
  return results;
}

async function deleteCredential(userId: string, credentialId: string, env: Env) {
  // Borrar la última passkey deja la cuenta inaccesible para siempre: no hay
  // contraseña de reserva ni forma de recuperarla.
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?1`)
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) return { error: 'es la única passkey de la cuenta' };

  const res = await env.DB.prepare(`DELETE FROM credentials WHERE id = ?1 AND user_id = ?2`)
    .bind(credentialId, userId)
    .run();
  return res.meta.changes > 0 ? { ok: true } : null;
}

/**
 * Alta manual de un producto, para lo que ninguna tienda tiene: doujinshi,
 * cosas descatalogadas, importaciones, o cajas cuyo codigo no reconoce nadie.
 *
 * Ojo con una cosa: el catalogo es COMUN a las dos cuentas, asi que esto no
 * lleva user_id. De ahi que, si el JAN ya existe, se devuelva el producto que
 * hay en lugar de actualizarlo: nadie deberia poder renombrar de un plumazo la
 * ficha que la otra persona ya esta siguiendo.
 *
 * El JAN es opcional. Si lo lleva, el cron lo consultara cada manana por si
 * algun dia aparece en una tienda; sin el, solo tendra los precios que anotes
 * a mano, que es justo lo que toca para lo que no se vende en ningun sitio.
 */
async function createProduct(body: any, env: Env) {
  const name = String(body.name ?? '').trim();
  if (name === '') return { error: 'falta el nombre' };

  const jan = body.jan ? String(body.jan).trim() : null;
  if (jan !== null && !/^\d{8,13}$/.test(jan)) return { error: 'JAN inválido' };

  if (jan !== null) {
    const existing = await env.DB.prepare(
      `SELECT id, jan, name, maker, api_category, image_url FROM products WHERE jan = ?1`
    )
      .bind(jan)
      .first<any>();
    // Ya estaba: se devuelve tal cual, y el 200 de la ruta lo distingue de un
    // alta nueva. Renombrarlo pisaria la ficha que la otra persona ya sigue.
    if (existing) return { product: existing, created: false };
  }

  const maker = body.maker ? String(body.maker).trim().slice(0, 120) : null;

  const product = await env.DB.prepare(
    `INSERT INTO products (jan, name, maker, image_url) VALUES (?1, ?2, ?3, NULL)
     RETURNING id, jan, name, maker, api_category, image_url`
  )
    .bind(jan, name.slice(0, 200), maker)
    .first<any>();

  return product ? { product, created: true } : null;
}

// ---------------------------------------------------------------- entrada

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Login y registro van antes de exigir sesión, evidentemente.
    const auth = await handleAuth(request, env);
    if (auth) return auth;

    const userId = await currentUserId(request, env);
    if (!userId) return json({ error: 'no autenticado' }, 401);

    try {
      if (request.method === 'GET' && path === '/api/vocab') {
        return json(await vocabFor(env.DB, userId));
      }

      if (request.method === 'GET' && path === '/api/me') {
        return json(
          await env.DB.prepare(`SELECT id, email, lang, currency, webhook_url FROM users WHERE id = ?1`)
            .bind(userId)
            .first()
        );
      }

      if (request.method === 'PATCH' && path === '/api/me') {
        const body = (await request.json()) as {
          lang?: string;
          currency?: string;
          webhook_url?: string | null;
        };

        // lang y currency llevan CHECK en el esquema: validarlos aquí devuelve
        // un 400 claro en vez de un 500 con el error de SQLite dentro.
        if (body.lang && !['es', 'en', 'ja'].includes(body.lang)) {
          return json({ error: 'idioma no válido' }, 400);
        }
        if (body.currency && !['JPY', 'EUR'].includes(body.currency)) {
          return json({ error: 'moneda no válida' }, 400);
        }

        // El cron hace POST a esta URL sin mirarla. Exigir https y descartar
        // lo que no sea una URL evita guardar ahí cualquier cosa por descuido.
        // Cadena vacía = quitar el webhook; ausente = no tocarlo.
        let webhook: string | null | undefined;
        if ('webhook_url' in body) {
          const raw = (body.webhook_url ?? '').trim();
          if (raw === '') {
            webhook = null;
          } else {
            let parsed: URL;
            try {
              parsed = new URL(raw);
            } catch {
              return json({ error: 'webhook no válido' }, 400);
            }
            if (parsed.protocol !== 'https:') {
              return json({ error: 'el webhook debe ser https' }, 400);
            }
            webhook = parsed.toString();
          }
        }

        await env.DB.prepare(
          `UPDATE users SET
             lang        = COALESCE(?2, lang),
             currency    = COALESCE(?3, currency),
             webhook_url = CASE WHEN ?5 = 1 THEN ?4 ELSE webhook_url END
           WHERE id = ?1`
        )
          .bind(
            userId,
            body.lang ?? null,
            body.currency ?? null,
            webhook ?? null,
            webhook === undefined ? 0 : 1
          )
          .run();

        return json({ ok: true });
      }

      if (request.method === 'GET' && path === '/api/lookup') {
        const jan = url.searchParams.get('jan');
        // isLookupableJan descarta también el código de precio del manga: un
        // cliente viejo o una llamada a mano no van a gastar cuota de Yahoo.
        if (!jan || !isLookupableJan(jan)) return json({ error: 'JAN inválido' }, 400);
        const hit = await lookupJan(jan, env);
        return hit ? json(hit) : json({ error: 'no encontrado' }, 404);
      }

      if (path === '/api/items') {
        if (request.method === 'GET') return json(await listCollection(userId, env));
        if (request.method === 'POST') {
          return json(await addToCollection(userId, await request.json(), env), 201);
        }
      }

      const history = path.match(/^\/api\/items\/(\d+)\/history$/);
      if (request.method === 'GET' && history) {
        return json(await priceHistory(userId, history[1], env));
      }

      const manual = path.match(/^\/api\/items\/(\d+)\/price$/);
      if (request.method === 'POST' && manual) {
        const done = await addManualPrice(userId, manual[1], await request.json(), env);
        return done ? json(done, 201) : json({ error: 'no encontrado' }, 404);
      }

      const photo = path.match(/^\/api\/items\/(\d+)\/photo$/);
      if (request.method === 'PUT' && photo) {
        const done = await putPhoto(userId, photo[1], request, env);
        return done ? json(done) : json({ error: 'no encontrado' }, 404);
      }

      if (request.method === 'GET' && path.startsWith('/api/photo/')) {
        const res = await getPhoto(userId, decodeURIComponent(path.slice('/api/photo/'.length)), env);
        return res ?? json({ error: 'no encontrado' }, 404);
      }

      // Ficha: leer, editar y borrar. Las tres comprueban el dueño dentro.
      const one = path.match(/^\/api\/items\/(\d+)$/);
      if (one) {
        if (request.method === 'GET') {
          const found = await getItem(userId, one[1], env);
          return found ? json(found) : json({ error: 'no encontrado' }, 404);
        }
        if (request.method === 'PATCH') {
          const done = await patchItem(userId, one[1], await request.json(), env);
          if (!done) return json({ error: 'no encontrado' }, 404);
          return done.error ? json(done, 400) : json(done);
        }
        if (request.method === 'DELETE') {
          const done = await deleteItem(userId, one[1], env);
          return done ? json(done) : json({ error: 'no encontrado' }, 404);
        }
      }

      // Lo que no encuentra ninguna tienda entra por aqui, a mano.
      if (request.method === 'POST' && path === '/api/products') {
        const made = await createProduct(await request.json(), env);
        if (!made) return json({ error: 'no se pudo crear' }, 500);
        if (made.error) return json(made, 400);
        return json(made.product, made.created ? 201 : 200);
      }

      if (request.method === 'GET' && path === '/api/alerts') {
        return json(await listAlerts(userId, env));
      }

      if (request.method === 'GET' && path === '/api/credentials') {
        return json(await listCredentials(userId, env));
      }

      // El id de una credencial es base64url, no un número: no vale \d+.
      const credential = path.match(/^\/api\/credentials\/([A-Za-z0-9_%-]+)$/);
      if (request.method === 'DELETE' && credential) {
        const done = await deleteCredential(userId, decodeURIComponent(credential[1]), env);
        if (!done) return json({ error: 'no encontrado' }, 404);
        // 409: la credencial existe, pero es la última y dejaría fuera al dueño.
        return done.error ? json(done, 409) : json(done);
      }

      return json({ error: 'ruta desconocida' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'error interno' }, 500);
    }
  },

  /**
   * Cron diario. Recorre PRODUCTOS, no usuarios: si dos personas siguen la misma
   * figura es una sola llamada. Yahoo limita a 1 consulta por segundo.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const { results: products } = await env.DB.prepare(
          `SELECT id, jan, name FROM tracked_products`
        ).all<{ id: number; jan: string; name: string }>();

        const map = await slugs(env.DB);

        for (const product of products) {
          const [yahoo, rakuten] = await Promise.all([
            yahooByJan(product.jan, env),
            rakutenByJan(product.jan, env),
          ]);
          // Se filtra aquí y no solo dentro de savePrices porque el aviso hace
          // map.shops.get(slug)! sin red: una tienda que no esté en la tabla
          // (esquema sin actualizar) sería un bind con undefined.
          const found = [...(yahoo ? [yahoo] : []), ...rakuten].filter(
            (p) => map.shops.has(p.shopSlug) && map.conditions.has(p.conditionSlug)
          );

          if (found.length > 0) {
            await savePrices(env, product.id, found);

            // El más barato DE CADA GRADO, no el más barato a secas. Mezclarlos
            // avisaría de que tu figura usada ha bajado porque hay una nueva
            // barata en tienda: justo la comparación que este proyecto evita.
            const bestByCondition = new Map<string, ShopPrice>();
            for (const p of found) {
              const prev = bestByCondition.get(p.conditionSlug);
              if (!prev || p.price < prev.price) bestByCondition.set(p.conditionSlug, p);
            }

            for (const [conditionSlug, best] of bestByCondition) {
              const conditionId = map.conditions.get(conditionSlug);
              if (conditionId === undefined) continue;

              // Objetivos por encima de este precio, sin aviso reciente, y solo
              // de quien tenga un ejemplar DE ESTE grado.
              const { results: hits } = await env.DB.prepare(
                `SELECT ui.id, u.webhook_url
                 FROM user_items ui
                 JOIN users u     ON u.id = ui.user_id
                 JOIN statuses st ON st.id = ui.status_id
                 WHERE ui.product_id = ?1
                   AND st.track_price = 1
                   AND ui.condition_id = ?3
                   AND ui.target_price IS NOT NULL
                   AND ui.target_price >= ?2
                   AND NOT EXISTS (
                     SELECT 1 FROM alert_log al
                     WHERE al.user_item_id = ui.id
                       AND al.price <= ?2
                       AND al.notified_at > datetime('now', '-14 days')
                   )`
              )
                .bind(product.id, best.price, conditionId)
                .all<{ id: number; webhook_url: string | null }>();

              for (const hit of hits) {
                if (hit.webhook_url) {
                  await fetch(hit.webhook_url, {
                    method: 'POST',
                    headers: JSON_HEADERS,
                    body: JSON.stringify({
                      content: `${product.name} — ¥${best.price.toLocaleString('ja-JP')} (${best.shopSlug})\n${best.url ?? ''}`,
                    }),
                  }).catch(() => {});
                }
                await env.DB.prepare(
                  `INSERT INTO alert_log (user_item_id, price, shop_id) VALUES (?1, ?2, ?3)`
                )
                  .bind(hit.id, best.price, map.shops.get(best.shopSlug)!)
                  .run();
              }
            }
          }

          await sleep(1100); // respeta el límite de 1 req/s de Yahoo
        }
      })()
    );
  },
};
