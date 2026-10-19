import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const pt = (deg: number, r: number) => {
  const t = (deg * Math.PI) / 180;
  return [32 + r * Math.sin(t), 32 - r * Math.cos(t)] as const;
};
function arc(n: number, r: number) {
  const a0 = -135;
  const a1 = -135 + 270 * Math.max(n, 0.005);
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export interface KnobProps {
  label: string;
  /** Raw value and range. */
  value: number;
  min: number;
  max: number;
  /** Raw -> text shown under the knob. */
  format: (raw: number) => string;
  /** Typed display value -> raw. */
  parse?: (text: string) => number | undefined;
  onChange: (raw: number, final: boolean) => void;
  size?: 'lg' | 'sm';
  active?: boolean;
  /** Text of the recipe's value when the knob was moved away from it. */
  recipeText?: string;
}

/** Drag up/down (or use arrow keys) to turn; double-click or press Enter to type a value. */
export function Knob({ label, value, min, max, format, parse, onChange, size = 'lg', active = true, recipeText }: KnobProps) {
  const drag = useRef<{ y: number; start: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const span = Math.max(1, max - min);
  const n = (value - min) / span;
  const changed = recipeText !== undefined;
  const [px, py] = pt(-135 + 270 * n, 14);
  const px2 = size === 'lg' ? 76 : 50;

  const commit = (raw: number, final: boolean) => onChange(Math.round(Math.min(max, Math.max(min, raw))), final);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: value };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    // 180 px of travel covers the whole range.
    commit(drag.current.start + (dy / 180) * span, false);
  };
  const onPointerUp = () => {
    if (drag.current) commit(value, true);
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? Math.max(1, Math.round(span / 10)) : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') commit(value + step, true);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') commit(value - step, true);
    else if (e.key === 'Home') commit(min, true);
    else if (e.key === 'End') commit(max, true);
    else if (e.key === 'Enter' && parse) startEdit();
    else return;
    e.preventDefault();
  };
  const startEdit = () => {
    if (!parse) return;
    setText(format(value).replace(/[^0-9.+-]/g, ''));
    setEditing(true);
  };
  const finishEdit = () => {
    const raw = parse?.(text);
    if (raw !== undefined && Number.isFinite(raw)) commit(raw, true);
    setEditing(false);
  };

  const color = changed ? 'var(--changed)' : active ? 'var(--accent)' : 'var(--muted-arc)';
  return (
    <div className={`knob knob-${size}`}>
      <button
        type="button"
        className="knob-dial"
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value) + (changed ? `, changed from recipe ${recipeText}` : '')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={startEdit}
      >
        <svg viewBox="0 0 64 64" width={px2} height={px2} aria-hidden="true">
          <path d={arc(1, 28)} className="knob-track" />
          <path d={arc(n, 28)} style={{ stroke: color }} className="knob-arc" />
          <circle cx="32" cy="32" r="21" className="knob-body" style={{ stroke: changed ? 'var(--changed)' : undefined }} />
          <line x1="32" y1="32" x2={px} y2={py} className="knob-pointer" />
        </svg>
      </button>
      {editing ? (
        <input
          className="knob-input"
          autoFocus
          inputMode="decimal"
          value={text}
          aria-label={`${label} value`}
          onChange={(e) => setText(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div className="knob-value" style={{ color: changed ? 'var(--changed)' : active ? undefined : 'var(--text-dim)' }}>
          {format(value)}
        </div>
      )}
      <div className="knob-label">{label}</div>
      {changed && <div className="knob-recipe">recipe {recipeText}</div>}
    </div>
  );
}
