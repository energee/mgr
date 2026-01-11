# UI/UX Guidelines

## Design System
- Use shadcn/ui components exclusively
- Tailwind CSS for styling
- Consistent spacing, colors, typography from shadcn defaults
- Dark mode support

## Mobile-First Screens
Optimized for mobile use on the brewhouse floor:
- Batch readings input
- Brew log event recording
- Batch additions
- Vessel status updates
- Quick batch lookup

## Desktop-Optimized Screens
Complex data entry and analysis:
- Recipe builder
- Order entry
- Packaging session planning
- Reports and dashboards
- Settings and configuration

## Navigation Structure
```
├── Dashboard
├── Production
│   ├── Batches
│   ├── Brew Logs
│   ├── Vessels
│   └── Recipes
├── Packaging
│   ├── Sessions
│   └── Formats
├── Inventory
│   ├── Finished Goods
│   ├── Bins
│   ├── Transfers
│   └── Kegs
├── Purchasing
│   ├── Purchase Orders
│   ├── Suppliers
│   ├── Ingredients
│   └── Inventory (raw materials)
├── Sales
│   ├── Orders
│   ├── Customers
│   └── Pricing
├── Reports
│   ├── TTB
│   ├── Projections
│   ├── COGS
│   └── Production
└── Settings
    ├── System
    ├── Users
    ├── Locations
    ├── Integrations
    └── Notifications
```

## Common Patterns

### List Views
- Filterable columns
- Sortable columns
- Search
- Pagination
- Bulk actions where appropriate
- Quick actions (edit, delete, status change)

### Detail Views
- Header with key info and status
- Tabbed sections for related data
- Action buttons contextual to state
- Revision history accessible

### Forms
- Inline validation with Zod
- Auto-save for complex forms (drafts)
- Confirmation for destructive actions
- Loading states on submit

### Status Badges
Consistent colors:
- Draft/Planned: Gray
- In Progress: Blue
- Completed/Success: Green
- Warning: Yellow
- Error/Cancelled: Red

---

## Related Documents

- [Architecture](./architecture.md) - Tech stack and component library
- [Modules](./modules.md) - Feature requirements
