// Pre-filled role templates for the Setup screen (design.md §7 — recruiter
// edits rather than types from scratch, for demo speed / R9's ≤3-step bar).

export interface RoleTemplate {
  id: string;
  title: string;
  focusAreas: string[];
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: 'software-engineer',
    title: 'Software Engineer',
    focusAreas: ['System design', 'Data structures & algorithms', 'Debugging', 'Code quality'],
  },
  {
    id: 'product-manager',
    title: 'Product Manager',
    focusAreas: ['Prioritization', 'Metrics & analytics', 'Stakeholder communication', 'User research'],
  },
  {
    id: 'data-scientist',
    title: 'Data Scientist',
    focusAreas: ['Statistical modeling', 'Experimentation', 'Data pipelines', 'Communicating insights'],
  },
  {
    id: 'custom',
    title: '',
    focusAreas: [],
  },
];
