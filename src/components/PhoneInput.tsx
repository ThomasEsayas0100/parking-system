"use client";

import React, { useCallback, forwardRef } from "react";

/**
 * Phone number input that only accepts digits and auto-formats as (555) 867-5309.
 *
 * Props:
 * - value: the formatted display string
 * - onChange: called with the new formatted string
 * - All other props forwarded to the underlying <input>
 */

/** Strip everything except digits. */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Format a digit string as (555) 867-5309. */
function formatPhone(digits: string): string {
  const d = digits.slice(0, 10); // max 10 digits
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "inputMode" | "value"> & {
  value: string;
  onChange: (formatted: string) => void;
};

const PhoneInput = forwardRef<HTMLInputElement, Props>(
  function PhoneInput({ value, onChange, onKeyDown, ...rest }, ref) {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = digitsOnly(e.target.value);
        onChange(formatPhone(digits));
      },
      [onChange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace") {
          const digits = digitsOnly(value);
          if (digits.length > 0) {
            e.preventDefault();
            onChange(formatPhone(digits.slice(0, -1)));
          }
        }
        if (onKeyDown) onKeyDown(e);
      },
      [value, onChange, onKeyDown],
    );

    return (
      <input
        {...rest}
        ref={ref}
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    );
  },
);

export default PhoneInput;
