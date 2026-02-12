"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2 } from "lucide-react";

export interface SecretKeyInputProps {
  label: string;
  placeholder: string;
  inputType?: "password" | "url";
  hintPrefix?: string;
  helpText?: ReactNode;
  // State (controlled)
  hasExistingKey: boolean;
  keyHint?: string | null;
  isLoading: boolean;
  // Callbacks
  onSave: (key: string) => void;
  onRemove: () => void;
  isSaving: boolean;
  // Optional test
  onTest?: () => void;
  isTesting?: boolean;
}

export function SecretKeyInput({
  label,
  placeholder,
  inputType = "password",
  hintPrefix,
  helpText,
  hasExistingKey,
  keyHint,
  isLoading,
  onSave,
  onRemove,
  isSaving,
  onTest,
  isTesting,
}: SecretKeyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading) return null;

  const showConfigured = hasExistingKey && !isEditing;

  if (showConfigured) {
    return (
      <div className="space-y-3">
        <Label>{label}</Label>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-green-600" />
            <span>Configured</span>
            {keyHint && (
              <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {hintPrefix}{keyHint}
              </code>
            )}
          </div>
          <div className="flex gap-2">
            {onTest && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTest}
                disabled={isTesting}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test"
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              Change
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemove}
              disabled={isSaving}
            >
              Remove
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type={inputType}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <Button
          type="button"
          onClick={() => {
            onSave(inputValue);
            setInputValue("");
            setIsEditing(false);
          }}
          disabled={!inputValue || isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            "Save"
          )}
        </Button>
        {hasExistingKey && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setInputValue("");
              setIsEditing(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}
