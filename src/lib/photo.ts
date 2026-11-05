/**
 * Compresión de la foto ANTES de subirla.
 *
 * Las del iPhone salen de 2 a 5 MB, y aquí la foto solo tiene que servir para
 * reconocer cuál de tus ejemplares es: no hace falta resolución de catálogo.
 * El plan gratuito de R2 son 10 GB y nadie los vigila.
 */

const MAX_SIDE = 1600;
const QUALITY = 0.82;

/**
 * Devuelve el fichero original si algo falla o si comprimir no gana nada. Una
 * foto peor es mejor que un alta perdida, así que esto no lanza nunca.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  try {
    // `from-image` aplica la orientación del EXIF. Sin eso, las fotos hechas
    // con el móvil en vertical se suben giradas: el canvas ignora el EXIF.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    );

    // En una foto ya pequeña, recomprimir puede salir más grande.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
