/**
 * One labelled field of the authentication forms.
 *
 * A real `<label>`, never a placeholder standing in for one: a placeholder
 * disappears the moment someone starts typing, which is exactly when they
 * need to know what the box is for.
 */
export function Field({
  id,
  name,
  label,
  type,
  autoComplete,
  required,
  hint,
  describedBy,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  required?: boolean;
  hint?: string;
  describedBy?: string;
  defaultValue?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const described = [hintId, describedBy].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-text-secondary text-sm">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        aria-describedby={described}
        className="bg-surface-1 border-border-default text-text-primary focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] outline-none"
      />
      {hint && (
        <p id={hintId} className="text-text-faint text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
