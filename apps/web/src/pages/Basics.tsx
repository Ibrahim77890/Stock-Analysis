import { FormEvent, ReactElement, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { GlossaryTerm } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { account, home } from "../copy/home";
import { HeroArt, LabArt } from "../components/Art";
import { Icon } from "../components/Icon";
import { Rich } from "../components/Term";
import { Button, Callout, Card, EmptyState, ErrorMessage, Loading, PageHead } from "../components/ui";

export function Home() {
  const { learner } = useAuth();
  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow"><Icon name="shield" />{home.eyebrow}</span>
          <h1>{home.title}</h1>
          <p className="lead">{home.intro}</p>
          <div className="row">
            {learner ? (
              <Link className="btn big" to="/learn">{home.startSignedIn}<Icon name="arrow" /></Link>
            ) : (
              <Link className="btn big" to="/sign-in">{home.signUpButton}<Icon name="arrow" /></Link>
            )}
            {!learner && <span className="muted">{home.startSignedOut}</span>}
          </div>
          <ul className="how-list" style={{ marginTop: "1.2rem" }}>
            {home.points.map((p) => <li key={p}><Icon name="check" /><span>{p}</span></li>)}
          </ul>
        </div>
        <HeroArt />
      </section>

      <h2 className="section-title">{home.stepsTitle}</h2>
      <div className="steps-grid">
        {home.three.map((t, i) => (
          <article key={t.head} className="step-card">
            <div className="num" aria-hidden="true">{i + 1}</div>
            <h3>{t.head.replace(/^\d\.\s*/, "")}</h3>
            <p>{t.body}</p>
          </article>
        ))}
      </div>

      <h2 className="section-title">{home.pathsTitle}</h2>
      <div className="grid">
        <Card>
          <div className="feature">
            <span className="badge"><Icon name="eye" /></span>
            <div>
              <h3>{home.paths[0].head}</h3>
              <p>{home.paths[0].body}</p>
              <Link className="btn secondary small" to={learner ? "/learn" : "/sign-in"}>{home.paths[0].cta}</Link>
            </div>
          </div>
        </Card>
        <Card>
          <div className="feature">
            <span className="badge teal"><Icon name="lab" /></span>
            <div>
              <h3>{home.paths[1].head}</h3>
              <p>{home.paths[1].body}</p>
              <Link className="btn secondary small" to={learner ? "/lab" : "/sign-in"}>{home.paths[1].cta}</Link>
            </div>
          </div>
        </Card>
      </div>
      <div style={{ marginTop: "1.2rem" }}><Callout kind="careful">{home.careful}</Callout></div>
    </>
  );
}

export function SignIn() {
  const { signIn, register, learner, notice } = useAuth();
  const [mode, setMode] = useState<"register" | "signin">("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  if (learner) return <Navigate to={(loc.state as any)?.from ?? "/learn"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === "register" ? register : signIn)(name, password);
      nav("/learn");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <span className="eyebrow"><Icon name="shield" />MarketLab</span>
        <h1>{account.asideTitle}</h1>
        <ul>
          {account.asidePoints.map((p) => <li key={p}><Icon name="check" /><span>{p}</span></li>)}
        </ul>
        <LabArt />
      </aside>
      <Card className="auth-card" title={mode === "register" ? account.registerTitle : account.signInTitle}>
        {notice && <Callout kind="info">{notice}</Callout>}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" type="text" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
            {mode === "register" && <p className="hint">{account.nameHelp}</p>}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type={show ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === "register" && <p className="hint">{account.passwordRules}</p>}
          </div>
          <div className="field"><label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {account.showPassword}</label></div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <div className="row">
            <Button type="submit" size="big" disabled={busy}>{mode === "register" ? "Create account" : "Sign in"}</Button>
            <Button variant="ghost" onClick={() => { setMode(mode === "register" ? "signin" : "register"); setError(null); }}>
              {mode === "register" ? account.switchToSignIn : account.switchToRegister}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function Glossary() {
  const { api } = useAuth();
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => api.glossary(q).then((r) => alive && setTerms(r), (e) => alive && setError(e.message)), q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, api]);
  return (
    <>
      <PageHead title="Words" intro="Short meanings for the words on the screens. Search to find one." eyebrow={<><Icon name="book" />Glossary</>} />
      <div className="field input-wrap">
        <Icon name="search" />
        <label className="sr-only" htmlFor="q">Search</label>
        <input id="q" type="search" placeholder="Search for a word" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!terms && !error && <Loading />}
      {terms && terms.length === 0 && <EmptyState>No word found. Try another search.</EmptyState>}
      <div className="grid">
        {terms?.map((t) => (
          <Card key={t.slug} title={t.term}>
            <div id={t.slug}>
              <p>{t.plain_definition}</p>
              {t.example && <p className="muted">Example: {t.example}</p>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

export function RequireSignIn({ children }: { children: ReactElement }) {
  const { learner } = useAuth();
  const loc = useLocation();
  if (!learner) return <Navigate to="/sign-in" replace state={{ from: loc.pathname }} />;
  return children;
}

export { Rich };
