# CLAUDE.md — Nefuda

Tracker de precios de figuras, juegos y otras cosas de colección. Proyecto personal,
uso privado, restricción dura: **todo dentro del plan gratuito y dentro de la legalidad**.

---

## Qué es y qué no es

Sustituye unas notas de móvil donde se apuntaban nombre y precio a mano. Lo que aporta:
buscador, fotos, histórico de precios y aviso cuando algo baja de un precio objetivo.

**No es** una tienda, ni un comparador público, ni una app con funciones sociales. Son dos
personas con colecciones separadas que no se ven entre ellas.

---

## Restricciones que no se negocian

1. **Gratis.** Cloudflare free tier (Workers, D1, R2) y APIs de tiendas con registro
   gratuito. Si algo obliga a pagar, se busca otra vía o se descarta.
2. **Legal.** Solo APIs oficiales. **Nada de scraping**: Mercari, Amazon y Suruga-ya lo
   prohíben en sus términos. Yahoo y Rakuten exigen mostrar un crédito de atribución en
   la app; va en la pantalla de ajustes.
3. **Trilingüe.** Interfaz en español, inglés y japonés, siempre las tres. Texto nuevo va
   a los tres idiomas o no va.
4. **Cuentas aisladas.** Ninguna consulta sobre datos de usuario sin `WHERE user_id = ?`.

---

## Arquitectura

Un único Worker sirve la PWA (estáticos) y la API. Un solo `wrangler deploy`.

```
Navegador  --passkey-->  Worker  ->  D1 (datos)
                          |          R2 (fotos propias)
                          |
                          +-> Yahoo!ショッピング API  (búsqueda por JAN, nuevo)
                          +-> 楽天市場 API           (nuevo + 駿河屋 y ブックオフ,
                          |                           que son segunda mano)
                          +-> Cron diario 06:00 JST  (precios + alertas)
```

### Autenticación: passkeys, no Cloudflare Access

Se evaluó Cloudflare Access y **se descartó**: exige un dominio propio en una zona de
Cloudflare y no protege un `workers.dev`, así que dejaba de ser gratis. En su lugar,
WebAuthn contra D1 (`src/worker/auth.ts`):

- `users.id` es un UUID que genera el Worker al registrar. No hay contraseñas.
- La sesión es una cookie firmada (HS256 con `SESSION_SECRET`), 30 días.
- El challenge viaja en una cookie firmada de 5 minutos: sin KV ni tabla extra.
- **El registro exige `INVITE_CODE`.** Sin eso, cualquiera que diera con la URL en
  `workers.dev` podría crearse una cuenta. La lista de quién entra la llevas tú ahora.
- **Las passkeys quedan atadas al `rpID`**, que sale del host de la petición. Si algún
  día se compra un dominio y se mueve la app, hay que volver a registrarlas.

### Modelo de datos: catálogo común, colección privada

- `products` + `price_points` → de las APIs, no pertenecen a nadie. Se guardan una vez
  aunque varias personas sigan el mismo artículo.
- `user_items` + `user_item_flags` + `alert_log` → privados, filtrados por usuario.

Dos consecuencias buenas: el cron recorre **productos distintos**, no usuarios (importa
porque Yahoo limita a 1 consulta/segundo), y quien da de alta algo que otro ya seguía ve
el histórico completo desde el primer día.

### Vocabularios en tabla, no en enum

`categories`, `statuses`, `conditions`, `flags` y `shops` son tablas, no `CHECK`. Motivo:
en SQLite (D1 es SQLite) no se puede modificar un `CHECK` con `ALTER TABLE`, hay que
reconstruir la tabla. Con tablas, añadir un valor es un `INSERT`.

Patrón en las cuatro primeras: `owner_id NULL` = de fábrica, visible para todos;
`owner_id = <usuario>` = privada. Consulta siempre
`WHERE owner_id IS NULL OR owner_id = ?1`.

**`statuses` lleva dos banderas de comportamiento** y el código debe usarlas en vez de
comparar slugs:

- `in_collection` → suma al valor de la colección
- `track_price` → el cron consulta su precio

Nunca escribir `WHERE status = 'sold'` ni equivalentes. Si se hace, se pierde la ventaja
de tener los estados en tabla.

