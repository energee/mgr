import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  transformSupplier,
  transformMalt,
  transformHop,
  transformYeast,
  transformStyle,
  transformBeer,
  transformVessel,
  transformBatch,
  transformOrder,
  transformOrderItem,
  transformTest,
  type HopLookup,
} from "../transformers";
import { objectIdToUuid } from "../id";

const oid = (hex: string) => new ObjectId(hex);

describe("Phase 1 transformers", () => {
  it("transforms supplier", () => {
    const result = transformSupplier({
      _id: oid("507f1f77bcf86cd799439011"),
      name: "BSG CraftBrewing",
    });
    expect(result).toEqual({
      id: objectIdToUuid("507f1f77bcf86cd799439011"),
      name: "BSG CraftBrewing",
      is_active: true,
    });
  });

  it("transforms malt with yield conversion", () => {
    const supplierMap = new Map([["aaa", "Supplier A"]]);
    const result = transformMalt(
      {
        _id: oid("507f1f77bcf86cd799439012"),
        name: "Pale Malt",
        supplier: oid("aaaaaaaaaaaaaaaaaaaaaaaa"),
        yieldOnGrind: 80,
        price: 55,
        weight: 55,
        color: 2.5,
      },
      supplierMap
    );
    expect(result.name).toBe("Pale Malt");
    expect(result.potential_ppg).toBe(36.8); // 80 * 0.46
    expect(result.cost_per_lb).toBe(1); // 55 / 55
    expect(result.color_lovibond).toBe(2.5);
    expect(result.is_active).toBe(true);
  });

  it("transforms hop with alpha acid range", () => {
    const result = transformHop({
      _id: oid("507f1f77bcf86cd799439013"),
      name: "Citra",
      alphaAcid: 12,
      betaAcid: 3.5,
    });
    expect(result.alpha_acid_typical).toBe(12);
    expect(result.alpha_acid_min).toBe(10.8); // 12 * 0.9
    expect(result.alpha_acid_max).toBe(13.2); // 12 * 1.1
    expect(result.beta_acid_min).toBe(3.5);
  });

  it("transforms yeast with supplier lookup", () => {
    const supplierMap = new Map([
      ["bbbbbbbbbbbbbbbbbbbbbbbb", "White Labs"],
    ]);
    const result = transformYeast(
      {
        _id: oid("507f1f77bcf86cd799439014"),
        name: "WLP001",
        supplier: oid("bbbbbbbbbbbbbbbbbbbbbbbb"),
        temperatureRange: { low: 64, high: 72 },
        attenuation: { low: 73, high: 80 },
        flocculation: "medium",
      },
      supplierMap
    );
    expect(result.manufacturer).toBe("White Labs");
    expect(result.temp_min_f).toBe(64);
    expect(result.attenuation_max).toBe(80);
  });

  it("transforms style", () => {
    const result = transformStyle({
      _id: oid("507f1f77bcf86cd799439015"),
      name: "India Pale Ale",
      glass: "pint",
      draftPrice: 7,
    });
    expect(result.name).toBe("India Pale Ale");
    expect(result.category).toBe("uncategorized");
  });
});

describe("Phase 2 transformers", () => {
  it("transforms beer to brand with hops JSONB", () => {
    const hopLookup: HopLookup = new Map([
      ["cccccccccccccccccccccccc", { uuid: "hop-uuid-1", name: "Citra" }],
    ]);
    const result = transformBeer(
      {
        _id: oid("507f1f77bcf86cd799439016"),
        name: "Lupula",
        style: oid("dddddddddddddddddddddddd"),
        abv: 6.5,
        variant: "lupula",
        hops: [oid("cccccccccccccccccccccccc")],
        untappdUrl: "https://untappd.com/b/lupula",
        untappdRatingValue: 4.1,
        description: "A hoppy IPA",
      },
      hopLookup
    );
    expect(result.name).toBe("Lupula");
    expect(result.abv).toBe(6.5);
    expect(result.variant).toBe("lupula");
    expect(result.untappd_url).toBe("https://untappd.com/b/lupula");
    expect(result.hops).toEqual([{ hop_id: "hop-uuid-1", name: "Citra" }]);
  });

  it("maps vessel types correctly", () => {
    const cases: Array<[string, string, string]> = [
      ["unitank", "FV1", "fermenter"],
      ["briteTank", "BT1", "brite"],
      ["foeder", "Foeder 1", "foeder"],
      ["other", "Kettle", "kettle"],
      ["other", "MLT", "mash_tun"],
    ];
    for (const [mongoType, name, expectedType] of cases) {
      const result = transformVessel({
        _id: new ObjectId(),
        name,
        type: mongoType,
        capacity: 25,
        units: "barrels",
      });
      expect(result.vessel_type).toBe(expectedType);
    }
  });
});

describe("Phase 3 transformers", () => {
  it("infers batch status as completed when canningDay exists", () => {
    const result = transformBatch({
      _id: oid("507f1f77bcf86cd799439017"),
      name: "Lupula Oct 24",
      canningDay: [oid("eeeeeeeeeeeeeeeeeeeeeeee")],
      date: new Date("2024-10-24"),
    });
    expect(result.status).toBe("completed");
  });

  it("infers batch status as fermenting when only currentVessel", () => {
    const result = transformBatch({
      _id: oid("507f1f77bcf86cd799439018"),
      currentVessel: oid("ffffffffffffffffffffffff"),
    });
    expect(result.status).toBe("fermenting");
  });

  it("transforms order with status mapping", () => {
    const result = transformOrder(
      {
        _id: oid("507f1f77bcf86cd799439019"),
        status: "completed",
        date: new Date("2024-10-21"),
        completedDate: new Date("2024-10-21"),
        notes: "test order",
      },
      1
    );
    expect(result.status).toBe("fulfilled");
    expect(result.order_number).toBe("ORD-20241021-001");
  });

  it("transforms order item with brand resolution", () => {
    const beerId = "507f1f77bcf86cd799439016";
    const result = transformOrderItem(
      {
        id: "item-1",
        quantity: 10,
        product: { relationTo: "beers", value: oid(beerId) },
        pricing: { unitPrice: 5.5 },
      },
      "order-uuid",
      "order-mongo-id",
      0
    );
    expect(result.brand_id).toBe(objectIdToUuid(beerId));
    expect(result.quantity).toBe(10);
    expect(result.unit_price).toBe(5.5);
  });
});

describe("Phase 4 transformers", () => {
  it("transforms test to batch reading with measurements JSONB", () => {
    const result = transformTest({
      _id: oid("507f1f77bcf86cd79943901a"),
      batch: oid("507f1f77bcf86cd799439017"),
      time: new Date("2024-10-23T13:14:30Z"),
      type: "mash-in",
      temperature: 140,
      ph: 5.2,
      name: "Oct 23 Mash-in",
    });
    expect(result.measurements).toEqual([
      { type: "temperature", value: 140, unit: "F" },
      { type: "ph", value: 5.2 },
    ]);
    expect(result.notes).toBe("Oct 23 Mash-in");
  });
});
