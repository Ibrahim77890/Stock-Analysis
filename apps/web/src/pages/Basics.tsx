import { FormEvent, ReactElement, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { GlossaryTerm } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { account, home } from "../copy/home";
import { Button, Callout, Card, ErrorMessage, Loading } from "../components/ui";
import { Rich } from "../components/Term";

export function Home() {
  const { learner } = useAuth();
  return (
    <>
      <h1>{home.title}</h1>
      <p>{home.intro}</p>
      <div className="grid">
        {home.three.map((t) => <Card key={t.head} title={t.head}><p>{t.body}</p></Card>)}
      </div>
      <Callout kind="careful">{home.careful}</Callout>
      {learner ? <Link className="btn" to="/learn">{home.startSignedIn}</Link> : (
        <p>{home.startSignedOut} <Link className="btn" to="/sign-in">Create an account</Link></p>
      )}
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
    <Card title={mode === "register" ? account.registerTitle : account.signInTitle}>
      {notice && <Callout kind="info">{notice}</Callout>}
      <form onSubmit={submit} noValidate>
        <p><label htmlFor="name">Your name</label>
          <input id="name" type="text" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
          {mode === "register" && <span className="muted"> {account.nameHelp}</span>}</p>
        <p><label htmlFor="password">Password</label>
          <input id="password" type={show ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "register" && <span className="muted"> {account.passwordRules}</span>}</p>
        <p><label style={{ fontWeight: 400 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {account.showPassword}</label></p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="row">
          <Button type="submit" disabled={busy}>{mode === "register" ? "Create account" : "Sign in"}</Button>
          <Button variant="secondary" onClick={() => { setMode(mode === "register" ? "signin" : "register"); setError(null); }}>
            {mode === "register" ? account.switchToSignIn : account.switchToRegister}
          </Button>
        </div>
      </form>
    </Card>
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
      <h1>Words</h1>
      <p>Short meanings for the words on the screens. Search to find one.</p>
      <p><label htmlFor="q">Search</label><input id="q" type="text" value={q} onChange={(e) => setQ(e.target.value)} /></p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!terms && !error && <Loading />}
      {terms && terms.length === 0 && <p className="muted">No word found. Try another search.</p>}
      {terms?.map((t) => (
        <Card key={t.slug} title={t.term}>
          <div id={t.slug}><p>{t.plain_definition}</p>{t.example && <p className="muted">Example: {t.example}</p>}</div>
        </Card>
      ))}
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
