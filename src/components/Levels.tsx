import { useMemo } from "react";
import type { Course, Swim, Swimmer } from "../store/types";
import {
  levelStatus,
  relativeGap,
  LEVELS,
  type Level,
  type LevelStatus,
} from "../lib/levels";
import { FFBN_GRID_URL } from "../lib/ffbnGrid";
import { personalBests } from "../lib/stats";
import { courseLabel, eventLabel } from "../lib/events";
import { formatTime } from "../lib/time";
import { todayISO } from "../lib/dates";
import { navigate } from "../router";
import { Section, StrokeTag } from "./ui";
import { Icon } from "./Icon";

/** Année des niveaux : celle d'aujourd'hui (âge atteint dans l'année). */
export const levelYear = () => Number(todayISO().slice(0, 4));

/** « 0.85 s » sous la minute, « 1:02.40 » au-delà. */
export function gapLabel(cs: number): string {
  return cs < 6000 ? `${(cs / 100).toFixed(2)} s` : formatTime(cs);
}

export function LevelChip({ level }: { level: Level }) {
  return <span className={`lvl-chip lvl-${level.toLowerCase()}`}>{level}</span>;
}

/** Fiche d'une épreuve : les niveaux FFBN de l'âge du nageur, atteints ou à atteindre. */
export function LevelLadder({
  status,
  course,
}: {
  status: LevelStatus;
  course: Course;
}) {
  return (
    <Section
      title="Niveaux FFBN"
      action={
        <span className="muted">
          {status.age >= 19 ? "19 ans et plus" : `${status.age} ans`} en{" "}
          {status.year}
        </span>
      }
    >
      <div className="list">
        {status.levels.map((l) => {
          const isNext = status.next?.level === l.level;
          return (
            <div
              key={l.level}
              className={`row lvl-row${isNext ? " next" : ""}`}
            >
              <span
                className={`lvl-mark lvl-${l.level.toLowerCase()}${l.reached ? " on" : ""}`}
                aria-hidden="true"
              >
                {l.reached && <Icon name="check" />}
              </span>
              <div className="row-body">
                <div className="row-title">{l.level}</div>
                <div className="row-sub">
                  {l.reached
                    ? "Atteint"
                    : l.gapCs != null
                      ? `Encore ${gapLabel(l.gapCs)} à gagner`
                      : "Pas encore de temps"}
                </div>
              </div>
              <span className="row-value tnum">{formatTime(l.cs)}</span>
            </div>
          );
        })}
      </div>
      <div className="section-foot">
        Temps de référence de la fédération francophone (grille 2026-2028) pour
        l’âge atteint en {status.year}, comparés au record en bassin de{" "}
        {courseLabel(course)}.
        {course === "SCM" && status.age >= 13
          ? " Le niveau Requin se nage en bassin de 50 m."
          : ""}{" "}
        <a href={FFBN_GRID_URL} target="_blank" rel="noreferrer">
          Voir la grille
        </a>
      </div>
    </Section>
  );
}

interface LevelGoal {
  course: Course;
  distance: number;
  stroke: Swim["stroke"];
  bestCs: number;
  status: LevelStatus;
}

/** Niveaux d'un nageur sur toutes ses épreuves (meilleur temps de chaque bassin). */
export function useLevelGoals(
  swimmer: Swimmer | undefined,
  swims: Swim[],
  includeTraining: boolean,
) {
  return useMemo(() => {
    const year = levelYear();
    const all: LevelGoal[] = [];
    if (swimmer)
      for (const best of personalBests(
        swims,
        swimmer.id,
        includeTraining,
      ).values()) {
        const status = levelStatus(
          swimmer,
          best.course,
          best.distance,
          best.stroke,
          year,
          best.timeCs,
        );
        if (status)
          all.push({
            course: best.course,
            distance: best.distance,
            stroke: best.stroke,
            bestCs: best.timeCs!,
            status,
          });
      }
    // Les plus proches d'abord (écart relatif au temps à réaliser)
    const next = all
      .filter((g) => g.status.next)
      .sort((a, b) => relativeGap(a.status)! - relativeGap(b.status)!);
    const reached = Object.fromEntries(
      LEVELS.map((l) => [l, all.filter((g) => g.status.reached === l).length]),
    ) as Record<Level, number>;
    return { next, reached };
  }, [swimmer, swims, includeTraining]);
}

/** Accueil : les niveaux les plus proches à aller chercher. */
export function LevelGoals({
  swimmer,
  swims,
  includeTraining,
}: {
  swimmer: Swimmer;
  swims: Swim[];
  includeTraining: boolean;
}) {
  const { next, reached } = useLevelGoals(swimmer, swims, includeTraining);
  if (!next.length) return null;
  const summary = LEVELS.filter((l) => reached[l] > 0)
    .reverse()
    .map((l) => `${l} sur ${reached[l]} épreuve${reached[l] > 1 ? "s" : ""}`)
    .join(", ");
  return (
    <Section
      title="Prochains niveaux"
      action={
        <button className="section-link" onClick={() => navigate("/levels")}>
          Tous les niveaux
        </button>
      }
    >
      <div className="list">
        {next.slice(0, 3).map((g) => (
          <button
            key={`${g.course}-${g.distance}-${g.stroke}`}
            className="row"
            onClick={() =>
              navigate(
                `/event/${swimmer.id}/${g.course}/${g.distance}/${g.stroke}`,
              )
            }
          >
            <StrokeTag stroke={g.stroke} distance={g.distance} />
            <div className="row-body">
              <div className="row-title">
                {eventLabel(g.distance, g.stroke)} · {courseLabel(g.course)}
              </div>
              <div className="row-sub">
                <LevelChip level={g.status.next!.level} />{" "}
                {formatTime(g.status.next!.cs)} · record {formatTime(g.bestCs)}
              </div>
            </div>
            <div className="row-end">
              <div style={{ textAlign: "right" }}>
                <div className="time-big tnum">
                  {gapLabel(g.status.next!.gapCs!)}
                </div>
                <div className="small muted">à gagner</div>
              </div>
              <Icon name="chevronRight" className="chev" />
            </div>
          </button>
        ))}
      </div>
      <div className="section-foot">
        Niveaux de la fédération francophone (Mistral, Trident, Requin) pour
        l’âge atteint en {next[0].status.year}.
        {summary ? ` Déjà atteint : ${summary}.` : ""}
      </div>
    </Section>
  );
}
