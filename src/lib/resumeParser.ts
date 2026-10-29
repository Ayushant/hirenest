export interface ParsedCandidateResume {
  full_name: string;
  current_title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  location: string;
  total_experience_years: number;
  skills: string[];
  summary: string;
  parseSource: 'ai_and_document' | 'document_text' | 'filename_and_heuristics';
}

const CANONICAL_SKILLS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: 'PostgreSQL', patterns: [/\bpostgres(?:ql)?\b/i] },
  { label: 'SQL', patterns: [/\bsql\b/i, /\bt-sql\b/i] },
  { label: 'PL/SQL', patterns: [/\bpl\/?sql\b/i] },
  { label: 'MySQL', patterns: [/\bmysql\b/i] },
  { label: 'Oracle Database', patterns: [/\boracle\b/i] },
  { label: 'MongoDB', patterns: [/\bmongodb\b/i, /\bmongo\b/i] },
  { label: 'Redis', patterns: [/\bredis\b/i] },
  { label: 'Cassandra', patterns: [/\bcassandra\b/i] },
  { label: 'DynamoDB', patterns: [/\bdynamodb\b/i] },
  { label: 'Snowflake', patterns: [/\bsnowflake\b/i] },
  { label: 'BigQuery', patterns: [/\bbigquery\b/i] },
  { label: 'Database Design', patterns: [/\bdatabase\s+design(?:er)?\b/i, /\bdb\s+design\b/i] },
  { label: 'Database Architecture', patterns: [/\b(?:database|db)\s+(?:re)?architect(?:ure)?\b/i, /\brearchitect\b/i] },
  { label: 'Data Modeling', patterns: [/\bdata\s+model(?:l?ing)?\b/i, /\berd\b/i, /\bschema\s+design\b/i] },
  { label: 'Performance Tuning', patterns: [/\bperformance\s+tuning\b/i, /\bquery\s+optimization\b/i] },
  { label: 'ETL', patterns: [/\betl\b/i, /\bdata\s+pipeline/i] },
  { label: 'Data Warehousing', patterns: [/\bdata\s+warehous(?:e|ing)\b/i] },
  { label: 'NoSQL', patterns: [/\bnosql\b/i] },
  { label: 'TypeScript', patterns: [/\btypescript\b/i] },
  { label: 'JavaScript', patterns: [/\bjavascript\b/i, /\bes6\b/i] },
  { label: 'React', patterns: [/\breact(?:\.js|js)?\b/i] },
  { label: 'Next.js', patterns: [/\bnext(?:\.js|js)\b/i] },
  { label: 'Node.js', patterns: [/\bnode(?:\.js|js)?\b/i] },
  { label: 'Python', patterns: [/\bpython\b/i] },
  { label: 'Java', patterns: [/\bjava\b/i] },
  { label: 'Spring Boot', patterns: [/\bspring\s*boot\b/i] },
  { label: 'Go', patterns: [/\bgolang\b/i] },
  { label: 'C#', patterns: [/\bc#\b/i, /\b\.net\b/i] },
  { label: 'Rust', patterns: [/\brust\b/i] },
  { label: 'GraphQL', patterns: [/\bgraphql\b/i] },
  { label: 'REST APIs', patterns: [/\brest(?:ful)?\s*api/i] },
  { label: 'Microservices', patterns: [/\bmicroservices?\b/i] },
  { label: 'Distributed Systems', patterns: [/\bdistributed\s+systems?\b/i] },
  { label: 'AWS', patterns: [/\baws\b/i, /\bamazon\s+web\s+services\b/i] },
  { label: 'GCP', patterns: [/\bgcp\b/i, /\bgoogle\s+cloud\b/i] },
  { label: 'Azure', patterns: [/\bazure\b/i] },
  { label: 'Docker', patterns: [/\bdocker\b/i] },
  { label: 'Kubernetes', patterns: [/\bkubernetes\b/i, /\bk8s\b/i] },
  { label: 'Terraform', patterns: [/\bterraform\b/i] },
  { label: 'CI/CD', patterns: [/\bci\/cd\b/i, /\bjenkins\b/i, /\bgithub\s+actions\b/i] },
  { label: 'Kafka', patterns: [/\bkafka\b/i] },
  { label: 'Spark', patterns: [/\bapache\s+spark\b/i, /\bpyspark\b/i] },
  { label: 'Linux', patterns: [/\blinux\b/i] },
  { label: 'Git', patterns: [/\bgit\b/i] },
  { label: 'Selenium', patterns: [/\bselenium\b/i] },
  { label: 'Playwright', patterns: [/\bplaywright\b/i] },
  { label: 'Cypress', patterns: [/\bcypress\b/i] },
  { label: 'QA Automation', patterns: [/\bqa\s+automation\b/i, /\btest\s+automation\b/i] },
  { label: 'SAP BASIS', patterns: [/\bsap\s+basis\b/i] },
  { label: 'SAP PPQM', patterns: [/\bsap\s+ppqm\b/i, /\bppqm\b/i] },
  { label: 'SAP HANA', patterns: [/\bsap\s+hana\b/i, /\bs\/4hana\b/i] },
  { label: 'Machine Learning', patterns: [/\bmachine\s+learning\b/i, /\bdeep\s+learning\b/i] },
  { label: 'System Design', patterns: [/\bsystem\s+design\b/i, /\bsolution\s+architect/i] },
];

const KNOWN_LOCATIONS: Array<{ match: RegExp; formatted: string }> = [
  { match: /\b(?:bengaluru|bangalore)\b/i, formatted: 'Bengaluru, India' },
  { match: /\bhyderabad\b/i, formatted: 'Hyderabad, India' },
  { match: /\bmumbai\b/i, formatted: 'Mumbai, India' },
  { match: /\bpune\b/i, formatted: 'Pune, India' },
  { match: /\bchennai\b/i, formatted: 'Chennai, India' },
  { match: /\b(?:gurgaon|gurugram)\b/i, formatted: 'Gurugram, India' },
  { match: /\bnoida\b/i, formatted: 'Noida, India' },
  { match: /\b(?:new\s+delhi|delhi\s*ncr|delhi)\b/i, formatted: 'Delhi NCR, India' },
  { match: /\bkolkata\b/i, formatted: 'Kolkata, India' },
  { match: /\bahmedabad\b/i, formatted: 'Ahmedabad, India' },
  { match: /\bremote\b/i, formatted: 'Remote, India' },
];

const ROLE_KEYWORDS =
  /\b(engineer|developer|architect|rearchitect|designer|manager|consultant|lead|director|analyst|specialist|scientist|administrator|dba|devops|sre|qa|tester|full\s*stack|frontend|backend|database)\b/i;

function toTitleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (!word) return '';
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Extracts candidate name and role title from common resume filename conventions:
 * e.g. "shivam Kumar- Senior Database Designer Rearchitect.pdf"
 *   -> { name: "Shivam Kumar", title: "Senior Database Designer Rearchitect" }
 */
export function parseHintsFromFileName(fileName: string): {
  name: string;
  title: string;
} {
  const withoutExt = fileName.replace(/\.[a-zA-Z0-9]+$/, '').trim();
  const cleaned = withoutExt
    .replace(/\b(resume|cv|curriculum\s+vitae|updated|profile|final|v\d+)\b/gi, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split on hyphen / en-dash / pipe
  const dashParts = cleaned
    .split(/\s*[-–|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (dashParts.length >= 2) {
    const first = dashParts[0].replace(/_/g, ' ').trim();
    const rest = dashParts.slice(1).join(' - ').replace(/_/g, ' ').trim();

    if (ROLE_KEYWORDS.test(rest) && !ROLE_KEYWORDS.test(first)) {
      return {
        name: toTitleCase(first),
        title: toTitleCase(rest),
      };
    }
    if (ROLE_KEYWORDS.test(first) && !ROLE_KEYWORDS.test(rest)) {
      return {
        name: toTitleCase(rest),
        title: toTitleCase(first),
      };
    }
    return {
      name: toTitleCase(first),
      title: toTitleCase(rest),
    };
  }

  // Fallback: split on underscores
  const underscoreParts = cleaned
    .split('_')
    .map((p) => p.trim())
    .filter(Boolean);

  if (underscoreParts.length >= 3) {
    const possibleName = underscoreParts.slice(0, 2).join(' ');
    const possibleTitle = underscoreParts.slice(2).join(' ');
    if (ROLE_KEYWORDS.test(possibleTitle)) {
      return {
        name: toTitleCase(possibleName),
        title: toTitleCase(possibleTitle),
      };
    }
  }

  return {
    name: toTitleCase(cleaned.replace(/[_-]/g, ' ')),
    title: '',
  };
}

function inferSkillsFromTitleAndText(title: string, text: string): string[] {
  const combined = `${title}\n${text}`;
  const found = new Set<string>();

  for (const item of CANONICAL_SKILLS) {
    if (item.patterns.some((rx) => rx.test(combined))) {
      found.add(item.label);
    }
  }

  // Additional domain skill inference if title mentions specific domains
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('database') || lowerTitle.includes('dba') || lowerTitle.includes('data')) {
    found.add('Database Design');
    found.add('SQL');
    found.add('PostgreSQL');
    found.add('Data Modeling');
    found.add('Performance Tuning');
  }
  if (lowerTitle.includes('rearchitect') || lowerTitle.includes('architect')) {
    found.add('System Design');
    found.add('Database Architecture');
  }
  if (lowerTitle.includes('frontend') || lowerTitle.includes('react') || lowerTitle.includes('ui')) {
    found.add('TypeScript');
    found.add('React');
    found.add('JavaScript');
  }
  if (lowerTitle.includes('backend') || lowerTitle.includes('full stack') || lowerTitle.includes('fullstack')) {
    found.add('Node.js');
    found.add('TypeScript');
    found.add('PostgreSQL');
    found.add('REST APIs');
  }
  if (lowerTitle.includes('devops') || lowerTitle.includes('cloud') || lowerTitle.includes('sre')) {
    found.add('Docker');
    found.add('Kubernetes');
    found.add('CI/CD');
    found.add('AWS');
  }
  if (lowerTitle.includes('qa') || lowerTitle.includes('test')) {
    found.add('QA Automation');
    found.add('Selenium');
    found.add('Playwright');
  }

  if (found.size === 0) {
    found.add('Problem Solving');
    found.add('System Design');
  }

  return Array.from(found).slice(0, 12);
}

function inferExperienceYears(title: string, text: string): number {
  const expPatterns = [
    /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:overall\s+|total\s+|professional\s+|it\s+)?experience/i,
    /experience\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i,
    /(\d{1,2}(?:\.\d)?)\s*\+\s*(?:years?|yrs?)/i,
  ];
  for (const rx of expPatterns) {
    const m = text.match(rx);
    if (m && m[1]) {
      const val = Number(m[1]);
      if (!Number.isNaN(val) && val >= 0 && val <= 45) {
        return val;
      }
    }
  }

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('principal') || lowerTitle.includes('director') || lowerTitle.includes('vp')) {
    return 12;
  }
  if (lowerTitle.includes('architect') || lowerTitle.includes('rearchitect') || lowerTitle.includes('staff')) {
    return 9;
  }
  if (lowerTitle.includes('senior') || lowerTitle.includes('sr') || lowerTitle.includes('lead')) {
    return 7;
  }
  if (lowerTitle.includes('junior') || lowerTitle.includes('associate') || lowerTitle.includes('intern')) {
    return 2;
  }
  return 4;
}

export function extractStructuredFieldsFromText(
  rawText: string,
  fileName: string
): ParsedCandidateResume {
  const fileHints = parseHintsFromFileName(fileName);
  const text = rawText.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : '';

  // 2. Phone
  const phoneMatch = text.match(
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4,5}/
  );
  let phone = '';
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length >= 10 && digits.replace(/\D/g, '').length <= 13) {
      phone = phoneMatch[0].trim();
    }
  }

  // 3. LinkedIn URL
  const linkedinMatch = text.match(
    /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/i
  ) || text.match(/linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  const linkedin_url = linkedinMatch
    ? linkedinMatch[0].startsWith('http')
      ? linkedinMatch[0]
      : `https://${linkedinMatch[0]}`
    : '';

  // 4. Location
  let location = '';
  for (const loc of KNOWN_LOCATIONS) {
    if (loc.match.test(text)) {
      location = loc.formatted;
      break;
    }
  }
  if (!location) {
    location = 'Hyderabad, India';
  }

  // 5. Full Name & Title
  let full_name = fileHints.name;
  let current_title = fileHints.title;

  if (!current_title) {
    const titleMatch = text.match(
      /\b((?:Senior|Lead|Principal|Staff|Chief|Associate|Junior)?\s*(?:Database|Full\s*Stack|Frontend|Backend|Software|Cloud|DevOps|Data|QA|Test|System|Solution|Platform|Site\s+Reliability)\s+(?:Engineer|Developer|Architect|Rearchitect|Designer|Consultant|Manager|Analyst|Specialist)(?:\s+Rearchitect|\s+Architect)?)\b/i
    );
    if (titleMatch) {
      current_title = toTitleCase(titleMatch[1]);
    }
  }
  if (!current_title) {
    current_title = 'Senior Software Engineer';
  }

  if (!full_name || full_name.length < 2) {
    full_name = 'Candidate';
  }

  // 6. Experience years
  const total_experience_years = inferExperienceYears(current_title, text);

  // 7. Skills
  const skills = inferSkillsFromTitleAndText(current_title, text);

  // 8. Summary
  const summary =
    `${full_name} - ${current_title} with ${total_experience_years}+ years of experience in ${skills
      .slice(0, 5)
      .join(', ')}.`;

  return {
    full_name,
    current_title,
    email,
    phone,
    linkedin_url,
    location,
    total_experience_years,
    skills,
    summary,
    parseSource: text.length > 60 ? 'document_text' : 'filename_and_heuristics',
  };
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

/**
 * Extracts printable text from a file locally in the browser as a fast first pass,
 * then enriches via POST /api/resumes/parse on the server.
 */
export async function parseResumeFile(file: File): Promise<ParsedCandidateResume> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Extract printable ASCII runs locally
  let localAscii = '';
  let currentRun = '';
  for (let i = 0; i < Math.min(bytes.length, 500_000); i++) {
    const code = bytes[i];
    if (code >= 32 && code <= 126) {
      currentRun += String.fromCharCode(code);
    } else {
      if (currentRun.length >= 4) {
        localAscii += currentRun + ' ';
      }
      currentRun = '';
    }
  }
  if (currentRun.length >= 4) localAscii += currentRun;

  const localParsed = extractStructuredFieldsFromText(localAscii, file.name);

  try {
    const base64Data = await arrayBufferToBase64(buffer);
    const res = await fetch('/api/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      }),
    });

    if (res.ok) {
      const serverData = (await res.json()) as { parsed?: Partial<ParsedCandidateResume> };
      const p = serverData.parsed;
      if (p) {
        return {
          full_name: p.full_name || localParsed.full_name,
          current_title: p.current_title || localParsed.current_title,
          email: p.email || localParsed.email,
          phone: p.phone || localParsed.phone,
          linkedin_url: p.linkedin_url || localParsed.linkedin_url,
          location: p.location || localParsed.location,
          total_experience_years:
            typeof p.total_experience_years === 'number' && p.total_experience_years >= 0
              ? p.total_experience_years
              : localParsed.total_experience_years,
          skills:
            Array.isArray(p.skills) && p.skills.length > 0
              ? p.skills
              : localParsed.skills,
          summary: p.summary || localParsed.summary,
          parseSource: p.parseSource || localParsed.parseSource,
        };
      }
    }
  } catch {
    // Fallback to localParsed if server is unreachable
  }

  return localParsed;
}
