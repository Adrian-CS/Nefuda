import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { startRegistration } from '@simplewebauthn/browser';
import { api, type Credential, type Me } from '../lib/api';
import { useI18n, type Lang } from '../i18n';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [webhook, setWebhook] = useState('');
  const [invite, setInvite] = useState('');
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load() {
    Promise.all([api.me(), api.credentials()])
      .then(([profile, creds]) => {
        setMe(profile);
        setWebhook(profile.webhook_url ?? '');
        setCredentials(creds);
      })
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, []);

  async function saveWebhook() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Vacío = quitarlo. El Worker exige https y rechaza lo que no sea una URL.
      await api.updateMe({ webhook_url: webhook.trim() });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrency(currency: string) {
    setError(null);
    try {
      await api.updateMe({ currency });
      setMe((current) => (current ? { ...current, currency: currency as Me['currency'] } : current));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Registrar otra passkey (el iPad, el móvil de repuesto). Pasa por la misma
   * ruta que el alta, así que vuelve a pedir el código de invitación: es el
   * único endpoint que hay y, de paso, prueba que eres tú.
   */
  async function addPasskey() {
    if (!me) return;
    setBusy(true);
    setError(null);
    try {
      const post = async (path: string, body: unknown) => {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error((data as { error?: string }).error ?? 'error');
        return data;
      };

      const options = await post('/api/auth/register/options', { email: me.email, invite });
      const response = await startRegistration({ optionsJSON: options as never });
      await post('/api/auth/register/verify', {
        response,
        email: me.email,
        deviceName: navigator.userAgent.slice(0, 60),
      });

      setInvite('');
      setAddingPasskey(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(t.confirmRemove)) return;
    setError(null);
    try {
      await api.deleteCredential(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="screen">
      <header className="header">
        <div>
          <h1 className="brand">{t.settings}</h1>
          <p className="brand-sub">{me?.email ?? ''}</p>
        </div>
        <Link href="/" className="icon-button" aria-label={t.back}>
          ✕
        </Link>
      </header>

      <section className="card">
        <h2 className="card-title">{t.language}</h2>
        {/* Cambiar aquí guarda en la cuenta (users.lang), no solo en el móvil. */}
        <div className="chips">
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={l.id === lang ? 'chip chip--on' : 'chip'}
              onClick={() => setLang(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>

        <h2 className="card-title">{t.currency}</h2>
        <div className="chips">
          {(['JPY', 'EUR'] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={me?.currency === c ? 'chip chip--on' : 'chip'}
              onClick={() => saveCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">{t.webhook}</h2>
        <p className="hint">{t.webhookHint}</p>
        <label className="field">
          <span className="visually-hidden">{t.webhook}</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://discord.com/api/webhooks/..."
            value={webhook}
            onChange={(e) => {
              setWebhook(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <button type="button" className="button button--quiet" disabled={busy} onClick={saveWebhook}>
          {saved ? '✓' : t.save}
        </button>
      </section>

      <section className="card">
        <h2 className="card-title">{t.passkeys}</h2>

        <ul className="items">
          {credentials.map((credential) => (
            <li key={credential.id} className="passkey">
              <div className="item-body">
                <span className="item-name">
                  {credential.device_name ?? credential.id.slice(0, 12)}
                </span>
                <span className="item-meta">
                  {t.passkeyLastUsed}:{' '}
                  {credential.last_used_at ? credential.last_used_at.slice(0, 10) : t.passkeyNever}
                </span>
              </div>
              <button
                type="button"
                className="chip"
                onClick={() => revoke(credential.id)}
                disabled={credentials.length <= 1}
              >
                {t.passkeyRevoke}
              </button>
            </li>
          ))}
        </ul>

        {/* No hay contraseña de reserva: quedarse sin passkeys es quedarse fuera
            de la cuenta para siempre, así que el Worker también lo impide. */}
        {credentials.length <= 1 && <p className="hint">{t.passkeyOnlyOne}</p>}

        {addingPasskey ? (
          <>
            <label className="field">
              <span className="field-label">{t.needAccount}</span>
              <input type="text" value={invite} onChange={(e) => setInvite(e.target.value)} />
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || invite === ''}
              onClick={addPasskey}
            >
              {t.passkeyAdd}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setAddingPasskey(false)}
            >
              {t.cancel}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setAddingPasskey(true)}
          >
            {t.passkeyAdd}
          </button>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2 className="card-title">{t.credits}</h2>
        {/*
          Yahoo y Rakuten EXIGEN mostrar un crédito de atribución para usar sus
          APIs gratis. El texto exacto lo fija cada uno en sus términos: hay que
          copiarlo literal de su portal de desarrolladores antes de publicar.
        */}
        <p className="hint">
          Yahoo!ショッピング (
          <a href="https://developer.yahoo.co.jp/" target="_blank" rel="noreferrer noopener">
            Yahoo! JAPAN Web Services
          </a>
          )
        </p>
        <p className="hint">
          楽天市場 (
          <a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noreferrer noopener">
            Rakuten Web Service
          </a>
          )
        </p>
      </section>

      <button type="button" className="button button--danger" onClick={() => api.logout()}>
        {t.logout}
      </button>
    </div>
  );
}
