import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { tour } from "../copy/home";
import { status as statusCopy } from "../copy/status";
import { journal as journalCopy } from "../copy/journal";
import { lessons } from "../copy/lessons";
import { BrandMark, Icon, IconName } from "./Icon";
import { markTourSeen, Tour, tourSeen } from "./Tour";
import { ProfileMenu } from "./ProfileMenu";
import { Button } from "./ui";

export function Footer() {
  return (
    <footer className="footer">
      <p>
        Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts</a>. For learning. Not investment advice.
      </p>
      <p>Price data are for your own learning on this computer. Interest rates and VIX come from FRED, a service of the St. Louis Fed.</p>
    </footer>
  );
}

/** The menu. It is shown only after sign-in, in the sidebar. `key` names the element the tour points at. */
export const MENU: Array<{ to: string; key: string; label: string; icon: IconName }> = [
  { to: "/path", key: "path", label: lessons.navLabel, icon: "route" },
  { to: "/learn", key: "learn", label: "Learn", icon: "eye" },
  { to: "/lab", key: "lab", label: "Lab", icon: "lab" },
  { to: "/journal", key: "journal", label: journalCopy.navLabel, icon: "book" },
  { to: "/status", key: "status", label: statusCopy.navLabel, icon: "server" },
  { to: "/progress", key: "progress", label: "My progress", icon: "chart" },
  { to: "/glossary", key: "glossary", label: "Words", icon: "book" },
  { to: "/hood", key: "hood", label: "How does this work?", icon: "layers" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { learner, signOut } = useAuth();
  const loc = useLocation();
  const [runTour, setRunTour] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // the tour starts the first time someone signs in (the layout is already on screen before that)
  useEffect(() => { if (learner && !tourSeen()) setRunTour(true); }, [learner]);
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const closeTour = () => { markTourSeen(); setRunTour(false); };
  const sidebarVisible = menuOpen || runTour;   // on a narrow screen the tour needs the menu on screen

  return (
    <>
      <a className="skip-link" href="#main">Skip to the page</a>
      <header className="appbar">
        <div className="appbar-inner">
          {learner && (
            <Button variant="ghost" size="small" className="menu-toggle" aria-label="Menu" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}>
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </Button>
          )}
          <Link to={learner ? "/" : "/landing"} className="brand"><BrandMark /><span className="brand-text">MarketLab</span></Link>
          <span className="spacer" />
          {learner && (
            <Button variant="ghost" size="small" data-tour="tutorial" aria-label={tour.helpLabel} onClick={() => setRunTour(true)}>
              <Icon name="help" /><span className="hide-narrow">{tour.help}</span>
            </Button>
          )}
          {learner ? (
            <ProfileMenu name={learner.display_name} items={[{ label: "Sign out", icon: "user", onSelect: () => signOut() }]} />
          ) : <Link className="btn small" to="/sign-in">Sign in</Link>}
        </div>
      </header>

      <div className={learner ? "shell with-sidebar" : "shell"}>
        {learner && (
          <>
            <aside id="sidebar" className={sidebarVisible ? "sidebar open" : "sidebar"} aria-label="Sidebar">
              <nav className="side-nav" aria-label="Main">
                {MENU.map((m) => (
                  <NavLink key={m.to} to={m.to} data-tour={`nav-${m.key}`}><Icon name={m.icon} /><span>{m.label}</span></NavLink>
                ))}
              </nav>
            </aside>
            {menuOpen && !runTour && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
          </>
        )}
        <div className="content">
          <main className="page" id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </div>
      </div>
      {learner && <Tour run={runTour} onClose={closeTour} />}
    </>
  );
}
