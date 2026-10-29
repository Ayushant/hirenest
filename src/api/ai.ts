import { supabase } from '../lib/supabase';
import { extractStructuredFieldsFromText } from '../lib/resumeParser';

export interface ScreeningEvaluationSuggestion {
  strengths: string;
  gaps: string;
  followUps: string;
  summary: string;
  skill_rating: number;
  communication_rating: number;
  overall_rating: number;
}

export type AiSuggestionSource = 'provider' | 'template';
export type AiFallbackReason =
  | 'no_api_key'
  | 'rate_limited'
  | 'provider_error'
  | 'provider_timeout'
  | 'network_unreachable';

export interface AiSuggestionResponse {
  label: string;
  text?: string;
  skills?: string[];
  questions?: Array<{
    topic: string;
    question: string;
    whatToLookFor: string;
  }>;
  evaluation?: ScreeningEvaluationSuggestion;
  // Provenance so the UI can honestly distinguish live-AI output from offline templates
  source?: AiSuggestionSource;
  ai?: boolean;
  provider?: string | null;
  model?: string | null;
  reason?: AiFallbackReason | null;
}

export const OFFLINE_AI_LABEL =
  'Offline template — AI provider unavailable; verify every value before use';
export const OFFLINE_SCREENING_LABEL =
  'Offline advisory template — AI provider unavailable; recruiter must evaluate manually';

type AiFeatureType =
  | 'suggest_skills'
  | 'improve_jd'
  | 'suggest_interview_questions'
  | 'tidy_feedback_notes'
  | 'evaluate_screening_responses'
  | 'general_chat';

function tagTemplate(
  body: Omit<AiSuggestionResponse, 'source' | 'ai' | 'provider' | 'model' | 'reason'>,
  reason: AiFallbackReason
): AiSuggestionResponse {
  return {
    ...body,
    source: 'template',
    ai: false,
    provider: null,
    model: null,
    reason,
  };
}

