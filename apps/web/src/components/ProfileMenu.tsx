import { useEffect, useId, useRef, useState } from "react";
import { Icon, IconName } from "./Icon";

export interface ProfileItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
}

/**
 * One button that shows the profile icon and the person's name together. Pressing it opens a dropdown menu (the items are
 * configurable, for example only "Sign out"). Arrow keys move between items, Escape or a click outside closes it and the focus
 * goes back to the button.
 */
export function ProfileMenu({ name, items }: { name: string; items: ProfileItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function move(e: React.KeyboardEvent, dir: 1 | -1) {
    const els = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + dir + els.length) % els.length]?.focus();
    e.preventDefault();
  }

  return (
    <div className="profile" ref={wrap}>
      <button ref={button} type="button" className="profile-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
        <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className="profile-name">Hello, {name}</span>
        <svg className="icon chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="profile-menu" id={menuId} role="menu" aria-label="Profile">
          <p className="profile-who" role="presentation">Signed in as <strong>{name}</strong></p>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="profile-item"
              onClick={() => { setOpen(false); it.onSelect(); }}
              onKeyDown={(e) => { if (e.key === "ArrowDown") move(e, 1); else if (e.key === "ArrowUp") move(e, -1); else if (e.key === "Tab") setOpen(false); }}>
              {it.icon && <Icon name={it.icon} />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
