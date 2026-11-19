import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error script Node sans types
import { activeEvents, meetFiles, mirrorId } from '../scripts/mirror-live.mjs';
import { isMirrored, liveUrl, listMirroredMeets, mergeMeetLists, pdfText, type LiveMeet } from '../src/lib/liveResults';
import { pdfLines } from '../src/lib/pdfText';

// Lecteur PDF remplacé : on compte les lectures
vi.mock('../src/lib/pdfText', () => ({ pdfLines: vi.fn(async () => ['Epreuve 1']) }));

const cal = {
  events: [
    { start: '2026-11-20', end: '2026-11-22', city: 'Bastogne', name: 'Championnats', live: 'https://resultats.example.be/CB-test26/' },
    { start: '2026-11-28', city: 'Ailleurs', name: 'Sans livetiming' },
  ],
};

describe('livetiming copié avec le site (hors live.swimrankings.net)', () => {
  it('copié de 2 jours avant à 14 jours après, seulement pour les compétitions qui ont un livetiming', () => {
    expect(activeEvents(cal, '2026-11-17')).toHaveLength(0);
    expect(activeEvents(cal, '2026-11-18')).toHaveLength(1);
    expect(activeEvents(cal, '2026-12-06')).toHaveLength(1);
    expect(activeEvents(cal, '2026-12-07')).toHaveLength(0);
    expect(activeEvents(cal, '2026-11-28').map((e: { city: string }) => e.city)).toEqual(['Bastogne']); // l'autre n'a pas de livetiming
  });

  it('identifiant et feuilles de la page Splash Meet Manager', () => {
    expect(mirrorId('https://resultats.example.be/CB-test26/')).toBe('ext-CB-test26');
    const html =
      '<a href="StartList_1.pdf">1</a><a href="ResultList_1.pdf">r</a><a href="StartList_1.pdf">1</a><a href="EntryStatistics.pdf">s</a>' +
      '<a href="ProgressionSummary.pdf">p</a><a href="results.lxf">l</a><a href="https://ailleurs.example/x.pdf">x</a><a href="../StartList_9.pdf">y</a>';
    expect(meetFiles(html).sort()).toEqual(['EntryStatistics.pdf', 'ResultList_1.pdf', 'StartList_1.pdf', 'results.lxf']);
  });

  it('chaque version d’une feuille copiée n’est téléchargée et lue qu’une fois', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(u);
      return new Response(new Uint8Array([37, 80, 68, 70]));
    });
    const url = liveUrl('ext-CB-test26', 'ResultList_2.pdf');
    vi.mocked(pdfLines).mockClear();
    await pdfText(url, true, false, 'aaa');
    expect(calls).toEqual(['./live/ext-CB-test26/ResultList_2.pdf?v=aaa']);
    await pdfText(url, true, false, 'bbb'); // feuille republiée : nouvelle version
    expect(calls[1]).toBe('./live/ext-CB-test26/ResultList_2.pdf?v=bbb');
    expect(pdfLines).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('l’application lit la copie sur son propre site', () => {
    expect(isMirrored('ext-CB-test26')).toBe(true);
    expect(isMirrored('11570')).toBe(false);
    expect(liveUrl('ext-CB-test26')).toBe('./live/ext-CB-test26/index.html');
    expect(liveUrl('ext-CB-test26', 'StartList_3.pdf')).toBe('./live/ext-CB-test26/StartList_3.pdf');
    expect(liveUrl('11570', 'results.lxf')).toBe('https://live.swimrankings.net/11570/results.lxf');
  });

  it('état d’après les dates, et pas de doublon si la compétition paraît aussi sur live.swimrankings.net', async () => {
    const meet = { id: 'ext-CB-test26', name: 'Championnats Test 2026', city: 'Bastogne', course: 'SCM', startDate: '2026-11-20', endDate: '2026-11-22' };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ meets: [meet] })));
    expect((await listMirroredMeets('2026-11-19'))[0].status).toBe('upcoming');
    expect((await listMirroredMeets('2026-11-21'))[0].status).toBe('live');
    const [m] = await listMirroredMeets('2026-11-23');
    expect(m.status).toBe('finished');
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await listMirroredMeets('2026-11-21')).toEqual([]);
    vi.unstubAllGlobals();
    const live: LiveMeet = { ...m, id: '12000', name: 'CHAMPIONNATS TEST 2026' };
    expect(mergeMeetLists([live], [m]).map((x) => x.id)).toEqual(['12000']);
    expect(mergeMeetLists([{ ...live, startDate: '2026-11-21' }], [m]).map((x) => x.id)).toEqual(['12000', 'ext-CB-test26']);
  });

  it('live.swimrankings.net : une feuille inchangée (même version) n’est pas relue', async () => {
    let etag = '"a-1"';
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { etag } }));
    const url = 'https://live.example/9001/StartList_1.pdf';
    vi.mocked(pdfLines).mockClear();
    expect(await pdfText(url, true)).toBe('Epreuve 1');
    expect(await pdfText(url, true)).toBe('Epreuve 1');
    expect(pdfLines).toHaveBeenCalledTimes(1);
    etag = '"b-1"'; // feuille republiée (résultats)
    await pdfText(url, true);
    expect(pdfLines).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
