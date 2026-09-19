/**
 * Códigos de barras: qué se puede consultar y qué no.
 *
 * Vive aquí y no dentro de una pantalla porque lo usan tres sitios: el escáner,
 * el formulario de JAN a mano y el propio Worker en `/api/lookup`.
 */

/**
 * Los libros japoneses llevan DOS códigos de barras apilados, y el lector
 * agarra el que pilla.
 *
 * El de arriba es el ISBN-13 (978… o 979…) e identifica el título. El de abajo
 * es el 日本図書コード: empieza por 192 y solo lleva género y precio. No
 * identifica nada, así que consultarlo no puede devolver más que un 404, y por
 * el camino gasta una de las 50.000 consultas diarias de Yahoo.
 */
export const isPriceBarcode = (code: string) => /^192\d{10}$/.test(code);

/** Un código que merece la pena consultar: 8-13 dígitos y no el de precio. */
export const isLookupableJan = (code: string) =>
  /^\d{8,13}$/.test(code) && !isPriceBarcode(code);
