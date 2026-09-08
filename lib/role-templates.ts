// Pre-filled role templates for the Setup screen (design.md §7 — recruiter
// edits rather than types from scratch, for demo speed / R9's ≤3-step bar).

import type { PersonaId } from './personas';

export interface RoleTemplate {
  id: string;
  title: string;
  /** Default focus areas per panelist — bucketed by which persona's lane they fall in. */
  personaFocusAreas: Record<PersonaId, string[]>;
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: 'software-engineer',
    title: 'Software Engineer',
    personaFocusAreas: {
      technical: ['System design', 'Data structures & algorithms', 'Debugging', 'Code quality'],
      product: ['Trade-off decisions'],
      behavioral: ['Collaboration & ownership'],
    },
  },
  {
    id: 'product-manager',
    title: 'Product Manager',
    personaFocusAreas: {
      technical: [],
      product: ['Prioritization', 'Metrics & analytics', 'User research'],
      behavioral: ['Stakeholder communication'],
    },
  },
  {
    id: 'data-scientist',
    title: 'Data Scientist',
    personaFocusAreas: {
      technical: ['Statistical modeling', 'Experimentation', 'Data pipelines'],
      product: ['Communicating insights'],
      behavioral: [],
    },
  },
  {
    id: 'custom',
    title: '',
    personaFocusAreas: { technical: [], product: [], behavioral: [] },
  },
];
