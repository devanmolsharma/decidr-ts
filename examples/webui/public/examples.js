// Example decisions for the decidr-ts showcase. Each entry is either a
// single `row` example or a `race` (the same task run two ways at once)
// or a `scale` example (a large option count to show off the hierarchy).
// All state/options here are real, working decidr-ts Rows -- nothing here
// is mocked; every example actually calls OpenAI from the browser.

export const EXAMPLES = [
  {
    id: "speed-race",
    kind: "race",
    title: "decidr vs. a normal chat call",
    tagline: "Same real classification, run two ways at once -- watch which one finishes first.",
    row: {
      id: "race-1",
      state:
        "Customer: \"My package was supposed to arrive 5 days ago and the tracking hasn't updated since. " +
        "I need this for an event this weekend and I'm getting worried.\"",
      question: "Which support queue should this go to?",
      // Real tokenizers split on more than just the first letter, so ids
      // that merely start with different letters (delay/damaged/defect/
      // delete/dispute all start with "d") can still share a first *token*
      // and cost extra disambiguation rounds -- a genuine, honest cost this
      // library has (see docs/PREFIX_MATCHING.md). These ids are picked to
      // diverge on their first whole token for a fast single-round race.
      options: [
        { id: "delay", description: "A package is late or tracking has stalled." },
        { id: "lost", description: "A package appears to be lost entirely." },
        { id: "torn", description: "A package arrived damaged." },
        { id: "swap", description: "The wrong item was shipped." },
        { id: "held", description: "A package is held up in customs." },
        { id: "refund", description: "Customer wants money back." },
        { id: "charge", description: "Customer disputes a charge." },
        { id: "plan", description: "Question about a subscription plan." },
        { id: "return", description: "Customer wants to return or exchange an item." },
        { id: "print", description: "Customer needs a return shipping label." },
        { id: "login", description: "Customer can't log in or access their account." },
        { id: "erase", description: "Customer wants their account deleted." },
        { id: "broken", description: "Customer reports a manufacturing defect." },
        { id: "howto", description: "General question about a product." },
        { id: "quote", description: "A pre-purchase sales question." },
      ],
    },
  },
  {
    id: "scale-demo",
    kind: "scale",
    title: "150-way routing in a handful of requests",
    tagline: "A flat race over 150 options would blow past any top_logprobs window. The id hierarchy resolves it anyway.",
  },
  {
    id: "ticket-routing",
    kind: "row",
    title: "Support ticket routing",
    tagline: "A real 2-level hierarchy (billing / support / bug), every branch explored for a full distribution.",
    row: {
      id: "ticket-99",
      state:
        "Customer: I was charged $49.99 twice this month for my subscription. I already emailed support three " +
        "days ago and nobody replied. I want the duplicate charge refunded immediately.",
      question: "Which team and sub-category should handle this support ticket?",
      options: [
        { id: "billing_refund", description: "Customer wants money back for an incorrect or duplicate charge." },
        { id: "billing_dispute", description: "Customer disputes a charge as unauthorized or fraudulent." },
        { id: "billing_subscription", description: "Questions about subscription plans, upgrades, or cancellation." },
        { id: "support_escalation", description: "Customer reports being ignored by a previous support contact." },
        { id: "support_general", description: "General product usage question." },
        { id: "bug_crash", description: "App or website crashed." },
        { id: "bug_slow", description: "App or website is slow." },
      ],
      exhaustive: true,
    },
  },
  {
    id: "vision",
    kind: "row",
    title: "Vision classification",
    tagline: "The state is a real photo, sent as a multimodal content block -- no text ever describes what's in it.",
    row: {
      id: "vision-1",
      // Sent as inline base64 (see app.js, which fetches this same local
      // file and encodes it before the call) rather than a hotlinked
      // third-party URL -- a live Unsplash URL used here earlier silently
      // started serving a different photo entirely between one test run
      // and the next, which is exactly the failure mode a demo can't
      // afford. This file is CC-0 (Wikimedia Commons), shipped locally,
      // and won't change under us.
      imageAsset: "./assets/red-panda.jpg",
      imageMimeType: "image/jpeg",
      question: "What animal is in this photo?",
      options: [
        { id: "red_panda", description: "a red panda" },
        { id: "raccoon", description: "a raccoon" },
        { id: "fox", description: "a fox" },
        { id: "cat", description: "a domestic cat" },
      ],
      imagePreview: "./assets/red-panda.jpg",
    },
  },
  {
    id: "multi-agent",
    kind: "row",
    title: "Multi-agent task routing",
    tagline: "The exact pattern TypeSafe cites for Jev: which specialized agent should handle this request?",
    row: {
      id: "req-1",
      state:
        "User: \"Can you find me the cheapest flight from Zurich to London next Tuesday, and also tell me " +
        "what the weather will be like when I land?\"",
      question: "Which specialized agent should handle this request first?",
      options: [
        { id: "flight", description: "Searches and compares real flight prices and schedules." },
        { id: "weather", description: "Looks up current and forecast weather for a location and date." },
        { id: "coder", description: "Writes, edits, or debugs source code." },
        { id: "writer", description: "Drafts or edits prose, emails, or documents." },
        { id: "calendar", description: "Reads or schedules events on a user's calendar." },
      ],
    },
  },
  {
    id: "tictactoe",
    kind: "row",
    title: "Tic-tac-toe move selection",
    tagline: "An honest example: decidr reports what the model actually believes, confident wrongness included.",
    row: {
      id: "ttt-1",
      state:
        "Tic-tac-toe. Rows and columns are numbered 0-2 (row, col), top-left is (0,0), bottom-right is (2,2).\n" +
        "X is at (0,0) and (1,1). O is at (0,1) and (2,1). All other cells are empty.\n" +
        "X to move. Three X's in a row (any row, column, or diagonal) wins immediately.",
      question: "Which empty cell should X play to win immediately, if a winning move exists?",
      options: [
        { id: "cell_0_2", description: "row 0, col 2 (top-right)" },
        { id: "cell_1_0", description: "row 1, col 0 (middle-left)" },
        { id: "cell_1_2", description: "row 1, col 2 (middle-right)" },
        { id: "cell_2_0", description: "row 2, col 0 (bottom-left)" },
        { id: "cell_2_2", description: "row 2, col 2 (bottom-right)" },
      ],
      exhaustive: true,
      correctId: "cell_2_2",
      board: [
        ["X", "O", "."],
        [".", "X", "."],
        [".", "O", "."],
      ],
    },
  },
];