**`conditions` es el grado** (uno por ejemplar, con `grade` numérico para ordenar).
**`flags` son defectos acumulables** (manual dañado, caja golpeada). Un ejemplar puede ser
`used` y tener tres flags a la vez. No mezclar ambos conceptos.

---

## Precios: nuevo y segunda mano no son lo mismo

Yahoo devuelve precio de **tienda, producto nuevo**. Mercari es C2C y de segunda mano, y
**no tiene API pública** para consultar precios de terceros (la メルカリShops API es para
que un vendedor gestione su propio inventario). Su scraping está prohibido. Por eso
Mercari existe en `shops` con `is_api = 0` y solo entra a mano, desde
`POST /api/items/:id/price`.

**La segunda mano automática sale de 駿河屋 y ブックオフ**, que tienen escaparate oficial
en 楽天市場 y por tanto se consultan por la API de Rakuten, sin rascar sus webs (que ambas
prohíben). Detalles que importan:

- Es **una sola llamada a Rakuten**, con `hits=30` en vez de 5: los resultados se reparten
  por `shopCode`. Hacer una llamada por tienda gastaría subrequests y huecos del límite de
  1 req/s sin necesidad.
- Las dos venden nuevo **y** usado, así que la tienda no basta para saber el grado: lo dice
  el título. `USED_MARKER` lo decide, y **un anuncio sin marca no se guarda en ningún
  grado**. Antes sin precio que con el precio equivocado.
- Son tiendas, no C2C: sus precios van por encima de lo que se cierra en Mercari. Es
  «segunda mano en tienda», no «lo que vale en Mercari».

De ahí una regla de producto: **comparar tu ejemplar usado contra el precio nuevo de
tienda infla el valor y miente.** El código ya lo respeta:

- `listCollection` calcula `best_price` contra el **mismo `condition_id`** que tu ejemplar,
  y devuelve `retail_price` aparte.
- Si no hay precio de ese grado, se cae a lo que pagaste en vez de inventar un número.
- En la ficha hay que mostrar **dos líneas separadas**, «nuevo en tienda» y «segunda
  mano», nunca un único «ahora vale». La hoja del escáner hace lo mismo.
- El cron avisa contra el **grado del ejemplar de cada quien**: calcula el mínimo por grado
  y filtra por `ui.condition_id`. Sin eso, una figura nueva barata dispararía el aviso de
  quien tiene la suya usada.

---

## Estado del repo

Funciona de punta a punta: registro, login, alta por JAN, colección y cron.

El código está entero: las cinco pantallas, el Worker, el esquema y los iconos. `npm run
build` pasa y `wrangler deploy --dry-run` empaqueta bien. **Nada de esto se ha ejecutado
contra las APIs reales todavía**, que es donde está el riesgo de verdad.

| Zona | Estado |
|---|---|
| `schema.sql` | Completo. Hay que reejecutarlo: añade `bookoff` y pone `is_api = 1` en 駿河屋 |
| `src/worker/index.ts`, `auth.ts` | Completos |
| `src/i18n.tsx`, `src/lib/api.ts`, `src/lib/jan.ts`, `src/hooks/useScanner.ts` | Completos |
| `src/screens/*.tsx` | Las cinco completas |
| `src/styles.css` | Completo |
| `public/icon-192.png`, `icon-512.png` | Hechos |

### Lo siguiente

1. **Conseguir el App ID de Rakuten y el de Yahoo.** Sin ellos no funciona ni la búsqueda
   por JAN, que es el corazón de la app.
2. **Verificar contra una llamada real** los nombres de campo de las dos APIs, los dos
   `shopCode` y el marcador de 【中古】. Ver las trampas de aquí abajo.
3. `npm run db:remote` y `npm run deploy`.
4. Registrar una passkey en producción: la de `localhost` no vale allí, el `rpID` cambia.

---

## Tokens de diseño

Están en `src/styles.css` como variables CSS. Resumen:

```
--paper #F4F1EA   fondo          --accent #B23A26  acción primaria, línea de gráfica
--card  #FFFFFF   tarjetas       --up     #2E6046  bajada de precio, mínimo histórico
--line  #E1DBCD   bordes         --up-bg  #E4EEE7
--ink   #1A1714   texto          --down-bg #F6E7E3 subida de precio
--muted #5E5751   secundario
```

Tipografía: **Instrument Serif** para cifras y titulares, **Noto Sans JP** para el resto
(cubre latín y japonés, imprescindible porque los nombres vienen en japonés).
Radios: 14px tarjetas, 12px campos, 999px pastillas. Diana táctil mínima 44px.

