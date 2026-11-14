import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EpisodeScreen, Learn } from "./pages/Learn";
import { Glossary, Home, RequireSignIn, SignIn } from "./pages/Basics";
import { Landing } from "./pages/Landing";
import { useAuth } from "./auth/AuthContext";
import { Navigate } from "react-router-dom";
import { LabHome } from "./lab/LabHome";
import { StatusPage } from "./status/StatusPage";
import { JournalPage } from "./journal/JournalPage";
import { LessonPage } from "./lessons/LessonPage";
import { PathPage } from "./lessons/PathPage";
import { StudyPage } from "./lab/StudyPage";
import { ProgressPage, ScorePage, UnderTheHood } from "./pages/ScorePages";

/** "/" is the home page when signed in; signed-out visitors are sent to the landing page. */
function HomeRoute() {
  const { learner } = useAuth();
  return learner ? <Home /> : <Navigate to="/landing" replace />;
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/path" element={<RequireSignIn><PathPage /></RequireSignIn>} />
        <Route path="/path/:slug" element={<RequireSignIn><LessonPage /></RequireSignIn>} />
        <Route path="/learn" element={<RequireSignIn><Learn /></RequireSignIn>} />
        <Route path="/learn/:id" element={<RequireSignIn><EpisodeScreen /></RequireSignIn>} />
        <Route path="/score/:id" element={<RequireSignIn><ScorePage /></RequireSignIn>} />
        <Route path="/lab" element={<RequireSignIn><LabHome /></RequireSignIn>} />
        <Route path="/lab/:id" element={<RequireSignIn><StudyPage /></RequireSignIn>} />
        <Route path="/status" element={<RequireSignIn><StatusPage /></RequireSignIn>} />
        <Route path="/journal" element={<RequireSignIn><JournalPage /></RequireSignIn>} />
        <Route path="/progress" element={<RequireSignIn><ProgressPage /></RequireSignIn>} />
        <Route path="/hood" element={<RequireSignIn><UnderTheHood /></RequireSignIn>} />
        <Route path="*" element={<p>That page does not exist. <a href="/">Go home</a>.</p>} />
      </Routes>
    </Layout>
  );
}
