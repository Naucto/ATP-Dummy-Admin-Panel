import { deflateSync } from 'node:zlib';

/** Naucto's Bubblegum-16 palette, which every seeded game is drawn with. */
const PALETTE = [
  '#16171a',
  '#7f0622',
  '#d62411',
  '#ff8426',
  '#ffd100',
  '#fafdff',
  '#ff80a4',
  '#ff2674',
  '#94216a',
  '#430067',
  '#234975',
  '#68aed4',
  '#bfff3c',
  '#10d275',
  '#007899',
  '#002859',
];

type Colour = [number, number, number];

const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 180;
const SPRITE_SIZE = 8;

function colour(index: number): Colour {
  const code = PALETTE[index % PALETTE.length] ?? '#000000';
  return [
    Number.parseInt(code.slice(1, 3), 16),
    Number.parseInt(code.slice(3, 5), 16),
    Number.parseInt(code.slice(5, 7), 16),
  ];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

class Canvas {
  private readonly rgb: Buffer;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.rgb = Buffer.alloc(width * height * 3);
  }

  rect(left: number, top: number, width: number, height: number, fill: Colour): void {
    for (let y = Math.max(top, 0); y < Math.min(top + height, this.height); y++) {
      for (let x = Math.max(left, 0); x < Math.min(left + width, this.width); x++) {
        const at = (y * this.width + x) * 3;
        this.rgb[at] = fill[0];
        this.rgb[at + 1] = fill[1];
        this.rgb[at + 2] = fill[2];
      }
    }
  }

  sprite(rows: readonly string[], left: number, top: number, scale: number): void {
    rows.forEach((row, y) => {
      Array.from(row).forEach((cell, x) => {
        if (cell !== '.') {
          this.rect(
            left + x * scale,
            top + y * scale,
            scale,
            scale,
            colour(Number.parseInt(cell, 16)),
          );
        }
      });
    });
  }

  png(): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.writeUInt8(8, 8);
    header.writeUInt8(2, 9);
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      this.rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** A screen-sized cover: the game's sprite standing on a horizon, as the Frontend's seed draws it. */
export function coverPng(sprite: readonly string[], sky: number): Buffer {
  const canvas = new Canvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  const skyColour = colour(sky);
  const ground = skyColour.map((channel) => Math.round(channel * 0.45)) as Colour;
  const horizon = SCREEN_HEIGHT - 34;
  canvas.rect(0, 0, SCREEN_WIDTH, horizon, skyColour);
  canvas.rect(0, horizon, SCREEN_WIDTH, SCREEN_HEIGHT - horizon, ground);
  const scale = 12;
  canvas.sprite(
    sprite,
    Math.round((SCREEN_WIDTH - SPRITE_SIZE * scale) / 2),
    horizon - SPRITE_SIZE * scale + 6,
    scale,
  );
  return canvas.png();
}

/** What a bug report's screenshot stands in for: a game frame with a floor, platforms and a sprite. */
export function screenshotPng(sprite: readonly string[], variant: number): Buffer {
  const scale = 3;
  const width = SCREEN_WIDTH * scale;
  const height = SCREEN_HEIGHT * scale;
  const canvas = new Canvas(width, height);
  canvas.rect(0, 0, width, height, colour(variant % 2 === 0 ? 15 : 0));
  const tile = SPRITE_SIZE * scale;
  const floor = colour(10 + (variant % 4));
  canvas.rect(0, height - tile, width, tile, floor);
  for (let platform = 0; platform < 4; platform++) {
    const left = ((variant * 7 + platform * 11) % 30) * tile;
    const top = height - tile * (5 + ((variant + platform * 3) % 9));
    canvas.rect(left, top, tile * (4 + ((variant + platform) % 5)), tile, floor);
  }
  canvas.sprite(sprite, ((variant * 5) % 30) * tile, height - tile * 2, scale);
  canvas.rect(tile, tile, tile * 6, scale * 3, colour(4));
  return canvas.png();
}
