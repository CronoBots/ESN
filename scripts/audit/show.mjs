// Affiche le résumé du bilan (npm run audit) ; le détail, avec les noms, reste dans audit/rapport.md (local).
import { readFileSync } from 'node:fs';
const text = readFileSync(new URL('../../audit/rapport.md', import.meta.url), 'utf8');
const summary = text.split('## Résumé')[1]?.split('\n## ')[0]?.trim() ?? '';
console.log(`\nBilan de la récupération (détail : audit/rapport.md)\n${summary}\n`);
