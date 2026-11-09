import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { tour } from "../copy/home";
import { Tour, tourSeen } from "./Tour";
import { Button } from "./ui";

export function Footer() {
  return (
    <footer className="footer">
      <p>
        Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts</a>. For learning. Not investment advice.
      </p>
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
      <header className="topbar">
        <div className="inner">
          <Link to="/" style={{ fontWeight: 700, textDecoration: "none" }}>MarketLab</Link>
          <nav aria-label="Main">
            <NavLink to="/learn">Learn</NavLink>
            <NavLink to="/progress">My progress</NavLink>
            <NavLink to="/glossary">Words</NavLink>
            <NavLink to="/hood">How does this work?</NavLink>
          </nav>
          <Button variant="secondary" onClick={() => setShowTour(true)}>{tour.help}</Button>
          {learner ? (
            <span className="row">
              <span>Hello, {learner.display_name}</span>
              <Button variant="secondary" onClick={() => signOut()}>Sign out</Button>
            </span>
          ) : <Link to="/sign-in">Sign in</Link>}
        </div>
      </header>
      <main className="page">
        {showTour && <Tour onClose={() => setShowTour(false)} />}
        {children}
      </main>
      <Footer />
    </>
  );
}
