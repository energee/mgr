# Brew Logs Domain

Brew logs capture the hot-side brewing process. They are **decoupled from batches** to support:
- **Split fermentation**: One brew → multiple batches (different yeasts, treatments)
- **Parti-gyle brewing**: One brew → multiple batches (first/second runnings)
- **Blend at knockout**: Multiple brews → one batch (rare, but supported)

## Relationship Model

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│  brew_logs  │────────▶│ brew_log_batches │◀────────│   batches   │
│  (hot side) │   1:M   │   (allocation)   │   M:1   │ (cold side) │
└─────────────┘         └──────────────────┘         └─────────────┘
                                                            │
                                                            │ belongs to
                                                            ▼
                                                     ┌─────────────┐
                                                     │   recipes   │
                                                     └─────────────┘
```

**Note:** Recipe is owned by batches, not brew logs. Brew logs derive recipe info
from their linked batches via the `brew_logs_with_batches` view.

---

## `brew_logs`

The brew day record - everything from strike water through knockout.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| brew_number | TEXT | Unique brew identifier (e.g., "BRW-2024-001") |
| brew_date | DATE | Date of brew day |
| brewer_id | UUID | FK to users (operator) |
| status | TEXT | Status: draft, in_progress, completed, cancelled |
| **Timeline** | | |
| events | JSONB | Array of brew day events (source of truth - see schema below) |
| **Legacy Data** | | For migration from old structure |
| legacy_data | JSONB | Structured legacy fields (strikeWater, mashIn, etc.) |
| **Notes** | | |
| notes | TEXT | General brew day notes |
| **Meta** | | |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Calculated Values (derived from events, not stored)

These are computed at query time or in application code:

| Value | Derived From |
|-------|--------------|
| actual_og | Last `gravity_plato` measurement from `ko_end` or `boil_end` event |
| pre_boil_gravity | `gravity_plato` measurement from `boil_start` event |
| pre_boil_volume | `volume_bbl` measurement from `boil_start` event |
| post_boil_volume | `volume_bbl` measurement from `boil_end` event |
| volume_to_fermenter | `volume_bbl` measurement from `ko_end` event |
| actual_boil_time | Time difference between `boil_start` and `boil_end` events |
| mash_water_used | `volume_l` measurement from `strike_water` event |
| sparge_water_used | `volume_l` measurement from `sparge_end` event |
| total_water_used | Sum of mash + sparge water |
| mash_efficiency | Calculated from OG, grain bill, and volume |
| actual_mash_ph | `ph` measurement from `mash_in` event |

**Note:** `actual_fg` and `actual_abv` are **fermentation results** and belong on the `batch`, not the brew log.

### Events JSONB Schema

The `events` array captures the timeline of brew day in a flexible structure:

```json
[
  {
    "id": "uuid",
    "phase": "strike_water",
    "custom_phase": null,
    "time": "06:30",
    "measurements": [
      { "metric": "temp_f", "value": 168, "custom_metric": null },
      { "metric": "volume_l", "value": 450, "custom_metric": null }
    ],
    "ingredient": null,
    "vessel": null,
    "notes": "Started heating strike water"
  },
  {
    "id": "uuid",
    "phase": "mash_in",
    "time": "07:00",
    "measurements": [
      { "metric": "temp_f", "value": 152 },
      { "metric": "ph", "value": 5.3 }
    ],
    "notes": null
  },
  {
    "id": "uuid",
    "phase": "hop_addition",
    "time": "09:15",
    "measurements": [
      { "metric": "amount_lbs", "value": 2.5 }
    ],
    "ingredient": {
      "type": "hop",
      "id": "uuid-of-citra"
    },
    "notes": "60 min addition"
  },
  {
    "id": "uuid",
    "phase": "ko_end",
    "time": "11:30",
    "measurements": [
      { "metric": "temp_f", "value": 66 },
      { "metric": "volume_bbl", "value": 10.2 }
    ],
    "vessel": "uuid-of-fv1",
    "notes": null
  }
]
```

### Phase Options

| Value | Label | Typical Measurements |
|-------|-------|---------------------|
| strike_water | Strike Water | temp_f, volume_l |
| mash_in | Mash In | temp_f, ph |
| mash_rest | Mash Rest | temp_f |
| mash_step | Mash Step | temp_f, time |
| vorlauf | Vorlauf | - |
| runoff_start | Runoff Start | flow_rate |
| runoff_end | Runoff End | - |
| sparge_start | Sparge Start | temp_f, ph, pump_speed |
| sparge_end | Sparge End | volume_bbl |
| kettle_full | Kettle Full | volume_bbl, temp_f |
| boil_start | Boil Start | gravity_plato, volume_bbl |
| boil_end | Boil End | - |
| hop_addition | Hop Addition | amount_lbs, amount_oz |
| adjunct_addition | Adjunct Addition | amount_lbs, amount_g |
| whirlpool_start | Whirlpool Start | temp_f |
| whirlpool_rest | Whirlpool Rest | - |
| whirlpool_end | Whirlpool End | - |
| ko_start | Knock Out Start | temp_f |
| ko_end | Knock Out End | temp_f, volume_bbl |
| yeast_pitch | Yeast Pitch | viability, pitch_rate, amount_lbs |
| hourly_check | Hourly Check | volume_bbl, pump_speed, flow_rate |
| flow_rate_change | Flow Rate Change | flow_rate |
| other | Other | (custom) |

### Measurement Metrics

| Value | Label | Unit |
|-------|-------|------|
| temp_f | Temperature | °F |
| ph | pH | - |
| volume_bbl | Volume (BBL) | BBL |
| volume_l | Volume (L) | L |
| gravity_plato | Gravity | °P |
| flow_rate | Flow Rate | L/min or custom |
| pump_speed | Pump Speed | % or custom |
| amount_lbs | Amount | lbs |
| amount_oz | Amount | oz |
| amount_g | Amount | g |
| viability | Viability | % |
| pitch_rate | Pitching Rate | M cells/mL/°P |
| other | Other | custom |

### Legacy Data JSONB Schema

For migration purposes, the old structured fields are preserved:

```json
{
  "strikeWater": {
    "beginTime": "06:30",
    "strikeTemp": 168,
    "volume": 450
  },
  "mashIn": {
    "beginTime": "07:00",
    "finishTime": "07:15",
    "actualMashTemp": 152,
    "actualMashPH": 5.3,
    "mashWaterUsed": 450,
    "mashSteps": [
      { "stepName": "Sacch Rest", "targetTemp": 152, "actualTemp": 152, "startTime": "07:00" }
    ]
  },
  "mashRest": { "beginTime": "07:15", "finishTime": "08:15" },
  "vorlauf": { "beginTime": "08:15", "finishTime": "08:25" },
  "runoff": {
    "beginTime": "08:25",
    "endTime": "09:30",
    "flowRate": "5 L/min",
    "flowRateChanges": []
  },
  "sparge": {
    "beginTime": "08:30",
    "endTime": "09:30",
    "pumpSpeed": "50%",
    "waterTemp": 170,
    "waterPH": 5.8,
    "spargeWaterUsed": 300,
    "kettleVolumeEnd": 12.5,
    "kettleTempEnd": 165
  },
  "hourlyChecks": [],
  "boil": {
    "beginTime": "09:45",
    "finishTime": "10:45",
    "actualBoilTime": 60,
    "preBoilGravity": 11.5,
    "preBoilVolume": 12.5
  },
  "additions": [],
  "whirlpool": {
    "beginTime": "10:50",
    "beginRestTime": "10:55",
    "finishTime": "11:10",
    "temp": 180
  },
  "knockOut": {
    "koTemp": 66,
    "koTank": "uuid-of-fv1",
    "beginTime": "11:15",
    "finishTime": "11:45",
    "volumeKO": 10.2,
    "yeastNutrientAmount": 50
  },
  "yeastPitching": {
    "yeast": "uuid-of-yeast",
    "pitchingRate": 0.75,
    "viability": 95,
    "cellCountingDate": "2024-01-14",
    "amountPitched": 2.5,
    "pitchTime": "11:50"
  }
}
```

---

## `brew_log_batches`

Junction table linking brew logs to batches with volume allocation. Per DEC-HP-003.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| brew_log_id | UUID | FK to brew_logs |
| batch_id | UUID | FK to batches |
| volume_bbl | DECIMAL(8,2) | Volume of wort allocated to this batch |
| notes | TEXT | Notes (e.g., "first runnings", "split for Brett") |
| created_at | TIMESTAMPTZ | Created timestamp |

**Database Constraints:**
```sql
UNIQUE(brew_log_id, batch_id)  -- A brew can only be linked to a batch once
CHECK (volume_bbl > 0)         -- Volume must be positive
```

**Application-Level Validation:**

| Rule | Description |
|------|-------------|
| Volume reconciliation | SUM(brew_log_batches.volume_bbl) for a brew should equal knockout volume ±5%; warn if not |
| Batch requires brew for fermenting | Batch cannot transition `planned → fermenting` without at least one link |
| No unlink after fermenting | Cannot delete link if batch.status != 'planned' |
| Blend support | Can add additional brew_log_batches to an already-fermenting batch |

**Edge Cases:**

| Scenario | Handling |
|----------|----------|
| Test brew / dump | brew_log can complete with zero batch links; flagged as "unallocated" |
| Volume mismatch >5% | Warning displayed; user must acknowledge before saving |
| Planned batch never brewed | Stays `planned`; user can cancel or delete |

### Example Scenarios

**Standard (1:1)**
```
brew_log: BRW-2024-001 (10.2 BBL total)
  └── batch: 2024-001 (10.2 BBL)
