import { useRef, useState } from "react";
import { AnswerResult, LessonQuestion } from "../api/client";
import { Icon } from "../components/Icon";
import { Button, Card } from "../components/ui";
import { lessons } from "../copy/lessons";

interface Props {
  slug: string;
  questions: LessonQuestion[];
  /** Sends one answer. The server decides if it is right; nothing about the answer key is known here. */
  answer: (question: number, option: number) => Promise<AnswerResult>;
  onAnswered: (question: number, result: AnswerResult) => void;
  onFinish: () => void;
  onBackToSteps: () => void;
}

export function QuestionFlow({ slug, questions, answer, onAnswered, onFinish, onBackToSteps }: Props) {
  const firstOpen = questions.findIndex((q) => !q.answered_right);
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const q = questions[index];
  const last = index === questions.length - 1;

  async function check() {
    if (chosen === null || sending.current) return; // a double click sends one request
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await answer(q.position, chosen);
      setResult(r);
      onAnswered(q.position, r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function again() {
    setResult(null);
    setChosen(null);
  }

  function next() {
    setResult(null);
    setChosen(null);
    if (last) onFinish();
    else setIndex(index + 1);
  }

  return (
    <Card title={lessons.questionsTitle}>
      <p className="muted">{lessons.questionsIntro}</p>
      <p className="eyebrow">{lessons.questionOf(index + 1, questions.length)}</p>
      <fieldset className="question" disabled={busy || result !== null}>
        <legend>{q.prompt}</legend>
        <p className="muted small">{lessons.chooseOne}</p>
        {q.options.map((text, i) => (
          <label key={i} className={chosen === i ? "option chosen" : "option"}>
            <input type="radio" name={`question-${slug}-${q.position}`} checked={chosen === i} onChange={() => setChosen(i)} />
            <span>{text}</span>
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="callout careful"><span className="body">{error}</span></p>}
      {!result && (
        <Button disabled={chosen === null || busy} onClick={check}>{busy ? lessons.checking : lessons.check}</Button>
      )}
      <div role="status" aria-live="polite">
        {result && (
          <div className={result.correct ? "verdict right" : "verdict notyet"}>
            <p className="verdict-head"><Icon name={result.correct ? "check" : "info"} /><strong>{result.correct ? lessons.right : lessons.notYet}</strong></p>
            <p>{result.why}</p>
            {!result.correct && result.correct_option !== undefined && q.options[result.correct_option] !== undefined && (
              <p>{lessons.rightAnswerIs(q.options[result.correct_option])}</p>
            )}
          </div>
        )}
      </div>
      {result && !result.correct && <Button variant="secondary" onClick={again}>{lessons.tryAgain}</Button>}
      {result?.correct && <Button onClick={next}>{last ? lessons.finishLesson : lessons.nextQuestion}</Button>}
      <p><Button variant="ghost" size="small" onClick={onBackToSteps}>{lessons.backToSteps}</Button></p>
    </Card>
  );
}
