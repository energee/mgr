"use client";

/**
 * CatalogPicker - Shared searchable command-popover for picking a catalog item.
 *
 * Used by the recipe ingredient editors (OtherIngredientsSection,
 * RecipeVariantEditor) to add an ingredient from a catalog table. The trigger
 * button and per-item rendering are supplied by the caller so each surface
 * keeps its existing look; the popover/command behavior (search, select,
 * close-and-clear) is shared here.
 */

import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type CatalogPickerProps<T extends { id: string; name: string }> = {
  /** Catalog items to choose from. */
  items: T[];
  /** Called with the picked item; the popover closes and search clears. */
  onSelect: (item: T) => void;
  /** Trigger element (a Button); rendered via PopoverTrigger asChild. */
  trigger: React.ReactNode;
  /** Placeholder for the search input. */
  searchPlaceholder: string;
  /** Message shown when no items match the search. */
  emptyMessage: string;
  /** Renders a catalog item inside its CommandItem. */
  renderItem: (item: T) => React.ReactNode;
};

export function CatalogPicker<T extends { id: string; name: string }>({
  items,
  onSelect,
  trigger,
  searchPlaceholder,
  emptyMessage,
  renderItem,
}: CatalogPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onSelect(item);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  {renderItem(item)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
