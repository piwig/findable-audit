// Web input bounds are intentionally smaller than the CLI's batch-file limits.
export const MAX_QUESTION_BODY_BYTES = 64 * 1024;

export function parsePriorityQuestions(values) {
  const questions = [...new Set(values.flatMap(value => value.split(/\r\n|[\r\n]/u)).map(value => value.trim()).filter(Boolean))];
  if (questions.length > 5 || questions.some(value => value.length > 300)) return null;
  return questions;
}
