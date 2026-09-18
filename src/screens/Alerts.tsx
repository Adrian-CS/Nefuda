import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { api, type AlertsPayload, type Vocab } from '../lib/api';
import { useI18n, yen } from '../i18n';
import { label } from './Collection';

/**
 * Alertas. Dos listas: lo que el cron ya avisó por el webhook, y lo que sigue
 * vigilando cada mañana.
 *
 * `watching` lo decide la bandera `track_price` del estado, así que un estado
 * que te inventes tú aparece aquí sin tocar esta pantalla.
 */
export default function Alerts() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [vocab, setVocab] = useState<Vocab | null>(null);

  useEffect(() => {
    Promise.all([api.alerts(), api.vocab()])
      .then(([payload, v]) => {
        setData(payload);
        setVocab(v);
      })
      .catch(() => setData({ recent: [], watching: [] }));
  }, []);

  const conditionName = (id: number) => {
    const row = vocab?.conditions.find((c) => c.id === id);
    return row ? label(row, lang) : '';
  };

  if (!data) return <div className="screen" aria-busy="true" />;

  return (
    <div className="screen">
      <header className="header">
        <div>
          <h1 className="brand">Nefuda</h1>
          <p className="brand-sub">値札 · {t.navAlerts}</p>
        </div>
        <Link href="/ajustes" className="icon-button" aria-label={t.settings}>
          ⚙
        </Link>
      </header>

      <h2 className="card-title">{t.recentDrops}</h2>
      {data.recent.length === 0 ? (
        <p className="hint hint--block">{t.noDrops}</p>
      ) : (
        <ul className="items">
          {data.recent.map((alert) => (
            <li key={alert.id}>
              <Link href={`/item/${alert.item_id}`} className="item">
                {alert.image_url ? (
                  <img className="item-thumb" src={alert.image_url} alt="" loading="lazy" />
                ) : (
                  <div className="item-thumb item-thumb--empty" />
                )}
                <div className="item-body">
                  <span className="item-name">{alert.name}</span>
                  <span className="item-meta">
                    {/* datetime('now') devuelve 'YYYY-MM-DD HH:MM:SS'; con el día basta. */}
                    {alert.notified_at.slice(0, 10)} · {alert.shop} · {conditionName(alert.condition_id)}
                  </span>
                </div>
                <span className="item-price item-price--down">{yen(alert.price, lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="card-title">{t.watching}</h2>
      {data.watching.length === 0 ? (
        <p className="hint hint--block">{t.noWatching}</p>
      ) : (
        <ul className="items">
          {data.watching.map((row) => {
            // El aviso se compara siempre contra el precio del MISMO grado que
            // tu ejemplar. El de tienda nueva se enseña aparte, nunca mezclado.
            const hit =
              row.target_price !== null &&
              row.best_price !== null &&
              row.best_price <= row.target_price;

            return (
              <li key={row.id}>
                <Link href={`/item/${row.id}`} className="item">
                  {row.image_url ? (
                    <img className="item-thumb" src={row.image_url} alt="" loading="lazy" />
                  ) : (
                    <div className="item-thumb item-thumb--empty" />
                  )}
                  <div className="item-body">
                    <span className="item-name">{row.name}</span>
                    <span className="item-meta">
                      {row.target_price !== null
                        ? `${t.target} ${yen(row.target_price, lang)}`
                        : t.noTarget}
                      {row.retail_price !== null
                        ? ` · ${t.newInShop} ${yen(row.retail_price, lang)}`
                        : ''}
                    </span>
                    {hit && <span className="badge badge--down">{t.belowTarget}</span>}
                  </div>
                  {row.best_price !== null && (
                    <span className={hit ? 'item-price item-price--down' : 'item-price'}>
                      {yen(row.best_price, lang)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="tabbar">
        <Link href="/" className="tab">{t.navCollection}</Link>
        <Link href="/escanear" className="tab tab--scan" aria-label={t.scan} />
        <Link href="/alertas" className="tab tab--on">{t.navAlerts}</Link>
      </nav>
    </div>
  );
}
