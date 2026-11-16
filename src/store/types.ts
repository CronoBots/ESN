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
  createdAt: number;
}

export interface Swim {
  id: string;
  swimmerId: string;
  meetId?: string;
  context: SwimContext;
  /** AAAA-MM-JJ */
  date: string;
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
}

export interface LiveSyncSettings {
  enabled: boolean;
  /** Compétitions déjà lues : identifiant → nageurs déjà recherchés. */
  processed: Record<string, string[]>;
  lastCheck?: number;
  /** Version de la recherche (une nouvelle version relance une recherche complète). */
  engine?: number;
}

export interface AppData {
  version: 1;
  swimmers: Swimmer[];
  meets: Meet[];
  swims: Swim[];
  goals: Goal[];
  settings: Settings;
}