```

**Split Fermentation (1:many)**
```
brew_log: BRW-2024-002 (10.0 BBL total)
  ├── batch: 2024-002A (5.0 BBL) - US-05 yeast
  └── batch: 2024-002B (5.0 BBL) - Kveik yeast
```

**Parti-gyle (1:many)**
```
brew_log: BRW-2024-003 (12.0 BBL total)
  ├── batch: 2024-003A (6.0 BBL) - First runnings (high gravity)
  └── batch: 2024-003B (6.0 BBL) - Second runnings (session)
```

---

## Impact on `batches` Table

With brew logs decoupled, the `batches` table focuses on **fermentation and packaging**:

### Fields to Keep on Batch
| Field | Rationale |
|-------|-----------|
| batch_number | Batch identity |
| name | Batch name |
| status | Lifecycle state |
| recipe_id | Single source of truth for recipe (brew logs derive recipe from here) |
| volume_bbl | Target/actual volume |
| actual_fg | Final gravity (derived from fermentation readings) |
| actual_abv | ABV (calculated from OG/FG) |
| notes | Batch-specific notes |

**Note:** Vessel assignment is tracked via `vessels.current_batch_id`, not on the batch itself.

### Fields to Remove from Batch (now on brew_log)
| Field | New Location |
|-------|--------------|
| brew_date | `brew_logs.brew_date` |
| actual_og | `brew_logs.actual_og` (batch can derive from linked brew) |
| actual_ph | `brew_logs.actual_mash_efficiency` via events |

### Derived Fields on Batch
The batch can compute/display values from its linked brew log(s):
- `brew_date` - from linked brew_log (or earliest if multiple)
- `actual_og` - from linked brew_log (weighted average if multiple)
- `source_brews` - list of contributing brew logs

---

## State Machine: Brew Log

Brew logs have a simpler lifecycle than batches:

```
draft → in_progress → completed
  │          │
  └──────────┴──────▶ cancelled
