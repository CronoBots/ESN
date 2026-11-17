// Temps limites des championnats (public/data/qualifying.json), à mettre à jour à chaque saison.
//
//   node scripts/limits.mjs texte REGLEMENT.pdf [PAGE] [--positions]
//        texte d'un règlement PDF, ligne par ligne (« | » entre les cellules) ; --positions ajoute la position
//        horizontale de chaque cellule (« 1:07,88@363 ») pour savoir à quelle colonne (âge, A ou B) elle appartient
//   node scripts/limits.mjs verifier
//        contrôle le fichier (temps lisibles, A plus rapide que B, limites plus rapides avec l'âge et plus lentes
//        avec la distance, dates) et affiche un résumé par championnat
//
// Les temps s'écrivent comme sur le règlement (« 1:07.88 », « 27.59 ») : un championnat dont la date est passée
// n'est plus affiché ; « limitsEdition » plus ancien que « edition » = limites reprises de l'édition précédente
// (affichées comme provisoires) en attendant les nouvelles.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});

const FILE = new URL('../public/data/qualifying.json', import.meta.url);
const [cmd, ...args] = process.argv.slice(2);

async function pdfText(file, only, positions) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
  console.log(`${file} : ${doc.numPages} pages`);
  for (let p = 1; p <= doc.numPages; p++) {
    if (only && p !== only) continue;
    const content = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const k = [...rows.keys()].find((r) => Math.abs(r - y) <= 2) ?? y;
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push({ x: Math.round(it.transform[4]), s: it.str.trim() });
    }
    console.log(`--- page ${p}`);
    for (const y of [...rows.keys()].sort((a, b) => b - a))
      console.log(rows.get(y).sort((a, b) => a.x - b.x).map((c) => (positions ? `${c.s}@${c.x}` : c.s)).join(positions ? '  ' : ' | '));
  }
}

async function verify() {
  const { parseQualifying } = await import('../src/lib/qualifying.ts');
  const { formatTime } = await import('../src/lib/time.ts');
  const data = parseQualifying(JSON.parse(readFileSync(FILE, 'utf8')));
  const today = new Date().toISOString().slice(0, 10);
  const problems = [];
  const order = (k) => (k === 'A' ? 0 : k === 'B' ? 1 : Number(k.replace('+', '')));
  for (const c of data.championships) {
    let count = 0;
    for (const g of ['F', 'M']) {
      const events = c.limits[g];
      for (const [event, row] of Object.entries(events)) {
        count += Object.keys(row).length;
        if (row.A != null && row.B != null && row.A > row.B) problems.push(`${c.id} ${g} ${event} : A (${formatTime(row.A)}) plus lent que B (${formatTime(row.B)})`);
        const ages = Object.keys(row).filter((k) => /^\d/.test(k)).sort((a, b) => order(a) - order(b));
        for (let i = 1; i < ages.length; i++)
          if (row[ages[i]] > row[ages[i - 1]]) problems.push(`${c.id} ${g} ${event} : ${ages[i]} ans plus lent que ${ages[i - 1]} ans`);
        // Même nage, distance plus longue : temps plus long
        const [d, stroke] = event.split('-');
        for (const [other, row2] of Object.entries(events)) {
          const [d2, s2] = other.split('-');
          if (s2 !== stroke || Number(d2) <= Number(d)) continue;
          for (const k of Object.keys(row)) if (row2[k] != null && row2[k] <= row[k]) problems.push(`${c.id} ${g} ${other} ${k} : pas plus lent que le ${event}`);
        }
      }
    }
    const kind = c.provisional ? `règlement ${c.limitsEdition} provisoire` : `règlement ${c.limitsEdition} officiel`;
    const state = c.until < today ? '⚠ passé (à retirer ou à remplacer)' : kind;
    const what = c.allround ? `classement aux points (${c.allround.categories.length} catégories)` : `${count} limites`;
    if (!c.allround && !count) problems.push(`${c.id} : ni limite ni classement aux points`);
    console.log(
      `${c.id} · ${c.name} (${c.course === 'SCM' ? '25 m' : '50 m'}) · ${c.start ? `${c.start} → ${c.end ?? c.start}` : `affiché jusqu'au ${c.until}`} · temps du ${c.window.from} au ${c.window.to} · ${what} · ${state}`,
    );
  }
  if (problems.length) {
    console.log(`\n${problems.length} incohérences à vérifier sur le règlement :`);
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
  } else console.log(`\nFichier valide (mis à jour le ${data.updated}).`);
}

if (cmd === 'texte') {
  const [file, page] = args.filter((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage : node scripts/limits.mjs texte REGLEMENT.pdf [PAGE] [--positions]');
  await pdfText(file, page ? Number(page) : undefined, args.includes('--positions'));
} else if (cmd === 'verifier') {
  await verify();
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 13).join('\n'));
}
