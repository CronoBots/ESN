import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';

// Compétition fictive terminée : une épreuve, une nageuse fictive
const LEF = `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0"><MEETS><MEET city="Liège" name="Meeting fictif" course="SCM" nation="BEL">
<SESSIONS><SESSION date="2026-10-10" daytime="09:00" number="1"><EVENTS>
<EVENT eventid="11" daytime="09:41" gender="F" number="3" round="TIM"><SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
<HEATS><HEAT heatid="901" number="1" /></HEATS></EVENT>
</EVENTS></SESSION></SESSIONS>
<CLUBS><CLUB name="Club Exemple Natation" code="CEN"><ATHLETES>
<ATHLETE firstname="Emma" lastname="Dupont" birthdate="2015-06-26" gender="F">
<RESULTS><RESULT eventid="11" points="205" swimtime="00:01:24.62" resultid="501" heatid="901" lane="4" /></RESULTS>
</ATHLETE></ATHLETES></CLUB></CLUBS>
</MEET></MEETS></LENEX>`;

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

/** Cache Storage minimal (en mémoire). */
function memoryCaches() {
  const stores = new Map<string, Map<string, ArrayBuffer>>();
  return {
    stores,
    async open(name: string) {
      const m = stores.get(name) ?? new Map<string, ArrayBuffer>();
      stores.set(name, m);
      const url = (k: RequestInfo) => (typeof k === 'string' ? k : k.url);
      return {
        match: async (k: RequestInfo) => (m.has(url(k)) ? new Response(m.get(url(k))!.slice(0)) : undefined),
        put: async (k: RequestInfo, r: Response) => void m.set(url(k), await r.arrayBuffer()),
        keys: async () => [...m.keys()].map((u) => new Request(u)),
        delete: async (k: RequestInfo) => m.delete(url(k)),
      };
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

/** Module rechargé : plus rien en mémoire, comme à la relance de l'application. */
async function fresh() {
  vi.resetModules();
  return import('../src/lib/liveResults');
}

describe('compétitions terminées gardées sur l’appareil', () => {
  let calls: string[];
  let caches: ReturnType<typeof memoryCaches>;
  beforeEach(() => {
    calls = [];
    caches = memoryCaches();
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(zip('results.lef', LEF));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ne considère définitifs que les résultats terminés depuis plus de 2 jours', async () => {
    const { isSettled } = await fresh();
    expect(isSettled('2026-10-11', '2026-10-14')).toBe(true);
    expect(isSettled('2026-10-12', '2026-10-14')).toBe(false);
    expect(isSettled('2026-10-14', '2026-10-14')).toBe(false);
    expect(isSettled(undefined, '2026-10-14')).toBe(false);
  });

  it('lit une seule fois le fichier de résultats d’une compétition terminée', async () => {
    const a = await (await fresh()).fetchLiveResults('7001', false, true);
    await settle();
    const b = await (await fresh()).fetchLiveResults('7001', false, true);
    expect(calls).toHaveLength(1);
    expect(b?.athletes[0].lastName).toBe(a?.athletes[0].lastName);
    expect(b?.athletes[0].swims[0].timeCs).toBe(8462);
  });

  it('relit toujours une compétition récente, en cours ou à venir', async () => {
    await (await fresh()).fetchLiveResults('7002', false, false);
    await settle();
    await (await fresh()).fetchLiveResults('7002', true, false);
    expect(calls).toHaveLength(2);
    expect(caches.stores.get('esn-resultats-v1')?.size ?? 0).toBe(0);
  });

  it('garde le classement d’une épreuve terminée : plus aucun téléchargement à la réouverture', async () => {
    const first = await (await fresh()).loadEventSheet('7003', 3, false, true);
    await settle();
    expect(first?.results[0].rows[0].timeCs).toBe(8462);
    const before = calls.length;
    const again = await (await fresh()).loadEventSheet('7003', 3, false, true);
    expect(calls.length).toBe(before);
    expect(again).toEqual(first);
  });
});
