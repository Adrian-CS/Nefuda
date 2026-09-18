/**
 * Nefuda · autenticación con passkeys (WebAuthn)
 *
 *   npm i @simplewebauthn/server jose
 *   npm i @simplewebauthn/browser   (en el frontend)
 *
 *   npx wrangler secret put SESSION_SECRET   # cadena aleatoria larga
 *   npx wrangler secret put INVITE_CODE      # para dar de alta a alguien
 *
 * Sustituye a Cloudflare Access, que exige dominio propio. Esto funciona en
 * workers.dev y no guarda ninguna contraseña: la clave privada nunca sale del
 * móvil (Face ID / huella / PIN del dispositivo).
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { SignJWT, jwtVerify } from 'jose';

export interface AuthEnv {
  DB: D1Database;
  SESSION_SECRET: string;
  INVITE_CODE: string;
}

const RP_NAME = 'Nefuda';
const SESSION_COOKIE = 'nefuda_session';
const CHALLENGE_COOKIE = 'nefuda_challenge';
const SESSION_DAYS = 30;

const b64url = {
  encode: (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (str: string) => {
    const pad = str.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  },
};

const secret = (env: AuthEnv) => new TextEncoder().encode(env.SESSION_SECRET);

/**
 * rpID e origin salen del host de la petición, no de una variable: así el mismo
 * código vale en local, en workers.dev y en un dominio propio si algún día lo
 * compras. OJO: las passkeys quedan atadas al rpID. Si cambias de dominio, hay
 * que volver a registrarlas.
 *
 * En desarrollo hay un matiz: Vite hace de proxy hacia el Worker y reescribe la
 * cabecera Host a 127.0.0.1:8787, así que la URL de la petición deja de decir
 * desde dónde navega la persona. WebAuthn exige que rpID y origin coincidan con
 * la página, y ademas una IP no vale como rpID, con lo que el navegador
 * rechazaría la passkey con «invalid domain».
 *
 * Por eso se mira la cabecera Origin, que sí trae la página real. Se confía en
 * ella SOLO si apunta a localhost: en producción no hay proxy, el Host es el
 * bueno, y así nadie puede colar un rpID ajeno mandando una cabecera a mano.
 */
function rp(request: Request) {
  const url = new URL(request.url);

  const sent = request.headers.get('origin');
  if (sent) {
    try {
      const browser = new URL(sent);
      if (browser.hostname === 'localhost') {
        return { rpID: browser.hostname, origin: browser.origin };
      }
    } catch {
      // Cabecera inservible: se ignora y manda el Host.
    }
  }

  return { rpID: url.hostname, origin: url.origin };
}

// ---------------------------------------------------------------- cookies

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/** El challenge va en una cookie firmada y de vida corta: sin KV ni tabla extra. */
async function putChallenge(env: AuthEnv, challenge: string): Promise<string> {
  const token = await new SignJWT({ challenge })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret(env));
  return cookie(CHALLENGE_COOKIE, token, 300);
}

async function takeChallenge(request: Request, env: AuthEnv): Promise<string | null> {
  const token = readCookie(request, CHALLENGE_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(env));
    return String(payload.challenge);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- sesión

export async function currentUserId(request: Request, env: AuthEnv): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(env));
    return String(payload.sub);
  } catch {
    return null;
  }
}

async function sessionCookie(env: AuthEnv, userId: string): Promise<string> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret(env));
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 24 * 60 * 60);
}

// ---------------------------------------------------------------- rutas

const json = (data: unknown, status = 200, setCookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(setCookie ? { 'set-cookie': setCookie } : {}),
    },
  });

/**
 * Devuelve una Response si la ruta es de autenticación, o null para que el
 * Worker siga con el resto de la API.
 */
