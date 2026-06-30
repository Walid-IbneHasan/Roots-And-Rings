import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UploadsService } from '../src/modules/uploads/service';

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../uploads');
const svc = new UploadsService(uploadsDir);

describe('UploadsService.processImage', () => {
  it('rejects non-image data', async () => {
    await expect(svc.processImage(Buffer.from('not an image at all here'), 'products')).rejects.toThrow();
  });

  it('re-encodes a valid PNG to WebP and returns dimensions', async () => {
    const png = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#caa' } }).png().toBuffer();
    const out = await svc.processImage(png, 'products');
    expect(out.url).toMatch(/^\/uploads\/products\/.+\.webp$/);
    expect(out.width).toBe(40);
    expect(out.height).toBe(50);
    const onDisk = path.join(uploadsDir, out.url.replace('/uploads/', ''));
    await expect(access(onDisk)).resolves.toBeUndefined();
  });
});