function buildClientStaffingAiFallback(
  feature: AiFeatureType,
  payload: Record<string, unknown>,
  reason: AiFallbackReason = 'network_unreachable'
): AiSuggestionResponse {
  if (feature === 'suggest_skills') {
    const text = `${String(payload.title || '')} ${String(payload.description || '')}`;
    const detected = extractStructuredFieldsFromText(text, 'jd.txt').skills;
    const roleDefaults = [
      'Python',
      'SQL',
      'TypeScript',
      'System Design',
      'Cloud Architecture',
      'CI/CD',
      'REST APIs',
      'Stakeholder Management',
    ];
    const skills = Array.from(new Set([...detected, ...roleDefaults])).slice(0, 8);
    return tagTemplate({ label: OFFLINE_AI_LABEL, skills }, reason);
  }

  if (feature === 'improve_jd') {
    const title = String(payload.title || 'Technical Specialist').trim();
    const rawDesc = String(payload.description || '').trim();
    const skills = Array.isArray(payload.skills)
      ? payload.skills.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const skillLine =
      skills.length > 0
        ? skills.join(', ')
        : 'core domain engineering, production architecture, and cross-functional delivery';
    return tagTemplate(
      {
        label: OFFLINE_AI_LABEL,
        text: [
          `Role Summary\nWe are seeking an experienced ${title} to design, build, and scale enterprise systems. ${rawDesc}`,
          `Key Responsibilities\n- Lead end-to-end technical delivery, architecture reviews, and production reliability across ${skillLine}.\n- Collaborate with product, engineering, and business stakeholders to translate requirements into maintainable solutions.\n- Enforce code quality, observability, security standards, and SLA commitments.`,
          `Required Qualifications\n- Proven hands-on production experience with ${skillLine}.\n- Strong debugging, analytical problem-solving, and clear written and verbal communication skills.\n- Demonstrated track record of delivering enterprise workloads on schedule.`,
        ].join('\n\n'),
      },
      reason
    );
  }

  if (feature === 'suggest_interview_questions') {
    const reqTitle = String(payload.requirement_title || 'this role').trim();
    const reqSkills = Array.isArray(payload.requirement_skills)
      ? payload.requirement_skills.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const candSkills = Array.isArray(payload.candidate_skills)
      ? payload.candidate_skills.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const roundType = String(payload.round_type || 'technical');
    const candLower = new Set(candSkills.map((s) => s.toLowerCase()));
    const unproven = reqSkills.filter((s) => !candLower.has(s.toLowerCase()));
    const primarySkills =
      reqSkills.length > 0
        ? reqSkills.slice(0, 3)
        : ['Core Architecture', 'Production Delivery', 'System Design'];

    const questions = primarySkills.map((sk) => ({
      topic: `${sk} (${roundType.replace(/_/g, ' ')})`,
      question: `Walk through a complex production system where you implemented ${sk} for a ${reqTitle} workload. What architectural trade-offs did you make and how did you measure success?`,
      whatToLookFor: `Concrete hands-on ownership, depth in ${sk}, edge-case handling, and measurable production impact.`,
    }));

    if (unproven.length > 0) {
      questions.push({
        topic: `Unproven JD skill check: ${unproven.slice(0, 2).join(', ')}`,
        question: `Our requirement emphasizes ${unproven.slice(0, 2).join(' and ')}, which is not explicitly detailed on your resume. Have you worked with these or adjacent tools in production?`,
        whatToLookFor: `Direct project evidence or transferable architectural concepts for ${unproven.slice(0, 2).join(', ')}.`,
      });
    }

    questions.push({
      topic: 'Incident resolution & stakeholder communication',
      question: `Describe a high-severity production bottleneck or ambiguous requirement you resolved recently. How did you diagnose the root cause and communicate trade-offs to stakeholders?`,
      whatToLookFor:
        'Structured debugging methodology, ownership without blame, and clear communication.',
    });

    return tagTemplate(
      { label: OFFLINE_AI_LABEL, questions: questions.slice(0, 5) },
      reason
    );
  }

  if (feature === 'tidy_feedback_notes') {
    const draft = String(payload.draft_notes || '').trim();
    const sentences = draft
      .split(/[\r\n.]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    return tagTemplate(
      {
        label: OFFLINE_AI_LABEL,
        text:
          sentences.length > 0
            ? `Interview Evaluation Summary: ${sentences.join('. ')}.`
            : draft,
      },
      reason
    );
  }

  if (feature === 'evaluate_screening_responses') {
    const reqTitle = String(payload.requirement_title || 'Requirement').trim();
    const qaPairs = Array.isArray(payload.qa_pairs)
      ? (payload.qa_pairs as Array<{ topic?: string; question?: string; response?: string }>)
      : [];
    const answered = qaPairs.filter((q) => String(q?.response || '').trim().length > 0);
    const avgLen =
      answered.reduce((acc, q) => acc + String(q.response || '').trim().length, 0) /
      Math.max(1, answered.length);

    const skillRating = answered.length >= 2 && avgLen >= 80 ? 4 : answered.length >= 1 ? 3 : 2;
    const commRating = avgLen >= 100 ? 4 : avgLen >= 40 ? 3 : 2;
    const overallRating = Math.round((skillRating + commRating) / 2);

    return tagTemplate(
      {
        label: OFFLINE_SCREENING_LABEL,
        evaluation: {
          strengths:
            answered.length > 0
              ? `Provided structured responses across ${answered.length} screening topics (${answered.map((q) => q.topic || 'Core skill').join(', ')}).`
              : 'Initial screening responses recorded.',
          gaps:
            answered.length < qaPairs.length
              ? `${qaPairs.length - answered.length} question(s) require deeper live technical probing during the next interview round.`
              : 'Verify production scale, system concurrency, and hands-on code depth in the technical round.',
          followUps: `Probe production architecture trade-offs and hands-on implementation metrics for ${reqTitle}.`,
          summary: `Candidate completed ${answered.length}/${qaPairs.length} first-round screening questions for ${reqTitle}. Role-skill evidence and communication clarity were evaluated on separate axes.`,
          skill_rating: skillRating,
          communication_rating: commRating,
          overall_rating: overallRating,
        },
      },
      reason
    );
  }

  return tagTemplate(
    {
      label: OFFLINE_AI_LABEL,
      text: `HireNestOS Staffing Operations Guide:\n1. Job Descriptions: Define clear atomic skills, experience bounds, work mode, and LPA/LPM budget range.\n2. 4-Dimension Matching: Scores combine Skills (40%), Experience (25%), Domain (20%), and Seniority (15%). Missing resume evidence is marked Unproven (verify in screening) rather than missing.\n3. Interviews & SLA: Acknowledge shared requirements within SLA, use structured competency rubrics, and rate JD skill alignment separately from communication.`,
    },
    reason
  );
}

async function callGuardedGemini(
  feature: AiFeatureType,
  payload: Record<string, unknown>
): Promise<AiSuggestionResponse> {
  try {
    const { data: sessionData } = await supabase.auth.getSession().catch(() => ({
      data: { session: null },
    }));
    const token = sessionData?.session?.access_token || 'workspace_active_session';

    const response = await fetch('/api/gemini/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ feature, payload }),
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as AiSuggestionResponse;
      }
    }
    // HTTP error: distinguish rate limit vs other provider errors so the UI can show an honest reason
    if (response.status === 429) {
      return buildClientStaffingAiFallback(feature, payload, 'rate_limited');
    }
    return buildClientStaffingAiFallback(feature, payload, 'provider_error');
  } catch {
    // Network/serverless unreachable: tag as such instead of impersonating live AI
    return buildClientStaffingAiFallback(feature, payload, 'network_unreachable');
  }
}

