import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EpisodeScreen, Learn } from "./pages/Learn";
import { Glossary, Home, RequireSignIn, SignIn } from "./pages/Basics";
import { LabHome } from "./lab/LabHome";
import { JournalPage } from "./journal/JournalPage";
import { LessonPage } from "./lessons/LessonPage";
import { PathPage } from "./lessons/PathPage";
import { StudyPage } from "./lab/StudyPage";
import { ProgressPage, ScorePage, UnderTheHood } from "./pages/ScorePages";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/path" element={<RequireSignIn><PathPage /></RequireSignIn>} />
        <Route path="/path/:slug" element={<RequireSignIn><LessonPage /></RequireSignIn>} />
        <Route path="/learn" element={<RequireSignIn><Learn /></RequireSignIn>} />
        <Route path="/learn/:id" element={<RequireSignIn><EpisodeScreen /></RequireSignIn>} />
        <Route path="/score/:id" element={<RequireSignIn><ScorePage /></RequireSignIn>} />
        <Route path="/lab" element={<RequireSignIn><LabHome /></RequireSignIn>} />
        <Route path="/lab/:id" element={<RequireSignIn><StudyPage /></RequireSignIn>} />
        <Route path="/journal" element={<RequireSignIn><JournalPage /></RequireSignIn>} />
        <Route path="/progress" element={<RequireSignIn><ProgressPage /></RequireSignIn>} />
        <Route path="/hood" element={<RequireSignIn><UnderTheHood /></RequireSignIn>} />
        <Route path="*" element={<p>That page does not exist. <a href="/">Go home</a>.</p>} />
      </Routes>
    </Layout>
  );
}