Móvil primero, 390×844 de referencia. El botón de escanear va en el centro de la barra
inferior: es la acción que sustituye a las notas. Los `input` van a 16px porque por debajo
iOS hace zoom al enfocarlos.

---

## Reglas de producto ya decididas

- **Los nombres de producto no se traducen nunca.** Llegan en japonés de la tienda y ahí
  se quedan, sea cual sea el idioma de la interfaz. Traducirlos sería inventar datos.
- **El separador de miles sigue al idioma, no a la moneda**: `¥151.900` en español,
  `¥151,900` en inglés y japonés.
- **`/api/lookup` no se cachea nunca.** Un precio viejo es peor que no tener precio.
  `/api/items` sí, para consultar la colección sin cobertura dentro de una tienda.
- **El idioma se guarda en la cuenta** (`users.lang`) con `localStorage` como respaldo del
  dispositivo. La pantalla de login tiene su propio selector porque ahí todavía no hay
  cuenta: arranca con `navigator.language`.
- **Las fotos propias van a R2 con prefijo `fotos/{user_id}/`** y se sirven por
  `/api/photo/...`, que comprueba el prefijo. Las imágenes de producto se enlazan al CDN
  de la tienda, no se copian.

---

## Trampas conocidas

- **Verificar los nombres de campo de las dos APIs** contra la documentación vigente antes
  de fiarse. Están escritos según la forma habitual de sus respuestas, pero ambas han
  cambiado de estructura entre versiones y fallan en silencio.
- **Los `shopCode` de 駿河屋 (`surugaya-a-too`) y ブックオフ (`bookoffonline`) y el campo
  `shopCode` de la respuesta de Rakuten están sin verificar contra una llamada real.**
  Igual que el resto de campos de las dos APIs: comprobarlos antes de fiarse. Si el
  `shopCode` no llega o el título no marca el grado, la línea de segunda mano sale vacía
  en silencio, que es el modo de fallo que este proyecto ya ha visto.
- **Yahoo limita a 1 consulta por segundo** (y 50.000 al día por App ID). El cron duerme
  1,1 s entre productos. No quitar esa pausa.
- **El App ID de Yahoo no puede exponerse.** Las llamadas salen del Worker, nunca del
  navegador.
- **Los libros japoneses llevan dos códigos de barras apilados**, y el lector agarra el
  que pilla. El de arriba es el ISBN-13 (978…), que sirve; el de abajo empieza por 192 y
  solo lleva género y precio. `isPriceBarcode` en `src/lib/jan.ts` lo descarta en el
  escáner y en `/api/lookup`. Si algún día se admiten códigos que no sean JAN, revisar eso.
- **`BarcodeDetector` no existe en Safari de iOS.** El hook carga un ponyfill WASM de
  ~300 kB de forma dinámica. No moverlo al bundle inicial.
- **D1 no soporta transacciones interactivas** (`BEGIN`/`COMMIT`). Usar `db.batch()`.
- **`slugCache` cachea solo `shops` y `conditions` globales.** Categorías y estados no se
  cachean porque dependen del usuario.
- **`alert_log` evita repetir el mismo aviso** cada mañana mientras un precio siga bajo.
  Ventana de 14 días.

---

## Puesta en marcha

```bash
npm install

npx wrangler d1 create nefuda            # pegar el id en wrangler.toml
npm run db:remote
npm run db:local
npx wrangler r2 bucket create nefuda-fotos

npx wrangler secret put SESSION_SECRET   # openssl rand -base64 48
npx wrangler secret put INVITE_CODE
npx wrangler secret put YAHOO_APP_ID     # developer.yahoo.co.jp
npx wrangler secret put RAKUTEN_APP_ID   # webservice.rakuten.co.jp

npm run deploy
```

En desarrollo hacen falta dos procesos: `npm run dev:api` (Worker en el 8787) y
`npm run dev` (Vite, que hace proxy de `/api`). Los secretos locales van en `.dev.vars`.

**Aviso sobre passkeys en local:** WebAuthn exige un origen seguro. `localhost` cuenta como
seguro, así que funciona, pero la passkey que registres en `localhost` no sirve en
producción y viceversa: el `rpID` es distinto. Habrá que registrar una en cada sitio.
