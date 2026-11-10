import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { tour } from "../copy/home";
import { lessons } from "../copy/lessons";
import { BrandMark, Icon } from "./Icon";
import { Tour, tourSeen } from "./Tour";
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

export function Layout({ children }: { children: ReactNode }) {
  const { learner, signOut } = useAuth();
  const [showTour, setShowTour] = useState(() => Boolean(learner) && !tourSeen());
  // the tour opens the first time someone signs in (the layout is already on screen before that)
  useEffect(() => { if (learner && !tourSeen()) setShowTour(true); }, [learner]);
  return (
    <>
      <a className="skip-link" href="#main">Skip to the page</a>
      <header className="appbar">
        <div className="appbar-inner">
          <Link to="/" className="brand"><BrandMark />MarketLab</Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/path"><Icon name="route" />{lessons.navLabel}</NavLink>
            <NavLink to="/learn"><Icon name="eye" />Learn</NavLink>
            <NavLink to="/lab"><Icon name="lab" />Lab</NavLink>
            <NavLink to="/progress"><Icon name="chart" />My progress</NavLink>
            <NavLink to="/glossary"><Icon name="book" />Words</NavLink>
            <NavLink to="/hood"><Icon name="layers" />How does this work?</NavLink>
          </nav>
          <Button variant="ghost" size="small" aria-label={tour.help} onClick={() => setShowTour(true)}><Icon name="help" /><span className="hide-narrow">{tour.help}</span></Button>
          {learner ? (
            <span className="userchip">
              <span className="avatar" aria-hidden="true">{learner.display_name.slice(0, 1).toUpperCase()}</span>
              <span className="name">Hello, {learner.display_name}</span>
              <Button variant="secondary" size="small" onClick={() => signOut()}>Sign out</Button>
            </span>
          ) : <Link className="btn small" to="/sign-in">Sign in</Link>}
        </div>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        {showTour && <Tour onClose={() => setShowTour(false)} />}
        {children}
      </main>
      <Footer />
    </>
  );
}
