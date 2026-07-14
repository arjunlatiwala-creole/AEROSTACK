// Script to update the people collection validation schema

db = db.getSiblingDB("aerostack");

// Update the validation schema for the people collection
db.runCommand({
  collMod: "people",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "name", "createdAt"],
      additionalProperties: true, // This is key - allows new fields
      properties: {
        email: { bsonType: "string" },
        name: { bsonType: "string" },
        user_id: { bsonType: "string" }, // Add new field
        is_verified: { bsonType: "bool" },
        role: { bsonType: "string" },

        // Enhanced Deel integration fields
        deel_employee_id: { bsonType: "string" },
        employment_status: {
          enum: ["ACTIVE", "INACTIVE", "ONBOARDING", "OFFBOARDING", "TERMINATED"]
        },
        employment_type: {
          enum: ["FULL_TIME", "PART_TIME", "CONTRACTOR", "CONSULTANT", "INTERN"]
        },
        department: {
          enum: ["ENGINEERING", "PRODUCT", "DESIGN", "SALES", "MARKETING", "OPERATIONS", "FINANCE", "HR", "EXECUTIVE"]
        },
        manager_id: { bsonType: "string" },
        manager_email: { bsonType: "string" },
        start_date: { bsonType: "string" },
        end_date: { bsonType: "string" },
        location: { bsonType: "string" },
        country: { bsonType: "string" },
        timezone: { bsonType: "string" },
        salary_currency: { bsonType: "string" },
        salary_amount: { bsonType: ["double", "int"] },

        velocityScore: {
          bsonType: "object",
          additionalProperties: true,
          properties: {
            current: { bsonType: ["double", "int"] },
            trend: { bsonType: "string" },
            lastUpdated: { bsonType: "date" },
          },
        },
        metadata: { bsonType: "object" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
  validationLevel: "moderate", // Only validate on inserts and updates that modify validated fields
  validationAction: "warn" // Log warnings instead of rejecting documents
});

print("✅ Updated people collection validation schema");