/** Preserve PNG/APNG bytes; other accepted image formats become a PNG export. */
export async function imageToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.every((byte, i) => bytes[i] === byte)) return bytes;
  const image = await createImageBitmap(new Blob([bytes.slice().buffer]));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image_conversion_failed');
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image_conversion_failed')), 'image/png');
    });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    image.close();
  }
}
