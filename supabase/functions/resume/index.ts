// resume: tailored CVs and cover letters generated from the user's real profile.
// The model is instructed to never invent facts; the prompt contains only what
// the user recorded, and the result is saved as a new CV version on request.
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

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  kilo: 'https://api.kilo.ai/api/gateway',
};

interface Provider {
  endpoint: string;
  key: string;
  model: string;
  label: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Missing bearer token.' }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(auth.slice(7));
  if (userError || !userData.user) return json({ error: 'Not signed in.' }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const provider = await resolveProvider(userId);
    if (!provider) {
      return json(
        {
          error:
            'No AI provider is configured. Add an OpenRouter key in Agent Manager, or ask the project owner to set OPENROUTER_API_KEY.',
        },
        503,
      );
    }

    if (body.action === 'generate-resume') return await generateResume(body, userId, provider);
    if (body.action === 'cover-letter') return await coverLetter(body, userId, provider);
    return json({ error: `Unknown action "${String(body.action)}".` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Generation failed.' }, 500);
  }
});

/* -------------------------------- provider -------------------------------- */

async function resolveProvider(userId: string): Promise<Provider | null> {
  const { data: providers } = await admin
    .from('ai_providers')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('is_default', { ascending: false })
    .order('fallback_order', { ascending: true });

  for (const provider of providers ?? []) {
    const { data: secret } = await admin
      .from('provider_secrets')
      .select('secret_id')
      .eq('provider_id', provider.id)
      .maybeSingle();
    if (!secret?.secret_id) continue;
    const { data: key } = await admin.rpc('jobby_read_secret', { p_id: secret.secret_id });
    if (typeof key !== 'string' || key.length < 8) continue;
    const endpoint =
      (provider.endpoint as string | null)?.replace(/\/+$/, '') ||
      DEFAULT_ENDPOINTS[provider.kind as string] ||
      '';
    if (!endpoint) continue;
    return {
      endpoint,
      key,
      model: String(provider.model_name),
      label: String(provider.provider_name),
    };
  }

  const serverKey = Deno.env.get('OPENROUTER_API_KEY');
  if (serverKey) {
    return {
      endpoint: 'https://openrouter.ai/api/v1',
      key: serverKey,
      model: Deno.env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openrouter/auto',
      label: 'OpenRouter (server default)',
    };
  }
  return null;
}

async function complete(
  provider: Provider,
  messages: Array<{ role: string; content: string }>,
  options: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const res = await fetch(`${provider.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jobby.app',
      'X-Title': 'JOBBY',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2200,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider ${res.status}: ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (parsed.error?.message) throw new Error(parsed.error.message);
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new Error('The provider returned an empty completion.');
  return content;
}

/* --------------------------------- context -------------------------------- */

async function buildContext(userId: string, jobId?: string) {
  const [{ data: profile }, { data: skills }, { data: resumes }, { data: skillPacks }] =
    await Promise.all([
      admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
      admin.from('user_skills').select('skill_name, proficiency').eq('user_id', userId),
      admin.from('resumes').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(3),
      admin
        .from('skills')
        .select('name, instructions')
        .or(`user_id.eq.${userId},built_in.eq.true`)
        .eq('enabled', true)
        .limit(8),
    ]);

  let job: Record<string, unknown> | null = null;
  if (jobId) {
    const { data } = await admin.from('jobs').select('*').eq('id', jobId).maybeSingle();
    job = data ?? null;
  }

  const facts = {
    profile: profile
      ? {
          full_name: profile.full_name,
          country: profile.country,
          headline: profile.headline,
          years_experience: profile.years_experience,
        }
      : null,
    skills: (skills ?? []).map((s) => `${s.skill_name} (${s.proficiency}/5)`),
    existingCv: resumes?.[0]?.content ?? null,
    previousTitles: (resumes ?? []).map((r) => r.title),
  };

  return {
    facts,
    job,
    rules: (skillPacks ?? []).map((pack) => `${pack.name}: ${pack.instructions}`).join('\n'),
    primary: resumes?.[0] ?? null,
  };
}

function fenceStripped(raw: string): string {
  return raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function safeJsonObject(raw: string): Record<string, unknown> {
  const text = fenceStripped(raw);
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function asStringArray(value: unknown, limit = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 400))
    .slice(0, limit);
}

function normaliseContent(raw: Record<string, unknown>) {
  const contact =
    typeof raw.contact === 'object' && raw.contact !== null
      ? (raw.contact as Record<string, unknown>)
      : {};
  const experience = Array.isArray(raw.experience)
    ? raw.experience
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .slice(0, 12)
        .map((item) => ({
          company: String(item.company ?? '').slice(0, 120),
          title: String(item.title ?? '').slice(0, 120),
          start: item.start ? String(item.start).slice(0, 40) : '',
          end: item.end ? String(item.end).slice(0, 40) : '',
          bullets: asStringArray(item.bullets, 8),
        }))
    : [];
  const education = Array.isArray(raw.education)
    ? raw.education
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .slice(0, 6)
        .map((item) => ({
          institution: String(item.institution ?? '').slice(0, 160),
          qualification: String(item.qualification ?? '').slice(0, 160),
          year: item.year ? String(item.year).slice(0, 20) : '',
        }))
    : [];

  return {
    summary: raw.summary ? String(raw.summary).slice(0, 1200) : '',
    contact: {
      email: contact.email ? String(contact.email).slice(0, 160) : '',
      phone: contact.phone ? String(contact.phone).slice(0, 60) : '',
      location: contact.location ? String(contact.location).slice(0, 120) : '',
      links: asStringArray(contact.links, 4),
    },
    experience,
    education,
    skills: asStringArray(raw.skills, 30),
    certifications: asStringArray(raw.certifications, 12),
  };
}

/* ------------------------------ generate resume ---------------------------- */

async function generateResume(
  body: Record<string, unknown>,
  userId: string,
  provider: Provider,
) {
  const jobId = body.jobId ? String(body.jobId) : undefined;
  const targetRole = body.targetRole ? String(body.targetRole).slice(0, 160) : '';
  const jobDescription = body.jobDescription ? String(body.jobDescription).slice(0, 9000) : '';
  const instructions = body.instructions ? String(body.instructions).slice(0, 2000) : '';
  const saveAsTitle = body.saveAsTitle ? String(body.saveAsTitle).slice(0, 120) : '';

  const { facts, job, rules } = await buildContext(userId, jobId);
  if (!facts.profile?.full_name && !facts.existingCv) {
    return json(
      { error: 'Add your name and skills in Settings before generating a CV.' },
      400,
    );
  }

  const listing = job
    ? `Title: ${job.title}\nCompany: ${job.company}\nRequirements:\n${(job.requirements as string[] | null)?.join('\n') ?? ''}\nDescription:\n${String(job.description ?? '').slice(0, 6000)}`
    : jobDescription
      ? `Target description provided by the user:\n${jobDescription}`
      : 'No specific listing; optimise for the target role named by the user.';

  const system = `You are JOBBY's CV writer. You produce truthful, ATS-friendly CV content.
HARD RULES:
- Use ONLY facts in the user record below. Never invent employers, dates, degrees, certifications, tools or metrics.
- If a section has no data, return an empty array or empty string rather than guessing.
- Mirror the listing's vocabulary only where the user genuinely has that experience.
- Bullets start with a strong verb, one line, no first person, no invented numbers.
${rules ? `\nUSER SKILL PACKS (follow strictly):\n${rules}` : ''}`;

  const user = `USER RECORD (JSON):\n${JSON.stringify(facts)}\n\nTARGET ROLE: ${targetRole || 'the role described below'}\n\nLISTING:\n${listing}\n\nEXTRA INSTRUCTIONS: ${instructions || 'none'}\n\nReturn strict JSON with keys: summary (string), contact {email, phone, location, links[]}, experience [{company,title,start,end,bullets[]}], education [{institution,qualification,year}], skills [string], certifications [string].`;

  const raw = await complete(
    provider,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.25 },
  );

  const content = normaliseContent(safeJsonObject(raw));

  let saved = null;
  if (saveAsTitle) {
    const { data, error } = await admin
      .from('resumes')
      .insert({ user_id: userId, title: saveAsTitle, content })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    saved = data;
  }

  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'create_resume_version',
    action: 'generate',
    status: 'succeeded',
    detail: { provider: provider.label, saved: Boolean(saved), jobId: jobId ?? null },
  });

  return json({
    resume: saved,
    content,
    message: saved
      ? `Saved "${saved.title}" using ${provider.label}. Review every line before sending it.`
      : `Draft generated with ${provider.label}. Review every line before sending it.`,
  });
}

/* -------------------------------- cover letter ----------------------------- */

async function coverLetter(body: Record<string, unknown>, userId: string, provider: Provider) {
  const jobId = body.jobId ? String(body.jobId) : undefined;
  const company = body.company ? String(body.company).slice(0, 160) : '';
  const role = body.role ? String(body.role).slice(0, 160) : '';
  const jobDescription = body.jobDescription ? String(body.jobDescription).slice(0, 9000) : '';
  const instructions = body.instructions ? String(body.instructions).slice(0, 2000) : '';

  const { facts, job, rules } = await buildContext(userId, jobId);
  const listing = job
    ? `Company: ${job.company}\nRole: ${job.title}\nRequirements:\n${(job.requirements as string[] | null)?.join('\n') ?? ''}\nDescription:\n${String(job.description ?? '').slice(0, 5000)}`
    : `Company: ${company || 'the employer'}\nRole: ${role || 'the advertised role'}\nDescription:\n${jobDescription || 'not provided'}`;

  const system = `You write short, specific cover letters for JOBBY.
RULES:
- 180-260 words, four paragraphs maximum, no clichés, no "I am writing to apply".
- Only reference experience that appears in the user record. Never invent achievements or numbers.
- Name the company and role, connect two concrete user facts to two listed requirements, close with a clear next step.
- Plain text only, no markdown, no placeholders like [Company].
${rules ? `\nUSER SKILL PACKS:\n${rules}` : ''}`;

  const user = `USER RECORD:\n${JSON.stringify(facts)}\n\nLISTING:\n${listing}\n\nEXTRA INSTRUCTIONS: ${instructions || 'none'}`;

  const letter = (
    await complete(
      provider,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.4, maxTokens: 900 },
    )
  ).trim();

  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'generate_cover_letter',
    action: 'generate',
    status: 'succeeded',
    detail: { provider: provider.label },
  });

  return json({ letter, message: `Drafted with ${provider.label}. Check every factual claim.` });
}
