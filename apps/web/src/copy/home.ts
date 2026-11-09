export const home = {
  title: "Learn to doubt your own guesses",
  intro: "MarketLab is a safe place to practise reading price charts. You look at a chart, guess what happens next, and see how good your guesses really are.",
  three: [
    { head: "1. Look at a hidden chart", body: "You see a price chart with no name and no dates. You cannot cheat from memory." },
    { head: "2. Say how sure you are", body: "For each guess you pick a number from 1% to 99%. The more sure you are, the higher the number." },
    { head: "3. See your honest score", body: "We check your guesses against what really happened. Then we tell you if you did better than plain luck." },
  ],
  careful: "MarketLab is for learning only. It does not tell you what to buy or sell. A good score on a few guesses can be luck.",
  startSignedOut: "Create an account to start. It stays on this computer.",
  startSignedIn: "Start learning",
};

export const account = {
  registerTitle: "Create your account",
  signInTitle: "Sign in",
  passwordRules: "Your password needs 10 or more characters. A few random words is fine.",
  nameHelp: "Pick any name with 2 to 40 characters. It stays on this computer.",
  showPassword: "Show password",
  taken: "That name is taken. Please choose another one.",
  switchToRegister: "New here? Create an account",
  switchToSignIn: "Already have an account? Sign in",
  sessionEnded: "Your session ended. Please sign in again.",
};

export const tour = {
  title: "A quick tour",
  skip: "Skip the tour",
  next: "Next",
  back: "Back",
  done: "Got it",
  help: "Need help?",
  steps: [
    { head: "The chart", body: "Each box on the chart is one {{candle|candle}}. It shows one day. The name, the dates and the price level are hidden." },
    { head: "Your guess", body: "You guess if the price will be higher in a few days. You also say how sure you are, from 1% to 99%." },
    { head: "No take-backs", body: "Once you send a guess, you cannot change it. That keeps your score honest." },
    { head: "Your score", body: "We give you a {{brier-score|Brier score}}. Lower is better. Saying 50% every time scores 0.25. That is the number to beat." },
    { head: "The reveal", body: "When you are done, you can {{reveal|reveal}} what the chart really was. Then the episode ends." },
  ],
};
