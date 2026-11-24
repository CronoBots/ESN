import type { RosterGroup } from '../lib/roster';

export type Stroke = 'FREE' | 'BACK' | 'BREAST' | 'FLY' | 'IM';
/** SCM = petit bassin (25 m), LCM = grand bassin (50 m). */
export type Course = 'SCM' | 'LCM';
export type Gender = 'F' | 'M';
export type SwimStatus = 'OK' | 'DSQ' | 'DNS' | 'DNF';
export type Round = 'TIM' | 'HEAT' | 'SEMI' | 'FINAL';
export type SwimContext = 'competition' | 'training';
export type Relation = 'child' | 'followed';

export interface Swimmer {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  birthYear?: number;
  club?: string;
  nation?: string;
  swimrankingsId?: string;
  /** Index de couleur de l'avatar. */
  color: number;
  /** Mon enfant (child) ou nageur suivi (followed : coéquipier, ami…). */
  relation: Relation;
  favorite: boolean;
  /** Groupe d'entraînement au club (liste des membres : A, B, C…). */
  group?: string;
  /** Ajouté depuis la liste des membres du club. */
  member?: boolean;
  /** Nageur du club trouvé automatiquement dans une compétition (pas encore dans la liste publiée). */
  discovered?: boolean;
  /** Ancien membre du club (liste publiée) : à part dans la liste, dans les classements sur option. */
  former?: boolean;
  /** Autres noms du membre (liste du club) : le même nageur écrit autrement ailleurs (fédération, swimrankings). */
  aliases?: { lastName: string; firstName: string; birthYear?: number }[];
  createdAt: number;
}

export interface Meet {
  id: string;
  name: string;
  city?: string;
  nation?: string;
  /** AAAA-MM-JJ */
  startDate: string;
  endDate?: string;
  course: Course;
  organizer?: string;
  notes?: string;
  favorite?: boolean;
  /** Identifiant de la compétition sur live.swimrankings.net (séries et résultats en direct). */
  liveId?: string;
  createdAt: number;
}

/** Dates d'une compétition (AAAA-MM-JJ), du premier au dernier jour. */
export interface DayRange {
  from: string;
  to: string;
}

export interface Swim {
  id: string;
  swimmerId: string;
  meetId?: string;
  context: SwimContext;
  /** AAAA-MM-JJ */
  date: string;
  /**
   * Jour de la course non relevé (ancienne course ajoutée d'après la page d'une compétition de plusieurs jours) :
   * dates de la compétition, affichées à la place du jour. `date` reste un jour de la compétition (tri, âge, saison).
   */
  dayRange?: DayRange;
  /** HH:MM (heure de passage prévue) */
  startTime?: string;
  distance: number;
  stroke: Stroke;
  course: Course;
  /** Temps réalisé en centièmes ; absent tant que la course n'est pas nagée. */
  timeCs?: number | null;
  /** Temps d'engagement en centièmes (absent = NT). */
  entryCs?: number | null;
  status: SwimStatus;
  round: Round;
  eventNo?: number;
  heat?: number;
  lane?: number;
  place?: number;
  /** Temps de passage cumulés en centièmes (tous les 50 m ou 25 m). */
  splits?: number[];
  splitEvery?: 25 | 50;
  /** Points officiels (import). */
  points?: number;
  /** Temps réalisé en compétition masters (25 ans et plus), marqué « M » sur swimrankings. */
  masters?: boolean;
  timing?: 'electronic' | 'manual';
  notes?: string;
  source: 'manual' | 'swimrankings' | 'club' | 'live';
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  swimmerId: string;
  distance: number;
  stroke: Stroke;
  course: Course;
  targetCs: number;
  label?: string;
  /** AAAA-MM-JJ */
  deadline?: string;
  createdAt: number;
  achievedAt?: string;
}

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  selectedSwimmerId?: string;
  lastBackupAt?: number;
  /** Compter les temps d'entraînement dans les records. */
  includeTraining: boolean;
  /** Bassin par défaut à l'affichage des records. */
  defaultCourse: Course;
  onboarded: boolean;
  celebrate: boolean;
  /** Récupération automatique des résultats en direct (live.swimrankings.net). */
  liveSync: LiveSyncSettings;
  /** Liste des membres du club, déverrouillée avec le code du club. */
  club?: ClubAccess;
  /** Nageurs suivis dont ce téléphone ne reçoit pas les notifications (identifiants). */
  pushMuted?: string[];
}

export interface ClubAccess {
  code: string;
  /** Version du fichier chiffré déjà appliquée (son vecteur d'initialisation). */
  version: string;
  /** Date de la liste (AAAA-MM-JJ). */
  updated: string;
  groups: RosterGroup[];
  count: number;
  /** Nouvelle liste publiée avec un autre code : à redemander. */
  expired?: boolean;
  /** Version de l'historique du club déjà appliquée. */
  historyVersion?: string;
  /** Version de la lecture de l'historique (une nouvelle version le réapplique). */
  historyParser?: number;
  /** Version de la lecture de la liste (une nouvelle version la réapplique). */
  rosterParser?: number;
  /** Version des classements nationaux déjà appliquée. */
  rankingsVersion?: string;
}

export interface LiveSyncSettings {
  enabled: boolean;
  /** Compétitions déjà lues : identifiant → nageurs déjà recherchés. */
  processed: Record<string, string[]>;
  lastCheck?: number;
  /** Version de la recherche (une nouvelle version relance une recherche complète). */
  engine?: number;
}

/** Classement national d'un nageur du club (swimrankings.net) sur une épreuve, une saison. */
export interface NationalRank {
  swimmerId: string;
  /** « 2026-2027 » (ou une année). */
  season: string;
  course: Course;
  distance: number;
  stroke: Stroke;
  /** Classement tel qu'affiché sur swimrankings : « Belgique · filles nées en 2015 ». */
  label: string;
  rank: number;
  /** Nombre de nageurs classés. */
  of?: number;
  /** Temps classé. */
  timeCs?: number;
}

export interface AppData {
  version: 1;
  swimmers: Swimmer[];
  meets: Meet[];
  swims: Swim[];
  goals: Goal[];
  /** Classements nationaux des nageurs du club (remplacés à chaque version publiée). */
  rankings?: NationalRank[];
  settings: Settings;
}
