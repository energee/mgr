"use client";

/**
 * OTP code input for Supabase magic link verification.
 * Renders a single group of digit slots. Pasted codes are stripped to
 * non-digits first, so codes copied with stray spaces or dashes still work.
 */

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const OTP_LENGTH = 8;

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
      pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
      data-1p-ignore
      data-lpignore="true"
    >
      <InputOTPGroup>
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

export { OTP_LENGTH };
