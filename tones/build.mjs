// Joins the per-song tone files into all-tones.json (the "Add starter tones" library). Run: npm run tones
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'all-tones.json')
  .sort();
const recipes = files.flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).recipes);
writeFileSync(new URL('all-tones.json', dir), JSON.stringify({ kind: 'tonelab-se-library', version: 1, recipes }, null, 2) + '\n');
console.log(`all-tones.json: ${recipes.length} tones from ${files.length} files`);
