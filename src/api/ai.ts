import { supabase } from '../lib/supabase';

export interface AiSuggestionResponse {
  label: string;
  text?: string;
  skills?: string[];
  questions?: Array<{
    topic: string;
    question: string;
    whatToLookFor: string;
  }>;
}

async function callGuardedGemini(
  feature:
    | 'suggest_skills'
    | 'improve_jd'
    | 'suggest_interview_questions'
    | 'tidy_feedback_notes'
    | 'general_chat',
  payload: Record<string, unknown>
): Promise<AiSuggestionResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('AI assistant unavailable right now');
  }

  const response = await fetch('/api/gemini/suggest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ feature, payload }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'AI assistant unavailable right now');
  }

  return (await response.json()) as AiSuggestionResponse;
}

// 1. Requirement form: "Suggest skills" from JD text
export async function suggestSkillsFromJd(params: {
  title: string;
  description: string;
}): Promise<{ label: string; skills: string[] }> {
  const res = await callGuardedGemini('suggest_skills', {
    title: params.title,
    description: params.description,
  });
  return {
    label: res.label || 'AI suggestion: review before use',
    skills: res.skills || [],
  };
}

// 2. Requirement form: "Improve JD wording"
export async function improveJdWording(params: {
  title: string;
  description: string;
  skills: string[];
}): Promise<{ label: string; text: string }> {
  const res = await callGuardedGemini('improve_jd', {
    title: params.title,
    description: params.description,
    skills: params.skills,
  });
  return {
    label: res.label || 'AI suggestion: review before use',
    text: res.text || '',
  };
}

// 3. Interview scheduling: "Suggest interview questions" from JD + structured candidate fields ONLY
export async function suggestInterviewQuestions(params: {
  requirement_title: string;
  requirement_description: string;
  requirement_skills: string[];
  candidate_skills: string[];
  total_experience_years: number | null;
  current_title: string | null;
  round_type: string;
}): Promise<{
  label: string;
  questions: Array<{ topic: string; question: string; whatToLookFor: string }>;
}> {
  const res = await callGuardedGemini('suggest_interview_questions', {
    requirement_title: params.requirement_title,
    requirement_description: params.requirement_description,
    requirement_skills: params.requirement_skills,
    candidate_skills: params.candidate_skills,
    total_experience_years: params.total_experience_years,
    current_title: params.current_title,
    round_type: params.round_type,
  });
  return {
    label: res.label || 'AI suggestion: review before use',
    questions: res.questions || [],
  };
}

// 4. Interview feedback form: "Tidy my notes" — rewrites only text the user typed
export async function tidyInterviewNotes(draftNotes: string): Promise<{
  label: string;
  text: string;
}> {
  const res = await callGuardedGemini('tidy_feedback_notes', {
    draft_notes: draftNotes,
  });
  return {
    label: res.label || 'AI suggestion: review before use',
    text: res.text || '',
  };
}

// 5. AI drawer: general staffing help chat (no candidate records sent)
export async function sendGeneralStaffingChat(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
): Promise<{ label: string; text: string }> {
  const res = await callGuardedGemini('general_chat', { messages });
  return {
    label: res.label || 'AI suggestion: review before use',
    text: res.text || '',
  };
}
