export const DealSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    amount: { type: "number" },
    stage: { type: "string" },
    ownerId: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    companyName: { type: "string", nullable: true },
    contactName: { type: "string", nullable: true },
    contactEmail: { type: "string", nullable: true },
  },
  required: ["id", "name"],
};

export const DealPageSchema = {
  type: "object",
  properties: {
    total: { type: "number" },
    hasMore: { type: "boolean" },
    deals: { type: "array", items: { $ref: "#/components/schemas/Deal" } },
  },
  required: ["total", "hasMore", "deals"],
};
