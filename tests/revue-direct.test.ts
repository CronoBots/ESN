import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import type { AppData, Swimmer } from '../src/store/types';

/*
 * Recherche des résultats en direct (live.swimrankings.net) : défauts relevés à la revue.
 * Noms, compétitions et temps fictifs uniquement.
 */

// Lecteur PDF simulé : le « PDF » est un texte, une ligne par morceau
const fakePdfjs = vi.hoisted(() => () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: ({ data }: { data: Uint8Array }) => {
    const lines = new TextDecoder().decode(data).split('\n');
    const page = {
      getTextContent: async () => ({ items: lines.map((str, i) => ({ str, transform: [1, 0, 0, 1, 0, 1000 - i * 12], width: str.length * 5 })) }),
    };
    return { promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: async () => {} };
  },
}));
vi.mock('pdfjs-dist/legacy/build/pdf.min.mjs', () => fakePdfjs());
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }));

/** Archive zip minimale (un fichier compressé « deflate »). */
function zip(name: string, content: string): ArrayBuffer {
  const data = Buffer.from(content, 'utf8');
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(n.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + n.length, 12);
  eocd.writeUInt32LE(local.length + n.length + comp.length, 16);
  const all = Buffer.concat([local, n, comp, cd, n, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

// Compétition fictive terminée : deux nageuses fictives de l'ESN
const LEF = `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0"><MEETS><MEET city="Liège" name="Meeting fictif" course="SCM" nation="BEL">
<SESSIONS><SESSION date="2026-01-10" daytime="09:00" number="1"><EVENTS>
<EVENT eventid="11" daytime="09:41" gender="F" number="3" round="TIM"><SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
<HEATS><HEAT heatid="901" number="1" /></HEATS></EVENT>
</EVENTS></SESSION></SESSIONS>
<CLUBS><CLUB name="Ecole Seraing Natation" code="ESN"><ATHLETES>
<ATHLETE firstname="Alice" lastname="Fictif" birthdate="2015-03-02" gender="F">
<RESULTS><RESULT eventid="11" points="205" swimtime="00:01:24.62" resultid="501" heatid="901" lane="4" /></RESULTS>
</ATHLETE>
<ATHLETE firstname="Chloé" lastname="Exemple" birthdate="2015-07-09" gender="F">
<RESULTS><RESULT eventid="11" points="210" swimtime="00:01:23.10" resultid="502" heatid="901" lane="5" /></RESULTS>
</ATHLETE></ATHLETES></CLUB></CLUBS>
</MEET></MEETS></LENEX>`;

const swimmer = (id: string, firstName: string, lastName: string, extra: Partial<Swimmer> = {}): Swimmer => ({
  id,
  firstName,
  lastName,
  gender: 'F',
  birthYear: 2015,
  color: 0,
  relation: 'followed',
  favorite: false,
  createdAt: 0,
  ...extra,
});

const data = (swimmers: Swimmer[], liveSync: AppData['settings']['liveSync']): AppData => ({
  version: 1,
  swimmers,
  meets: [],
  swims: [],
  goals: [],
  settings: { theme: 'auto', includeTraining: false, defaultCourse: 'SCM', onboarded: true, celebrate: true, liveSync },
});

/** Application relancée : plus rien en mémoire (données, lectures gardées, lecteur PDF). */
async function fresh() {
  vi.resetModules();
  const store = await import('../src/store/store');
  const live = await import('../src/lib/liveResults');
  return { ...store, ...live };
}

type Answer = string | ArrayBuffer | number | Error | (() => string | ArrayBuffer | number | Error);
let calls: string[];
let site: Record<string, Answer>;

beforeEach(() => {
  calls = [];
  site = {};
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  // Site simulé : texte, archive, code d'erreur HTTP ou coupure réseau
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    let a = site[url.replace('https://live.swimrankings.net', '')];
    if (typeof a === 'function') a = a();
    if (a === undefined) return new Response('', { status: 404 });
    if (a instanceof Error) throw a;
    if (typeof a === 'number') return new Response('', { status: a });
    return new Response(a);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('recherche automatique : les anciens membres ne la relancent pas (store-2, import-4)', () => {
  it('attend le délai prévu quand tous les nageurs suivis ont déjà été cherchés', async () => {
    const app = await fresh();
    app.actions.replaceAll(
      data([swimmer('a1', 'Alice', 'FICTIF'), swimmer('f1', 'Ancienne', 'MEMBRE', { former: true })], {
        enabled: true,
        processed: { '9001': ['a1'] },
        lastCheck: Date.now(),
        engine: app.SYNC_ENGINE,
      }),
    );
    expect(app.shouldAutoSyncLive()).toBe(false);
    // Un nouveau nageur actif : recherche tout de suite
    app.actions.addSwimmer({ firstName: 'Chloé', lastName: 'EXEMPLE', gender: 'F', birthYear: 2015, relation: 'followed' });
    expect(app.shouldAutoSyncLive()).toBe(true);
  });
});

describe('lectures en direct : une seule version gardée par compétition (store-6)', () => {
  it('oublie la lecture précédente d’une compétition en cours, sans toucher aux autres', async () => {
    site['/7101/results.lxf'] = () => zip('results.lef', LEF);
    site['/71010/results.lxf'] = () => zip('results.lef', LEF);
    const app = await fresh();
    const t0 = 6_000_000 * 300000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await app.fetchLiveResults('71010', true);
    await app.fetchLiveResults('7101', true);
    now.mockReturnValue(t0 + 300000);
    await app.fetchLiveResults('7101', true);
    expect(calls.filter((u) => u.includes('/7101/'))).toHaveLength(2);
    // La lecture de t0 n'est plus gardée : relue (avant : gardée à vie, une de plus toutes les 5 minutes)
    now.mockReturnValue(t0);
    await app.fetchLiveResults('7101', true);
    expect(calls.filter((u) => u.includes('/7101/'))).toHaveLength(3);
    // L'autre compétition (identifiant qui commence pareil) garde la sienne
    await app.fetchLiveResults('71010', true);
    expect(calls.filter((u) => u.includes('/71010/'))).toHaveLength(1);
  });
});

describe('feuilles PDF : une feuille illisible ne fait pas perdre les résultats (import-1)', () => {
  const meet = { id: '7201', status: 'finished' as const, name: 'Meeting fictif', course: 'SCM' as const, startDate: '2026-01-10', endDate: '2026-01-11' };
  const alice = swimmer('a1', 'Alice', 'FICTIF');
  const club = /seraing|\besn\b/i;

  beforeEach(() => {
    site['/7201/'] = '<a href="ResultList_1.pdf">1</a><a href="ResultList_2.pdf">2</a><a href="EntryStatistics.pdf">Statistiques</a>';
    site['/7201/EntryStatistics.pdf'] = 'Statistiques des engagements\nEsn 2 4';
    site['/7201/ResultList_1.pdf'] = 'Epreuve 1 10-01-26 - 09:30 Dames, 50m Dos\n 1. FICTIF, Alice 15 Esn 40.12 250';
    site['/7201/ResultList_2.pdf'] = 'Epreuve 2 10-01-26 - 10:00 Dames, 50m Libre\n 1. FICTIF, Alice 15 Esn 35.50 260';
  });

  it('toutes les feuilles lues : résultats trouvés, compétition complète', async () => {
    const r = (await (await fresh()).readMeetPdfs(meet, [alice], club))!;
    expect(r.found.get('a1')?.map((s) => s.timeCs)).toEqual([4012, 3550]);
    expect(r.complete).toBe(true);
  });

  it('feuille des engagements en erreur : les épreuves sont quand même lues', async () => {
    site['/7201/EntryStatistics.pdf'] = 503;
    const r = (await (await fresh()).readMeetPdfs(meet, [alice], club))!;
    expect(r.found.get('a1')?.map((s) => s.timeCs)).toEqual([4012, 3550]);
  });

  it('feuille d’une épreuve en erreur ou coupure réseau : compétition pas complète, relue à la recherche suivante', async () => {
    site['/7201/ResultList_2.pdf'] = 503;
    let r = (await (await fresh()).readMeetPdfs(meet, [alice], club))!;
    expect(r.found.get('a1')?.map((s) => s.timeCs)).toEqual([4012]);
    expect(r.complete).toBe(false);
    site['/7201/ResultList_2.pdf'] = new Error('réseau coupé');
    r = (await (await fresh()).readMeetPdfs(meet, [alice], club))!;
    expect(r.complete).toBe(false);
  });

  it('lecteur PDF pas chargé une fois : rechargé à la feuille suivante', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist/legacy/build/pdf.min.mjs', () => {
      throw new Error('lecteur PDF indisponible (hors ligne)');
    });
    const { pdfLines } = await import('../src/lib/pdfText');
    const sheet = new TextEncoder().encode('Epreuve 1 10-01-26 - 09:30 Dames, 50m Dos').buffer as ArrayBuffer;
    await expect(pdfLines(sheet)).rejects.toThrow();
    // De nouveau en ligne : la feuille suivante est lue (avant : échec jusqu'à la relance de l'application)
    vi.doMock('pdfjs-dist/legacy/build/pdf.min.mjs', () => fakePdfjs());
    expect(await pdfLines(sheet)).toEqual(['Epreuve 1 10-01-26 - 09:30 Dames, 50m Dos', '']);
  });
});

describe('fin de recherche : un nageur renommé pendant la recherche reste à rechercher (import-13)', () => {
  it('ne remet pas dans la liste des compétitions traitées un nageur renommé entre-temps', async () => {
    const app = await fresh();
    app.actions.replaceAll(
      data([swimmer('a1', 'Alice', 'FICTIF'), swimmer('c1', 'Chloé', 'EXEMPLE')], { enabled: true, processed: { '9001': ['a1', 'c1'] }, engine: app.SYNC_ENGINE }),
    );
    site['/?nation=BEL'] =
      '<tr class=""><td class="tdStatus"><a href="/7301/"><span class="badge badge-finished">Finished</span></a></td><td class="tdDate"><a href="/7301/"><span class="dateLong">10 - 11 Jan 2026</span></a></td><td class="tdCourse"><a href="/7301/"><span class="course">25m</span></a></td><td class="tdName"><a href="/7301/"><span class="name">Meeting fictif</span></a></td><td class="tdCity"><a href="/7301/">Liège <span class="nation">BEL</span></a></td></tr>';
    // Pendant la lecture du fichier de résultats, un parent corrige le nom
    site['/7301/results.lxf'] = () => {
      app.actions.updateSwimmer('a1', { lastName: 'FICTIVE' });
      return zip('results.lef', LEF);
    };
    await app.syncLive({ force: true });
    const processed = app.getState().settings.liveSync.processed;
    expect(processed['7301']).toEqual(['c1']);
    expect(processed['9001']).toEqual(['c1']);
    // Sous son nouveau nom, elle sera cherchée dès que possible
    expect(app.shouldAutoSyncLive()).toBe(true);
  });
});
