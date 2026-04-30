"use client";

/**
 * OTP code input for Supabase magic link verification.
 * Renders digit slots in two equal groups with a separator (e.g. 0000 — 0000).
 */

import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";

const OTP_LENGTH = 8;
const HALF = OTP_LENGTH / 2;

type OtpCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  onComplete: () => void;
  disabled?: boolean;
  id?: string;
}

export function OtpCodeInput({ value, onChange, onComplete, disabled, id }: OtpCodeInputProps) {
  return (
    <InputOTP
      id={id}
      maxLength={OTP_LENGTH}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      data-1p-ignore
      data-lpignore="true"
    >
      <InputOTPGroup>
        {Array.from({ length: HALF }, (_, i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        {Array.from({ length: HALF }, (_, i) => (
          <InputOTPSlot key={i + HALF} index={i + HALF} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

export { OTP_LENGTH };
