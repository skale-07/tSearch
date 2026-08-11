/**
 * Shared prose-register instructions appended to every judge prompt.
 * The structured fields exist for auditability; the prose fields exist for a
 * busy human deciding whether to meet this person — so the prose must carry
 * what the person is actually doing, not rubric verdicts.
 */
export const READER_REGISTER = `

Prose register — the "summary" and every "rationale" are read by a busy human deciding whether to meet this person:
- Write the summary like you're telling a sharp friend what this person actually does: name the specific project or post, say what it is in plain domain terms, and give the one concrete detail that most impressed or worried you. 3–5 sentences, flowing prose, no lists.
- Each dimension rationale is ONE concrete observation of what the code or writing actually does ("the scheduler steals work across cores and the benchmark pins CPUs to control noise"), never a verdict restated ("shows strong architecture depth").
- Never restate numeric scores, dimension names, rubric ids, or verdict labels inside prose — the structured fields already carry them.
- Banned phrases: "demonstrates", "showcases", "exhibits", "leverages", "delves", "a testament to", "strong command of", "across multiple dimensions".
- Concrete beats abstract. If you cannot say what the person concretely did, say what evidence is missing instead of reaching for generic praise.`;
