/**
 * IT vs Non-IT classification for requirements.
 * Derived from title + skills (no DB column needed, so it works for every existing requirement).
 */
export type RequirementCategory = 'it' | 'non_it';

const IT_TITLE =
  /\b(develop(er|ment)?|engineer(ing)?|programmer|software|devops|devsecops|sre|cloud|architect|data\s*(scientist|analyst|engineer)|analytics|machine learning|ml|ai|qa|sdet|tester|testing|automation|java|python|\.net|dotnet|node|react|angular|vue|full[\s-]?stack|front[\s-]?end|back[\s-]?end|mobile|android|ios|flutter|salesforce|sap|abap|oracle|servicenow|workday|mainframe|cobol|database|dba|sql|etl|bi|power\s*bi|tableau|network|security analyst|cyber|infosec|sysadmin|system administrator|it support|helpdesk|scrum master|product owner|business analyst|ui\/?ux|technical|technology|tech lead|blockchain|embedded|firmware|vlsi)\b/i;

const NON_IT_TITLE =
  /\b(sales|business development executive|telecaller|tele\s*sales|bpo|customer (support|service|care)|call cent(er|re)|voice process|non[\s-]?voice|hr\b|human resources|talent acquisition|recruiter|payroll|accountant|accounts?|finance|auditor|tax|banking|insurance|marketing|seo|content (writer|creator)|copywriter|graphic designer|operations|logistics|supply chain|warehouse|driver|delivery|admin(istrat(or|ive))?|receptionist|office|executive assistant|front desk|nurse|doctor|pharma(cist)?|teacher|trainer|faculty|retail|store|merchandis|manufactur|production|mechanical|civil|electrical|site engineer|quality inspector|security guard|housekeeping|chef|hotel|hospitality|legal|compliance)\b/i;

const IT_SKILL =
  /\b(java|python|javascript|typescript|react|angular|node|sql|aws|azure|gcp|docker|kubernetes|terraform|spring|\.net|c\+\+|golang|kotlin|swift|salesforce|sap|api|microservices|devops|linux|git|selenium|hadoop|spark|etl|tableau|power\s*bi|agile|jira)\b/i;

export function classifyRequirement(req: {
  title?: string | null;
  skills?: string[] | null;
  description?: string | null;
}): RequirementCategory {
  const title = req.title || '';
  const skills = Array.isArray(req.skills) ? req.skills.join(' ') : '';

  const itTitle = IT_TITLE.test(title);
  const nonItTitle = NON_IT_TITLE.test(title);
  const itSkills = IT_SKILL.test(skills);

  // A clear IT job title wins, even if a generic word like "executive" also appears.
  if (itTitle && !nonItTitle) return 'it';
  if (nonItTitle && !itTitle) return itSkills ? 'it' : 'non_it';
  if (itTitle && nonItTitle) return itSkills ? 'it' : 'non_it';

  // Neither title matched: decide on skills, then fall back to the description.
  if (itSkills) return 'it';
  if (IT_SKILL.test((req.description || '').slice(0, 1500))) return 'it';
  return 'non_it';
}

export const REQUIREMENT_CATEGORY_LABEL: Record<RequirementCategory, string> = {
  it: 'IT',
  non_it: 'Non-IT',
};
