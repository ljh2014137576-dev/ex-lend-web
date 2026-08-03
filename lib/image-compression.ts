// 支付凭证压缩：浏览器端 canvas 压缩，目标 ≤450KB、最长边 ≤1600px。
// 相比旧项目（E:/GLM-Z/ex-lend 的 image-compression.ts）修正：
// 1. HEIC/无法解码的图片不再抛错中止上传，而是返回 null 原样上传（降级不失败）；
// 2. 用 createImageBitmap(imageOrientation:"from-image") 处理 EXIF 方向，竖拍照片不旋转；
// 3. 去掉首帧 0.58 白渲染（旧代码结果立即被循环覆盖，属无效工作）；
// 4. 已 ≤450KB 的图片直接返回 null 跳过压缩。

const MAX_EDGE = 1600;
const MIN_EDGE = 960;
const TARGET_BYTES = 450 * 1024;

export interface CompressedImage {
  blob: Blob;
  contentType: string;
  extension: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function supportsWebp(): Promise<boolean> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const blob = await canvasToBlob(canvas, "image/webp", 0.5);
    return !!blob && blob.type === "image/webp";
  } catch {
    return false;
  }
}

async function render(
  source: ImageBitmap | HTMLImageElement,
  contentType: string,
  edge: number,
  quality: number,
): Promise<Blob | null> {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, edge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, contentType, quality);
}

/**
 * 压缩支付凭证图片。
 * 返回 null 表示“无需压缩或无法压缩”，调用方应原样上传原文件。
 */
export async function compressPaymentProof(file: File): Promise<CompressedImage | null> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return null;
  if (file.size <= TARGET_BYTES) return null;

  let source: ImageBitmap | HTMLImageElement | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      // 需要 try：Safari 旧版不支持 imageOrientation 选项时可能抛错
      source = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => loadImage(file));
    } else {
      source = await loadImage(file);
    }
  } catch {
    return null; // HEIC 等无法解码 → 降级原样上传，不让上传失败
  }

  try {
    const useWebp = await supportsWebp();
    const contentType = useWebp ? "image/webp" : "image/jpeg";
    const extension = useWebp ? "webp" : "jpg";

    let edge = MAX_EDGE;
    let quality = 0.72;
    let blob = await render(source, contentType, edge, quality);

    // 先降质量到 0.4
    while (blob && blob.size > TARGET_BYTES && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.08);
      blob = await render(source, contentType, edge, quality);
    }
    // 再降最长边到 MIN_EDGE
    while (blob && blob.size > TARGET_BYTES && edge > MIN_EDGE) {
      edge = Math.max(MIN_EDGE, Math.round(edge * 0.82));
      blob = await render(source, contentType, edge, quality);
    }

    if (!blob || blob.size >= file.size) return null;
    return { blob, contentType, extension };
  } catch {
    return null;
  } finally {
    if (source instanceof ImageBitmap) source.close();
  }
}
