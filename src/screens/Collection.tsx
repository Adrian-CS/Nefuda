import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { api, type CollectionItem, type Vocab, type VocabRow } from '../lib/api';
import { useI18n, yen, type Lang } from '../i18n';
import { IconScan, IconSettings } from '../icons';

/** Nombre de una fila de vocabulario en el idioma activo. */
export const label = (row: VocabRow, lang: Lang) =>
  lang === 'ja' ? row.name_ja : lang === 'en' ? row.name_en : row.name_es;

export default function Collection() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [vocab, setVocab] = useState<Vocab | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.collection(), api.vocab()])
      .then(([i, v]) => {
        setItems(i);
        setVocab(v);
      })
      .catch(() => setItems([]));
  }, []);

  const inCollection = useMemo(
    () => new Set(vocab?.statuses.filter((s) => s.in_collection).map((s) => s.id) ?? []),
    [vocab]
  );

  const totals = useMemo(() => {
    const mine = (items ?? []).filter((i) => inCollection.has(i.status_id));
    return {
      pieces: mine.length,
      spent: mine.reduce((sum, i) => sum + (i.paid_price ?? 0), 0),
      worth: mine.reduce((sum, i) => sum + (i.best_price ?? i.paid_price ?? 0), 0),
    };
  }, [items, inCollection]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => {
      if (categoryId !== null && i.category_id !== categoryId) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || (i.jan ?? '').includes(q);
    });
  }, [items, query, categoryId]);

  if (items === null) return <div className="screen" aria-busy="true" />;

  return (
    <div className="screen">
      <header className="header">
        <div>
          <h1 className="brand">Nefuda</h1>
          <p className="brand-sub">値札 · {t.subtitle}</p>
        </div>
        <nav className="header-actions">
          <Link href="/ajustes" className="icon-button" aria-label={t.settings}>
            <IconSettings />
          </Link>
        </nav>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">{t.pieces}</span>
          <strong className="stat-value">{totals.pieces}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">{t.spent}</span>
          <strong className="stat-value">{yen(totals.spent, lang)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">{t.worth}</span>
          <strong className="stat-value stat-value--up">{yen(totals.worth, lang)}</strong>
        </div>
      </div>

      <label className="search">
        <span className="visually-hidden">{t.searchPlaceholder}</span>
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
        />
      </label>

      {/* Las categorías salen de la base de datos, así que los chips incluyen
          las que se haya creado el usuario sin tocar este componente. */}
      <div className="chips">
        <button
          type="button"
          className={categoryId === null ? 'chip chip--on' : 'chip'}
          onClick={() => setCategoryId(null)}
        >
          {t.all}
        </button>
        {vocab?.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={categoryId === c.id ? 'chip chip--on' : 'chip'}
            onClick={() => setCategoryId(c.id)}
          >
            {label(c, lang)}
          </button>
        ))}
      </div>

      <ul className="items">
        {visible.map((item) => (
          <li key={item.id}>
            <Link href={`/item/${item.id}`} className="item">
              {item.image_url ? (
                <img className="item-thumb" src={item.image_url} alt="" loading="lazy" />
              ) : (
                <div className="item-thumb item-thumb--empty" />
              )}
              <div className="item-body">
                <span className="item-name">{item.name}</span>
                <span className="item-meta">
                  {item.paid_price !== null ? `${t.paid} ${yen(item.paid_price, lang)}` : null}
                  {item.target_price !== null ? ` · ${t.target} ${yen(item.target_price, lang)}` : null}
                </span>
              </div>
              {item.best_price !== null && (
                <span className="item-price">{yen(item.best_price, lang)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <nav className="tabbar">
        <Link href="/" className="tab tab--on">{t.navCollection}</Link>
        <Link href="/escanear" className="tab tab--scan" aria-label={t.scan}>
          <IconScan />
        </Link>
        <Link href="/alertas" className="tab">{t.navAlerts}</Link>
      </nav>
    </div>
  );
}
