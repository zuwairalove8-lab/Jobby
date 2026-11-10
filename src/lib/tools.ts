import type { PermissionLevel } from '../types';

export type ToolCategory = 'research' | 'jobs' | 'resume' | 'browser' | 'mcp' | 'profile';

export interface ToolSpec {
  name: string;
  label: string;
  description: string;
  category: ToolCategory;
  defaultPermission: PermissionLevel;
  /** Tools that can never be auto-approved by a permission row. */
  alwaysAsk?: boolean;
}

/**
 * The server-side tool registry is authoritative; this catalogue drives the
 * permission UI and human-readable step labels. Names must stay in sync with
 * `supabase/functions/agent-chat/index.ts`.
 */
export const TOOL_CATALOG: ToolSpec[] = [
  {
    name: 'get_profile',
    label: 'Read profile',
    description: 'Reads your name, country, skills and career preferences.',
    category: 'profile',
    defaultPermission: 'allow',
  },
  {
    name: 'search_jobs',
    label: 'Search jobs',
    description: 'Searches public job feeds (Remotive, Arbeitnow, Himalayas).',
    category: 'jobs',
    defaultPermission: 'allow',
  },
  {
    name: 'save_job',
    label: 'Save job',
    description: 'Adds a discovered job to your application tracker as Saved.',
    category: 'jobs',
    defaultPermission: 'allow',
  },
  {
    name: 'list_applications',
    label: 'List applications',
    description: 'Reads your tracked applications and their statuses.',
    category: 'jobs',
    defaultPermission: 'allow',
  },
  {
    name: 'update_application_status',
    label: 'Update application',
    description: 'Moves a tracked application to a new stage.',
    category: 'jobs',
    defaultPermission: 'ask',
  },
  {
    name: 'list_resumes',
    label: 'List CVs',
    description: 'Lists your saved CV versions.',
    category: 'resume',
    defaultPermission: 'allow',
  },
  {
    name: 'create_resume_version',
    label: 'Create tailored CV',
    description: 'Saves a new tailored CV version to your CV Studio.',
    category: 'resume',
    defaultPermission: 'ask',
  },
  {
    name: 'generate_cover_letter',
    label: 'Draft cover letter',
    description: 'Drafts a cover letter and saves it with an application.',
    category: 'resume',
    defaultPermission: 'ask',
  },
  {
    name: 'browser_navigate',
    label: 'Browser: navigate',
    description: 'Moves the shared remote browser to a URL.',
    category: 'browser',
    defaultPermission: 'ask',
  },
  {
    name: 'browser_click',
    label: 'Browser: click',
    description: 'Clicks an element in the shared browser.',
    category: 'browser',
    defaultPermission: 'ask',
  },
  {
    name: 'browser_type',
    label: 'Browser: type',
    description: 'Types into a field in the shared browser.',
    category: 'browser',
    defaultPermission: 'ask',
  },
  {
    name: 'browser_screenshot',
    label: 'Browser: screenshot',
    description: 'Captures the current page for you to review.',
    category: 'browser',
    defaultPermission: 'allow',
  },
  {
    name: 'mcp_list_tools',
    label: 'MCP: list tools',
    description: 'Discovers tools on your connected MCP accounts.',
    category: 'mcp',
    defaultPermission: 'allow',
  },
  {
    name: 'mcp_call_tool',
    label: 'MCP: run tool',
    description: 'Runs a tool on a connected account (email, calendar, docs…).',
    category: 'mcp',
    defaultPermission: 'ask',
  },
  {
    name: 'submit_application',
    label: 'Submit application',
    description: 'Final submission to an employer. Always requires your approval.',
    category: 'jobs',
    defaultPermission: 'ask',
    alwaysAsk: true,
  },
];

export const TOOL_BY_NAME = new Map(TOOL_CATALOG.map((t) => [t.name, t]));

export function toolLabel(name: string): string {
  return TOOL_BY_NAME.get(name)?.label ?? name.replace(/_/g, ' ');
}

export function toolCategory(name: string): ToolCategory {
  return TOOL_BY_NAME.get(name)?.category ?? 'mcp';
}
