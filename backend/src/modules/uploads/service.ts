import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

export type UploadKind = 'products' | 'categories' | 'avatars';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../uploads');

/** Sniff true file type by magic bytes (not the client-provided MIME). */
function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'avif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 16);
    if (brand.includes('avif') || brand.includes('heic') || brand.includes('mif1')) return 'avif';
  }
  return null;
}

export interface ProcessedImage {
  url: string;
  width: number;
  height: number;
}

export class UploadsService {
  constructor(private baseDir: string = DEFAULT_DIR) {}

  /**
   * Validate by magic bytes, EXIF-rotate, strip metadata, resize long edge ≤1600px,
   * re-encode to WebP q80, write under uploads/<kind>/ with a random filename.
   */
  async processImage(buffer: Buffer, kind: UploadKind, maxEdge = 1600): Promise<ProcessedImage> {
    const type = sniff(buffer);
    if (!type) {
      const err = new Error('Unsupported or invalid image file');
      (err as { statusCode?: number }).statusCode = 400;
      throw err;
    }

    const { data, info } = await sharp(buffer)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const filename = `${nanoid()}.webp`;
    const dir = path.join(this.baseDir, kind);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), data);

    return { url: `/uploads/${kind}/${filename}`, width: info.width, height: info.height };
  }
}

export const uploadsService = new UploadsService();
