/**
 * 寬鬆的 JSON：先照標準解，解不開再用 JSON5 的常見寫法解一次。
 *
 * 酒館的 MagVarUpdate 初始變數條目是作者手寫的，常見的有註解（// 與 /* *\/）、結尾多一個逗號、
 * 單引號字串、沒加引號的鍵。這幾種收；YAML、EJS 這類不是 JSON 的就解不開，由呼叫端決定怎麼辦。
 * 不支援十六進位、Infinity、NaN、跨行字串——遇到就當解不開。
 */

export function parseRelaxedJson(text: string): unknown {
  const source = text.replace(/^﻿/, "");
  try {
    return JSON.parse(source);
  } catch {
    return new RelaxedParser(source).parse();
  }
}

class RelaxedParser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): unknown {
    const value = this.value(0);
    this.space();
    if (this.i < this.s.length) this.fail();
    return value;
  }

  private fail(): never {
    throw new SyntaxError(`relaxed_json_invalid_at_${this.i}`);
  }

  private space() {
    for (;;) {
      const c = this.s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === " " || c === "﻿") this.i++;
      else if (c === "/" && this.s[this.i + 1] === "/") {
        while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      } else if (c === "/" && this.s[this.i + 1] === "*") {
        const end = this.s.indexOf("*/", this.i + 2);
        if (end < 0) this.fail();
        this.i = end + 2;
      } else return;
    }
  }

  private value(depth: number): unknown {
    if (depth > 64) this.fail();
    this.space();
    const c = this.s[this.i];
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"' || c === "'") return this.string();
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.number();
    const word = this.identifier();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return this.fail();
  }

  private object(depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    for (;;) {
      this.space();
      if (this.s[this.i] === "}") { this.i++; return out; }
      const c = this.s[this.i];
      const key = c === '"' || c === "'" ? this.string() : this.identifier();
      if (!key && c !== '"' && c !== "'") this.fail();
      this.space();
      if (this.s[this.i] !== ":") this.fail();
      this.i++;
      Object.defineProperty(out, key, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
      this.space();
      if (this.s[this.i] === ",") { this.i++; continue; }
      if (this.s[this.i] === "}") { this.i++; return out; }
      this.fail();
    }
  }

  private array(depth: number): unknown[] {
    const out: unknown[] = [];
    this.i++;
    for (;;) {
      this.space();
      if (this.s[this.i] === "]") { this.i++; return out; }
      out.push(this.value(depth + 1));
      this.space();
      if (this.s[this.i] === ",") { this.i++; continue; }
      if (this.s[this.i] === "]") { this.i++; return out; }
      this.fail();
    }
  }

  private string(): string {
    const quote = this.s[this.i++];
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c === "\n") this.fail();
      if (c !== "\\") { out += c; continue; }
      const e = this.s[this.i++];
      if (e === "u") {
        const hex = this.s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail();
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 4;
      } else if (e === "\n") {
        /* 行尾跳脫：接下一行 */
      } else {
        out += ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "0": "\0" } as Record<string, string>)[e] ?? e;
      }
    }
    return this.fail();
  }

  private number(): number {
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (!m) this.fail();
    this.i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) this.fail();
    return n;
  }

  /** 沒加引號的鍵與 true／false／null。照 JSON5：字母、數字、底線、$，以及任何非 ASCII 字（中文鍵）。 */
  private identifier(): string {
    const m = /^[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/.exec(this.s.slice(this.i));
    if (!m) return "";
    this.i += m[0].length;
    return m[0];
  }
}
