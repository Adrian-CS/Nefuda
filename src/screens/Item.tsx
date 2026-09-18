import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  api,
  type HistoryPoint,
  type ItemDetail,
  type Vocab,
  type ConditionRow,
} from '../lib/api';
import { useI18n, yen, type Lang } from '../i18n';
import { label } from './Collection';

/** Un punto de la gráfica: un día, el precio más bajo de ese día. */
interface Point {
  day: string;
  price: number;
}

/**
 * Gráfica del histórico. SVG a mano, sin librería: son cuatro cuentas y así no
 * entran 40 kB al bundle por dibujar una línea.
 *
 * El viewBox es fijo y el ancho al 100%: el navegador la escala sola y no hace
 * falta medir el contenedor ni volver a pintar al girar el móvil.
 */
function Chart({ points, lang }: { points: Point[]; lang: Lang }) {
  const W = 320;
  const H = 120;
  const PAD = 10;

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const times = points.map((p) => Date.parse(p.day));
    const prices = points.map((p) => p.price);
    const minX = Math.min(...times);
    const maxX = Math.max(...times);
    const minY = Math.min(...prices);
    const maxY = Math.max(...prices);

    // Si todo el histórico vale lo mismo, el rango es 0: sin esto se divide
    // entre cero y la línea desaparece.
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
    const y = (p: number) => H - PAD - ((p - minY) / spanY) * (H - 2 * PAD);

    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(Date.parse(p.day)).toFixed(1)},${y(p.price).toFixed(1)}`)
      .join(' ');

    const lowest = points.reduce((a, b) => (a.price <= b.price ? a : b));

    return {
      path,
      lowest,
      lowestX: x(Date.parse(lowest.day)),
      lowestY: y(lowest.price),
      minY,
      maxY,
    };
  }, [points]);

  if (!geometry) return null;

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        role="img"
        aria-label={`${yen(geometry.minY, lang)} – ${yen(geometry.maxY, lang)}`}
      >
        <path d={geometry.path} className="chart-line" />
        {/* El mínimo histórico es el dato que importa cuando decides comprar. */}
        <circle cx={geometry.lowestX} cy={geometry.lowestY} r="4" className="chart-lowest" />
      </svg>
      <figcaption className="chart-caption">
        <span>{points[0].day}</span>
        <span className="chart-lowest-label">
          {yen(geometry.lowest.price, lang)} · {points.length} pts
        </span>
        <span>{points[points.length - 1].day}</span>
      </figcaption>
    </figure>
  );
}

export default function Item() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const [, params] = useRoute('/item/:id');
  const itemId = Number(params?.id);

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [vocab, setVocab] = useState<Vocab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Formulario de edición.
  const [statusId, setStatusId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [conditionId, setConditionId] = useState<number | null>(null);
  const [target, setTarget] = useState('');
  const [paid, setPaid] = useState('');
  const [note, setNote] = useState('');
  const [flagIds, setFlagIds] = useState<number[]>([]);

  // Formulario de precio a mano: Mercari, 駿河屋 y la tienda de la esquina.
  const [shopId, setShopId] = useState<number | null>(null);
  const [manualCondition, setManualCondition] = useState<number | null>(null);
  const [manualPrice, setManualPrice] = useState('');
  const [manualUrl, setManualUrl] = useState('');

  function fill(fresh: ItemDetail) {
    setItem(fresh);
    setStatusId(fresh.status_id);
    setCategoryId(fresh.category_id);
    setConditionId(fresh.condition_id);
    setTarget(fresh.target_price?.toString() ?? '');
    setPaid(fresh.paid_price?.toString() ?? '');
    setNote(fresh.note ?? '');
    setFlagIds(fresh.flag_ids);
    setManualCondition((current) => current ?? fresh.condition_id);
  }

  useEffect(() => {
    if (!Number.isFinite(itemId)) return;
    Promise.all([api.item(itemId), api.history(itemId), api.vocab()])
      .then(([fresh, points, v]) => {
        fill(fresh);
        setHistory(points);
        setVocab(v);
        // Las tiendas sin API son las que se anotan a mano; el vocabulario ya
        // las devuelve al final, así que la primera de ellas es buen defecto.
        setShopId((current) => current ?? v.shops.find((s) => s.is_api === 0)?.id ?? null);
      })
      .catch((err) => setError((err as Error).message));
  }, [itemId]);

  const myCondition: ConditionRow | undefined = vocab?.conditions.find(
    (c) => c.id === item?.condition_id
  );

  /**
   * La gráfica pinta UN grado, nunca una mezcla: juntar el precio de nuevo con
   * el de segunda mano en la misma línea dibuja una caída que no existe.
   * Se prefiere el grado de tu ejemplar; si aún no tiene dos puntos, se enseña
   * el de tienda nueva, que es el que alimenta el cron todos los días.
   */
  const { chartPoints, chartCondition } = useMemo(() => {
    const byCondition = (slug: string): Point[] => {
      const days = new Map<string, number>();
      for (const point of history) {
        if (point.condition !== slug) continue;
        const previous = days.get(point.seen_on);
        if (previous === undefined || point.price < previous) days.set(point.seen_on, point.price);
      }
      return [...days.entries()]
        .map(([day, price]) => ({ day, price }))
        .sort((a, b) => a.day.localeCompare(b.day));
    };

    const mine = myCondition ? byCondition(myCondition.slug) : [];
    if (mine.length >= 2) return { chartPoints: mine, chartCondition: myCondition };

    const retail = byCondition('new');
    return {
      chartPoints: retail,
      chartCondition: vocab?.conditions.find((c) => c.slug === 'new'),
    };
  }, [history, myCondition, vocab]);

  async function save() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      const fresh = await api.patchItem(item.id, {
        status_id: statusId ?? undefined,
        category_id: categoryId ?? undefined,
        condition_id: conditionId ?? undefined,
        // Vacío = quitar el objetivo. El Worker acepta null a propósito.
        target_price: target === '' ? null : Number(target),
        paid_price: paid === '' ? null : Number(paid),
        note: note === '' ? null : note,
        flag_ids: flagIds,
      });
      fill(fresh);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addManualPrice() {
    if (!item || shopId === null || manualCondition === null || manualPrice === '') return;
    setSaving(true);
    setError(null);
    try {
      await api.manualPrice(item.id, {
        shop_id: shopId,
        condition_id: manualCondition,
        price: Number(manualPrice),
        url: manualUrl || null,
      });
      setManualPrice('');
      setManualUrl('');
      const [fresh, points] = await Promise.all([api.item(item.id), api.history(item.id)]);
      fill(fresh);
      setHistory(points);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!item) return;
    setSaving(true);
    try {
      await api.uploadPhoto(item.id, file);
      fill(await api.item(item.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeItem() {
    if (!item || !window.confirm(t.confirmRemove)) return;
    try {
      await api.deleteItem(item.id);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!item) {
    return (
      <div className="screen" aria-busy={!error}>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="header">
        <div className="item-title">
          {/* Nunca se traduce: llega en japonés de la tienda y ahí se queda. */}
          <h1 className="item-title-name">{item.name}</h1>
          <p className="item-meta">
            {item.maker ?? ''}
            {item.jan ? ` · ${item.jan}` : ''}
          </p>
        </div>
        <Link href="/" className="icon-button" aria-label={t.back}>
          ✕
        </Link>
      </header>

      <div className="item-photo">
        {item.photo_key ? (
          <img src={`/api/photo/${encodeURIComponent(item.photo_key)}`} alt="" />
        ) : item.image_url ? (
          <img src={item.image_url} alt="" />
        ) : (
          <div className="item-photo-empty" />
        )}
        <label className="button button--quiet button--photo">
          {t.addPhoto}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPhoto(file);
            }}
          />
        </label>
      </div>

      {/* Las dos líneas, separadas siempre. Comparar tu ejemplar usado contra el
          precio de tienda nueva infla el valor y miente. */}
      <div className="price-line">
        <span className="price-line-label">{t.newInShop}</span>
        {item.retail_price !== null ? (
          <span className="price-line-value">{yen(item.retail_price, lang)}</span>
        ) : (
          <span className="price-line-value price-line-value--none">{t.noPrice}</span>
        )}
      </div>

      {myCondition && myCondition.slug !== 'new' && (
        <div className="price-line">
          <span className="price-line-label">
            {t.secondHand} · {label(myCondition, lang)}
          </span>
          {item.best_price !== null ? (
            <span className="price-line-value">{yen(item.best_price, lang)}</span>
          ) : (
            <span className="price-line-value price-line-value--none">{t.noPrice}</span>
          )}
        </div>
      )}

      {item.paid_price !== null && (
        <p className="hint">
          {t.paid} {yen(item.paid_price, lang)}
        </p>
      )}

      <section className="card">
        <h2 className="card-title">
          {t.history}
          {chartCondition ? ` · ${label(chartCondition, lang)}` : ''}
        </h2>
        {chartPoints.length >= 2 ? (
          <Chart points={chartPoints} lang={lang} />
        ) : (
          <p className="hint">{t.historyEmpty}</p>
        )}
      </section>

      {/* Mercari no tiene API que consultar y su scraping está prohibido: la
          única vía legal para tener su precio es teclearlo. */}
      <section className="card">
        <h2 className="card-title">{t.addPrice}</h2>

        <div className="field-grid">
          <label className="field">
            <span className="field-label">{t.shop}</span>
            <select value={shopId ?? ''} onChange={(e) => setShopId(Number(e.target.value))}>
              {vocab?.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">{t.condition}</span>
            <select
              value={manualCondition ?? ''}
              onChange={(e) => setManualCondition(Number(e.target.value))}
            >
              {vocab?.conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">{t.price}</span>
          <input
            type="text"
            inputMode="numeric"
            value={manualPrice}
            onChange={(e) => setManualPrice(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        <label className="field">
          <span className="field-label">URL</span>
          <input
            type="url"
            inputMode="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="button button--quiet"
          disabled={saving || manualPrice === ''}
          onClick={addManualPrice}
        >
          {t.save}
        </button>
      </section>

      <section className="card">
        <h2 className="card-title">{t.targetPrice}</h2>
        <label className="field">
          <span className="field-label">{t.targetHint}</span>
          <input
            type="text"
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span className="field-label">{t.status}</span>
            <select value={statusId ?? ''} onChange={(e) => setStatusId(Number(e.target.value))}>
              {vocab?.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {label(s, lang)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">{t.condition}</span>
            <select
              value={conditionId ?? ''}
              onChange={(e) => setConditionId(Number(e.target.value))}
            >
              {vocab?.conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">{t.category}</span>
          <select value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {vocab?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c, lang)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">{t.paid}</span>
          <input
            type="text"
            inputMode="numeric"
            value={paid}
            onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        {/* Los defectos son acumulables: un ejemplar puede ser 'usado' y tener
            además la caja golpeada y el manual dañado. */}
        <span className="field-label">{t.defects}</span>
        <div className="chips chips--wrap">
          {vocab?.flags.map((f) => (
            <button
              key={f.id}
              type="button"
              className={flagIds.includes(f.id) ? 'chip chip--on' : 'chip'}
              onClick={() =>
                setFlagIds((current) =>
                  current.includes(f.id)
                    ? current.filter((id) => id !== f.id)
                    : [...current, f.id]
                )
              }
            >
              {label(f, lang)}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field-label">{t.note}</span>
          <textarea
            className="textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="button" className="button button--primary" disabled={saving} onClick={save}>
          {t.save}
        </button>
      </section>

      <button type="button" className="button button--danger" onClick={removeItem}>
        {t.removeItem}
      </button>
    </div>
  );
}
