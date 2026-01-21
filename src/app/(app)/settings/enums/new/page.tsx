/**
 * New Enum Value Page
 */

"use client";

import Link from "next/link";
import { EntityForm } from "@/components/universal/entity-form";
import { enumValueEntity } from "@/entities/enum-value";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function NewEnumValuePage() {
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings/enums">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Add Enum Value</h1>
      </div>

      {/* Form */}
      <EntityForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={enumValueEntity as any}
        basePath="/settings/enums"
      />
    </div>
  );
}
