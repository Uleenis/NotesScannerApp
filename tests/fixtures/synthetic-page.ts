export type TestGray = { data: Uint8Array; width: number; height: number };

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stroke(page: Float64Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number, thickness: number, ink: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const radius = thickness / 2;
  for (let step = 0; step <= steps; step += 1) {
    const x = x0 + ((x1 - x0) * step) / steps;
    const y = y0 + ((y1 - y0) * step) / steps;
    for (let py = Math.floor(y - radius); py <= Math.ceil(y + radius); py += 1) {
      for (let px = Math.floor(x - radius); px <= Math.ceil(x + radius); px += 1) {
        if (px >= 0 && py >= 0 && px < width && py < height && Math.hypot(px - x, py - y) <= radius) {
          page[py * width + px] = ink;
        }
      }
    }
  }
}

const made = new Map<string, TestGray>();

export function syntheticPage(seed: number, width = 450, height = 600): TestGray {
  const key = `${seed}/${width}/${height}`;
  const known = made.get(key);
  if (known !== undefined) {
    return known;
  }
  const page = makePage(seed, width, height);
  made.set(key, page);
  return page;
}

function makePage(seed: number, width: number, height: number): TestGray {
  const random = generator(seed);
  const page = new Float64Array(width * height).fill(232);
  const lineHeight = 38 + Math.floor(random() * 10);
  const thickness = 1.6 + random() * 0.9;
  const ink = 30 + Math.floor(random() * 40);
  for (let baseline = 90; baseline < height - 60; baseline += lineHeight) {
    let x = 60 + random() * 20;
    while (x < width - 70) {
      const glyph = 8 + random() * 16;
      const rise = 10 + random() * 16;
      stroke(page, width, height, x, baseline, x + glyph * 0.5, baseline - rise, thickness, ink);
      stroke(page, width, height, x + glyph * 0.5, baseline - rise, x + glyph, baseline - random() * 6, thickness, ink);
      if (random() < 0.4) {
        stroke(page, width, height, x + glyph * 0.2, baseline - rise * 0.5, x + glyph * 0.9, baseline - rise * 0.5, thickness, ink);
      }
      x += glyph + 4 + random() * 8;
      if (random() < 0.15) {
        x += 14;
      }
    }
  }
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.max(0, Math.min(255, Math.round(page[index] + (random() - 0.5) * 6)));
  }
  return gaussianBlur({ data, width, height }, 0.5);
}

export function gaussianBlur(gray: TestGray, sigma: number): TestGray {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    kernel.push(Math.exp(-(offset * offset) / (2 * sigma * sigma)));
  }
  const total = kernel.reduce((sum, weight) => sum + weight, 0);
  const { width, height } = gray;
  const horizontal = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + offset));
        sum += gray.data[y * width + sx] * kernel[offset + radius];
      }
      horizontal[y * width + x] = sum / total;
    }
  }
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + offset));
        sum += horizontal[sy * width + x] * kernel[offset + radius];
      }
      data[y * width + x] = Math.round(sum / total);
    }
  }
  return { data, width, height };
}

export function motionBlur(gray: TestGray, length: number, degrees: number): TestGray {
  const { width, height } = gray;
  const dx = Math.cos((degrees * Math.PI) / 180);
  const dy = Math.sin((degrees * Math.PI) / 180);
  const samples = Math.max(2, Math.round(length));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let sample = 0; sample < samples; sample += 1) {
        const t = (sample / (samples - 1) - 0.5) * length;
        const sx = Math.min(width - 1, Math.max(0, Math.round(x + t * dx)));
        const sy = Math.min(height - 1, Math.max(0, Math.round(y + t * dy)));
        sum += gray.data[sy * width + sx];
      }
      data[y * width + x] = Math.round(sum / samples);
    }
  }
  return { data, width, height };
}

export function enlarge(gray: TestGray, factor: number): TestGray {
  const width = gray.width * factor;
  const height = gray.height * factor;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = gray.data[Math.floor(y / factor) * gray.width + Math.floor(x / factor)];
    }
  }
  return { data, width, height };
}
