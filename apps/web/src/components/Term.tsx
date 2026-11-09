import { Fragment, ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import type { GlossaryTerm } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const cache = new Map<string, GlossaryTerm>();
export const clearTermCache = () => cache.clear();

/** An inline word that opens its plain-language definition (not a pop-up window). Escape closes it. */
export function Term({ slug, children }: { slug: string; children: ReactNode }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState<GlossaryTerm | null>(cache.get(slug) ?? null);
  const [failed, setFailed] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open || term) return;
    let alive = true;
    api.term(slug).then((t) => { cache.set(slug, t); if (alive) setTerm(t); }, () => alive && setFailed(true));
    return () => { alive = false; };
  }, [open, term, slug, api]);

  return (
    <span>
      <button
        type="button" className="term-btn" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      >
        {children}
      </button>
      {open && (
        <span id={id} className="term-panel" role="note" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          {term ? (
            <>
              <strong>{term.term}:</strong> {term.plain_definition}
              {term.example && <> <em>Example: {term.example}</em></>}{" "}
              <Link to={`/glossary#${slug}`}>More</Link>
            </>
          ) : failed ? "We do not have a definition for that word yet." : "Loading..."}
        </span>
      )}
    </span>
  );
}

const MARK = /\{\{([a-z0-9-]+)\|([^}]+)\}\}/g;

/** Text with {{slug|label}} markers; each marker becomes a Term. All screen text lives in src/copy. */
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    parts.push(text.slice(last, m.index));
    parts.push(<Term key={`${m.index}-${m[1]}`} slug={m[1]}>{m[2]}</Term>);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/** The text a reader sees (markers replaced by their label); used by the copy checks. */
export const plainText = (text: string): string => text.replace(MARK, "$2");
