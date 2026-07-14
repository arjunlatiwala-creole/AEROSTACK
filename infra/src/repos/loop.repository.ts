import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  Contributor,
  Lesson,
  Loop,
  LoopListParams,
} from "src/shared/validation/loop.schema";

type PaginationKey = Record<string, string | number>;

export interface ListResult<T> {
  items: T[];
  lastKey?: string;
  count: number;
  // totalCount: number;
}

export interface ILoopRepository {
  create(loop: Loop): Promise<Loop>;
  getById(loopId: string): Promise<Loop | null>;
  update(loop: Partial<Loop> & { loop_id: string }): Promise<Loop>;
  scoreOutcome(input: {
    loop_id: string;
    outcome_score: number;
    contributors?: Contributor[];
    lesson?: Lesson;
    updated_by?: string;
  }): Promise<void>;
  list(params: LoopListParams): Promise<ListResult<Loop>>;
}

interface QueryStrategy {
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, string | number | boolean>;
  expressionAttributeNames?: Record<string, string>;
  filterExpression?: string;
  scanIndexForward: boolean;
}

export class LoopRepository implements ILoopRepository {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /**
   * Fields that must NEVER be updated via generic update()
   * Only system/computed fields are truly immutable
   */
  private static readonly IMMUTABLE_FIELDS = new Set<string>([
    "loop_id",
    "created_at",
    "entity_type",
    "loop_score", // Computed field
    "weighted_score", // Computed field
  ]);

  private decodeLastKey(lastKey?: string): PaginationKey | undefined {
    if (!lastKey) return undefined;
    try {
      return JSON.parse(
        Buffer.from(lastKey, "base64").toString("utf-8"),
      ) as PaginationKey;
    } catch {
      return undefined;
    }
  }

  private encodeLastKey(lastKey?: PaginationKey): string | undefined {
    if (!lastKey) return undefined;
    return Buffer.from(JSON.stringify(lastKey), "utf-8").toString("base64");
  }

