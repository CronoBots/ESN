import type { Swimmer } from '../store/types';

/*
 * Photo d'un nageur du club, telle que swimrankings.net la publie sur sa fiche :
 * …/data/images/athletes/<3 derniers chiffres>/<identifiant>.jpg (ex. 1234567 → athletes/567/1234567.jpg).
 * Chargée directement par le navigateur depuis swimrankings, jamais copiée ni enregistrée par l'application
 * (le service worker ne garde que les fichiers de l'application elle-même). Pas de photo : les initiales.
 */

const BASE = 'https://www.swimrankings.net/data/images/athletes';

/**
 * Adresses possibles de la photo, dans l'ordre d'essai : seulement pour un nageur actif de la liste du club
 * qui a un identifiant swimrankings. Identifiant finissant par 0xx (ex. 1234067) : dossier « 067 » ou « 67 »
 * selon swimrankings (non confirmé), les deux sont essayés.
 */
export function swimmerPhotoUrls(s: Partial<Pick<Swimmer, 'member' | 'former' | 'swimrankingsId'>>): string[] {
  const id = s.member && !s.former ? s.swimrankingsId?.trim() : undefined;
  if (!id || !/^\d{4,}$/.test(id)) return [];
  const last = id.slice(-3);
  return [...new Set([last, String(Number(last))])].map((folder) => `${BASE}/${folder}/${id}.jpg`);
}

/** Adresses déjà en échec pendant cette session (pas de photo, ou refusée) : pas redemandées. */
const failed = new Set<string>();
export const photoFailed = (url: string) => failed.has(url);
export const markPhotoFailed = (url: string) => failed.add(url);
