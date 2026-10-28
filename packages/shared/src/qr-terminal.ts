export interface QrMatrix {
  size: number;
  /** row-major dark-module flags (qrcode's `modules.data`) */
  data: ArrayLike<boolean | number>;
}

export interface QrTerminalOptions {
  /** light quiet zone in modules; the QR spec asks for 4 */
  margin?: number;
  /** one line per module row from background-colored spaces — ASCII-only,
   * for consoles that can't draw block glyphs (legacy Windows) */
  ascii?: boolean;
}

const RESET = "\x1b[0m";
// 8-color codes every terminal supports: 30/40 black, 37/47 white
const FG = { dark: 30, light: 37 } as const;
const BG = { dark: 40, light: 47 } as const;

/** Renders a QR matrix for a terminal with explicit black-on-white colors
 * and a light quiet zone, so phones scan it on dark and light themes alike
 * (inheriting the theme inverts the code on dark terminals). Default mode
 * packs two module rows per line with '▀' (top = foreground, bottom =
 * background) so a full WhatsApp code fits a normal terminal height. */
export function renderQrTerminal(matrix: QrMatrix, options: QrTerminalOptions = {}): string {
  const margin = options.margin ?? 4;
  const full = matrix.size + margin * 2;
  const dark = (x: number, y: number): boolean => {
    const cx = x - margin;
    const cy = y - margin;
    if (cx < 0 || cy < 0 || cx >= matrix.size || cy >= matrix.size) {
      return false;
    }
    return Boolean(matrix.data[cy * matrix.size + cx]);
  };
  const lines: string[] = [];
  if (options.ascii === true) {
    for (let y = 0; y < full; y += 1) {
      let line = "";
      let current = "";
      for (let x = 0; x < full; x += 1) {
        const code = `\x1b[${dark(x, y) ? BG.dark : BG.light}m`;
        if (code !== current) {
          line += code;
          current = code;
        }
        line += "  ";
      }
      lines.push(line + RESET);
    }
    return `${lines.join("\n")}\n`;
  }
  for (let y = 0; y < full; y += 2) {
    let line = "";
    let current = "";
    for (let x = 0; x < full; x += 1) {
      const top = dark(x, y) ? FG.dark : FG.light;
      const bottom = dark(x, y + 1) ? BG.dark : BG.light;
      const code = `\x1b[${top};${bottom}m`;
      if (code !== current) {
        line += code;
        current = code;
      }
      line += "▀";
    }
    lines.push(line + RESET);
  }
  return `${lines.join("\n")}\n`;
}
