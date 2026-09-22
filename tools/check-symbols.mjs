// Verifies that every pin of every symbol (incl. option variants) lies on the 10-unit grid
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await import(pathToFileURL(join(root, 'js/parts/index.js')).href);
const { LIB, getSymbol } = await import(pathToFileURL(join(root, 'js/parts/kit.js')).href);
let bad = 0;
for (const def of Object.values(LIB)) {
  const variants = [{}];
  for (const pr of def.props || []) if (pr.options) for (const o of pr.options) variants.push({ [pr.key]: o });
  for (const v of variants) {
    const props = {};
    for (const pr of def.props || []) props[pr.key] = pr.default;
    Object.assign(props, v);
    const sym = getSymbol({ type: def.type, props });
    const ids = new Set();
    for (const p of sym.pins) {
      if (p.x % 10 || p.y % 10) { bad++; console.log(`${def.type} ${JSON.stringify(v)} pin ${p.id} at (${p.x},${p.y})`); }
      if (ids.has(p.id)) { bad++; console.log(`${def.type} duplicate pin id ${p.id}`); }
      ids.add(p.id);
    }
  }
}
console.log(bad ? `${bad} problems` : 'all pins on grid');
