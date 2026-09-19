/** Tipos que devuelve el Worker. Mantenlos alineados con schema.sql. */

export interface VocabRow {
  id: number;
  slug: string;
  name_es: string;
  name_en: string;
  name_ja: string;
}

export interface StatusRow extends VocabRow {
  in_collection: 0 | 1;
  track_price: 0 | 1;
}

export interface ConditionRow extends VocabRow {
  grade: number;
  from_api: 0 | 1;
}

export interface ShopRow {
  id: number;
  slug: string;
  name: string;
  kind: 'online' | 'physical';
  /** 0 = el cron no la consulta; es donde entran Mercari y 駿河屋, a mano. */
  is_api: 0 | 1;
}

export interface Vocab {
  categories: VocabRow[];
  statuses: StatusRow[];
  conditions: ConditionRow[];
  flags: VocabRow[];
  shops: ShopRow[];
}

export interface CollectionItem {
  id: number;
  product_id: number;
  jan: string | null;
  name: string;
  maker: string | null;
  image_url: string | null;
  category_id: number;
  status_id: number;
  condition_id: number;
  paid_price: number | null;
  paid_on: string | null;
  paid_shop_id: number | null;
  target_price: number | null;
  note: string | null;
  /** Mejor precio del MISMO grado que tu ejemplar. */
  best_price: number | null;
  /** Precio de tienda, producto nuevo. Va aparte a propósito: son dos líneas. */
  retail_price: number | null;
  photo_key: string | null;
}

/** Un precio por grado: lo que permite pintar «nuevo» y «usado» por separado. */
export interface PriceByCondition {
  condition_id: number;
  slug: string;
  name_es: string;
  name_en: string;
  name_ja: string;
  grade: number;
  price: number;
  shop_id: number;
  url: string | null;
  seen_on: string;
}

export interface ItemDetail extends CollectionItem {
  sold_price: number | null;
  sold_on: string | null;
  api_category: string | null;
  created_at: string;
  flag_ids: number[];
  prices_by_condition: PriceByCondition[];
}

/** Ficha del catalogo comun. `jan` es nulo en lo dado de alta a mano. */
export interface Product {
  id: number;
  jan: string | null;
  name: string;
  maker: string | null;
  api_category: string | null;
  image_url: string | null;
}

export interface LookupResult {
  product: Product;
  /** `condition` separa «nuevo en tienda» de «segunda mano»: nunca se funden. */
  prices: { shop: string; condition: string; price: number; url: string | null }[];
}

export interface Me {
  id: string;
  email: string;
  lang: 'es' | 'en' | 'ja';
  currency: 'JPY' | 'EUR';
  webhook_url: string | null;
}

export interface Credential {
  id: string;
  device_name: string | null;
  transports: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface HistoryPoint {
  shop: string;
  condition: string;
  price: number;
  seen_on: string;
  source: 'api' | 'manual';
}

export interface AlertsPayload {
  /** Avisos que ya salieron por el webhook. */
  recent: {
    id: number;
    price: number;
    notified_at: string;
    shop: string;
    item_id: number;
    target_price: number | null;
    condition_id: number;
    name: string;
    image_url: string | null;
  }[];
  /** Lo que el cron sigue mirando ahora mismo. */
  watching: {
    id: number;
    target_price: number | null;
    condition_id: number;
    status_id: number;
    name: string;
    image_url: string | null;
    best_price: number | null;
    retail_price: number | null;
  }[];
}

/** Campos editables de la ficha. Todos opcionales: se manda solo lo que cambia. */
export interface ItemPatch {
  category_id?: number;
  status_id?: number;
  condition_id?: number;
  paid_price?: number | null;
  paid_on?: string | null;
  paid_shop_id?: number | null;
  sold_price?: number | null;
  sold_on?: string | null;
  /** null quita el objetivo. Por eso el Worker no usa COALESCE. */
  target_price?: number | null;
  note?: string | null;
  /** Lista completa: sustituye a la anterior, no se acumula. */
  flag_ids?: number[];
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  // La cookie de sesión dura 30 días. Cuando caduca, App vuelve a Login solo:
  // basta con avisar de que ya no hay sesión.
  if (res.status === 401) {
    window.dispatchEvent(new Event('nefuda:signed-out'));
    throw new ApiError(401, 'sesión caducada');
  }
  if (!res.ok) {
    // El Worker manda {error: "..."} en todos los fallos; si no, queda el texto.
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* no era JSON: se usa el texto tal cual */
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  vocab: () => call<Vocab>('/api/vocab'),

  me: () => call<Me>('/api/me'),

  updateMe: (body: { lang?: string; currency?: string; webhook_url?: string | null }) =>
    call<{ ok: true }>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }),

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('nefuda:signed-out'));
  },

  collection: () => call<CollectionItem[]>('/api/items'),

  item: (itemId: number) => call<ItemDetail>(`/api/items/${itemId}`),

  patchItem: (itemId: number, body: ItemPatch) =>
    call<ItemDetail>(`/api/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteItem: (itemId: number) =>
    call<{ ok: true }>(`/api/items/${itemId}`, { method: 'DELETE' }),

  lookup: (jan: string) => call<LookupResult>(`/api/lookup?jan=${encodeURIComponent(jan)}`),

  /**
   * Alta manual, para lo que no vende ninguna tienda. Si el JAN ya existe en el
   * catalogo comun devuelve ese producto en vez de duplicarlo.
   */
  createProduct: (body: { jan?: string | null; name: string; maker?: string | null }) =>
    call<Product>('/api/products', { method: 'POST', body: JSON.stringify(body) }),

  addItem: (body: {
    product_id: number;
    category_id: number;
    status_id: number;
    condition_id: number;
    paid_price?: number | null;
    paid_shop_id?: number | null;
    target_price?: number | null;
    flag_ids?: number[];
  }) => call<{ id: number }>('/api/items', { method: 'POST', body: JSON.stringify(body) }),

  history: (itemId: number) => call<HistoryPoint[]>(`/api/items/${itemId}/history`),

  /** Así entran Mercari y 駿河屋: a mano, porque no hay API que consultarles. */
  manualPrice: (
    itemId: number,
    body: { shop_id: number; condition_id: number; price: number; url?: string | null; seen_on?: string }
  ) => call<{ ok: true }>(`/api/items/${itemId}/price`, { method: 'POST', body: JSON.stringify(body) }),

  alerts: () => call<AlertsPayload>('/api/alerts'),

  credentials: () => call<Credential[]>('/api/credentials'),

  /** Devuelve 409 si es la última: la cuenta se quedaría sin forma de entrar. */
  deleteCredential: (credentialId: string) =>
    call<{ ok: true }>(`/api/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' }),

  /** Sube una foto propia a R2 a través del Worker. */
  uploadPhoto: async (itemId: number, file: File) => {
    const res = await fetch(`/api/items/${itemId}/photo`, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!res.ok) throw new ApiError(res.status, 'no se pudo subir la foto');
    return res.json() as Promise<{ photo_key: string }>;
  },
};