export async function handleAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/auth/')) return null;
  const { rpID, origin } = rp(request);

  // WebAuthn exige un DOMINIO como rpID: una IP no vale, aunque el origen sea
  // seguro. Con rp() esto ya no debería pasar navegando por localhost; queda
  // como red por si se entra directo por IP, porque el navegador solo dice
  // "invalid domain" y no explica qué hacer.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rpID) || rpID.includes(':')) {
    return json(
      {
        error: `las passkeys necesitan un dominio, no una IP (${rpID}). Abre la app en localhost o en el dominio desplegado`,
      },
      400
    );
  }

  // ---- alta de una passkey nueva -----------------------------------------
  if (path === '/api/auth/register/options' && request.method === 'POST') {
    const { email, invite } = (await request.json()) as { email: string; invite: string };

    // Sin esto, cualquiera que dé con la URL en workers.dev podría registrarse.
    if (invite !== env.INVITE_CODE) return json({ error: 'invitación no válida' }, 403);
    if (!email) return json({ error: 'falta el email' }, 400);

    let user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind(email)
      .first<{ id: string }>();

    if (!user) {
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO users (id, email) VALUES (?1, ?2)`).bind(id, email).run();
      user = { id };
    }

    // Credenciales ya registradas, para que el navegador no ofrezca duplicar.
    const { results: existing } = await env.DB.prepare(
      `SELECT id, transports FROM credentials WHERE user_id = ?1`
    )
      .bind(user.id)
      .all<{ id: string; transports: string | null }>();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: email,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      authenticatorSelection: {
        // residentKey required = passkey descubrible: se entra sin teclear nada.
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    return json(options, 200, await putChallenge(env, options.challenge));
  }

  if (path === '/api/auth/register/verify' && request.method === 'POST') {
    const body = (await request.json()) as { response: any; email: string; deviceName?: string };
    const expectedChallenge = await takeChallenge(request, env);
    if (!expectedChallenge) return json({ error: 'challenge caducado' }, 400);

    const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind(body.email)
      .first<{ id: string }>();
    if (!user) return json({ error: 'usuario desconocido' }, 400);

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return json({ error: 'no verificado' }, 400);
    }

    const { credential } = verification.registrationInfo;
    await env.DB.prepare(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_name)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
      .bind(
        credential.id,
        user.id,
        b64url.encode(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        body.deviceName ?? null
      )
      .run();

    return json({ ok: true }, 200, await sessionCookie(env, user.id));
  }

  // ---- entrar --------------------------------------------------------------
  if (path === '/api/auth/login/options' && request.method === 'POST') {
    // allowCredentials vacío: el navegador ofrece las passkeys que tenga para
    // este dominio. No hace falta escribir el email para entrar.
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    return json(options, 200, await putChallenge(env, options.challenge));
  }

  if (path === '/api/auth/login/verify' && request.method === 'POST') {
    const body = (await request.json()) as { response: any };
    const expectedChallenge = await takeChallenge(request, env);
    if (!expectedChallenge) return json({ error: 'challenge caducado' }, 400);

    const stored = await env.DB.prepare(
      `SELECT id, user_id, public_key, counter FROM credentials WHERE id = ?1`
    )
      .bind(body.response.id)
      .first<{ id: string; user_id: string; public_key: string; counter: number }>();
    if (!stored) return json({ error: 'credencial desconocida' }, 401);

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.id,
        publicKey: b64url.decode(stored.public_key),
        counter: stored.counter,
      },
    });

    if (!verification.verified) return json({ error: 'no verificado' }, 401);

    // El contador sube en cada uso: si retrocede, es señal de credencial clonada.
    await env.DB.prepare(
      `UPDATE credentials SET counter = ?2, last_used_at = datetime('now') WHERE id = ?1`
    )
      .bind(stored.id, verification.authenticationInfo.newCounter)
      .run();

    return json({ ok: true }, 200, await sessionCookie(env, stored.user_id));
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, cookie(SESSION_COOKIE, '', 0));
  }

  return json({ error: 'ruta desconocida' }, 404);
}
