import { useData, actions } from '../store/store';
import { hasClubMembers, isActiveMember, mySwimmers, useSelectedSwimmer } from '../store/hooks';
import { Avatar, BrandLogo, Empty, NavBar, Section } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { InstallBanner } from './Install';
import { openShareApp } from '../components/Invite';
import { clubSummary, openFollow, openFollowPicker, useRosterAvailable } from './Club';
import type { Swimmer } from '../store/types';
import { SwimmerFile } from '../components/SwimmerFile';
import { LiveBanner } from '../components/LiveBanner';

export function Home() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  const swimmers = mySwimmers(data.swimmers, swimmer);
  const clubMode = hasClubMembers(data.swimmers);
  const noChild = clubMode && !data.swimmers.some((s) => s.relation === 'child' || s.favorite);

  if (noChild) {
    return (
      <>
        <NavBar title="Mon espace" brand={<BrandLogo height={88} />} />
        <main className="page">
          <Empty
            icon="person"
            title="Quels nageurs suivre ?"
            text="Choisissez dans la liste du club les nageurs à suivre (vos enfants, leurs coéquipiers…) : leurs résultats, records et progression s’afficheront ici."
            action={
              <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
                <button className="btn block" onClick={() => openFollowPicker()}>
                  <Icon name="heart" /> Choisir les nageurs suivis
                </button>
                <button className="btn ghost block" onClick={() => navigate('/esn')}>
                  <Icon name="users" /> Voir l’espace du club
                </button>
              </div>
            }
          />
          {/* La vie du club, même sans nageur suivi */}
          <LiveBanner />
        </main>
      </>
    );
  }

  if (!swimmer) {
    return (
      <>
        <NavBar title="Mon espace" brand={<BrandLogo height={88} />} />
        <main className="page">
          <Empty
            icon="person"
            title="Aucun nageur suivi"
            text="Choisissez dans la liste du club les nageurs à suivre : leurs résultats arrivent tout seuls."
            action={
              <button className="btn" onClick={() => openFollow()}>
                <Icon name="heart" /> Choisir dans la liste du club
              </button>
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar title="Mon espace" wide brand={<BrandLogo height={88} />} />
      <main className="page wide">
        <LiveBanner />
        {swimmers.length > 0 && (
          <div className="switcher" role="tablist" aria-label="Choisir un nageur">
            {swimmers.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === swimmer.id}
                className={s.id === swimmer.id ? 'active' : ''}
                onClick={() => actions.selectSwimmer(s.id)}
              >
                <Avatar swimmer={s} size={30} />
                <span className="name">{s.firstName}</span>
              </button>
            ))}
            <button className="add" onClick={() => openFollow()} aria-label="Suivre d’autres nageurs" title="Suivre d’autres nageurs">
              <Icon name="plus" />
            </button>
          </div>
        )}
        <HomeContent swimmer={swimmer} />
      </main>
    </>
  );
}

function HomeContent({ swimmer }: { swimmer: Swimmer }) {
  // Mon espace : la fiche complète du nageur choisi ; la vie du club est dans l'onglet Club
  return <SwimmerFile swimmer={swimmer} home afterHero={<InstallBanner />} />;
}

/** Accès aux nageurs du club (ou à leur chargement s'il n'a pas encore pu se faire). */
export function ClubCard() {
  const data = useData();
  const available = useRosterAvailable();
  const club = data.settings.club;
  if (!club && !available) return null;
  const members = data.swimmers.filter(isActiveMember);
  return (
    <Section title="Le club">
      {club ? (
        <div className="list">
          <button className="row" onClick={() => navigate('/club')}>
            <span className="row-icon" style={{ background: 'var(--brand-green)' }}>
              <Icon name="users" />
            </span>
            <div className="row-body">
              <div className="row-title">Nageurs de l’ESN</div>
              <div className="row-sub">
                {clubSummary(club.groups, members)}
              </div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
          <button className="row" onClick={() => navigate('/club-records')}>
            <span className="row-icon" style={{ background: '#f5a400' }}>
              <Icon name="trophy" />
            </span>
            <div className="row-body">
              <div className="row-title">Records du club</div>
              <div className="row-sub">Meilleurs temps de l’ESN, par épreuve et par âge</div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
          <button className="row" onClick={() => navigate('/rankings')}>
            <span className="row-icon" style={{ background: 'var(--brand-blue)' }}>
              <Icon name="ranking" />
            </span>
            <div className="row-body">
              <div className="row-title">Classements du club</div>
              <div className="row-sub">Meilleurs temps par épreuve{club.groups.length ? ' et par groupe' : ', par âge'}</div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
          <button className="row" onClick={openShareApp}>
            <span className="row-icon" style={{ background: '#34c759' }}>
              <Icon name="qr" />
            </span>
            <div className="row-body">
              <div className="row-title">Partager l’application aux parents</div>
              <div className="row-sub">QR code à scanner, lien ou affiche à imprimer</div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
        </div>
      ) : (
        <button className="card pad club-card" style={{ width: '100%', textAlign: 'left' }} onClick={() => openFollow()}>
          <span className="row-icon club-card-icon" aria-hidden="true">
            <Icon name="users" />
          </span>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Tous les nageurs de l’ESN</div>
            <div className="muted small">Touchez pour charger la liste du club et retrouver tous les nageurs et leurs résultats.</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </button>
      )}
    </Section>
  );
}

