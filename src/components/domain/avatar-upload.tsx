"use client";

/**
 * AvatarUpload Component
 *
 * Handles user profile avatar upload to Supabase Storage.
 * - Accepts image/jpeg, image/png, image/webp (max 1MB)
 * - Uploads to avatars/{user_id}/avatar.{ext}
 * - Updates user_profiles.avatar_url with the public URL
 * - Shows current avatar or initials fallback
 */

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { entityKeys, userKeys } from "@/lib/query-keys";
import { SafeImage } from "@/components/ui/safe-image";

/** Accepted MIME types for avatar images */
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Maximum file size in bytes (1MB) */
const MAX_FILE_SIZE = 1_048_576;

/** Maps MIME types to file extensions for storage path */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface AvatarUploadProps {
  /** Current user ID (used as storage folder name) */
  userId: string;
  /** Current avatar URL, if any */
  avatarUrl: string | null;
  /** Display name for initials fallback */
  displayName: string | null;
}

export function AvatarUpload({ userId, avatarUrl, displayName }: AvatarUploadProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const initials = (displayName ?? "?").charAt(0).toUpperCase();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const ext = MIME_TO_EXT[file.type];
      if (!ext) throw new Error("Unsupported file type");

      const filePath = `${userId}/avatar.${ext}`;

      // Upload file to Supabase Storage (upsert to replace existing)
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      // Append cache-busting timestamp so the browser refetches
      const avatarUrlWithCacheBust = `${publicUrl}?t=${Date.now()}`;

      // Update user_profiles with the new avatar URL
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ avatar_url: avatarUrlWithCacheBust })
        .eq("id", userId);

      if (updateError) throw updateError;

      return avatarUrlWithCacheBust;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.current() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("user_profile") });
      toast.success("Avatar updated");
      // Clear the local preview since the server URL is now active
      setPreviewUrl(null);
    },
    onError: (error) => {
      toast.error(`Failed to upload avatar: ${error.message}`);
      setPreviewUrl(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      // List files in the user's avatar folder to delete them
      const { data: files } = await supabase.storage
        .from("avatars")
        .list(userId);

      if (files && files.length > 0) {
        const filePaths = files.map((f) => `${userId}/${f.name}`);
        const { error: deleteError } = await supabase.storage
          .from("avatars")
          .remove(filePaths);

        if (deleteError) throw deleteError;
      }

      // Clear avatar_url in user_profiles
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ avatar_url: null })
        .eq("id", userId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.current() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("user_profile") });
      toast.success("Avatar removed");
      setPreviewUrl(null);
    },
    onError: (error) => {
      toast.error(`Failed to remove avatar: ${error.message}`);
    },
  });

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Reset the input so the same file can be re-selected
      event.target.value = "";

      // Validate file type
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error("Please select a JPEG, PNG, or WebP image");
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        toast.error("Image must be under 1MB");
        return;
      }

      // Show local preview immediately
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      uploadMutation.mutate(file);
    },
    [uploadMutation],
  );

  const isLoading = uploadMutation.isPending || removeMutation.isPending;

  // Determine which image to display: local preview > server URL > initials
  const displayUrl = previewUrl ?? avatarUrl;

  return (
    <div className="flex items-center gap-4">
      {/* Avatar circle */}
      <div className="relative group">
        <div className="h-16 w-16 rounded-full overflow-hidden bg-muted flex items-center justify-center">
          {displayUrl ? (
            <SafeImage
              src={displayUrl}
              alt={displayName ?? "Avatar"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xl font-medium text-muted-foreground">
              {initials}
            </span>
          )}

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 rounded-full bg-background/60 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="sr-only"
          onChange={handleFileChange}
          disabled={isLoading}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="h-3.5 w-3.5 mr-1.5" />
          {avatarUrl ? "Change photo" : "Upload photo"}
        </Button>

        {avatarUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isLoading}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => removeMutation.mutate()}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Remove
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          JPG, PNG, or WebP. Max 1MB.
        </p>
      </div>
    </div>
  );
}
