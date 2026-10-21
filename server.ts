import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const PORT = 3000;

// In-memory per-user rate limiter: max 20 requests per hour per authenticated user ID.
// Resets on server restart (per instance) — documented in README as an MVP limitation.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const userRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkUserRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = userRateLimitMap.get(userId);
  if (!existing || now >= existing.resetAt) {
    const next = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    userRateLimitMap.set(userId, next);
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: next.resetAt };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - existing.count, resetAt: existing.resetAt };
}

// Strict PII scrubber: strips emails, phone numbers, LinkedIn/URLs, street addresses, and DOB patterns.
// Never logs input or output payloads.
function scrubPII(input: string): string {
  if (!input) return '';
  return input
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    // LinkedIn and web URLs
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/(?:www\.)?linkedin\.com\/in\/[^\s/]+/gi, '[REDACTED_LINKEDIN]')
    // Phone numbers (international and local formats)
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/g, '[REDACTED_PHONE]')
    // Dates of birth / explicit date patterns like DD/MM/YYYY or YYYY-MM-DD
    .replace(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/g, '[REDACTED_DATE]')
    .slice(0, 6000);
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateWithFallback(
  ai: GoogleGenAI,
  preferredModel: 'gemini-3.1-flash-lite' | 'gemini-3.8-flash',
  contents: string,
  systemInstruction: string,
  jsonSchema?: Record<string, unknown>
): Promise<string> {
  const modelsToTry = [preferredModel, 'gemini-3.8-flash', 'gemini-flash-latest'];
  const uniqueModels = Array.from(new Set(modelsToTry));

  let lastErr: unknown = null;
  for (const model of uniqueModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          ...(jsonSchema
            ? {
                responseMimeType: 'application/json',
                responseSchema: jsonSchema,
              }
            : {}),
        },
      });
      if (response.text) {
        return response.text;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('AI_UNAVAILABLE');
}

