/**
 * Nefuda · Worker
 *
 * Sirve la PWA (estáticos, vía [assets]) y la API. El cron diario refresca
 * precios y dispara alertas.
 *
 * Toda consulta sobre datos de usuario lleva `WHERE user_id = ?`. Sin excepción.
 */

import { handleAuth, currentUserId, type AuthEnv } from './auth';

export interface Env extends AuthEnv {
  DB: D1Database;
  FOTOS: R2Bucket;
  YAHOO_APP_ID: string;
  RAKUTEN_APP_ID: string;
}

interface ShopPrice {
  shopSlug: 'yahoo' | 'rakuten';
  price: number;
  url: string | null;
  image: string | null;
  name: string;
  maker: string | null;
  category: string | null;
}

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
    db.prepare(`SELECT id, slug, name FROM shops ORDER BY id`),
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
  if (!res.ok) return null;

  const hit = ((await res.json()) as any)?.hits?.[0];
  if (!hit) return null;

  return {
    shopSlug: 'yahoo',
    price: Number(hit.price),
    url: hit.url ?? null,
    image: hit.image?.medium ?? hit.image?.small ?? null,
    name: hit.name ?? '',
    maker: hit.brand?.name ?? null,
    category: hit.genreCategory?.name ?? null,
  };
}

async function rakutenByJan(jan: string, env: Env): Promise<ShopPrice | null> {
  // Rakuten no filtra por JAN, pero buscarlo como palabra clave funciona bien.
  const url =
    `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601` +
    `?applicationId=${env.RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=5&sort=%2BitemPrice`;

  const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!res.ok) return null;

  const raw = ((await res.json()) as any)?.Items?.[0];
  const hit = raw?.Item ?? raw;
  if (!hit) return null;

  return {
    shopSlug: 'rakuten',
    price: Number(hit.itemPrice),
    url: hit.itemUrl ?? null,
    image: hit.mediumImageUrls?.[0]?.imageUrl ?? null,
    name: hit.itemName ?? '',
    maker: hit.shopName ?? null,
    category: null,
  };
}

/** Los precios de API son siempre de producto nuevo: condición 'new'. */
async function savePrices(env: Env, productId: number, prices: ShopPrice[]) {
  if (prices.length === 0) return;
  const map = await slugs(env.DB);
  const conditionId = map.conditions.get('new')!;
  const day = today();

  const stmt = env.DB.prepare(
    `INSERT INTO price_points (product_id, shop_id, condition_id, price, url, seen_on, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'api')
     ON CONFLICT (product_id, shop_id, condition_id, seen_on)
     DO UPDATE SET price = excluded.price, url = excluded.url`
  );

  await env.DB.batch(
    prices
      .filter((p) => map.shops.has(p.shopSlug))
      .map((p) => stmt.bind(productId, map.shops.get(p.shopSlug)!, conditionId, p.price, p.url, day))
  );
}

// ---------------------------------------------------------------- rutas

async function lookupJan(jan: string, env: Env) {
  const [yahoo, rakuten] = await Promise.all([yahooByJan(jan, env), rakutenByJan(jan, env)]);
  const found = [yahoo, rakuten].filter((p): p is ShopPrice => p !== null);

  let product = await env.DB.prepare(
    `SELECT id, jan, name, maker, api_category, image_url FROM products WHERE jan = ?1`
  )
    .bind(jan)
    .first<any>();

  if (!product) {
    if (found.length === 0) return null;
    const best = found[0];
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
    prices: found
      .map((p) => ({ shop: p.shopSlug, price: p.price, url: p.url }))
      .sort((a, b) => a.price - b.price),
  };
}

/**
 * La colección. `best_price` se calcula contra el MISMO grado que tu ejemplar:
 * comparar una figura usada con el precio de tienda nueva infla el valor.
 * Si no hay precio de ese grado, cae a lo que pagaste en vez de inventar.
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
         WHERE lp.product_id = ui.product_id) AS retail_price
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
          await env.DB.prepare(`SELECT id, email, lang, currency FROM users WHERE id = ?1`)
            .bind(userId)
            .first()
        );
      }

      if (request.method === 'PATCH' && path === '/api/me') {
        const body = (await request.json()) as { lang?: string; currency?: string };
        await env.DB.prepare(
          `UPDATE users SET lang = COALESCE(?2, lang), currency = COALESCE(?3, currency) WHERE id = ?1`
        )
          .bind(userId, body.lang ?? null, body.currency ?? null)
          .run();
        return json({ ok: true });
      }

      if (request.method === 'GET' && path === '/api/lookup') {
        const jan = url.searchParams.get('jan');
        if (!jan || !/^\d{8,13}$/.test(jan)) return json({ error: 'JAN inválido' }, 400);
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
          const found = [yahoo, rakuten].filter((p): p is ShopPrice => p !== null);

          if (found.length > 0) {
            await savePrices(env, product.id, found);
            const best = found.reduce((a, b) => (a.price <= b.price ? a : b));

            // Objetivos por encima de este precio, sin aviso reciente.
            const { results: hits } = await env.DB.prepare(
              `SELECT ui.id, u.webhook_url
               FROM user_items ui
               JOIN users u     ON u.id = ui.user_id
               JOIN statuses st ON st.id = ui.status_id
               WHERE ui.product_id = ?1
                 AND st.track_price = 1
                 AND ui.target_price IS NOT NULL
                 AND ui.target_price >= ?2
                 AND NOT EXISTS (
                   SELECT 1 FROM alert_log al
                   WHERE al.user_item_id = ui.id
                     AND al.price <= ?2
                     AND al.notified_at > datetime('now', '-14 days')
                 )`
            )
              .bind(product.id, best.price)
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

          await sleep(1100); // respeta el límite de 1 req/s de Yahoo
        }
      })()
    );
  },
};
