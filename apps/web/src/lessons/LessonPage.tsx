import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnswerResult, ApiError, LessonDetail } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Rich } from "../components/Term";
import { Button, Callout, Card, Chip, ErrorMessage, Loading, PageHead, ProgressBar } from "../components/ui";
import { lessons } from "../copy/lessons";
import { Demo } from "./demos/Demos";
import { QuestionFlow } from "./QuestionFlow";

type Phase = "steps" | "questions" | "done";

const friendly = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (e.status === 429) return e.message; // the server says how long to wait, in plain words
    if (lessons.errors[e.status]) return lessons.errors[e.status];
  }
  return (e as Error).message;
};

function startPhase(l: LessonDetail): { phase: Phase; step: number } {
  if (l.done) return { phase: "done", step: 0 };
  const read = new Set(l.steps_read_list);
  const firstUnread = l.steps.findIndex((_, i) => !read.has(i + 1));
  if (firstUnread === -1) return { phase: "questions", step: l.steps.length - 1 };
  return { phase: "steps", step: firstUnread };
}

export function LessonPage() {
  const { slug = "" } = useParams();
  const { api } = useAuth();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("steps");
  const [step, setStep] = useState(0);
  const [more, setMore] = useState(false);
  const asked = useRef(new Set<number>()); // steps already sent in this visit: each is marked once

  useEffect(() => {
    let alive = true;
    asked.current = new Set();
    setLesson(null);
    setLoadError(null);
    api.lesson(slug).then((l) => {
      if (!alive) return;
      const s = startPhase(l);
      setLesson(l);
      setPhase(s.phase);
      setStep(s.step);
    }).catch((e) => alive && setLoadError({ status: e instanceof ApiError ? e.status : 0, message: friendly(e) }));
    return () => { alive = false; };
  }, [api, slug]);

  const markRead = useCallback(async (n: number) => {
    if (asked.current.has(n)) return;
    asked.current.add(n);
    try {
      const r = await api.lessonRead(slug, n);
      setLesson((cur) => (cur ? { ...cur, steps_read: r.steps_read, steps_read_list: cur.steps_read_list.includes(n) ? cur.steps_read_list : [...cur.steps_read_list, n].sort((a, b) => a - b) } : cur));
    } catch (e) {
      asked.current.delete(n); // try again the next time this step is shown
      setError(friendly(e));
    }
  }, [api, slug]);

  useEffect(() => {
    if (lesson && phase === "steps" && !lesson.steps_read_list.includes(step + 1)) void markRead(step + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.slug, phase, step]);

  function go(n: number) {
    setMore(false);
    setStep(n);
  }

  function onAnswered(question: number, r: AnswerResult) {
    setLesson((cur) => {
      if (!cur) return cur;
      const questions = cur.questions.map((q) => (q.position === question ? { ...q, attempts: q.attempts + 1, answered_right: q.answered_right || r.correct } : q));
      const right = questions.filter((q) => q.answered_right).length;
      return { ...cur, questions, questions_right: right, done: cur.steps_read >= cur.steps_total && right >= questions.length };
    });
  }

  if (loadError) {
    return (
      <>
        <ErrorMessage>{loadError.status === 404 ? lessons.notFound : loadError.message}</ErrorMessage>
        <p><Link className="btn secondary" to="/path">{lessons.toPath}</Link></p>
      </>
    );
  }
  if (!lesson) return <Loading />;
  const s = lesson.steps[step];
  const practiceLearn = lesson.position <= 4 || lesson.position === 7;

  return (
    <>
      <PageHead title={lesson.title} eyebrow={<><Icon name="route" />{lessons.lessonNumber(lesson.position)} · {lessons.minutes(lesson.minutes)}</>} intro={lesson.summary}>
        <Link className="btn ghost small" to="/path">{lessons.allLessons}</Link>
      </PageHead>
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {phase === "steps" && (
        <Card>
          <div className="card-head">
            <p className="eyebrow">{lessons.stepOf(step + 1, lesson.steps_total)}</p>
            <Chip>{lessons.states[lesson.steps_read + lesson.questions_right > 0 ? "inProgress" : "notStarted"]}</Chip>
          </div>
          <ProgressBar value={lesson.steps_read} max={lesson.steps_total} label={lessons.stepsBar} />
          <h2>{s.head}</h2>
          <p className="lesson-body"><Rich text={s.body} /></p>
          {s.more && (
            <>
              <Button variant="ghost" size="small" aria-expanded={more} onClick={() => setMore(!more)}>{more ? lessons.showLess : lessons.showMore}</Button>
              {more && <p className="lesson-more"><Rich text={s.more} /></p>}
            </>
          )}
          {s.demo && <Demo id={s.demo} />}
          <div className="row">
            <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}>{lessons.back}</Button>
            {step < lesson.steps.length - 1
              ? <Button onClick={() => go(step + 1)}>{lessons.next}</Button>
              : <Button onClick={() => setPhase("questions")}>{lessons.toQuestions}<Icon name="arrow" /></Button>}
          </div>
        </Card>
      )}

      {phase === "questions" && (
        <QuestionFlow
          slug={lesson.slug}
          questions={lesson.questions}
          answer={(q, o) => api.lessonAnswer(lesson.slug, q, o)}
          onAnswered={onAnswered}
          onFinish={() => setPhase("done")}
          onBackToSteps={() => { setPhase("steps"); go(0); }}
        />
      )}

      {phase === "done" && (
        <Card title={lessons.doneTitle}>
          <Callout kind={lesson.done ? "tip" : "info"}>{lesson.done ? lessons.doneBody : lessons.notDoneBody}</Callout>
          <div className="row">
            <Link className="btn" to={practiceLearn ? "/learn" : "/lab"}>{practiceLearn ? lessons.practiceLearn : lessons.practiceLab}<Icon name="arrow" /></Link>
            <Link className="btn secondary" to="/path">{lessons.toPath}</Link>
            <Button variant="ghost" onClick={() => { setPhase("steps"); go(0); }}>{lessons.readAgain}</Button>
          </div>
        </Card>
      )}
    </>
  );
}
