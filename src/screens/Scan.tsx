import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type LookupResult, type Vocab } from '../lib/api';
import { useI18n, yen } from '../i18n';
import { label } from './Collection';
import { useScanner } from '../hooks/useScanner';
import { IconClose } from '../icons';

/**
 * Escáner. Es la pantalla que sustituye a las notas del móvil: apuntar a la
 * caja y que el precio se apunte solo.
 *
 * Tras leer un código se para la cámara y sube una hoja con lo que han
 * devuelto las tiendas y dos salidas: añadirlo a la colección o solo vigilar
 * su precio. El teclado sigue estando abajo para cuando el código esté roto o
 * el navegador no dé cámara.
 */
export default function Scan() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();

  const [vocab, setVocab] = useState<Vocab | null>(null);
  const [hit, setHit] = useState<LookupResult | null>(null);
  const [jan, setJan] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [conditionId, setConditionId] = useState<number | null>(null);
  const [paid, setPaid] = useState('');
  const [target, setTarget] = useState('');

  // Un código se detecta muchas veces por segundo: sin esto saldrían varias
  // consultas a la vez para el mismo JAN.
  const looking = useRef(false);

  /**
   * No depende de `t` a propósito: el hook recrea `start` cuando cambia esta
   * función, y con el idioma dentro cambiar de lengua reiniciaría la cámara.
   * Por eso los fallos se guardan como bandera y el texto se elige al pintar.
   */
  const lookup = useCallback(async (code: string) => {
    if (looking.current) return;
    looking.current = true;

    setJan(code);
    setBusy(true);
    setNotFound(false);
    setError(null);

    try {
      setHit(await api.lookup(code));
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'no encontrado') setNotFound(true);
      else setError(message);
    } finally {
      setBusy(false);
      looking.current = false;
    }
  }, []);

  const { videoRef, state, start, stop } = useScanner(lookup);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    api.vocab().then(setVocab).catch(() => {});
  }, []);

  // Mientras la hoja está arriba la cámara no pinta nada: se apaga y así no
  // gasta batería ni vuelve a leer el mismo código por detrás.
  const sheetUp = busy || notFound || hit !== null;
  useEffect(() => {
    if (sheetUp) stop();
  }, [sheetUp, stop]);

  // Las condiciones llegan ordenadas por grado descendente, así que la primera
  // es la mejor: lo normal al escanear una caja recién comprada.
  useEffect(() => {
    if (!vocab) return;
    setCategoryId((current) => current ?? vocab.categories[0]?.id ?? null);
    setConditionId((current) => current ?? vocab.conditions[0]?.id ?? null);
  }, [vocab]);

  // Los dos estados salen de sus banderas, nunca de comparar slugs: si te
  // inventas un estado propio, esto lo respeta sin tocar código.
  const statusOwned = vocab?.statuses.find((s) => s.in_collection === 1);
  const statusWatch =
    vocab?.statuses.find((s) => s.in_collection === 0 && s.track_price === 1) ?? statusOwned;

  function reset() {
    setHit(null);
    setJan('');
    setNotFound(false);
    setError(null);
    setPaid('');
    setTarget('');
    looking.current = false;
    void start();
  }

  async function save(statusId: number | undefined, keepPaid: boolean) {
    if (!hit || statusId === undefined || categoryId === null || conditionId === null) return;

    setSaving(true);
    setError(null);
    try {
      await api.addItem({
        product_id: hit.product.id,
        category_id: categoryId,
        status_id: statusId,
        condition_id: conditionId,
        // Si solo lo vigilas todavía no lo tienes: no hay nada pagado.
        paid_price: keepPaid && paid ? Number(paid) : null,
        target_price: target ? Number(target) : null,
      });
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const cameraDown = state === 'denied' || state === 'unsupported';

  return (
    <div className="screen screen--scan">
      <header className="header">
        <div>
          <h1 className="brand">{t.scan}</h1>
          <p className="brand-sub">{t.scanHint}</p>
        </div>
        <Link href="/" className="icon-button" aria-label={t.back}>
          <IconClose />
        </Link>
      </header>

      {cameraDown ? (
        <p className="hint hint--block">{t.noCamera}</p>
      ) : (
        <div className="viewfinder">
          <video ref={videoRef} className="viewfinder-video" muted playsInline />
          <div className="viewfinder-frame" aria-hidden="true" />
          {state !== 'scanning' && <p className="viewfinder-status">{t.loading}</p>}
        </div>
      )}

      {/* Siempre disponible: códigos rotos, cajas sin código, o iOS sin permiso. */}
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{8,13}$/.test(typed)) void lookup(typed);
        }}
      >
        <span className="field-label">{t.enterJanByHand}</span>
        <div className="field-row">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d*"
            placeholder={t.jan}
            value={typed}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))}
          />
          <button type="submit" className="button button--primary button--inline">
            {t.lookup}
          </button>
        </div>
      </form>

      {sheetUp && (
        <>
          <div className="sheet-backdrop" onClick={reset} />
          <section className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-grip" aria-hidden="true" />

            {busy && <p className="hint hint--block">{t.searching}</p>}

            {notFound && (
              <>
                <p className="hint hint--block">{t.notFound}</p>
                <p className="item-meta">{jan}</p>
                <button type="button" className="button button--quiet" onClick={reset}>
                  {t.retry}
                </button>
              </>
            )}

            {hit && (
              <>
                <div className="sheet-product">
                  {hit.product.image_url ? (
                    <img className="item-thumb" src={hit.product.image_url} alt="" />
                  ) : (
                    <div className="item-thumb item-thumb--empty" />
                  )}
                  <div className="item-body">
                    {/* El nombre llega en japonés de la tienda y no se traduce. */}
                    <span className="item-name">{hit.product.name}</span>
                    <span className="item-meta">
                      {hit.product.maker ?? ''} · {hit.product.jan}
                    </span>
                  </div>
                </div>

                {/* Yahoo y Rakuten devuelven precio de tienda, producto nuevo.
                    Se etiqueta como tal: nunca como «ahora vale». */}
                <div className="price-line">
                  <span className="price-line-label">{t.newInShop}</span>
                  {hit.prices.length > 0 ? (
                    <span className="price-line-value">{yen(hit.prices[0].price, lang)}</span>
                  ) : (
                    <span className="price-line-value price-line-value--none">{t.noPrice}</span>
                  )}
                </div>
                {hit.prices.slice(1).map((p) => (
                  <div className="price-line price-line--sub" key={p.shop}>
                    <span className="price-line-label">{p.shop}</span>
                    <span className="price-line-value">{yen(p.price, lang)}</span>
                  </div>
                ))}

                <div className="chips">
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

                <div className="field-grid">
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

                  <label className="field">
                    <span className="field-label">{t.targetPrice}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={target}
                      onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
                    />
                  </label>
                </div>

                <label className="field">
                  <span className="field-label">{t.paid}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={paid}
                    onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))}
                  />
                </label>

                {error && <p className="error">{error}</p>}

                <button
                  type="button"
                  className="button button--primary"
                  disabled={saving}
                  onClick={() => save(statusOwned?.id, true)}
                >
                  {t.add}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={saving}
                  onClick={() => save(statusWatch?.id, false)}
                >
                  {t.watch}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
