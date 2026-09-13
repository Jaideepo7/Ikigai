/** Syllabus → Gemini Flash-Lite → structured class tasks. */
export type SyllabusDraftTask = {
  name: string;
  description: string;
  due_date: string | null;
  priority: 1 | 2 | 3;
  difficulty: 1 | 2 | 3;
  est_minutes: number;
};

const MODEL = 'gemini-3.1-flash-lite';
const MAX_TASKS = 40;

const SCHEMA = {
  type: 'object',
  properties: {
    class_name: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          due_date: { type: 'string', description: 'YYYY-MM-DD or empty' },
          priority: { type: 'integer' },
          difficulty: { type: 'integer' },
          est_minutes: { type: 'integer' },
        },
        required: ['name', 'description', 'due_date', 'priority', 'difficulty', 'est_minutes'],
      },
    },
  },
  required: ['class_name', 'tasks'],
};

function clampTask(raw: any): SyllabusDraftTask | null {
  const name = String(raw?.name ?? '').trim().slice(0, 50);
  if (!name) return null;
  const description = String(raw?.description ?? '').trim().slice(0, 200);
  const dueRaw = String(raw?.due_date ?? '').trim();
  const due_date = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
  const priority = [1, 2, 3].includes(Number(raw?.priority)) ? Number(raw.priority) as 1 | 2 | 3 : 2;
  const difficulty = [1, 2, 3].includes(Number(raw?.difficulty)) ? Number(raw.difficulty) as 1 | 2 | 3 : 2;
  let est = Math.round(Number(raw?.est_minutes) || 60);
  if (!Number.isFinite(est)) est = 60;
  est = Math.min(300, Math.max(5, est));
  return { name, description, due_date, priority, difficulty, est_minutes: est };
}

function buildPrompt(className: string, today: string) {
  return `You turn a course syllabus into a short actionable task list for a student productivity game.

Class / folder name hint: ${className || '(infer a short class name)'}
Today's date: ${today}

Rules:
- Return at most ${MAX_TASKS} concrete student tasks (homework, readings, exams, projects, quizzes, labs).
- Skip fluff: office hours, academic integrity paragraphs, grading scales, disability statements.
- name: short action (max 50 chars), e.g. "Read Ch. 3" or "Midterm exam".
- description: one short line of context (max 200 chars).
- due_date: YYYY-MM-DD when the syllabus has a date; otherwise "".
- priority: 1 low, 2 normal, 3 high (exams/projects = 3).
- difficulty: 1 easy, 2 medium, 3 hard.
- est_minutes: integer 5-300 for how long the student should budget.
- class_name: short folder label (max 30 chars), prefer the hint if given.
- Prefer dated graded work; include major readings if clearly assigned.`;
}

/** Call Gemini with syllabus plain text. */
export async function parseSyllabusWithGemini(apiKey: string, text: string, className: string, today: string): Promise<{ class_name: string; tasks: SyllabusDraftTask[] }> {
  const trimmed = text.replace(/\u0000/g, ' ').trim();
  if (trimmed.length < 40) throw new Error('Could not read enough text from that PDF. Try a text-based syllabus.');
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${buildPrompt(className, today)}\n\n--- SYLLABUS TEXT ---\n${trimmed.slice(0, 120_000)}` }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini error (${res.status})`;
    throw new Error(msg);
  }
  const rawText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';
  let parsed: any;
  try { parsed = JSON.parse(rawText); }
  catch { throw new Error('Gemini returned unreadable task data. Try again.'); }
  const folder = String(parsed.class_name || className || 'Class').trim().slice(0, 30) || 'Class';
  const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).map(clampTask).filter(Boolean).slice(0, MAX_TASKS) as SyllabusDraftTask[];
  if (!tasks.length) throw new Error('No tasks found in that syllabus.');
  return { class_name: folder, tasks };
}
