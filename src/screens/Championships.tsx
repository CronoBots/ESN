import { useData } from '../store/store';
import { useSelectedSwimmer } from '../store/hooks';
import { Empty, NavBar } from '../components/ui';
import { AllroundCard, QualifyingGoals } from '../components/Qualifying';
import { SwimmerChips } from './Records';

/** Championnats : toutes les limites atteintes ou à portée, et le total de points des championnats par âge. */
export function ChampionshipsScreen() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  if (!swimmer) return <Empty icon="person" title="Aucun nageur suivi" />;
  return (
    <>
      <NavBar title="Championnats" subtitle={`Temps limites ${swimmer.firstName ? `de ${swimmer.firstName}` : ''}`.trim()} back="/records" />
      <main className="page">
        <SwimmerChips swimmer={swimmer} />
        <QualifyingGoals swimmer={swimmer} swims={data.swims} all />
        <AllroundCard swimmer={swimmer} swims={data.swims} />
        <div className="section-foot">
          Les temps limites de chaque épreuve sont aussi sur sa fiche (onglet Records, touchez une épreuve).
        </div>
      </main>
    </>
  );
}