export interface AiProvenance {
  source: AiSuggestionSource;
  ai: boolean;
  provider: string | null;
  reason: AiFallbackReason | null;
}

function readProvenance(res: AiSuggestionResponse): AiProvenance {
  // Default to template/offline when the server did not tag the response — safer than claiming live AI.
  return {
    source: res.source || 'template',
    ai: res.ai === true,
    provider: res.provider ?? null,
    reason: res.reason ?? null,
  };
}

// 1. Requirement form: "Suggest skills" from JD text
export async function suggestSkillsFromJd(params: {
  title: string;
  description: string;
}): Promise<{ label: string; skills: string[] } & AiProvenance> {
  const res = await callGuardedGemini('suggest_skills', {
    title: params.title,
    description: params.description,
  });
  return {
    label: res.label || OFFLINE_AI_LABEL,
    skills: res.skills || [],
    ...readProvenance(res),
  };
}

// 2. Requirement form: "Improve JD wording"
export async function improveJdWording(params: {
  title: string;
  description: string;
  skills: string[];
}): Promise<{ label: string; text: string } & AiProvenance> {
  const res = await callGuardedGemini('improve_jd', {
    title: params.title,
    description: params.description,
    skills: params.skills,
  });
  return {
    label: res.label || OFFLINE_AI_LABEL,
    text: res.text || '',
    ...readProvenance(res),
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
}): Promise<
  {
    label: string;
    questions: Array<{ topic: string; question: string; whatToLookFor: string }>;
  } & AiProvenance
> {
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
    label: res.label || OFFLINE_AI_LABEL,
    questions: res.questions || [],
    ...readProvenance(res),
  };
}

// 4. Interview feedback form: "Tidy my notes" — rewrites only text the user typed
export async function tidyInterviewNotes(
  draftNotes: string
): Promise<{ label: string; text: string } & AiProvenance> {
  const res = await callGuardedGemini('tidy_feedback_notes', {
    draft_notes: draftNotes,
  });
  return {
    label: res.label || OFFLINE_AI_LABEL,
    text: res.text || '',
    ...readProvenance(res),
  };
}

// 5. First-Round Screening Interview: "Evaluate captured Q&A responses" (Advisory only; separates Skill vs Communication)
export async function evaluateScreeningResponses(params: {
  requirement_title: string;
  requirement_skills: string[];
  mode: string;
  qa_pairs: Array<{ topic: string; question: string; response: string }>;
}): Promise<
  { label: string; evaluation: ScreeningEvaluationSuggestion } & AiProvenance
> {
  const res = await callGuardedGemini('evaluate_screening_responses', {
    requirement_title: params.requirement_title,
    requirement_skills: params.requirement_skills,
    mode: params.mode,
    qa_pairs: params.qa_pairs,
  });
  return {
    label: res.label || OFFLINE_SCREENING_LABEL,
    evaluation: res.evaluation || {
      strengths: 'Responses captured for screening topics.',
      gaps: 'Verify hands-on production depth in the next technical round.',
      followUps: 'Probe system architecture and edge-case handling.',
      summary: 'First-round screening completed.',
      skill_rating: 3,
      communication_rating: 3,
      overall_rating: 3,
    },
    ...readProvenance(res),
  };
}

// 6. AI drawer: general staffing help chat (no candidate records sent)
export async function sendGeneralStaffingChat(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
): Promise<{ label: string; text: string } & AiProvenance> {
  const res = await callGuardedGemini('general_chat', { messages });
  return {
    label: res.label || OFFLINE_AI_LABEL,
    text: res.text || '',
    ...readProvenance(res),
  };
}
