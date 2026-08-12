"use client";

/**
 * CatalogAddPopover — the "Add <thing>" button shared by the catalog-backed row
 * editors (grain bill, hop schedule, batch additions).
 *
 * All three rendered the same popover: an outline trigger with a plus and a
 * chevron, a `cmdk` search box, and the catalog grouped into `CommandGroup`s by
 * type with a name-plus-detail line per entry. Only the labels, the grouping
 * key, and the detail line differed, so those are props.
 *
 * The popover closes and clears its search box after a selection — the callers
 * previously did this by hand and one of them (the hop editor) is the reason
 * `onSelect` runs *before* the close, so a caller that rejects a duplicate
 * still gets the popover dismissed.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Plus, ChevronsUpDown } from "lucide-react";

type CatalogAddPopoverProps<T> = {
  /** Full catalog, already filtered of anything the caller wants hidden. */
  catalog: T[];
  /** Stable id per catalog entry; entries whose id is in `excludeIds` are hidden. */
  getId: (item: T) => string;
  excludeIds?: Set<string>;
  /** Grouping key (e.g. malt/hop/additive `type`). */
  getGroup: (item: T) => string;
  /** Display label per group key; falls back to the raw key. */
  groupLabels?: Record<string, string>;
  /** Search haystack for `cmdk`. */
  getSearchValue: (item: T) => string;
  /** Primary line for a catalog entry. */
  getLabel: (item: T) => React.ReactNode;
  /** Muted secondary line; return null to omit it. */
  getDetail?: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  /** Trigger text, e.g. "Add Malt". */
  triggerLabel: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
};

export function CatalogAddPopover<T>({
  catalog,
  getId,
  excludeIds,
  getGroup,
  groupLabels = {},
  getSearchValue,
  getLabel,
  getDetail,
  onSelect,
  triggerLabel,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
}: CatalogAddPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const groups = useMemo(() => {
    const byGroup: Record<string, T[]> = {};
    for (const item of catalog) {
      if (excludeIds?.has(getId(item))) continue;
      const key = getGroup(item) || "other";
      (byGroup[key] ??= []).push(item);
    }
    return byGroup;
    // `getId`/`getGroup` are inline arrow props; depending on them would defeat
    // the memo, and they are pure projections of `item` in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, excludeIds]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="gap-1">
          <Plus className="h-4 w-4" />
          {triggerLabel}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {Object.entries(groups).map(([key, entries]) => (
              <CommandGroup key={key} heading={groupLabels[key] || key}>
                {entries.map((item) => (
                  <CommandItem
                    key={getId(item)}
                    value={getSearchValue(item)}
                    onSelect={() => {
                      onSelect(item);
                      setOpen(false);
                      setSearchValue("");
                    }}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col">
                      <span>{getLabel(item)}</span>
                      {getDetail?.(item)}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
