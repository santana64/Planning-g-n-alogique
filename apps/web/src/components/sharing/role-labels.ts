import type { TreeRole } from '@chronolignee/domain';

export const ROLE_NAMES: Record<TreeRole, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EDITOR: 'Éditeur',
  CONTRIBUTOR: 'Contributeur',
  VIEWER: 'Lecteur',
};

/** What each role means, in one line, where a role is chosen. */
export const ROLE_DESCRIPTIONS: Record<TreeRole, string> = {
  OWNER: 'Tout, y compris supprimer l’arbre.',
  ADMIN: 'Gère les membres, les réglages, la publication et l’export.',
  EDITOR: 'Ajoute, corrige, retire et importe.',
  CONTRIBUTOR: 'Ajoute et corrige, sans jamais rien retirer.',
  VIEWER: 'Lit l’arbre tel que ses membres le voient, personnes vivantes comprises.',
};
