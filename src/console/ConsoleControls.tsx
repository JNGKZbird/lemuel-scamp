import { useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

export type SegmentOption<T extends string | number> = {
  value: T;
  label: string;
};

type Props<T extends string | number> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
};

export function VisibilityToggle({
  visible,
  label,
  disabled = false,
  onChange,
}: {
  visible: boolean;
  label: string;
  disabled?: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      aria-label={label}
      disabled={disabled}
      className={`console-visibility${visible ? " is-on" : ""}`}
      onClick={() => onChange(!visible)}
    >
      <span className="console-visibility__track" aria-hidden="true">
        <span className="console-visibility__thumb" />
      </span>
      <span className="console-visibility__label">
        {visible ? "显示" : "隐藏"}
      </span>
    </button>
  );
}

export default function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: Props<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const style = {
    "--seg-count": options.length,
    "--active-index": index,
    gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
  } as CSSProperties;

  const move = (delta: number) => {
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    requestAnimationFrame(() => refs.current[next]?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(options[0].value);
      requestAnimationFrame(() => refs.current[0]?.focus());
    } else if (event.key === "End") {
      const last = options.length - 1;
      event.preventDefault();
      onChange(options[last].value);
      requestAnimationFrame(() => refs.current[last]?.focus());
    }
  };

  return (
    <div
      className={`console-segmented${className ? ` ${className}` : ""}`}
      style={style}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <span className="console-segmented__thumb" aria-hidden="true" />
      {options.map((option, i) => (
        <button
          key={String(option.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          className={`console-segmented__option${i === index ? " is-active" : ""}`}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
