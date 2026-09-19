/**
 * The state of a story selection request, shared by the action and the form.
 *
 * In its own module because a 'use server' file may only export async
 * functions: a constant exported from one breaks the build.
 */

export type StoryChoiceState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'chosen';
      /** Who chose: the provider's own label. */
      readonly label: string;
      /** A model chose, and any sentence shown is the model's. */
      readonly byModel: boolean;
      readonly selections: readonly {
        readonly candidateId: string;
        readonly angle: string | null;
      }[];
    };

export const STORY_CHOICE_IDLE: StoryChoiceState = { status: 'idle' };
