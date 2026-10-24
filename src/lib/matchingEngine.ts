import type { Candidate, CandidateMatch, Requirement } from '../types/db';

/**
 * Normalizes a skill or phrase for comparison.
 */
function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s+#./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a raw atomic skill token into clean, readable casing while preserving acronyms.
 */
export function formatAtomicSkillLabel(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^[•·\-–—*]+\s*/, '')
    .replace(/[.;:,]+$/, '')
    .trim();
  if (!trimmed) return '';

  const ACRONYMS: Record<string, string> = {
    ai: 'AI',
    ml: 'ML',
    llm: 'LLM',
    llms: 'LLMs',
    rag: 'RAG',
    nlp: 'NLP',
    genai: 'GenAI',
    iac: 'IaC',
    aws: 'AWS',
    gcp: 'GCP',
    azure: 'Azure',
    sql: 'SQL',
    nosql: 'NoSQL',
    'pl/sql': 'PL/SQL',
    't-sql': 'T-SQL',
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    mongodb: 'MongoDB',
    dynamodb: 'DynamoDB',
    bigquery: 'BigQuery',
    databricks: 'Databricks',
    snowflake: 'Snowflake',
    api: 'API',
    apis: 'APIs',
    rest: 'REST',
    graphql: 'GraphQL',
    'ci/cd': 'CI/CD',
    cicd: 'CI/CD',
    devops: 'DevOps',
    devsecops: 'DevSecOps',
    sre: 'SRE',
    k8s: 'K8s',
    sap: 'SAP',
    ppqm: 'PPQM',
    hana: 'HANA',
    abap: 'ABAP',
    etl: 'ETL',
    elt: 'ELT',
    bi: 'BI',
    qa: 'QA',
    ui: 'UI',
    ux: 'UX',
    arm: 'ARM',
    rbac: 'RBAC',
    iam: 'IAM',
    aks: 'AKS',
    eks: 'EKS',
    gke: 'GKE',
  };

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('evaluation of answer quality') ||
    (lower.includes('latency') && lower.includes('token cost'))
  ) {
    if (lower === 'evaluation of answer quality') return 'LLM Answer Quality Evaluation';
    if (lower === 'latency and token cost' || lower === 'latency & token cost') {
      return 'Latency & Token Optimization';
    }
    if (lower.includes('evaluation of answer quality') && lower.includes('token')) {
      return 'LLM Evaluation & Token Optimization';
    }
  }

  return trimmed
    .split(/\s+/)
    .map((word, idx) => {
      const cleanWord = word.toLowerCase();
      if (ACRONYMS[cleanWord]) return ACRONYMS[cleanWord];
      if (
        idx > 0 &&
        ['of', 'and', 'as', 'in', 'on', 'for', 'to', 'with', 'by', 'or'].includes(cleanWord)
      ) {
        return cleanWord;
      }
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Protected slash tokens that should NOT be split on `/`.
 */
const PROTECTED_SLASH_PATTERNS = [
  /\bci\s*\/\s*cd\b/gi,
  /\bpl\s*\/\s*sql\b/gi,
  /\bs\s*\/\s*4\s*hana\b/gi,
  /\bui\s*\/\s*ux\b/gi,
  /\btcp\s*\/\s*ip\b/gi,
  /\bos\s*\/\s*390\b/gi,
  /\bz\s*\/\s*os\b/gi,
];

/**
 * Splits compound JD skill strings (e.g., separated by `;`, `/`, `,`, `|`, bullets, or `and`)
 * into clean, atomic skill labels.
 */
export function decomposeCompoundSkills(rawSkills: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (candidate: string) => {
    const formatted = formatAtomicSkillLabel(candidate);
    if (!formatted || formatted.length < 2) return;
    const key = formatted.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(formatted);
    }
  };

  for (const rawItem of rawSkills || []) {
    if (!rawItem || typeof rawItem !== 'string') continue;

    let working = rawItem;
    const replacements: Array<{ placeholder: string; original: string }> = [];
    PROTECTED_SLASH_PATTERNS.forEach((pattern, i) => {
      working = working.replace(pattern, (match) => {
        const placeholder = `__SLASH_PROTECTED_${i}__`;
        replacements.push({ placeholder, original: match.replace(/\s*\/\s*/, '/') });
        return placeholder;
      });
    });

    const primaryChunks = working
      .split(/[;|\n\r/]+/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (let chunk of primaryChunks) {
      for (const r of replacements) {
        chunk = chunk.replace(new RegExp(r.placeholder, 'g'), r.original);
      }

      const lowerChunk = chunk.toLowerCase();
      if (
        lowerChunk.startsWith('evaluation of ') &&
        (lowerChunk.includes('latency') || lowerChunk.includes('token'))
      ) {
        pushUnique('LLM Evaluation & Quality');
        pushUnique('Latency & Token Optimization');
        continue;
      }

      const subParts = chunk
        .split(/,|\band\b/i)
        .map((p) => p.trim())
        .filter(Boolean);

      for (const part of subParts) {
        pushUnique(part);
      }
    }
  }

  return result;
}

/**
 * Extracts core technical & domain skills from a JD title and description
 * to supplement decomposed requirement skills.
 */
const JD_SKILL_DETECTORS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Azure AI', pattern: /\bazure\s+ai\b/i },
  { label: 'Microsoft Foundry', pattern: /\b(?:microsoft\s+)?foundry\b/i },
  { label: 'Azure AI Search', pattern: /\bazure\s+(?:ai|cognitive)\s+search\b/i },
  { label: 'Copilot Studio', pattern: /\bcopilot\s+studio\b/i },
  { label: 'Microsoft Bicep', pattern: /\bbicep\b/i },
  { label: 'Infrastructure as Code', pattern: /\binfrastructure\s+as\s+code\b|\biac\b/i },
  { label: 'Azure', pattern: /\bazure\b/i },
  { label: 'AWS', pattern: /\baws\b|\bamazon\s+web\s+services\b/i },
  { label: 'GCP', pattern: /\bgcp\b|\bgoogle\s+cloud\b/i },
  { label: 'Terraform', pattern: /\bterraform\b/i },
  { label: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b|\baks\b|\beks\b/i },
  { label: 'Docker', pattern: /\bdocker\b|\bcontainer/i },
  { label: 'DevSecOps', pattern: /\bdevsecops\b/i },
  { label: 'DevOps', pattern: /\bdevops\b/i },
  { label: 'CI/CD', pattern: /\bci\/cd\b|\bgithub\s+actions\b|\bazure\s+devops\b|\bjenkins\b/i },
  { label: 'Databricks', pattern: /\bdatabricks\b/i },
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'TypeScript', pattern: /\btypescript\b/i },
  { label: 'JavaScript', pattern: /\bjavascript\b/i },
  { label: 'React', pattern: /\breact(?:\.js|js)?\b/i },
  { label: 'Node.js', pattern: /\bnode(?:\.js|js)?\b/i },
  { label: 'Java', pattern: /\bjava\b/i },
  { label: 'C# / .NET', pattern: /\bc#\b|\b\.net\b/i },
  { label: 'PostgreSQL', pattern: /\bpostgres(?:ql)?\b/i },
  { label: 'SQL', pattern: /\bsql\b|\bt-sql\b|\bpl\/sql\b/i },
  { label: 'Database Architecture', pattern: /\bdatabase\s+(?:design|architect|rearchitect)/i },
  { label: 'Data Engineering', pattern: /\bdata\s+engineer(?:ing)?\b|\betl\b|\bdata\s+pipeline/i },
  { label: 'Snowflake', pattern: /\bsnowflake\b/i },
  { label: 'Spark', pattern: /\bspark\b|\bpyspark\b/i },
  { label: 'SAP PPQM', pattern: /\bsap\s+ppqm\b|\bppqm\b/i },
  { label: 'SAP HANA', pattern: /\bsap\s+hana\b|\bs\/4hana\b/i },
  { label: 'SAP BASIS', pattern: /\bsap\s+basis\b/i },
  { label: 'Machine Learning', pattern: /\bmachine\s+learning\b|\bdeep\s+learning\b|\bllm\b|\bgenai\b|\brag\b/i },
  { label: 'Solution Architecture', pattern: /\b(?:solution|cloud|enterprise|foundry|ai)\s+architect(?:ure)?\b/i },
];

/**
 * Domain synonym & capability clusters: maps normalized required skill concepts
 * to equivalent or strongly related resume skills/keywords.
 */
const SKILL_SYNONYM_CLUSTERS: Array<{
  triggers: RegExp[];
  strongEquivalents: RegExp[];
  partialEquivalents: RegExp[];
}> = [
  {
    triggers: [/\bbicep\b/i, /\barm\s+template/i],
    strongEquivalents: [
      /\bbicep\b/i,
      /\barm\s+template/i,
      /\binfrastructure\s+as\s+code\b/i,
      /\biac\b/i,
      /\bterraform\b/i,
    ],
    partialEquivalents: [
      /\bazure\b/i,
      /\bdevsecops\b/i,
      /\bdevops\b/i,
      /\bcloudformation\b/i,
      /\bpulumi\b/i,
      /\bci\/cd\b/i,
    ],
  },
  {
    triggers: [/\binfrastructure\s+as\s+code\b/i, /\biac\b/i],
    strongEquivalents: [
      /\binfrastructure\s+as\s+code\b/i,
      /\biac\b/i,
      /\bterraform\b/i,
      /\bbicep\b/i,
      /\bcloudformation\b/i,
      /\bpulumi\b/i,
      /\bansible\b/i,
      /\bdevsecops\b/i,
      /\bdevops\b/i,
    ],
    partialEquivalents: [/\bci\/cd\b/i, /\bkubernetes\b/i, /\bdocker\b/i, /\bcloud\b/i, /\bazure\b/i, /\baws\b/i],
  },
  {
    triggers: [
      /\bazure\s+ai\b/i,
      /\bfoundry\b/i,
      /\bcopilot\s+studio\b/i,
      /\bazure\s+ai\s+search\b/i,
      /\bcognitive\s+search\b/i,
    ],
    strongEquivalents: [
      /\bazure\s+ai\b/i,
      /\bfoundry\b/i,
      /\bcopilot\b/i,
      /\bopenai\b/i,
      /\bllm\b/i,
      /\bgenai\b/i,
      /\brag\b/i,
      /\bmachine\s+learning\b/i,
      /\bai\s+architect/i,
    ],
    partialEquivalents: [
      /\bazure\b/i,
      /\bcloud\s+architect/i,
      /\bsolution\s+architect/i,
      /\bpython\b/i,
      /\bdata\s+engineer/i,
      /\bdata\s+scien/i,
    ],
  },
  {
    triggers: [
      /\bllm\s+evaluation\b/i,
      /\banswer\s+quality\b/i,
      /\btoken\s+(?:cost|optimization)\b/i,
      /\blatency\b/i,
    ],
    strongEquivalents: [
      /\bllm\b/i,
      /\bgenai\b/i,
      /\bopenai\b/i,
      /\bmachine\s+learning\b/i,
      /\bperformance\s+tuning\b/i,
      /\bobservability\b/i,
      /\bmlops\b/i,
    ],
    partialEquivalents: [
      /\bpython\b/i,
      /\bazure\b/i,
      /\bdata\s+engineer/i,
      /\barchitect\b/i,
      /\bmonitoring\b/i,
      /\bcloud\b/i,
    ],
  },
  {
    triggers: [/\bdevsecops\b/i, /\bdevops\b/i, /\bcloud\s+architect/i, /\bsolution\s+architect/i],
    strongEquivalents: [
      /\bdevsecops\b/i,
      /\bdevops\b/i,
      /\bci\/cd\b/i,
      /\bkubernetes\b/i,
      /\bdocker\b/i,
      /\bterraform\b/i,
      /\bazure\b/i,
      /\baws\b/i,
      /\bgcp\b/i,
      /\bsystem\s+design\b/i,
    ],
    partialEquivalents: [/\blinux\b/i, /\bgit\b/i, /\bmicroservices\b/i],
  },
  {
    triggers: [
      /\bdatabase\s+design/i,
      /\bdatabase\s+architect/i,
      /\brearchitect/i,
      /\bdata\s+model/i,
      /\bpostgresql\b/i,
      /\bsql\b/i,
    ],
    strongEquivalents: [
      /\bpostgresql\b/i,
      /\bsql\b/i,
      /\bpl\/sql\b/i,
      /\boracle\b/i,
      /\bmysql\b/i,
      /\bdatabase\b/i,
      /\bdata\s+model/i,
      /\bdb\b/i,
      /\bdba\b/i,
      /\bsnowflake\b/i,
    ],
    partialEquivalents: [/\betl\b/i, /\bdata\s+warehous/i, /\bdata\s+engineer/i, /\bperformance\s+tuning\b/i],
  },
  {
    triggers: [
      /\bdatabricks\b/i,
      /\bdata\s+engineer/i,
      /\betl\b/i,
      /\bdata\s+pipeline/i,
      /\bspark\b/i,
      /\bsnowflake\b/i,
    ],
    strongEquivalents: [
      /\bdatabricks\b/i,
      /\bdata\s+engineer/i,
      /\betl\b/i,
      /\bspark\b/i,
      /\bpyspark\b/i,
      /\bsnowflake\b/i,
      /\bbigquery\b/i,
      /\bkafka\b/i,
      /\bsql\b/i,
      /\bpython\b/i,
      /\bdata\s+warehous/i,
    ],
    partialEquivalents: [/\bpostgresql\b/i, /\bazure\b/i, /\baws\b/i, /\bgcp\b/i],
  },
];

/**
 * Industry & Technical Domain Clusters for the 20% Domain Match (D) dimension.
 */
const DOMAIN_CLUSTERS: Array<{
  id: string;
  name: string;
  patterns: RegExp[];
  adjacentDomains: string[];
}> = [
  {
    id: 'ai_genai_foundry',
    name: 'AI, GenAI & Agentic Systems',
    patterns: [
      /\bazure\s+ai\b/i,
      /\bfoundry\b/i,
      /\bcopilot\b/i,
      /\bopenai\b/i,
      /\bllm\b/i,
      /\bgenai\b/i,
      /\brag\b/i,
      /\bmachine\s+learning\b/i,
      /\bcognitive\s+search\b/i,
      /\bai\s+search\b/i,
    ],
    adjacentDomains: ['cloud_devsecops_infra', 'data_engineering_lakehouse'],
  },
  {
    id: 'cloud_devsecops_infra',
    name: 'Cloud Infrastructure & DevSecOps',
    patterns: [
      /\bazure\b/i,
      /\baws\b/i,
      /\bgcp\b/i,
      /\bbicep\b/i,
      /\bterraform\b/i,
      /\binfrastructure\s+as\s+code\b/i,
      /\biac\b/i,
      /\bdevsecops\b/i,
      /\bdevops\b/i,
      /\bkubernetes\b/i,
      /\bdocker\b/i,
      /\bci\/cd\b/i,
      /\bcloud\b/i,
    ],
    adjacentDomains: ['ai_genai_foundry', 'software_backend_fullstack'],
  },
  {
    id: 'data_engineering_lakehouse',
    name: 'Data Engineering, Lakehouse & Analytics',
    patterns: [
      /\bdatabricks\b/i,
      /\bspark\b/i,
      /\bpyspark\b/i,
      /\bdata\s+engineer/i,
      /\betl\b/i,
      /\bdata\s+pipeline/i,
      /\bsnowflake\b/i,
      /\bbigquery\b/i,
      /\bkafka\b/i,
      /\bdata\s+warehous/i,
    ],
    adjacentDomains: ['database_rdbms_architecture', 'ai_genai_foundry', 'cloud_devsecops_infra'],
  },
  {
    id: 'database_rdbms_architecture',
    name: 'Database Architecture & RDBMS',
    patterns: [
      /\bpostgresql\b/i,
      /\bsql\b/i,
      /\bpl\/sql\b/i,
      /\boracle\b/i,
      /\bmysql\b/i,
      /\bdatabase\b/i,
      /\brearchitect/i,
      /\bdata\s+model/i,
      /\bdba\b/i,
      /\bperformance\s+tuning\b/i,
    ],
    adjacentDomains: ['data_engineering_lakehouse', 'software_backend_fullstack'],
  },
  {
    id: 'enterprise_erp_sap',
    name: 'Enterprise ERP & SAP',
    patterns: [
      /\bsap\b/i,
      /\bppqm\b/i,
      /\bhana\b/i,
      /\bs\/4hana\b/i,
      /\babap\b/i,
      /\bbasis\b/i,
      /\berp\b/i,
    ],
    adjacentDomains: ['database_rdbms_architecture'],
  },
  {
    id: 'software_backend_fullstack',
    name: 'Software & Distributed Systems Engineering',
    patterns: [
      /\btypescript\b/i,
      /\bjavascript\b/i,
      /\breact\b/i,
      /\bnode(?:\.js|js)?\b/i,
      /\bpython\b/i,
      /\bjava\b/i,
      /\bspring\s*boot\b/i,
      /\bgolang\b/i,
      /\bc#\b/i,
      /\b\.net\b/i,
      /\bmicroservices\b/i,
      /\bdistributed\s+systems\b/i,
      /\brest\s*api/i,
    ],
    adjacentDomains: ['cloud_devsecops_infra', 'database_rdbms_architecture'],
  },
  {
    id: 'qa_test_automation',
    name: 'Quality Engineering & Automation',
    patterns: [
      /\bselenium\b/i,
      /\bplaywright\b/i,
      /\bcypress\b/i,
      /\bqa\s+automation\b/i,
      /\btest\s+automation\b/i,
    ],
    adjacentDomains: ['software_backend_fullstack'],
  },
];

const STOP_WORDS = new Set([
  'and',
  'or',
  'of',
  'the',
  'in',
  'on',
  'for',
  'to',
  'with',
  'as',
  'by',
  'at',
  'from',
  'senior',
  'junior',
  'lead',
  'principal',
  'staff',
  'consultant',
  'specialist',
  'associate',
]);

/**
 * Extracts all normalized text & skill signals from a Candidate record
 * (including `skills`, `current_title`, `summary`, and `parsed_data`).
 */
export function extractCandidateProfileSignals(candidate: Candidate): {
  explicitSkills: string[];
  inferredSkills: string[];
  allSkills: string[];
  corpusText: string;
  titleTokens: Set<string>;
} {
  const rawSkills = Array.isArray(candidate.skills) ? candidate.skills : [];
  const explicitSkills = decomposeCompoundSkills(rawSkills);

  const parsedDataStr = candidate.parsed_data ? JSON.stringify(candidate.parsed_data) : '';
  const corpusText = [
    candidate.current_title || '',
    candidate.summary || '',
    explicitSkills.join(' '),
    parsedDataStr,
  ]
    .join(' ')
    .toLowerCase();

  const inferredSkills: string[] = [];
  const seen = new Set(explicitSkills.map((s) => s.toLowerCase()));

  for (const detector of JD_SKILL_DETECTORS) {
    if (detector.pattern.test(corpusText) && !seen.has(detector.label.toLowerCase())) {
      seen.add(detector.label.toLowerCase());
      inferredSkills.push(detector.label);
    }
  }

  const titleLower = (candidate.current_title || '').toLowerCase();
  if (/\bcloud\b/.test(titleLower) && !seen.has('cloud architecture')) {
    seen.add('cloud architecture');
    inferredSkills.push('Cloud Architecture');
  }
  if (/\bdevsecops\b/.test(titleLower) && !seen.has('devsecops')) {
    seen.add('devsecops');
    inferredSkills.push('DevSecOps');
  }
  if (/\bdevops\b/.test(titleLower) && !seen.has('devops')) {
    seen.add('devops');
    inferredSkills.push('DevOps');
  }
  if (/\barchitect\b/.test(titleLower) && !seen.has('solution architecture')) {
    seen.add('solution architecture');
    inferredSkills.push('Solution Architecture');
  }
  if (/\bdata\s+engineer/i.test(titleLower) && !seen.has('data engineering')) {
    seen.add('data engineering');
    inferredSkills.push('Data Engineering');
  }
  if (/\bdatabase\b/i.test(titleLower) && !seen.has('database architecture')) {
    seen.add('database architecture');
    inferredSkills.push('Database Architecture');
  }

  const titleTokens = new Set(
    normalizeText(candidate.current_title || '')
      .split(' ')
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
  );

  return {
    explicitSkills,
    inferredSkills,
    allSkills: [...explicitSkills, ...inferredSkills],
    corpusText,
    titleTokens,
  };
}

/**
 * Extracts normalized atomic requirement skills from the Requirement's `skills` array,
 * plus core skills mentioned in `title` and `description`.
 */
export function extractRequirementAtomicSkills(
  requirement: Pick<Requirement, 'title' | 'description' | 'skills'>
): string[] {
  const decomposed = decomposeCompoundSkills(requirement.skills || []);
  const seen = new Set(decomposed.map((s) => s.toLowerCase()));

  const titleAndDesc = `${requirement.title || ''} ${requirement.description || ''}`;
  for (const detector of JD_SKILL_DETECTORS) {
    if (detector.pattern.test(requirement.title || '') && !seen.has(detector.label.toLowerCase())) {
      const alreadyCovered = decomposed.some(
        (existing) =>
          existing.toLowerCase().includes(detector.label.toLowerCase()) ||
          detector.label.toLowerCase().includes(existing.toLowerCase())
      );
      if (!alreadyCovered) {
        seen.add(detector.label.toLowerCase());
        decomposed.unshift(detector.label);
      }
    }
  }

  if (decomposed.length === 0 && titleAndDesc.trim()) {
    for (const detector of JD_SKILL_DETECTORS) {
      if (detector.pattern.test(titleAndDesc) && !seen.has(detector.label.toLowerCase())) {
        seen.add(detector.label.toLowerCase());
        decomposed.push(detector.label);
      }
    }
  }

  return decomposed;
}

/**
 * Evaluates a single atomic JD skill against a candidate's profile signals.
 * Returns a credit score in [0, 1] and whether it counts as matched/evidenced.
 */
function evaluateSingleSkillMatch(
  reqSkill: string,
  candidateSignals: ReturnType<typeof extractCandidateProfileSignals>
): { credit: number; matchedLabel: string | null } {
  const normReq = normalizeText(reqSkill);
  if (!normReq) return { credit: 0, matchedLabel: null };

  // 1. Exact or substring match against candidate's explicit or inferred skills
  for (const cSkill of candidateSignals.allSkills) {
    const normCand = normalizeText(cSkill);
    if (!normCand) continue;
    if (normCand === normReq) {
      return { credit: 1.0, matchedLabel: reqSkill };
    }
    if (
      (normCand.length >= 3 && normReq.includes(normCand)) ||
      (normReq.length >= 3 && normCand.includes(normReq))
    ) {
      return { credit: 0.94, matchedLabel: reqSkill };
    }
  }

  // 2. Direct phrase presence in candidate's full resume corpus (summary, title, parsed_data)
  if (normReq.length >= 3 && candidateSignals.corpusText.includes(normReq)) {
    return { credit: 0.95, matchedLabel: reqSkill };
  }

  // 3. Domain synonym & ecosystem cluster equivalence
  for (const cluster of SKILL_SYNONYM_CLUSTERS) {
    const matchesTrigger = cluster.triggers.some((rx) => rx.test(reqSkill));
    if (matchesTrigger) {
      const hasStrong = cluster.strongEquivalents.some((rx) =>
        rx.test(candidateSignals.corpusText)
      );
      if (hasStrong) {
        return { credit: 0.86, matchedLabel: reqSkill };
      }
      const hasPartial = cluster.partialEquivalents.some((rx) =>
        rx.test(candidateSignals.corpusText)
      );
      if (hasPartial) {
        return { credit: 0.68, matchedLabel: reqSkill };
      }
    }
  }

  // 4. Token-level overlap (e.g., "Azure AI Search" vs candidate having "Azure" or "AI")
  const reqTokens = normReq
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  if (reqTokens.length > 0) {
    let matchedTokenCount = 0;
    for (const token of reqTokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tokenRegex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (tokenRegex.test(candidateSignals.corpusText)) {
        matchedTokenCount += 1;
      }
    }
    if (matchedTokenCount > 0) {
      const ratio = matchedTokenCount / reqTokens.length;
      const credit = Math.min(0.85, 0.45 + ratio * 0.45);
      return { credit, matchedLabel: credit >= 0.55 ? reqSkill : null };
    }
  }

  return { credit: 0, matchedLabel: null };
}

/**
 * Dimension 2: Experience Match Score (E, 0–100, Weight 25%)
 */
function computeExperienceScoreAndNote(
  candidateYears: number | null | undefined,
  minYears: number | null | undefined,
  maxYears: number | null | undefined
): { score: number; note: string } {
  const cYears = Number(candidateYears ?? 0);
  const reqMin = Number(minYears ?? 0);
  const reqMax = maxYears !== null && maxYears !== undefined ? Number(maxYears) : null;

  if (reqMin <= 0 && (reqMax === null || reqMax <= 0)) {
    return {
      score: cYears > 0 ? 90 : 75,
      note: `${cYears.toFixed(1)} yrs experience`,
    };
  }

  if (cYears >= reqMin && (reqMax === null || cYears <= reqMax)) {
    return {
      score: 100,
      note: `${cYears.toFixed(1)} yrs within target (${reqMin.toFixed(1)}–${(reqMax ?? reqMin + 5).toFixed(1)} yrs)`,
    };
  }

  if (cYears < reqMin) {
    const deficit = reqMin - cYears;
    const ratio = reqMin > 0 ? Math.max(0, cYears / reqMin) : 0;
    const score = Math.round(Math.max(20, Math.min(95, ratio * 85 + (deficit <= 1.5 ? 10 : 0))));
    return {
      score,
      note: `${cYears.toFixed(1)} yrs vs minimum ${reqMin.toFixed(1)} yrs`,
    };
  }

  const overage = reqMax !== null ? cYears - reqMax : 0;
  const score = Math.round(Math.max(75, 100 - overage * 4));
  return {
    score,
    note: `${cYears.toFixed(1)} yrs (exceeds ${reqMax?.toFixed(1)} yrs range)`,
  };
}

/**
 * Dimension 3: Domain Match Score (D, 0–100, Weight 20%)
 * Evaluates industry, business domain, and project relevance between JD and Candidate Resume.
 */
function computeDomainMatchScore(
  requirement: Pick<Requirement, 'title' | 'description' | 'skills'>,
  candidateSignals: ReturnType<typeof extractCandidateProfileSignals>
): { score: number; matchedDomains: string[] } {
  const jdCorpus = `${requirement.title || ''} ${requirement.description || ''} ${(requirement.skills || []).join(' ')}`.toLowerCase();

  const reqDomains = DOMAIN_CLUSTERS.filter((cluster) =>
    cluster.patterns.some((rx) => rx.test(jdCorpus))
  );
  const candDomains = new Set(
    DOMAIN_CLUSTERS.filter((cluster) =>
      cluster.patterns.some((rx) => rx.test(candidateSignals.corpusText))
    ).map((c) => c.id)
  );

  if (reqDomains.length === 0) {
    return { score: 75, matchedDomains: [] };
  }

  let domainCredits = 0;
  const matchedDomains: string[] = [];

  for (const reqDom of reqDomains) {
    if (candDomains.has(reqDom.id)) {
      domainCredits += 1.0;
      matchedDomains.push(reqDom.name);
    } else if (reqDom.adjacentDomains.some((adj) => candDomains.has(adj))) {
      domainCredits += 0.65;
      matchedDomains.push(`${reqDom.name} (Adjacent)`);
    } else {
      domainCredits += 0.2;
    }
  }

  // Also check JD title keyword overlap in candidate corpus
  const jdTitleTokens = normalizeText(requirement.title || '')
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  let titleHits = 0;
  for (const token of jdTitleTokens) {
    if (candidateSignals.corpusText.includes(token)) {
      titleHits += 1;
    }
  }
  const titleBonus = jdTitleTokens.length > 0 ? (titleHits / jdTitleTokens.length) * 15 : 0;

  const rawScore = (domainCredits / reqDomains.length) * 88 + titleBonus;
  return {
    score: Math.round(Math.max(20, Math.min(100, rawScore))),
    matchedDomains,
  };
}

/**
 * Dimension 4: Seniority Match Score (N, 0–100, Weight 15%)
 * Evaluates role level, responsibility, and seniority alignment.
 */
function inferSeniorityTier(
  text: string,
  years: number | null | undefined
): { tier: number; label: string } {
  const lower = text.toLowerCase();
  const y = Number(years ?? 0);

  if (/\b(architect|principal|staff|director|vp|head|chief)\b/.test(lower) || y >= 10) {
    return { tier: 4, label: 'Architect / Principal' };
  }
  if (/\b(lead|senior|sr\.?|specialist|manager)\b/.test(lower) || y >= 6) {
    return { tier: 3, label: 'Senior / Lead / Specialist' };
  }
  if (/\b(junior|jr\.?|associate|intern|trainee|entry)\b/.test(lower) && y < 3) {
    return { tier: 1, label: 'Junior / Associate' };
  }
  return { tier: 2, label: 'Mid-Level Engineer / Consultant' };
}

function computeSeniorityMatchScore(
  requirement: Pick<Requirement, 'title' | 'description'> & {
    min_experience?: number | null;
    max_experience?: number | null;
  },
  candidate: Candidate
): { score: number; label: string } {
  const reqTargetYears =
    requirement.min_experience !== null && requirement.min_experience !== undefined
      ? Number(requirement.min_experience)
      : 4;
  const jdSeniority = inferSeniorityTier(
    `${requirement.title || ''} ${requirement.description || ''}`,
    reqTargetYears
  );
  const candSeniority = inferSeniorityTier(
    `${candidate.current_title || ''} ${candidate.summary || ''}`,
    candidate.total_experience_years
  );

  const tierDiff = Math.abs(jdSeniority.tier - candSeniority.tier);
  let score = 80;
  if (tierDiff === 0) {
    score = 95;
  } else if (tierDiff === 1) {
    // Candidate 1 tier above or below target
    score = candSeniority.tier > jdSeniority.tier ? 88 : 78;
  } else if (tierDiff === 2) {
    score = 58;
  } else {
    score = 40;
  }

  // Refine with experience proximity to target range
  const cYears = Number(candidate.total_experience_years ?? 0);
  if (reqTargetYears > 0) {
    if (cYears >= reqTargetYears) {
      score = Math.min(100, score + 5);
    } else if (reqTargetYears - cYears <= 1.5) {
      score = Math.max(70, score - 4);
    } else if (reqTargetYears - cYears > 3) {
      score = Math.max(35, score - 12);
    }
  }

  return {
    score: Math.round(Math.max(25, Math.min(100, score))),
    label: candSeniority.label,
  };
}

export interface DimensionBreakdown {
  skills: { score: number; weight: 0.4; contribution: number };
  experience: { score: number; weight: 0.25; contribution: number };
  domain: { score: number; weight: 0.2; contribution: number };
  seniority: { score: number; weight: 0.15; contribution: number };
}

export interface FineTunedMatchResult {
  skill_score: number;
  experience_score: number;
  domain_score: number;
  seniority_score: number;
  computed_score: number;
  final_score: number;
  matched_skills: string[];
  unproven_skills: string[];
  experience_note: string;
  dimensions: DimensionBreakdown;
}

/**
 * 4-Dimension Weighted Matching Engine:
 *   Match Score = 0.40 * S + 0.25 * E + 0.20 * D + 0.15 * N
 * Where:
 *   S = Skills match score out of 100 (40%)
 *   E = Experience match score out of 100 (25%)
 *   D = Domain match score out of 100 (20%)
 *   N = Seniority match score out of 100 (15%)
 */
export function computeFineTunedCandidateMatch(
  requirement: Pick<Requirement, 'id' | 'title' | 'description' | 'skills'> & {
    min_experience?: number | null;
    max_experience?: number | null;
    min_experience_years?: number | null;
    max_experience_years?: number | null;
  },
  candidate: Candidate,
  existingMatch?: Partial<CandidateMatch> | null
): FineTunedMatchResult {
  const atomicReqSkills = extractRequirementAtomicSkills(requirement);
  const candidateSignals = extractCandidateProfileSignals(candidate);

  const matchedSkills: string[] = [];
  const unprovenSkills: string[] = [];
  let totalSkillCredit = 0;

  for (const reqSkill of atomicReqSkills) {
    const { credit, matchedLabel } = evaluateSingleSkillMatch(reqSkill, candidateSignals);
    totalSkillCredit += credit;
    if (matchedLabel && credit >= 0.5) {
      matchedSkills.push(matchedLabel);
    } else {
      unprovenSkills.push(reqSkill);
    }
  }

  // Surface any explicit resume skills that appear in the JD title/description
  const jdCorpus = `${requirement.title || ''} ${requirement.description || ''}`.toLowerCase();
  let extraResumeSkillMatches = 0;
  for (const cSkill of candidateSignals.explicitSkills) {
    const lowerC = cSkill.toLowerCase();
    if (
      lowerC.length >= 2 &&
      jdCorpus.includes(lowerC) &&
      !matchedSkills.some((m) => m.toLowerCase() === lowerC)
    ) {
      extraResumeSkillMatches += 1;
      if (matchedSkills.length < 8) {
        matchedSkills.push(cSkill);
      }
    }
  }

  // 1. S = Skills Match Score (0–100, Weight 40%)
  const baseSkillScore =
    atomicReqSkills.length > 0 ? (totalSkillCredit / atomicReqSkills.length) * 100 : 50;
  const skillBonus = Math.min(12, extraResumeSkillMatches * 4);
  const skillScore = Math.round(Math.max(0, Math.min(100, baseSkillScore + skillBonus)));

  // 2. E = Experience Match Score (0–100, Weight 25%)
  const minExp = requirement.min_experience ?? requirement.min_experience_years ?? 0;
  const maxExp = requirement.max_experience ?? requirement.max_experience_years ?? null;
  const { score: experienceScore, note: experienceNote } = computeExperienceScoreAndNote(
    candidate.total_experience_years,
    minExp,
    maxExp
  );

  // 3. D = Domain Match Score (0–100, Weight 20%)
  const { score: domainScore } = computeDomainMatchScore(requirement, candidateSignals);

  // 4. N = Seniority Match Score (0–100, Weight 15%)
  const { score: seniorityScore } = computeSeniorityMatchScore(
    {
      title: requirement.title,
      description: requirement.description,
      min_experience: minExp,
      max_experience: maxExp,
    },
    candidate
  );

  // Contributions: 0.40*S + 0.25*E + 0.20*D + 0.15*N
  const skillsContribution = Number((skillScore * 0.4).toFixed(2));
  const experienceContribution = Number((experienceScore * 0.25).toFixed(2));
  const domainContribution = Number((domainScore * 0.2).toFixed(2));
  const seniorityContribution = Number((seniorityScore * 0.15).toFixed(2));

  const computedScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        skillsContribution +
          experienceContribution +
          domainContribution +
          seniorityContribution
      )
    )
  );

  const overrideScore =
    existingMatch?.override_score !== undefined ? existingMatch.override_score : null;
  const finalScore =
    overrideScore !== null && overrideScore !== undefined ? overrideScore : computedScore;

  return {
    skill_score: skillScore,
    experience_score: experienceScore,
    domain_score: domainScore,
    seniority_score: seniorityScore,
    computed_score: computedScore,
    final_score: finalScore,
    matched_skills: matchedSkills,
    unproven_skills: unprovenSkills,
    experience_note: experienceNote,
    dimensions: {
      skills: { score: skillScore, weight: 0.4, contribution: skillsContribution },
      experience: { score: experienceScore, weight: 0.25, contribution: experienceContribution },
      domain: { score: domainScore, weight: 0.2, contribution: domainContribution },
      seniority: { score: seniorityScore, weight: 0.15, contribution: seniorityContribution },
    },
  };
}
