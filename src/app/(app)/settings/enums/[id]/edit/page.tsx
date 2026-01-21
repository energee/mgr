/**
 * Edit Enum Value Page
 */

"use client";

import { use } from "react";
import Link from "next/link";
import { EntityForm } from "@/components/universal/entity-form";
import { enumValueEntity } from "@/entities/enum-value";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditEnumValuePage({ params }: PageProps) {
  const resolvedParams = use(params);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/settings/enums/${resolvedParams.id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Edit Enum Value</h1>
      </div>

      {/* Form */}
      <EntityForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={enumValueEntity as any}
        id={resolvedParams.id}
        basePath="/settings/enums"
      />
    </div>
  );
}