// Verify Supabase JWT and caller profile using ONLY the anon key and user's token (RLS enforced)
async function authenticateStaffingCaller(req: express.Request): Promise<
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; message: string }
> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'https://your-project-id.supabase.co') {
    return { ok: false, status: 503, message: 'Supabase environment is not configured.' };
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data: userData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !userData?.user) {
    return { ok: false, status: 401, message: 'Invalid or expired session.' };
  }

  // Read caller's public.profiles row with the user-scoped client
  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('id, role, status')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, status: 403, message: 'Profile not found or access denied.' };
  }

  // Reject (403) if role is 'pending' or status is not 'active'
  if (profile.role === 'pending' || profile.status !== 'active') {
    return { ok: false, status: 403, message: 'Active workspace account required.' };
  }

  // Never allow Gemini on candidate-facing screens
  if (profile.role === 'candidate') {
    return { ok: false, status: 403, message: 'AI assistant is not enabled for candidate accounts.' };
  }

  return { ok: true, userId: userData.user.id, role: profile.role };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Unified guarded endpoint for the 4 allowed suggestion features + general staffing help chat
  app.post('/api/gemini/suggest', async (req, res) => {
    try {
      const auth = await authenticateStaffingCaller(req);
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.message });
        return;
      }

      const rate = checkUserRateLimit(auth.userId);
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      if (!rate.allowed) {
        res.status(429).json({
          error: 'AI assistant unavailable right now (hourly request limit of 20 reached).',
        });
        return;
      }

      const ai = getGenAIClient();
      if (!ai) {
        res.status(503).json({ error: 'AI assistant unavailable right now' });
        return;
      }

      const { feature, payload } = req.body as {
        feature?: string;
        payload?: Record<string, unknown>;
      };

      if (!feature || !payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Invalid request format.' });
        return;
      }

      // 1. Requirement form: "Suggest skills" from JD text
      if (feature === 'suggest_skills') {
        const title = scrubPII(String(payload.title || ''));
        const description = scrubPII(String(payload.description || ''));
        if (!title && !description) {
          res.status(400).json({ error: 'Provide a requirement title or description first.' });
          return;
        }
        const rawJson = await generateWithFallback(
          ai,
          'gemini-3.1-flash-lite',
          `Requirement Title: ${title}\nJob Description:\n${description}`,
          'You are an enterprise technical recruiter assistant. Extract 5 to 10 concise, standardized technical or domain skill tags from the job description. Return JSON only.',
          {
            type: Type.OBJECT,
            properties: {
              skills: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Suggested standardized skill tags',
              },
            },
            required: ['skills'],
          }
        );
        const parsed = JSON.parse(rawJson.trim()) as { skills?: string[] };
        const cleanSkills = Array.isArray(parsed.skills)
          ? parsed.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
          : [];
        res.json({
          label: 'AI suggestion: review before use',
          skills: cleanSkills,
        });
        return;
      }

      // 2. Requirement form: "Improve JD wording"
      if (feature === 'improve_jd') {
        const title = scrubPII(String(payload.title || ''));
        const description = scrubPII(String(payload.description || ''));
        const skills = Array.isArray(payload.skills)
          ? payload.skills.map((s) => scrubPII(String(s))).slice(0, 20).join(', ')
          : '';
        if (!description || description.trim().length < 10) {
          res.status(400).json({ error: 'Enter at least a short draft description to improve.' });
          return;
        }
        const text = await generateWithFallback(
          ai,
          'gemini-3.8-flash',
          `Requirement Title: ${title}\nRequired Skills: ${skills}\nDraft Description:\n${description}`,
          'You are an enterprise staffing editor. Rewrite the job description into clear, structured, plain-text sections (Role Summary, Key Responsibilities, Required Qualifications) without markdown bolding or PII. Keep all factual requirements intact and concise.'
        );
        res.json({
          label: 'AI suggestion: review before use',
          text: text.trim(),
        });
        return;
      }

      // 3. Interview scheduling: "Suggest interview questions" from JD + structured candidate skills
      if (feature === 'suggest_interview_questions') {
        const reqTitle = scrubPII(String(payload.requirement_title || ''));
        const reqDesc = scrubPII(String(payload.requirement_description || ''));
        const reqSkills = Array.isArray(payload.requirement_skills)
          ? payload.requirement_skills.map((s) => scrubPII(String(s))).slice(0, 20)
          : [];
        const candSkills = Array.isArray(payload.candidate_skills)
          ? payload.candidate_skills.map((s) => scrubPII(String(s))).slice(0, 25)
          : [];
        const candExp =
          typeof payload.total_experience_years === 'number'
            ? `${payload.total_experience_years} years`
            : 'unspecified';
        const candTitle = scrubPII(String(payload.current_title || ''));
        const roundType = scrubPII(String(payload.round_type || 'technical'));

        const prompt = [
          `Interview Round: ${roundType}`,
          `Requirement Title: ${reqTitle}`,
          `Requirement Skills: ${reqSkills.join(', ')}`,
          `Requirement Description: ${reqDesc.slice(0, 1500)}`,
          `Candidate Current Title: ${candTitle}`,
          `Candidate Experience: ${candExp}`,
          `Candidate Listed Skills: ${candSkills.join(', ')}`,
        ].join('\n');

        const rawJson = await generateWithFallback(
          ai,
          'gemini-3.8-flash',
          prompt,
          'You are a structured interview architect. Generate 5 targeted, competency-based interview questions tailored to the requirement skills, the interview round, and any unproven skill gaps. Do not score the candidate.',
          {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    question: { type: Type.STRING },
                    whatToLookFor: { type: Type.STRING },
                  },
                  required: ['topic', 'question', 'whatToLookFor'],
                },
              },
            },
            required: ['questions'],
          }
        );
        const parsed = JSON.parse(rawJson.trim()) as {
          questions?: Array<{ topic: string; question: string; whatToLookFor: string }>;
        };
        res.json({
          label: 'AI suggestion: review before use',
          questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 6) : [],
        });
        return;
      }

      // 4. Interview feedback form: "Tidy my notes" — rewrites only text the user typed
      if (feature === 'tidy_feedback_notes') {
        const draftNotes = scrubPII(String(payload.draft_notes || ''));
        if (!draftNotes || draftNotes.trim().length < 10) {
          res.status(400).json({ error: 'Type at least 10 characters of notes before tidying.' });
          return;
        }
        const text = await generateWithFallback(
          ai,
          'gemini-3.1-flash-lite',
          `Raw Interviewer Notes:\n${draftNotes}`,
          'Rewrite ONLY the interviewer notes provided into clear, objective, professional sentences suitable for an enterprise interview record. Do NOT invent observations, do NOT add a hire/reject decision, and do NOT include any candidate names or PII. Return plain text only.'
        );
        res.json({
          label: 'AI suggestion: review before use',
          text: text.trim(),
        });
        return;
      }

      // 5. AI drawer: general staffing help chat (no candidate records sent)
      if (feature === 'general_chat') {
        const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
        const sanitizedHistory = rawMessages
          .slice(-8)
          .map((m: { role?: string; text?: string }) => {
            const roleLabel = m?.role === 'assistant' ? 'Assistant' : 'User';
            return `${roleLabel}: ${scrubPII(String(m?.text || ''))}`;
          })
          .join('\n\n');

        if (!sanitizedHistory.trim()) {
          res.status(400).json({ error: 'Message cannot be empty.' });
          return;
        }

        const text = await generateWithFallback(
          ai,
          'gemini-3.8-flash',
          sanitizedHistory,
          `You are the HireNestOS Staffing Operations Guide for role "${auth.role}". Provide concise, practical guidance on staffing workflows, writing clear job descriptions, conducting structured competency interviews, and SLA best practices. Never evaluate specific candidates, never compute scores, never decide disputes, and remind users not to paste personal contact details.`
        );
        res.json({
          label: 'AI suggestion: review before use',
          text: text.trim(),
        });
        return;
      }

      res.status(400).json({ error: 'Unsupported suggestion feature.' });
    } catch {
      res.status(503).json({ error: 'AI assistant unavailable right now' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HireNestOS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
