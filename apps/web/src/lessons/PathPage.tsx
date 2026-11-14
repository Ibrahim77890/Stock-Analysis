import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LessonSummary } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Card, Chip, ErrorMessage, Loading, PageHead, ProgressBar } from "../components/ui";
import { lessons } from "../copy/lessons";

export function lessonState(l: LessonSummary): "done" | "inProgress" | "notStarted" {
  if (l.done) return "done";
  return l.steps_read + l.questions_right > 0 ? "inProgress" : "notStarted";
}

/** The lesson to start next: the first one that is not finished. */
export function nextLesson(list: LessonSummary[]): string | null {
  return list.find((l) => !l.done)?.slug ?? null;
}

export function PathPage() {
  const { api } = useAuth();
  const [list, setList] = useState<LessonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.lessons().then((l) => alive && setList(l)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [api]);

  if (error && !list) return <ErrorMessage>{error}</ErrorMessage>;
  if (!list) return <Loading>{lessons.loadingPath}</Loading>;
  const next = nextLesson(list);
  return (
    <>
      <PageHead title={lessons.pathTitle} intro={lessons.pathIntro} eyebrow={<><Icon name="route" />Learn step by step</>} />
      <p className="muted"><Icon name="lock" /> {lessons.privacy}</p>
      <ol className="path">
        {list.map((l) => {
          const state = lessonState(l);
          return (
            <li key={l.slug}>
              <Card>
                <div className="card-head">
                  <div>
                    <p className="eyebrow">{lessons.lessonNumber(l.position)} · {lessons.minutes(l.minutes)}</p>
                    <h2>{l.title}</h2>
                  </div>
                  <span className="chips">
                    {l.slug === next && <Chip kind="accent">{lessons.startHere}</Chip>}
                    <Chip kind={state === "done" ? "ok" : undefined}>{lessons.states[state]}</Chip>
                  </span>
                </div>
                <p>{l.summary}</p>
                <ProgressBar value={l.steps_read + l.questions_right} max={l.steps_total + l.questions_total} label={`Progress in ${l.title}`} />
                <p className="muted small">{lessons.progressLine(l.steps_read, l.steps_total, l.questions_right, l.questions_total)}{l.completed_manually ? ` · ${lessons.markedByYou}` : ""}</p>
                <Link className={state === "done" ? "btn secondary small" : "btn small"} to={`/path/${l.slug}`} aria-label={`${state === "done" ? lessons.readAgain : state === "inProgress" ? lessons.continueLesson : lessons.openLesson}: ${l.title}`}>
                  {state === "done" ? lessons.readAgain : state === "inProgress" ? lessons.continueLesson : lessons.openLesson}
                  <Icon name="arrow" />
                </Link>
              </Card>
            </li>
          );
        })}
      </ol>
    </>
  );
}