  async create(loop: Loop): Promise<Loop> {
    // Build category_status composite key
    const category_status = `${loop.category}#${loop.status}`;

    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...loop,
          entity_type: "LOOP",
          category_status, // Add composite key
        },
        ConditionExpression: "attribute_not_exists(loop_id)",
      }),
    );

    return loop;
  }

  async getById(loopId: string): Promise<Loop | null> {
    const res = await this.ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { loop_id: loopId },
      }),
    );

    if (!res.Item) return null;

    const { entity_type, category_status, ...loop } = res.Item;
    return loop as Loop;
  }

  /**
   * Generic loop update (title, status, phase, priority, etc.)
   * DOES NOT allow scoring fields
   */
  async update(loop: Partial<Loop> & { loop_id: string }): Promise<Loop> {
    const existing = await this.getById(loop.loop_id);
    if (!existing) {
      throw new Error(`Loop ${loop.loop_id} not found`);
    }

    const updatedAt = new Date().toISOString();

    const names: Record<string, string> = {
      "#updated_at": "updated_at",
    };
    const values: Record<string, unknown> = {
      ":updated_at": updatedAt,
    };
    const sets: string[] = ["#updated_at = :updated_at"];

    // Update category_status if category or status changes
    const newCategory = loop.category || existing.category;
    const newStatus = loop.status || existing.status;
    if (loop.category || loop.status) {
      const category_status = `${newCategory}#${newStatus}`;
      names["#category_status"] = "category_status";
      values[":category_status"] = category_status;
      sets.push("#category_status = :category_status");
    }

    for (const [key, value] of Object.entries(loop)) {
      if (value === undefined) continue;
      if (LoopRepository.IMMUTABLE_FIELDS.has(key)) continue;

      names[`#${key}`] = key;
      values[`:${key}`] = value;
      sets.push(`#${key} = :${key}`);
    }

    if (sets.length === 1) return existing;

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { loop_id: loop.loop_id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(loop_id)",
      }),
    );

    return {
      ...existing,
      ...loop,
      updated_at: updatedAt,
    };
  }

  async scoreOutcome(input: {
    loop_id: string;
    outcome_score: number;
    contributors?: Contributor[];
    lesson?: Lesson;
    updated_by?: string;
  }): Promise<void> {
    const names: Record<string, string> = {
      "#updated_at": "updated_at",
      "#outcome_score": "outcome_score",
    };

    const values: Record<string, unknown> = {
      ":updated_at": new Date().toISOString(),
      ":outcome_score": input.outcome_score,
    };

    const sets: string[] = [
      "#outcome_score = :outcome_score",
      "#updated_at = :updated_at",
    ];

    if (input.contributors) {
      names["#contributors"] = "contributors";
      values[":contributors"] = input.contributors;
      sets.push("#contributors = :contributors");
    }

    if (input.lesson) {
      names["#lesson"] = "lesson";
      values[":lesson"] = input.lesson;
      sets.push("#lesson = :lesson");
    }
    
    if (input.updated_by) {
      names["#updated_by"] = "updated_by";
      values[":updated_by"] = input.updated_by;
      sets.push("#updated_by = :updated_by");
    }

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { loop_id: input.loop_id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(loop_id)",
      }),
    );
  }

  /**
   * Determines the optimal query strategy based on filter parameters
   * Priority: Most selective filter → Best GSI → Least reads
   */
  private selectQueryStrategy(params: LoopListParams): QueryStrategy {
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, string | number | boolean> =
      {};
    const expressionAttributeNames: Record<string, string> = {};

    let indexName: string | undefined;
    let keyConditionExpression: string;
    const scanIndexForward = params.sort_order === "asc";

    // Strategy 1: Category + Status (most selective composite)
    if (params.category && params.status) {
      indexName = "GSI_CategoryStatus";
      keyConditionExpression = "category_status = :cs";
      expressionAttributeValues[":cs"] = `${params.category}#${params.status}`;

      // Add remaining filters
      if (params.phase) {
        filterExpressions.push("#phase = :phase");
        expressionAttributeNames["#phase"] = "phase";
        expressionAttributeValues[":phase"] = params.phase;
      }
      if (params.loop_type) {
        filterExpressions.push("loop_type = :loop_type");
        expressionAttributeValues[":loop_type"] = params.loop_type;
      }
      if (params.owner_email) {
        filterExpressions.push("owner_email = :owner");
        expressionAttributeValues[":owner"] = params.owner_email;
      }
    }
    // Strategy 2: Owner (highly selective)
    else if (params.owner_email) {
      indexName = "GSI_Owner";
      keyConditionExpression = "owner_email = :owner";
      expressionAttributeValues[":owner"] = params.owner_email;

      if (params.category) {
        filterExpressions.push("category = :cat");
        expressionAttributeValues[":cat"] = params.category;
      }
      if (params.status) {
        filterExpressions.push("#status = :status");
        expressionAttributeNames["#status"] = "status";
        expressionAttributeValues[":status"] = params.status;
      }
      if (params.phase) {
        filterExpressions.push("#phase = :phase");
        expressionAttributeNames["#phase"] = "phase";
        expressionAttributeValues[":phase"] = params.phase;
      }
      if (params.loop_type) {
        filterExpressions.push("loop_type = :loop_type");
        expressionAttributeValues[":loop_type"] = params.loop_type;
      }
      if (params.priority) {
        filterExpressions.push("priority = :priority");
        expressionAttributeValues[":priority"] = params.priority;
      }
    }
    // Strategy 3: Category (moderately selective)
    else if (params.category) {
      indexName = "GSI_Category";

      // Use target_date as range key for better sorting
      if (params.target_before) {
        keyConditionExpression =
          "category = :cat AND target_completion_date <= :date";
        expressionAttributeValues[":date"] = params.target_before;
      } else {
        keyConditionExpression = "category = :cat";
      }
      expressionAttributeValues[":cat"] = params.category;

      if (params.status) {
        filterExpressions.push("#status = :status");
        expressionAttributeNames["#status"] = "status";
        expressionAttributeValues[":status"] = params.status;
      }
      if (params.phase) {
        filterExpressions.push("#phase = :phase");
        expressionAttributeNames["#phase"] = "phase";
        expressionAttributeValues[":phase"] = params.phase;
      }
      if (params.loop_type) {
        filterExpressions.push("loop_type = :loop_type");
        expressionAttributeValues[":loop_type"] = params.loop_type;
      }
    }
    // Strategy 4: Status
    else if (params.status) {
      indexName = "GSI_Status";
      keyConditionExpression = "entity_type = :et AND #status = :status";
      expressionAttributeNames["#status"] = "status";
      expressionAttributeValues[":et"] = "LOOP";
      expressionAttributeValues[":status"] = params.status;

      if (params.phase) {
        filterExpressions.push("#phase = :phase");
        expressionAttributeNames["#phase"] = "phase";
        expressionAttributeValues[":phase"] = params.phase;
      }
      if (params.loop_type) {
        filterExpressions.push("loop_type = :loop_type");
        expressionAttributeValues[":loop_type"] = params.loop_type;
      }
    }
    // Strategy 5: Sort-based GSI selection
    else {
      expressionAttributeValues[":et"] = "LOOP";

      switch (params.sort_by) {
        case "priority":
          indexName = "GSI_Priority";
          if (params.priority !== undefined) {
            keyConditionExpression =
              "entity_type = :et AND priority = :priority";
            expressionAttributeValues[":priority"] = params.priority;
          } else {
            keyConditionExpression = "entity_type = :et";
          }
          break;
        case "created_at":
          indexName = "GSI_CreatedAt";
          keyConditionExpression = "entity_type = :et";
          break;
        case "target_date":
          indexName = "GSI_TargetDate";
          if (params.target_before) {
            keyConditionExpression =
              "entity_type = :et AND target_completion_date <= :date";
            expressionAttributeValues[":date"] = params.target_before;
          } else {
            keyConditionExpression = "entity_type = :et";
          }
          break;
        default:
          // Updated_at or no sort - use any GSI
          indexName = "GSI_Status";
          keyConditionExpression = "entity_type = :et";
      }

      // Add all filters as FilterExpression
      if (params.phase) {
        filterExpressions.push("#phase = :phase");
        expressionAttributeNames["#phase"] = "phase";
        expressionAttributeValues[":phase"] = params.phase;
      }
      if (params.loop_type) {
        filterExpressions.push("loop_type = :loop_type");
        expressionAttributeValues[":loop_type"] = params.loop_type;
      }
    }

    // Common filters applied to all strategies
    // if (params.priority) {
    //   filterExpressions.push("priority = :priority");
    //   expressionAttributeValues[":priority"] = params.priority;
    // }

    // Target date filter (if not used in KeyCondition)
    if (
      params.target_before &&
      !keyConditionExpression.includes("target_completion_date")
    ) {
      filterExpressions.push("target_completion_date <= :target_before");
      expressionAttributeValues[":target_before"] = params.target_before;
    }

    return {
      indexName,
      keyConditionExpression,
      expressionAttributeValues,
      expressionAttributeNames:
        Object.keys(expressionAttributeNames).length > 0
          ? expressionAttributeNames
          : undefined,
      filterExpression:
        filterExpressions.length > 0
          ? filterExpressions.join(" AND ")
          : undefined,
      scanIndexForward,
    };
  }

  /**
   * Smart list method that handles multiple filters and sorting
   */
  async list(params: LoopListParams): Promise<ListResult<Loop>> {
    const strategy = this.selectQueryStrategy(params);

    const filteredValues = Object.fromEntries(
      Object.entries(strategy.expressionAttributeValues).filter(
        ([, v]) => v !== undefined && v !== null,
      ),
    );

    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: strategy.indexName,
      KeyConditionExpression: strategy.keyConditionExpression,
      FilterExpression:
        strategy.filterExpression && Object.keys(filteredValues).length > 0
          ? strategy.filterExpression
          : undefined,
      ExpressionAttributeValues:
        Object.keys(filteredValues).length > 0 ? filteredValues : undefined,
      ExpressionAttributeNames: strategy.expressionAttributeNames,
      ExclusiveStartKey: this.decodeLastKey(params.last_key), // decoded cursor
      Limit: params.limit, // page size
      ScanIndexForward: strategy.scanIndexForward, // ascending/descending
    });

    const res = await this.ddb.send(command);

    const items = (res.Items ?? []).map(
      ({ entity_type, category_status, ...item }) => item as Loop,
    );

    const nextCursor = res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64")
      : undefined;

    return {
      items,
      count: items.length,
      lastKey: nextCursor,
    };
  }

  async adaptLoop(input: {
    loop_id: string;
    why: string;
    what?: string;
    new_target_date: string;
    previous_target_date: string;
    follow_on_loop_id?: string;
    updated_by?: string;
  }): Promise<void> {
    const adaptationRecord = {
      why: input.why,
      what: input.what,
      previous_target_date: input.previous_target_date,
      new_target_date: input.new_target_date,
      adapted_at: new Date().toISOString(),
      follow_on_loop_id: input.follow_on_loop_id,
    };

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { loop_id: input.loop_id },
        UpdateExpression:
          "SET target_completion_date = :new_date, " +
          "#phase = :phase, " +
          "adaptations = list_append(if_not_exists(adaptations, :empty_list), :adaptation), " +
          "updated_at = :updated, " +
          "updated_by = :updated_by",
        ExpressionAttributeNames: {
          "#phase": "phase",
        },
        ExpressionAttributeValues: {
          ":new_date": input.new_target_date,
          ":phase": "ADAPTATION",
          ":adaptation": [adaptationRecord],
          ":empty_list": [],
          ":updated": new Date().toISOString(),
          ":updated_by": input.updated_by || null,
        },
        ConditionExpression: "attribute_exists(loop_id)",
      }),
    );
  }

  async scoreEffort(loop_id: string, effort_score: number, updated_by?: string): Promise<void> {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { loop_id },
        UpdateExpression: "SET effort_score = :effort, updated_at = :updated, updated_by = :updated_by",
        ExpressionAttributeValues: {
          ":effort": effort_score,
          ":updated": new Date().toISOString(),
          ":updated_by": updated_by || null,
        },
        ConditionExpression: "attribute_exists(loop_id)",
      }),
    );
  }

  async delete(loop_id: string) {
    await this.ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { loop_id },
      }),
    );

    return { loop_id };
  }
}
