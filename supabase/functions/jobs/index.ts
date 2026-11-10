// jobs: live search across public job feeds plus the transparent match scorer.
// Only real feed responses are returned; unavailability is reported per source.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface NormalisedJob {
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  source: string;
  external_id: string;
  job_url: string | null;
  description: string | null;
  requirements: string[];
  tags: string[];
  salary: string | null;
  remote: boolean;
  deadline: string | null;
  posted_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Missing bearer token.' }, 401);
  const token = auth.slice(7);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Not signed in.' }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    if (body.action === 'search') return await search(body, userId);
    if (body.action === 'match') return await match(String(body.jobId ?? ''), userId);
    return json({ error: `Unknown action "${String(body.action)}".` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Job request failed.' }, 500);
  }
});

/* --------------------------------- search --------------------------------- */

async function search(body: Record<string, unknown>, userId: string) {
  const query = String(body.query ?? '').trim();
  const country = String(body.country ?? '').trim();
  const category = String(body.category ?? 'all');
  const remoteOnly = Boolean(body.remoteOnly);
  const limit = Math.min(Math.max(Number(body.limit ?? 24), 1), 60);

  const results = await Promise.allSettled([fetchRemotive(query), fetchArbeitnow(query), fetchHimalayas(query)]);
  const sources: { source: string; count: number; error?: string }[] = [];
  const collected: NormalisedJob[] = [];

  const names = ['Remotive', 'Arbeitnow', 'Himalayas'];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      collected.push(...result.value);
      sources.push({ source: names[index]!, count: result.value.length });
    } else {
      sources.push({
        source: names[index]!,
        count: 0,
        error: result.reason instanceof Error ? result.reason.message : 'Feed unavailable',
      });
    }
  });

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const filtered = collected.filter((job) => {
    if (remoteOnly && !job.remote) return false;
    if (country && !job.remote) {
      const haystack = `${job.location ?? ''} ${job.country ?? ''}`.toLowerCase();
      if (!haystack.includes(country.toLowerCase())) return false;
    }
    if (category !== 'all') {
      const haystack = `${job.title} ${job.tags.join(' ')} ${job.description ?? ''}`.toLowerCase();
      const matched =
        category === 'remote'
          ? job.remote
          : category === 'internship'
            ? /intern|graduate|trainee/.test(haystack)
            : category === 'training'
              ? /training|apprentice|bootcamp/.test(haystack)
              : category === 'entry'
                ? /entry.level|junior|graduate|no experience/.test(haystack)
                : haystack.includes(category);
      if (!matched) return false;
    }
    if (terms.length > 0) {
      const haystack = `${job.title} ${job.company} ${job.tags.join(' ')}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });

  const seen = new Set<string>();
  const unique = filtered.filter((job) => {
    const key = `${job.source}:${job.external_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const shortlist = unique.slice(0, limit);
  if (shortlist.length > 0) {
    const { error } = await admin.from('jobs').upsert(
      shortlist.map((job) => ({
        ...job,
        requirements: job.requirements,
        tags: job.tags,
      })),
      { onConflict: 'source,external_id', ignoreDuplicates: false },
    );
    if (error) {
      sources.push({ source: 'database', count: 0, error: error.message });
    }
  }

  const keys = shortlist.map((job) => job.external_id);
  const { data: saved } = keys.length
    ? await admin.from('jobs').select('*').in('external_id', keys).limit(limit)
    : { data: [] };

  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'search_jobs',
    action: 'feed-search',
    status: 'succeeded',
    detail: { query, country, category, returned: shortlist.length },
  });

  return json({ jobs: saved ?? [], sources });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Pull requirement-like lines out of the listing text. Heuristic, never invented. */
function extractRequirements(text: string): string[] {
  if (!text) return [];
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^[•\-*\s]+/, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 220);
  const scored = lines
    .map((line) => ({
      line,
      score:
        (/require|must have|essential|qualification|experience with|proficien|knowledge of|degree|years/i.test(line)
          ? 2
          : 0) + (/^[A-Z]/.test(line) ? 1 : 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((entry) => entry.line.replace(/\.$/, ''));
  return [...new Set(scored)];
}

async function fetchJson(url: string, timeoutMs = 9000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'JOBBY/1.0 (+https://jobby.app)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemotive(query: string): Promise<NormalisedJob[]> {
  const url = new URL('https://remotive.com/api/remote-jobs');
  url.searchParams.set('limit', '60');
  if (query) url.searchParams.set('search', query);
  const data = (await fetchJson(url.toString())) as {
    jobs?: Array<Record<string, unknown>>;
  };
  return (data.jobs ?? []).map((raw) => {
    const description = stripHtml(String(raw.description ?? ''));
    return {
      title: String(raw.title ?? 'Untitled role'),
      company: String(raw.company_name ?? 'Unknown company'),
      location: raw.candidate_required_location ? String(raw.candidate_required_location) : null,
      country: null,
      source: 'Remotive',
      external_id: String(raw.id ?? raw.url ?? crypto.randomUUID()),
      job_url: raw.url ? String(raw.url) : null,
      description: description.slice(0, 12000),
      requirements: extractRequirements(description),
      tags: [raw.category, raw.job_type].filter((v): v is string => typeof v === 'string' && v.length > 0),
      salary: raw.salary ? String(raw.salary) : null,
      remote: true,
      deadline: null,
      posted_at: raw.publication_date ? new Date(String(raw.publication_date)).toISOString() : null,
    } satisfies NormalisedJob;
  });
}

async function fetchArbeitnow(query: string): Promise<NormalisedJob[]> {
  const data = (await fetchJson('https://www.arbeitnow.com/api/job-board-api')) as {
    data?: Array<Record<string, unknown>>;
  };
  const jobs = (data.data ?? []).map((raw) => {
    const description = stripHtml(String(raw.description ?? ''));
    return {
      title: String(raw.title ?? 'Untitled role'),
      company: String(raw.company_name ?? 'Unknown company'),
      location: raw.location ? String(raw.location) : null,
      country: null,
      source: 'Arbeitnow',
      external_id: String(raw.slug ?? raw.url ?? crypto.randomUUID()),
      job_url: raw.url ? String(raw.url) : null,
      description: description.slice(0, 12000),
      requirements: extractRequirements(description),
      tags: (Array.isArray(raw.tags) ? raw.tags : []).map(String).slice(0, 8),
      salary: null,
      remote: Boolean(raw.remote),
      deadline: null,
      posted_at: raw.created_at ? new Date(Number(raw.created_at) * 1000).toISOString() : null,
    } satisfies NormalisedJob;
  });
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const filtered = terms.length
    ? jobs.filter((job) => {
        const haystack = `${job.title} ${job.company} ${job.tags.join(' ')}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      })
    : jobs;
  return filtered.slice(0, 60);
}

async function fetchHimalayas(query: string): Promise<NormalisedJob[]> {
  const url = new URL('https://himalayas.app/jobs/api');
  url.searchParams.set('limit', '50');
  if (query) url.searchParams.set('q', query);
  const data = (await fetchJson(url.toString())) as {
    jobs?: Array<Record<string, unknown>>;
  };
  return (data.jobs ?? []).map((raw) => {
    const description = stripHtml(String(raw.description ?? ''));
    const locations = Array.isArray(raw.locationRestrictions)
      ? raw.locationRestrictions.map(String)
      : [];
    return {
      title: String(raw.title ?? 'Untitled role'),
      company: String(raw.companyName ?? raw.company_name ?? 'Unknown company'),
      location: locations[0] ?? (raw.location ? String(raw.location) : null),
      country: locations[0] ?? null,
      source: 'Himalayas',
      external_id: String(raw.guid ?? raw.applicationLink ?? crypto.randomUUID()),
      job_url: raw.applicationLink ? String(raw.applicationLink) : null,
      description: description.slice(0, 12000),
      requirements: extractRequirements(description),
      tags: (Array.isArray(raw.categories) ? raw.categories : []).map(String).slice(0, 8),
      salary:
        raw.minSalary || raw.maxSalary
          ? `${raw.currency ?? ''} ${raw.minSalary ?? ''}–${raw.maxSalary ?? ''}`.trim()
          : null,
      remote: true,
      deadline: raw.expiryDate ? new Date(String(raw.expiryDate)).toISOString().slice(0, 10) : null,
      posted_at: raw.pubDate ? new Date(Number(raw.pubDate) * 1000).toISOString() : null,
    } satisfies NormalisedJob;
  });
}

/* ---------------------------------- match --------------------------------- */

const STOPWORDS = new Set([
  'the','and','for','with','you','your','our','are','will','have','has','this','that','from','not',
  'but','all','any','can','may','must','able','ability','work','working','role','job','team','teams',
  'plus','etc','years','year','experience','knowledge','using','use','good','strong','excellent',
  'required','preferred',
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((word) => {
      if (word.length <= 3) return word;
      if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
      if (word.endsWith('sses')) return word.slice(0, -2);
      if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
      return word;
    });
}

function skillMatches(skill: string, requirement: string): boolean {
  const a = tokenize(skill);
  const b = tokenize(requirement);
  if (a.length === 0 || b.length === 0) return false;
  const joinedA = a.join(' ');
  const joinedB = b.join(' ');
  if (joinedB.includes(joinedA) || joinedA.includes(joinedB)) return true;
  if (a.every((token) => b.includes(token))) return true;
  return a.some(
    (token) =>
      token.length >= 3 &&
      b.some(
        (reqToken) =>
          reqToken.length >= 3 && (token.includes(reqToken) || reqToken.includes(token)),
      ),
  );
}

function ageFrom(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

async function match(jobId: string, userId: string) {
  if (!jobId) return json({ error: 'jobId is required.' }, 400);

  const [{ data: job }, { data: profile }, { data: skills }] = await Promise.all([
    admin.from('jobs').select('*').eq('id', jobId).maybeSingle(),
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('user_skills').select('skill_name').eq('user_id', userId),
  ]);
  if (!job) return json({ error: 'Job not found.' }, 404);

  const skillNames: string[] = (skills ?? []).map((row) => String(row.skill_name));
  const requirements: string[] = Array.isArray(job.requirements) ? job.requirements : [];
  const preferred = (Array.isArray(job.tags) ? job.tags : []).slice(0, 8).map(String);
  const eligibility = (job.eligibility ?? {}) as { minAge?: number; maxAge?: number };

  const matched: string[] = [];
  const missing: string[] = [];
  for (const requirement of requirements) {
    const hit = skillNames.find((skill) => skillMatches(skill, requirement));
    if (hit) matched.push(`${hit} → ${requirement}`);
    else missing.push(requirement);
  }
  const preferredHits = preferred.filter((tag) => skillNames.some((skill) => skillMatches(skill, tag)));
  const preferredMissing = preferred.filter((tag) => !preferredHits.includes(tag));

  const requiredScore = requirements.length === 0 ? 1 : (requirements.length - missing.length) / requirements.length;
  const preferredScore = preferred.length === 0 ? 1 : preferredHits.length / preferred.length;

  const notes: string[] = [];
  let eligible: boolean | null = null;
  let eligibilityScore = 1;
  const age = ageFrom(profile?.date_of_birth ? String(profile.date_of_birth) : null);

  if (eligibility.minAge != null && age != null) {
    eligible = age >= eligibility.minAge && (eligibility.maxAge == null || age <= eligibility.maxAge);
    if (!eligible) {
      eligibilityScore = 0;
      notes.push(`Age eligibility: role requires ${eligibility.minAge}+, profile lists ${age}.`);
    } else {
      notes.push('Age requirement appears satisfied from your profile date of birth.');
    }
  }

  const profileCountry = profile?.country ? String(profile.country) : null;
  const jobCountry = job.country ?? job.location;
  if (profileCountry && jobCountry && !job.remote) {
    const same = profileCountry.toLowerCase().trim() === String(jobCountry).toLowerCase().trim();
    if (!same) {
      eligibilityScore = Math.min(eligibilityScore, 0.5);
      notes.push(`Location: listing is in ${jobCountry} while your profile country is ${profileCountry}. Confirm work authorisation.`);
      if (eligible === null) eligible = false;
    }
  }
  if (job.remote) notes.push('Remote role — confirm the employer hires in your country.');

  if (requirements.length === 0) {
    notes.push('This listing has no structured requirements; score reflects eligibility only. Add detail to your profile to sharpen it.');
  }
  if (preferredMissing.length > 0) {
    notes.push(`Preferred but not on your profile: ${preferredMissing.slice(0, 5).join(', ')}.`);
  }
  if (missing.length > 0) {
    notes.push(`${missing.length} required item(s) are missing from your profile — do not claim them in an application.`);
  }

  const score = Math.max(
    0,
    Math.min(100, Math.round(requiredScore * 60 + preferredScore * 20 + eligibilityScore * 20)),
  );

  const explanation = { matched, missing, notes, eligible };
  await admin.from('job_matches').upsert(
    { user_id: userId, job_id: jobId, match_score: score, explanation },
    { onConflict: 'user_id,job_id' },
  );
  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'match_job',
    action: 'score',
    status: 'succeeded',
    detail: { jobId, score },
  });

  return json({ score, ...explanation });
}
