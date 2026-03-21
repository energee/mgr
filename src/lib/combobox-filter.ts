/**
 * Combobox filter utilities — shared filter callbacks for Combobox components.
 * Eliminates duplicated inline onFilter functions across packaging components.
 */

/**
 * Creates a Combobox onFilter callback that matches items by name.
 * Usage: `onFilter={createNameFilter(packagingFormats)}`
 */
export function createNameFilter(
  items: Array<{ id: string; name: string }> | undefined
): (values: string[], search: string) => string[] {
  return (values, search) => {
    const term = search.toLowerCase();
    return values.filter((v) =>
      items?.find((item) => item.id === v)?.name.toLowerCase().includes(term)
    );
  };
}
