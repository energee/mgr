# Brands and Beer Styles Management

## Overview

Add UI for managing brands (beer products) and beer styles (BJCP guidelines + custom).

## Database Changes

### Add `is_bjcp` column to `beer_styles`

```sql
ALTER TABLE beer_styles ADD COLUMN is_bjcp boolean DEFAULT false;
```

### Seed BJCP 2021 Styles

Insert ~100 BJCP styles with:
- name, category, description
- Vital stat ranges: OG, FG, ABV, IBU, SRM (min/max)
- `is_bjcp = true` for all seeded styles

Source: https://github.com/lrdodge/bjcp-style-data

Custom styles added by users will have `is_bjcp = false`.

## Entity Configurations

### `src/entities/beer-style.tsx`

**List columns:**
- name (sortable)
- category (sortable)
- ABV range (formatted as "X-Y%")
- IBU range
- SRM range
- is_bjcp (badge: "BJCP" or "Custom")

**List filters:**
- category (dynamic from data)
- is_bjcp (BJCP Only / Custom Only / All)

**Form fields:**
- name (required)
- category (required)
- description (textarea)
- OG min/max
- FG min/max
- ABV min/max
- IBU min/max
- SRM min/max

**Default sort:** category asc, name asc

### `src/entities/brand.tsx`

**List columns:**
- name (sortable)
- variant
- style (relation display)
- ABV

**Form fields:**
- name (required)
- variant
- style_id (relation to beer_styles)
- ABV (number)
- description (textarea)
- untappd_url
- untappd_rating (read-only or hidden)

**Detail sections:**
1. Overview: name, variant, style, ABV
2. Description: description (full width)
3. Untappd: untappd_url, untappd_rating

**Relations:**
- belongsTo: beer_style via style_id

## Settings Pages

### Beer Styles (`/settings/beer-styles`)
```
src/app/(app)/settings/beer-styles/
  page.tsx           → EntityList
  new/page.tsx       → EntityForm
  [id]/page.tsx      → EntityDetail
  [id]/edit/page.tsx → EntityForm
```

### Brands (`/settings/brands`)
```
src/app/(app)/settings/brands/
  page.tsx           → EntityList
  new/page.tsx       → EntityForm
  [id]/page.tsx      → EntityDetail
  [id]/edit/page.tsx → EntityForm
```

### Settings Page Updates

Add to `settingsLinks` array in `src/app/(app)/settings/page.tsx`:

```typescript
{
  title: "Beer Styles",
  description: "BJCP style guidelines and custom styles",
  href: "/settings/beer-styles",
  icon: BookOpen,  // or similar
  available: true,
},
{
  title: "Brands",
  description: "Manage your beer brands and products",
  href: "/settings/brands",
  icon: Beer,  // or Tag
  available: true,
},
```

## Implementation Order

1. **Migration** - Add `is_bjcp` column + seed BJCP styles
2. **Beer styles entity** - Entity config + 4 pages
3. **Brands entity** - Entity config + 4 pages
4. **Settings page** - Add cards for both
5. **Entity registry** - Register both entities

## Files to Create/Modify

### Create
- `supabase/migrations/00066_add_bjcp_styles.sql`
- `src/entities/beer-style.tsx`
- `src/entities/brand.tsx`
- `src/app/(app)/settings/beer-styles/page.tsx`
- `src/app/(app)/settings/beer-styles/new/page.tsx`
- `src/app/(app)/settings/beer-styles/[id]/page.tsx`
- `src/app/(app)/settings/beer-styles/[id]/edit/page.tsx`
- `src/app/(app)/settings/brands/page.tsx`
- `src/app/(app)/settings/brands/new/page.tsx`
- `src/app/(app)/settings/brands/[id]/page.tsx`
- `src/app/(app)/settings/brands/[id]/edit/page.tsx`

### Modify
- `src/entities/index.ts` - Register both entities
- `src/app/(app)/settings/page.tsx` - Add setting cards
