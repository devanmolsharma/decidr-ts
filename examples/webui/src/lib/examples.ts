import type { QuestionSpec } from "./question-types";
import { RED_PANDA_BASE64 } from "./red-panda-base64";
import { TRAFFIC_LIGHT_BASE64 } from "./traffic-light-base64";
import { BAR_CHART_BASE64 } from "./bar-chart-base64";
import { buildScaleRow } from "./scale-example";

export const RED_PANDA_URL = `${import.meta.env.BASE_URL}red-panda.jpg`;
export const TRAFFIC_LIGHT_URL = `${import.meta.env.BASE_URL}traffic-light.jpg`;
export const BAR_CHART_URL = `${import.meta.env.BASE_URL}bar-chart.jpg`;

export interface ExamplePreset {
  id: string;
  title: string;
  tagline: string;
  /** Raw text as it appears in the State editor -- a JSON string for
   * plain text, or a JSON-stringified ContentBlock[] for multimodal. */
  stateText: string;
  imagePreview?: string;
  questionsText: string;
}

function questionsJson(questions: QuestionSpec[]): string {
  return JSON.stringify(questions, null, 2);
}

const scaleRow = buildScaleRow();

export const EXAMPLE_PRESETS: ExamplePreset[] = [
  {
    id: "ticket-routing",
    title: "Support ticket routing",
    tagline: "A real 2-level hierarchy, a severity rubric, and a yes/no escalation check -- all three primitives on one ticket.",
    stateText: JSON.stringify(
      "Customer: I was charged $49.99 twice this month for my subscription. I already emailed support three " +
        "days ago and nobody replied. I want the duplicate charge refunded immediately.",
    ),
    questionsText: questionsJson([
      {
        id: "team",
        type: "choice",
        instructions: "Which team and sub-category should handle this support ticket?",
        criteria: [
          { id: "billing_refund", description: "Customer wants money back for an incorrect or duplicate charge." },
          { id: "billing_dispute", description: "Customer disputes a charge as unauthorized or fraudulent." },
          { id: "billing_subscription", description: "Questions about subscription plans, upgrades, or cancellation." },
          { id: "support_escalation", description: "Customer reports being ignored by a previous support contact." },
          { id: "support_general", description: "General product usage question." },
          { id: "bug_crash", description: "App or website crashed." },
          { id: "bug_slow", description: "App or website is slow." },
        ],
      },
      {
        id: "urgency",
        type: "score",
        instructions: "How urgent is this ticket?",
        criteria: ["no time pressure", "should be handled today", "customer is actively escalating and expects an immediate response"],
      },
      {
        id: "escalated",
        type: "noun",
        instructions: "Has this customer already contacted support about this issue before?",
      },
    ]),
  },
  {
    id: "vision",
    title: "Vision classification",
    tagline: "The state is a real photo, sent as a multimodal content block -- no text ever describes what's in it.",
    stateText: JSON.stringify(
      [
        { type: "text", text: "Look at this photo:" },
        { type: "image", data: RED_PANDA_BASE64, mimeType: "image/jpeg" },
      ],
      null,
      2,
    ),
    imagePreview: RED_PANDA_URL,
    questionsText: questionsJson([
      {
        id: "animal",
        type: "choice",
        instructions: "What animal is in this photo?",
        criteria: [
          { id: "red_panda", description: "a red panda" },
          { id: "raccoon", description: "a raccoon" },
          { id: "fox", description: "a fox" },
          { id: "cat", description: "a domestic cat" },
        ],
      },
      { id: "is_pet", type: "noun", instructions: "Is this a wild animal typically kept as a household pet?" },
    ]),
  },
  {
    id: "traffic-light",
    title: "Traffic light state",
    tagline: "A self-driving-relevant read: which light is lit, and a real Score rubric for how urgent the stop is.",
    stateText: JSON.stringify(
      [
        { type: "text", text: "A traffic light, seen from a car approaching the intersection:" },
        { type: "image", data: TRAFFIC_LIGHT_BASE64, mimeType: "image/jpeg" },
      ],
      null,
      2,
    ),
    imagePreview: TRAFFIC_LIGHT_URL,
    questionsText: questionsJson([
      {
        id: "light",
        type: "choice",
        instructions: "Which light is currently lit?",
        criteria: [
          { id: "red", description: "the red light is lit" },
          { id: "yellow", description: "the yellow light is lit" },
          { id: "green", description: "the green light is lit" },
        ],
      },
      {
        id: "urgency",
        type: "score",
        instructions: "How urgently must the car stop?",
        criteria: ["no need to stop", "should slow down", "must stop immediately"],
      },
      { id: "clear_to_go", type: "noun", instructions: "Is it safe for the car to continue through the intersection right now?" },
    ]),
  },
  {
    id: "bar-chart",
    title: "Chart reading",
    tagline: "The state is a rendered chart image -- decidr reads the visual, not a data table it was never given.",
    stateText: JSON.stringify(
      [
        { type: "text", text: "A quarterly revenue chart:" },
        { type: "image", data: BAR_CHART_BASE64, mimeType: "image/jpeg" },
      ],
      null,
      2,
    ),
    imagePreview: BAR_CHART_URL,
    questionsText: questionsJson([
      {
        id: "best_quarter",
        type: "choice",
        instructions: "Which quarter had the highest revenue?",
        criteria: [
          { id: "q1", description: "Q1" },
          { id: "q2", description: "Q2" },
          { id: "q3", description: "Q3" },
          { id: "q4", description: "Q4" },
        ],
      },
      { id: "trending_up", type: "noun", instructions: "Does revenue generally trend upward from Q1 to Q4 in this chart?" },
    ]),
  },
  {
    id: "multi-agent",
    title: "Multi-agent task routing",
    tagline: "Which specialized agent should handle this request, and does it need more than one agent?",
    stateText: JSON.stringify(
      'User: "Can you find me the cheapest flight from Zurich to London next Tuesday, and also tell me ' +
        'what the weather will be like when I land?"',
    ),
    questionsText: questionsJson([
      {
        id: "agent",
        type: "choice",
        instructions: "Which specialized agent should handle this request first?",
        criteria: [
          { id: "flight", description: "Searches and compares real flight prices and schedules." },
          { id: "weather", description: "Looks up current and forecast weather for a location and date." },
          { id: "coder", description: "Writes, edits, or debugs source code." },
          { id: "writer", description: "Drafts or edits prose, emails, or documents." },
          { id: "calendar", description: "Reads or schedules events on a user's calendar." },
        ],
      },
      { id: "multi_agent", type: "noun", instructions: "Does fulfilling this request require more than one specialized agent?" },
    ]),
  },
  {
    id: "tictactoe",
    title: "Tic-tac-toe move selection",
    tagline: "An honest example: decidr reports what the model actually believes, confident wrongness included.",
    stateText: JSON.stringify(
      "Tic-tac-toe. Rows and columns are numbered 0-2 (row, col), top-left is (0,0), bottom-right is (2,2).\n" +
        "X is at (0,0) and (1,1). O is at (0,1) and (2,1). All other cells are empty.\n" +
        "X to move. Three X's in a row (any row, column, or diagonal) wins immediately.",
    ),
    questionsText: questionsJson([
      {
        id: "move",
        type: "choice",
        instructions: "Which empty cell should X play to win immediately, if a winning move exists?",
        criteria: [
          { id: "cell_0_2", description: "row 0, col 2 (top-right)" },
          { id: "cell_1_0", description: "row 1, col 0 (middle-left)" },
          { id: "cell_1_2", description: "row 1, col 2 (middle-right)" },
          { id: "cell_2_0", description: "row 2, col 0 (bottom-left)" },
          { id: "cell_2_2", description: "row 2, col 2 (bottom-right)" },
        ],
      },
      { id: "has_win", type: "noun", instructions: "Does X have a winning move available right now?" },
    ]),
  },
  {
    id: "scale-demo",
    title: "150-way routing in a handful of requests",
    tagline: "A flat race over 150 options would blow past any top_logprobs window. The id hierarchy resolves it anyway.",
    stateText: JSON.stringify(scaleRow.state),
    questionsText: questionsJson([{ id: "route", type: "choice", instructions: scaleRow.question, criteria: scaleRow.options }]),
  },
];
