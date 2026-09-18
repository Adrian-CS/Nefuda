import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useI18n, type Lang } from '../i18n';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];

export default function Login({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as any).error ?? 'error');
    return data;
  };

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const options = await post('/api/auth/login/options', {});
      const response = await startAuthentication({ optionsJSON: options as any });
      await post('/api/auth/login/verify', { response });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const options = await post('/api/auth/register/options', { email, invite });
      const response = await startRegistration({ optionsJSON: options as any });
      await post('/api/auth/register/verify', {
        response,
        email,
        // Ayuda a distinguir credenciales cuando haya que revocar una.
        deviceName: navigator.userAgent.slice(0, 60),
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen--login">
      <div className="login-body">
        <div className="login-brand">
          <h1 className="brand brand--big">Nefuda</h1>
          <p className="brand-sub">値札</p>
        </div>

        {mode === 'register' && (
          <>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                type="email"
                autoComplete="username webauthn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Invitación</span>
              <input type="text" value={invite} onChange={(e) => setInvite(e.target.value)} />
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}

        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={mode === 'login' ? login : register}
        >
          {mode === 'login' ? t.passkeyLogin : t.passkeyRegister}
        </button>

        <button
          type="button"
          className="button button--quiet"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t.needAccount : t.haveAccount}
        </button>

        <p className="hint">{t.privacyNote}</p>
      </div>

      {/* El selector va aquí porque antes de entrar todavía no hay cuenta
          de la que leer el idioma. Arranca con navigator.language. */}
      <div className="lang-picker">
        <span className="field-label">{t.languageHint}</span>
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
      </div>
    </div>
  );
}
