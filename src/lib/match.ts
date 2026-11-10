import type { MatchResult } from '../types';

/**
 * Transparent, deterministic job-match scoring.
 *
 * Weights:
 *   required skills   60 points
 *   preferred skills  20 points
 *   eligibility       20 points
 *
 * Scoring is intentionally explainable: every point is traceable to a matched
 * or missing keyword, and the edge function mirrors this exact algorithm so the
 * UI and the agent never disagree.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'will', 'have', 'has', 'this',
  'that', 'from', 'not', 'but', 'all', 'any', 'can', 'may', 'must', 'able', 'ability', 'work',
  'working', 'role', 'job', 'team', 'teams', 'plus', 'etc', 'years', 'year', 'experience',
  'knowledge', 'using', 'use', 'good', 'strong', 'excellent', 'required', 'preferred',
]);

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(singularize);
}

function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

function skillMatches(skill: string, requirement: string): boolean {
  const a = tokenize(skill);
  const b = tokenize(requirement);
  if (a.length === 0 || b.length === 0) return false;
  // A skill counts as present if every meaningful token appears in the
  // requirement, or the raw strings contain each other (e.g. "SQL" vs "PostgreSQL").
  const joinedA = a.join(' ');
  const joinedB = b.join(' ');
  if (joinedB.includes(joinedA) || joinedA.includes(joinedB)) return true;
  if (a.every((token) => b.includes(token))) return true;
  // Compound tech names: "PostgreSQL" satisfies a "SQL" requirement and vice
  // versa. Only compare tokens of 3+ characters so short noise cannot match.
  return a.some((token) =>
    token.length >= 3 &&
    b.some(
      (reqToken) =>
        reqToken.length >= 3 &&
        (token.includes(reqToken) || reqToken.includes(token)),
    ),
  );
}

export interface MatchInput {
  skills: string[];
  requirements: string[];
  preferred?: string[];
  age?: number | null;
  minAge?: number | null;
  country?: string | null;
  jobCountry?: string | null;
  remote?: boolean;
  maxAge?: number | null;
}

export function computeMatch(input: MatchInput): MatchResult {
  const skills = input.skills.filter((s) => s.trim().length > 0);
  const requirements = input.requirements.filter((r) => r.trim().length > 0);
  const preferred = (input.preferred ?? []).filter((r) => r.trim().length > 0);

  const matched: string[] = [];
  const missing: string[] = [];

  for (const req of requirements) {
    const hit = skills.find((skill) => skillMatches(skill, req));
    if (hit) matched.push(`${hit} → ${req}`);
    else missing.push(req);
  }

  const preferredHits = preferred.filter((p) => skills.some((s) => skillMatches(s, p)));
  const preferredMissing = preferred.filter((p) => !preferredHits.includes(p));

  const requiredScore =
    requirements.length === 0 ? 1 : (requirements.length - missing.length) / requirements.length;
  const preferredScore =
    preferred.length === 0 ? 1 : preferredHits.length / preferred.length;

  const notes: string[] = [];
  let eligible: boolean | null = null;
  let eligibilityScore = 1;

  if (input.minAge != null && input.age != null) {
    eligible = input.age >= input.minAge && (input.maxAge == null || input.age <= input.maxAge);
    if (!eligible) {
      eligibilityScore = 0;
      notes.push(
        `Age eligibility: role requires ${input.minAge}${input.maxAge ? `–${input.maxAge}` : '+'}, profile lists ${input.age}.`,
      );
    }
  }
  if (input.maxAge != null && input.age != null && eligible !== false) {
    if (input.age > input.maxAge) {
      eligible = false;
      eligibilityScore = 0;
      notes.push(`Age eligibility: role is capped at ${input.maxAge}, profile lists ${input.age}.`);
    }
  }

  const countryKnown = Boolean(input.country && input.jobCountry);
  if (countryKnown && !input.remote) {
    const sameCountry =
      input.country!.toLowerCase().trim() === input.jobCountry!.toLowerCase().trim();
    if (!sameCountry) {
      eligibilityScore = Math.min(eligibilityScore, 0.5);
      notes.push(
        `Location: listing is in ${input.jobCountry} while your profile country is ${input.country}. Confirm work authorisation.`,
      );
      if (eligible === null) eligible = false;
    }
  }
  if (input.remote && countryKnown) {
    notes.push('Remote role — confirm the employer hires in your country.');
  }

  const score = Math.round(
    requiredScore * 60 + preferredScore * 20 + eligibilityScore * 20,
  );

  if (requirements.length === 0) {
    notes.push('This listing has no structured requirements; score reflects eligibility only.');
  }
  if (preferredMissing.length > 0) {
    notes.push(`Preferred but not on your profile: ${preferredMissing.slice(0, 5).join(', ')}.`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    matched,
    missing,
    notes,
    eligible,
  };
}

/** Rough age in years from an ISO date string. */
export function ageFromDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
