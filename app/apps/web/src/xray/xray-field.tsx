import { useEffect, useId, useState, type FormEvent } from "react";
import { strings } from "./strings";

export interface XrayFieldProps {
  input: string;
  onSubmit: (input: string) => void;
  /** A scan is running: the button shows it (and waits). */
  busy?: boolean;
}

export function XrayField({ input, onSubmit, busy = false }: XrayFieldProps) {
  const [value, setValue] = useState(input);
  const id = useId();
  useEffect(() => setValue(input), [input]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }
  return (
    <form className="xray-field" onSubmit={submit}>
      <label className="xray-sr-only" htmlFor={id}>
        {strings.addressLabel}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={strings.placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <button
        type="submit"
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        className={busy ? "is-pending" : undefined}
      >
        {strings.submit}
      </button>
    </form>
  );
}
