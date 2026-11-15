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
  /** Code club dans les numéros de licence (ex. ESN/012345/14). */
  licenseCode: 'ESN',
  /** Pages « Résultats » du site du club (complétées automatiquement par le menu du site). */
  resultsPages: [
    'https://www.esn-seraing.be/copie-de-r%C3%A9sultats-ns-2025-2026-1',
    'https://www.esn-seraing.be/copie-de-r%C3%A9sultats-ns-2025-2026',
    'https://www.esn-seraing.be/copie-de-r%C3%A9sultats-ns-2023-2024',
    'https://www.esn-seraing.be/copie-de-r%C3%A9sultats-saison-es-2024-2025',
    'https://www.esn-seraing.be/r%C3%A9sultats-saison-es-2024-2025',
    'https://www.esn-seraing.be/copie-de-r%C3%A9sultats-m',
  ],
  /** Catalogue des rapports de résultats, généré chaque jour (scripts/club-index.ts). */
  indexUrl: './data/club-results.json',
};
