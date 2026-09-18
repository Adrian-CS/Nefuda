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

export interface Vocab {
  categories: VocabRow[];
  statuses: StatusRow[];
  conditions: ConditionRow[];
  flags: VocabRow[];
  shops: { id: number; slug: string; name: string }[];
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
  target_price: number | null;
  best_price: number | null;
  photo_key: string | null;
}

export interface LookupResult {
  product: { id: number; jan: string; name: string; maker: string | null; image_url: string | null };
  prices: { shop: string; price: number; url: string | null }[];
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
  if (!res.ok) throw new ApiError(res.status, await res.text());

  return res.json() as Promise<T>;
}

export const api = {
  vocab: () => call<Vocab>('/api/vocab'),

  collection: () => call<CollectionItem[]>('/api/items'),

  lookup: (jan: string) => call<LookupResult>(`/api/lookup?jan=${encodeURIComponent(jan)}`),

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

  history: (itemId: number) =>
    call<{ shop: string; price: number; seen_on: string }[]>(`/api/items/${itemId}/history`),

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