```

| State | Description |
|-------|-------------|
| draft | Brew planned but not started |
| in_progress | Brew day actively happening |
| completed | Brew finished, wort in fermenter(s) |
| cancelled | Brew cancelled |

| Transition | Trigger |
|------------|---------|
| draft → in_progress | First event recorded |
| in_progress → completed | Knockout complete, linked to batch(es) |
| any → cancelled | User cancellation |

---

## Indexes

```sql
CREATE INDEX idx_brew_logs_brew_date ON brew_logs(brew_date);
CREATE INDEX idx_brew_logs_brewer_id ON brew_logs(brewer_id);
CREATE INDEX idx_brew_log_batches_brew_log_id ON brew_log_batches(brew_log_id);
CREATE INDEX idx_brew_log_batches_batch_id ON brew_log_batches(batch_id);
```

---

## Example Queries

**Get all brews for a batch:**
```sql
SELECT bl.*
FROM brew_logs bl
JOIN brew_log_batches blb ON bl.id = blb.brew_log_id
WHERE blb.batch_id = 'batch-uuid';
```

**Get all batches from a brew:**
```sql
SELECT b.*, blb.volume_bbl as allocated_volume
FROM batches b
JOIN brew_log_batches blb ON b.id = blb.batch_id
WHERE blb.brew_log_id = 'brew-log-uuid';
```

**Get brew day timeline:**
```sql
SELECT
  brew_number,
  brew_date,
  jsonb_array_elements(events) as event
FROM brew_logs
WHERE id = 'brew-log-uuid';
```

**Calculate total volume allocated from a brew:**
```sql
SELECT
  bl.brew_number,
  bl.volume_to_fermenter_bbl as total_ko,
  SUM(blb.volume_bbl) as allocated,
  bl.volume_to_fermenter_bbl - SUM(blb.volume_bbl) as unallocated
FROM brew_logs bl
LEFT JOIN brew_log_batches blb ON bl.id = blb.brew_log_id
WHERE bl.id = 'brew-log-uuid'
GROUP BY bl.id;
```
