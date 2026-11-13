"use client";

const MAX_SIDE = 2400;
const QUALITY = 0.88;
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;

/**
 * Downscale large phone photos in the browser so uploads stay well under the
 * 4.5 MB Vercel request limit. Falls back to the original file if the browser
 * cannot decode it (e.g. HEIC on some browsers).
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SKIP_BELOW_BYTES && file.type !== "image/heic" && file.type !== "image/heif") return file;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "menu";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
