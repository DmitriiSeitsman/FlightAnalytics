"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  detail?: string;
  keywords?: string;
};

const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  emptyText = "Ничего не найдено",
  disabled = false,
}: {
  label: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const search = normalize(query);
    if (!search) return options;
    return options.filter((option) => normalize(`${option.label} ${option.detail ?? ""} ${option.keywords ?? ""}`).includes(search));
  }, [options, query]);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  const select = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };
  const show = () => {
    if (disabled) return;
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  };

  return <div className={`live-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`} ref={rootRef}>
    <label htmlFor={`${id}-input`}><span>{label}</span></label>
    <div className="live-select-control">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="6.7" cy="6.7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="m10 10 3.3 3.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      <input
        id={`${id}-input`}
        ref={inputRef}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={show}
        onClick={show}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }
          if (event.key === "ArrowDown" && filtered.length) { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(filtered.length - 1, current + 1)); return; }
          if (event.key === "ArrowUp" && filtered.length) { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); return; }
          if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); select(filtered[activeIndex].value); }
        }}
      />
      <button type="button" className="live-select-toggle" disabled={disabled} onClick={() => { if (open) setOpen(false); else { show(); inputRef.current?.focus(); } }} aria-label={open ? "Закрыть список" : "Открыть список"} aria-expanded={open}>
        <svg viewBox="0 0 12 8" width="10" height="7" aria-hidden="true"><path d="m1 1.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
    {open && <div className="live-select-menu" id={`${id}-listbox`} role="listbox" aria-label={label}>
      <div className="live-select-status">{query ? `Найдено: ${filtered.length}` : `Доступно: ${options.length}`}</div>
      <div className="live-select-options">
        {filtered.map((option, index) => <button
          type="button"
          id={`${id}-option-${index}`}
          role="option"
          aria-selected={option.value === value}
          className={`${option.value === value ? "is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
          key={option.value}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => select(option.value)}
        >
          <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
          {option.value === value && <i aria-hidden="true">✓</i>}
        </button>)}
        {!filtered.length && <p>{emptyText}<small>Попробуйте изменить запрос</small></p>}
      </div>
    </div>}
  </div>;
}
