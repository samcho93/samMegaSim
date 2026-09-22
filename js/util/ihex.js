// Intel HEX parser
export function parseIntelHex(text, maxSize = 262144) {
  const data = new Uint8Array(maxSize).fill(0xff);
  let base = 0, maxAddr = 0;
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line) continue;
    if (line[0] !== ':') throw new Error(`HEX 형식 오류 (line ${ln + 1})`);
    const bytes = [];
    for (let i = 1; i + 1 < line.length; i += 2) bytes.push(parseInt(line.substr(i, 2), 16));
    const len = bytes[0];
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new Error(`HEX 체크섬 오류 (line ${ln + 1})`);
    if (type === 0) {
      for (let i = 0; i < len; i++) {
        const a = base + addr + i;
        if (a < maxSize) data[a] = bytes[4 + i];
        if (a + 1 > maxAddr) maxAddr = a + 1;
      }
    } else if (type === 1) {
      break;
    } else if (type === 2) {
      base = ((bytes[4] << 8) | bytes[5]) << 4;
    } else if (type === 4) {
      base = ((bytes[4] << 8) | bytes[5]) << 16;
    }
  }
  return { data, maxAddr };
}
