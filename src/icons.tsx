/**
 * Iconos en SVG, escritos a mano. Sin librería: son unos pocos trazos, y meter
 * un paquete de iconos costaría decenas de kB para dibujar lo que cabe aquí.
 *
 * Todos heredan el color con `currentColor`, así que el mismo icono vale sobre
 * el rojo de acción y sobre el papel. Van marcados como decorativos: el texto
 * accesible lo pone el aria-label del botón que los envuelve, no el icono.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
} as const;

/** Escanear: las cuatro esquinas del visor y las barras de un código. */
export function IconScan() {
  return (
    <svg {...base} width="26" height="26">
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 9v6" />
      <path d="M12 9v6" />
      <path d="M15 9v6" />
    </svg>
  );
}

/** Ajustes: dos controles deslizantes. Se lee mejor que un engranaje a 24px. */
export function IconSettings() {
  return (
    <svg {...base} width="22" height="22">
      <path d="M4 8h6" />
      <path d="M15 8h5" />
      <circle cx="12.5" cy="8" r="2.2" />
      <path d="M4 16h4" />
      <path d="M13 16h7" />
      <circle cx="10.5" cy="16" r="2.2" />
    </svg>
  );
}

/** Cerrar. */
export function IconClose() {
  return (
    <svg {...base} width="20" height="20">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
