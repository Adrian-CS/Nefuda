import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'es' | 'en' | 'ja';

/**
 * Solo el texto de la interfaz. Los nombres de producto llegan de la tienda en
 * japonés y no se traducen nunca.
 */
const DICT = {
  es: {
    subtitle: 'MI COLECCIÓN',
    pieces: 'Piezas',
    spent: 'Invertido',
    worth: 'Ahora vale',
    searchPlaceholder: 'Buscar por nombre o JAN',
    all: 'Todo',
    scan: 'Escanear código',
    scanHint: 'Apunta al código JAN de la caja.',
    add: 'Añadir a la colección',
    watch: 'Solo vigilar el precio',
    notFound: 'No lo encuentro en ninguna tienda. ¿Lo doy de alta a mano?',
    noCamera: 'Este navegador no deja usar la cámara. Busca por nombre o JAN.',
    paid: 'pagaste',
    target: 'objetivo',
    cheapest: 'más barato',
    navCollection: 'Colección',
    navAlerts: 'Alertas',
    settings: 'Ajustes',
    passkeyLogin: 'Entrar con passkey',
    passkeyRegister: 'Crear mi passkey',
    needAccount: 'Tengo una invitación',
    haveAccount: 'Ya tengo cuenta',
    privacyNote: 'Cada cuenta es independiente. Nadie ve tu colección.',
    languageHint: 'IDIOMA',
  },
  en: {
    subtitle: 'MY COLLECTION',
    pieces: 'Items',
    spent: 'Spent',
    worth: 'Now worth',
    searchPlaceholder: 'Search by name or JAN code',
    all: 'All',
    scan: 'Scan code',
    scanHint: 'Point at the JAN barcode on the box.',
    add: 'Add to collection',
    watch: 'Just watch the price',
    notFound: "No shop has it. Add it by hand?",
    noCamera: 'This browser will not give camera access. Search by name or JAN.',
    paid: 'paid',
    target: 'target',
    cheapest: 'cheapest',
    navCollection: 'Collection',
    navAlerts: 'Alerts',
    settings: 'Settings',
    passkeyLogin: 'Sign in with a passkey',
    passkeyRegister: 'Create my passkey',
    needAccount: 'I have an invite',
    haveAccount: 'I already have an account',
    privacyNote: 'Every account stands alone. Nobody sees your collection.',
    languageHint: 'LANGUAGE',
  },
  ja: {
    subtitle: 'マイコレクション',
    pieces: '点数',
    spent: '購入額',
    worth: '現在の価値',
    searchPlaceholder: '商品名・JANコードで検索',
    all: 'すべて',
    scan: 'コードをスキャン',
    scanHint: '箱のJANコードにかざしてください。',
    add: 'コレクションに追加',
    watch: '価格の追跡だけする',
    notFound: 'どのショップにも見つかりません。手動で登録しますか？',
    noCamera: 'このブラウザではカメラを使えません。商品名かJANで検索してください。',
    paid: '購入',
    target: '目標',
    cheapest: '最安',
    navCollection: 'コレクション',
    navAlerts: 'アラート',
    settings: '設定',
    passkeyLogin: 'パスキーでログイン',
    passkeyRegister: 'パスキーを作成',
    needAccount: '招待コードがあります',
    haveAccount: 'すでにアカウントがあります',
    privacyNote: 'アカウントは独立しています。コレクションは他の人に見えません。',
    languageHint: '表示言語',
  },
} as const;

export type Strings = (typeof DICT)['es'];

function detect(): Lang {
  const saved = localStorage.getItem('nefuda.lang');
  if (saved === 'es' || saved === 'en' || saved === 'ja') return saved;
  const nav = navigator.language.slice(0, 2);
  return nav === 'es' || nav === 'ja' ? nav : 'en';
}

/** Yenes: el separador sigue al idioma, no a la moneda. */
export function yen(n: number, lang: Lang): string {
  return '¥' + n.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US');
}

const Ctx = createContext<{ lang: Lang; t: Strings; setLang: (l: Lang) => void }>({
  lang: 'es',
  t: DICT.es,
  setLang: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem('nefuda.lang', lang);
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    // Se guarda también en la cuenta, para que el idioma viaje con la persona
    // y no con el móvil. Si falla, el localStorage ya cubre este dispositivo.
    fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang: l }),
    }).catch(() => {});
  };

  return <Ctx.Provider value={{ lang, t: DICT[lang], setLang }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
