const QUADRANTS: Record<number, string> = {
  0: " ",
  1: "▗",
  2: "▖",
  3: "▄",
  4: "▝",
  5: "▐",
  6: "▞",
  7: "▟",
  8: "▘",
  9: "▚",
  10: "▌",
  11: "▙",
  12: "▀",
  13: "▜",
  14: "▛",
  15: "█",
}

export class Raster {
  readonly width: number
  readonly height: number
  private readonly cells: Uint8Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = new Uint8Array(width * height)
  }

  get subWidth(): number {
    return this.width * 2
  }

  get subHeight(): number {
    return this.height * 2
  }

  setSub(x2: number, y2: number): void {
    const x = Math.round(x2)
    const y = Math.round(y2)
    if (x < 0 || y < 0 || x >= this.width * 2 || y >= this.height * 2) return
    const cx = x >> 1
    const cy = y >> 1
    const right = (x & 1) === 1
    const bottom = (y & 1) === 1
    const bit = right ? (bottom ? 1 : 4) : bottom ? 2 : 8
    this.cells[cy * this.width + cx] |= bit
  }

  setCell(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.cells[y * this.width + x] = 15
  }

  line(x0: number, y0: number, x1: number, y1: number, accept?: (x2: number, y2: number) => boolean): void {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const xe = Math.round(x1)
    const ye = Math.round(y1)
    const dx = Math.abs(xe - x)
    const dy = -Math.abs(ye - y)
    const sx = x < xe ? 1 : -1
    const sy = y < ye ? 1 : -1
    let err = dx + dy
    let guard = 0
    const maxSteps = dx - dy + 2
    for (;;) {
      if (!accept || accept(x, y)) this.setSub(x, y)
      if ((x === xe && y === ye) || guard++ > maxSteps) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  toLines(): string[] {
    const lines: string[] = []
    for (let y = 0; y < this.height; y++) {
      let line = ""
      for (let x = 0; x < this.width; x++) {
        line += QUADRANTS[this.cells[y * this.width + x] ?? 0] ?? " "
      }
      lines.push(line)
    }
    return lines
  }
}
