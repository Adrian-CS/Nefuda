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

    // --- comunes ---
    productName: 'Nombre del producto',
    maker: 'Fabricante',
    createByHand: 'Darlo de alta a mano',
    save: 'Guardar',
    cancel: 'Cancelar',
    remove: 'Eliminar',
    confirmRemove: '¿Seguro? Esto no se puede deshacer.',
    close: 'Cerrar',
    loading: 'Cargando…',
    retry: 'Reintentar',
    back: 'Volver',

    // --- escáner ---
    searching: 'Buscando…',
    enterJanByHand: 'Escribir el JAN a mano',
    jan: 'Código JAN',
    lookup: 'Buscar',

    // --- ficha ---
    newInShop: 'Nuevo en tienda',
    secondHand: 'Segunda mano',
    noPrice: 'Sin precio todavía',
    history: 'Histórico',
    historyEmpty: 'Todavía no hay histórico. El precio se consulta cada mañana.',
    lowest: 'mínimo',
    addPrice: 'Anotar un precio',
    shop: 'Tienda',
    condition: 'Estado del ejemplar',
    seenOn: 'Fecha',
    price: 'Precio',
    targetPrice: 'Precio objetivo',
    targetHint: 'Recibirás un aviso cuando baje de aquí.',
    status: 'Situación',
    category: 'Categoría',
    defects: 'Defectos',
    note: 'Notas',
    photo: 'Foto',
    addPhoto: 'Añadir foto',
    manualSource: 'anotado a mano',
    apiSource: 'de la tienda',
    removeItem: 'Quitar de la colección',

    // --- alertas ---
    recentDrops: 'Bajadas recientes',
    noDrops: 'Ninguna bajada todavía.',
    watching: 'Vigilando',
    noWatching: 'No estás vigilando nada.',
    belowTarget: 'por debajo del objetivo',
    noTarget: 'sin objetivo',

    // --- ajustes ---
    account: 'Cuenta',
    language: 'Idioma',
    currency: 'Moneda',
    webhook: 'Webhook de Discord',
    webhookHint: 'Pega aquí la URL del webhook y los avisos llegarán a tu Discord. Debe empezar por https.',
    passkeys: 'Passkeys',
    passkeyAdd: 'Añadir una passkey',
    passkeyRevoke: 'Revocar',
    passkeyLastUsed: 'Última vez',
    passkeyNever: 'sin usar',
    passkeyOnlyOne: 'Es la única passkey de la cuenta: si la quitas, te quedas fuera para siempre.',
    logout: 'Cerrar sesión',
    credits: 'Créditos',
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

    // --- comunes ---
    productName: 'Product name',
    maker: 'Maker',
    createByHand: 'Add it by hand',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Delete',
    confirmRemove: 'Sure? This cannot be undone.',
    close: 'Close',
    loading: 'Loading…',
    retry: 'Try again',
    back: 'Back',

    // --- escáner ---
    searching: 'Searching…',
    enterJanByHand: 'Type the JAN by hand',
    jan: 'JAN code',
    lookup: 'Look up',

    // --- ficha ---
    newInShop: 'New in shop',
    secondHand: 'Second hand',
    noPrice: 'No price yet',
    history: 'Price history',
    historyEmpty: 'No history yet. Prices are checked every morning.',
    lowest: 'lowest',
    addPrice: 'Record a price',
    shop: 'Shop',
    condition: 'Condition',
    seenOn: 'Date',
    price: 'Price',
    targetPrice: 'Target price',
    targetHint: 'You get an alert when it drops below this.',
    status: 'Status',
    category: 'Category',
    defects: 'Defects',
    note: 'Notes',
    photo: 'Photo',
    addPhoto: 'Add photo',
    manualSource: 'recorded by hand',
    apiSource: 'from the shop',
    removeItem: 'Remove from collection',

    // --- alertas ---
    recentDrops: 'Recent drops',
    noDrops: 'No drops yet.',
    watching: 'Watching',
    noWatching: 'You are not watching anything.',
    belowTarget: 'below target',
    noTarget: 'no target',

    // --- ajustes ---
    account: 'Account',
    language: 'Language',
    currency: 'Currency',
    webhook: 'Discord webhook',
    webhookHint: 'Paste the webhook URL and alerts arrive in your Discord. It must start with https.',
    passkeys: 'Passkeys',
    passkeyAdd: 'Add a passkey',
    passkeyRevoke: 'Revoke',
    passkeyLastUsed: 'Last used',
    passkeyNever: 'never used',
    passkeyOnlyOne: 'This is the only passkey on the account: remove it and you are locked out for good.',
    logout: 'Sign out',
    credits: 'Credits',
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

    // --- comunes ---
    productName: '商品名',
    maker: 'メーカー',
    createByHand: '手動で登録する',
    save: '保存',
    cancel: 'キャンセル',
    remove: '削除',
    confirmRemove: '本当に削除しますか？元に戻せません。',
    close: '閉じる',
    loading: '読み込み中…',
    retry: '再試行',
    back: '戻る',

    // --- escáner ---
    searching: '検索中…',
    enterJanByHand: 'JANコードを手入力',
    jan: 'JANコード',
    lookup: '検索',

    // --- ficha ---
    newInShop: '新品（ショップ）',
    secondHand: '中古',
    noPrice: '価格データなし',
    history: '価格推移',
    historyEmpty: 'まだ履歴がありません。価格は毎朝取得します。',
    lowest: '最安値',
    addPrice: '価格を記録',
    shop: 'ショップ',
    condition: '状態',
    seenOn: '日付',
    price: '価格',
    targetPrice: '目標価格',
    targetHint: 'この価格を下回ると通知します。',
    status: 'ステータス',
    category: 'カテゴリ',
    defects: '難あり',
    note: 'メモ',
    photo: '写真',
    addPhoto: '写真を追加',
    manualSource: '手動入力',
    apiSource: 'ショップ提供',
    removeItem: 'コレクションから削除',

    // --- alertas ---
    recentDrops: '最近の値下がり',
    noDrops: 'まだ値下がりはありません。',
    watching: '追跡中',
    noWatching: '追跡中のアイテムはありません。',
    belowTarget: '目標価格を下回りました',
    noTarget: '目標なし',

    // --- ajustes ---
    account: 'アカウント',
    language: '表示言語',
    currency: '通貨',
    webhook: 'Discord Webhook',
    webhookHint: 'WebhookのURLを貼ると、通知がDiscordに届きます。https で始まる必要があります。',
    passkeys: 'パスキー',
    passkeyAdd: 'パスキーを追加',
    passkeyRevoke: '削除',
    passkeyLastUsed: '最終使用',
    passkeyNever: '未使用',
    passkeyOnlyOne: 'これがアカウント唯一のパスキーです。削除すると二度とログインできません。',
    logout: 'ログアウト',
    credits: 'クレジット',
  },
} as const;

/**
 * Las claves las fija el español; los valores son texto libre. El `as const` de
 * DICT haría literal cada cadena y `en`/`ja` dejarían de encajar, de ahí el
 * mapped type. Sigue exigiendo que los tres idiomas tengan TODAS las claves.
 */
export type Strings = { readonly [K in keyof (typeof DICT)['es']]: string };

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
