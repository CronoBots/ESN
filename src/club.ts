/**
 * Informations du club (affichées dans « À propos »).
 * Source : https://www.esn-seraing.be/
 */
export const CLUB = {
  name: 'Ecole Seraing Natation',
  short: 'ESN Seraing',
  legal: 'Ecole Seraing Natation ASBL',
  address: 'Avenue des Puddleurs 53, 4100 Seraing',
  phone: '04 338 15 52',
  email: 'info@esn-seraing.be',
  website: 'https://www.esn-seraing.be/',
  founded: 1976,
  pool: 'Piscine olympique (50 m)',
  sections: ['Natation sportive', 'Masters', 'Natation artistique', 'Water-polo', 'École de nage', 'École sportive'],
  /** Le club dans les feuilles des compétitions (« Ecole Seraing Natation a.s.b.l. », « Esn »). */
  match: /seraing|\besn\b/i,
  /** Nageur du club dans une feuille ou un fichier de résultats (pour l'ajouter à la liste). */
  member: /ecole\s+seraing|^esn$/i,
  /** Pays des compétitions suivies sur live.swimrankings.net. */
  liveNation: 'BEL',
  /**
   * Clé de la liste et de l'historique du club (fichiers chiffrés de public/data).
   * Application ouverte à tous, sans connexion (décision du club) : la clé est
   * intégrée et publique. Le chiffrement sert seulement à ce que les noms des
   * nageurs ne soient pas lisibles en clair dans le dépôt ni indexés par les
   * moteurs de recherche. Nouvelle clé (scripts/roster.mjs) : la changer ici.
   */
  accessKey: 'ESN-2DY4-YWJF',
};
