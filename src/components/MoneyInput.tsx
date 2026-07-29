/**
 * NIZAM · MoneyInput — integer-milliunit text input (no floats)
 * Implemented by: KIRO Contract 4 / Phase 4.1
 * Depends on: lib/money/money.ts
 *
 * The user types a decimal EGP string; it is parsed via fromDecimal (digit-parse)
 * on commit (blur / Enter). Value in/out is integer milliunits.
 */
import { useEffect, useState } from 'react';
import { fromDecimal, toDecimal, type Money } from '@/lib/money/money';

export interface MoneyInputProps {
  value: Money;
  onCommit: (value: Money) => void;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  className?: string;
}

/** Trim trailing zeros for friendlier editing ("12.500" -> "12.5", "12.000" -> "12"). */
function display(value: Money): string {
  if (value === 0) return '';
  return toDecimal(value).replace(/\.?0+$/, '');
}

export function MoneyInput(props: MoneyInputProps) {
  const [text, setText] = useState(() => display(props.value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(display(props.value));
    setInvalid(false);
  }, [props.value]);

  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') {
      setInvalid(false);
      props.onCommit(0);
      return;
    }
    try {
      const parsed = fromDecimal(trimmed);
      setInvalid(false);
      props.onCommit(parsed);
    } catch {
      setInvalid(true);
    }
  }

  return (
    <input
      className={`input input-money ${props.className ?? ''}`}
      style={invalid ? { outline: '2px solid var(--rag-red-text)' } : undefined}
      inputMode="decimal"
      value={text}
      placeholder={props.placeholder ?? '0.00'}
      autoFocus={props.autoFocus}
      aria-label={props['aria-label']}
      aria-invalid={invalid}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
