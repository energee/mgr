# Appendices

## Appendix A: Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# QuickBooks
QBO_CLIENT_ID=
QBO_CLIENT_SECRET=
QBO_REDIRECT_URI=

# Email (Resend)
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Allocation** | A record tracking inventory movement from source to destination |
| **BBL** | Barrel, the standard unit for beer volume (31 gallons) |
| **Bin** | A storage location within a facility |
| **Brite Tank** | Conditioning vessel where beer is carbonated before packaging |
| **COGS** | Cost of Goods Sold |
| **FG** | Finished Goods - packaged beer ready for sale |
| **Generation** | Yeast pitch count from original purchase (Gen 0 = purchased) |
| **Landed Cost** | Total cost including shipping allocation |
| **Lot Number** | Unique identifier for a production batch, used for traceability |
| **Pitch** | A quantity of yeast used to ferment beer |
| **PO** | Purchase Order |
| **QBO** | QuickBooks Online |
| **RLS** | Row Level Security - Supabase/PostgreSQL feature for access control |
| **SKU** | Stock Keeping Unit - a specific beer or product |
| **Template** | A recipe pattern with variable ingredients for projections |
| **TTB** | Alcohol and Tobacco Tax and Trade Bureau |

---

## Appendix C: References

- [Supabase Documentation](https://supabase.com/docs)
- [Next.js App Router](https://nextjs.org/docs/app)
- [shadcn/ui](https://ui.shadcn.com/)
- [TTB Form 5130.9](https://www.ttb.gov/system/files?file=images/pdfs/forms/f51309.pdf)
- [QuickBooks Online API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities)

---

## Appendix D: Enum Registry

All TEXT fields with constrained values. Use these exact values in application code.

### Entity Statuses

#### Batch Status
```
planned | fermenting | conditioning | packaging | completed | cancelled
```

#### Brew Log Status
```
draft | in_progress | completed | cancelled
```

#### Order Status
```
draft | confirmed | scheduled | picking | packed | out_the_door | fulfilled | cancelled
```

#### Packaging Session Status
```
planned | in_progress | completed | revised | cancelled
```

#### Purchase Order Status
```
draft | submitted | confirmed | partial | fulfilled | cancelled
```

#### Transfer Status
```
planned | in_transit | completed | cancelled
```

#### Vessel Status
```
empty | in_use | dirty | cleaning | maintenance
```

#### Yeast Brink Status
```
active | depleted | dumped
```

#### Viability Measurement Method
```
hemocytometer | cell_counter | estimated
```

### Allocation Types

#### Source Types
```
batch | finished_good | inventory_lot | external
```

#### Destination Types
```
batch | finished_good | order | sample | adjustment | destruction | loss | transfer
```

**Destination type usage:**
| Type | Use Case | destination_id |
|------|----------|----------------|
| batch | Raw materials allocated to production | batches.id |
| finished_good | Batch packaged into FG | finished_goods.id |
| order | FG sold to customer | orders.id |
| sample | Trade/quality samples | NULL |
| adjustment | Inventory corrections | NULL |
| destruction | QC failure, contamination | NULL |
| loss | Breakage, spillage, theft | NULL |
| transfer | Inter-location movement | location_transfers.id |

#### Allocation Status
```
planned | completed | cancelled
```

### Adjustment Reason Codes
```
breakage | shrinkage | found | recount | sample_customer | sample_event | sample_internal | donation | received_in_bond | destroyed | theft
```

### Adjustment Approval Status
```
pending_approval | approved | rejected
```

### Price Source (Order Items)
```
tier | style_tier | manual | promotional
```

### Hop Timing
```
mash | first_wort | boil | whirlpool | dry_hop
```

### Customer Type
```
distributor | retailer | taproom | direct | export
```

### Keg Transaction Types
```
fill | ship | return | clean | receive | adjust
```

### Vessel Types
```
fermenter | brite | unitank | barrel | serving
```

### Bin Types
```
cold_room | warehouse | taproom | offsite | shipping
```

### User Roles
```
Admin | Production Manager | Brewer | Sales
```

### Notification Types
```
low_inventory | batch_ready | order_due | po_delivery | packaging_scheduled | fg_expiring
```

### Catalog Item Types
```
malt | hop | adjunct | yeast | sugar | spice | fruit | additive
```

### Brew Log Phases
```
strike_water | mash_in | vorlauf | sparge | boil_start | hop_addition | boil_end | whirlpool | ko_start | ko_end | custom
```

### Measurement Metrics
```
temp_f | ph | gravity_plato | volume_bbl | pressure_psi | do_ppb | diacetyl | clarity
```

---

## Related Documents

- [Decisions](./decisions.md) - Schema design decisions
- [Workflows](./workflows.md) - State machine definitions
