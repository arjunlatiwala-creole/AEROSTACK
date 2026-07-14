import {
	type DynamoDBDocumentClient,
	ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export interface APNListParams {
	limit?: number;
	last_key?: string | null;
	stage?: string;
	status?: string;
}

export interface APNPaginatedResult<T> {
	items: T[];
	total: number;
	totalPages: number;
	pageSize: number;
	hasMore: boolean;
	nextCursor: string | null;
	count: number;
}

// Flattened/transformed types for API responses
export interface APNOpportunity {
	opportunityId: string;
	arn: string;
	catalog: string;
	createdDate: string;
	lastModifiedDate: string;
	customerCompanyName: string;
	customerIndustry: string;
	customerCity?: string;
	customerCountry: string;
	customerWebsite?: string;
	projectTitle: string;
	projectDescription?: string;
	customerUseCase?: string;
	deliveryModels?: string[];
	awsProducts?: string[];
	solutions?: string[];
	stage: string;
	reviewStatus: string;
	targetCloseDate?: string;
	expectedMonthlySpend?: number;
	currencyCode?: string;
	ownerEmail?: string;
	ownerName?: string;
	opportunityType?: string;
	campaignName?: string;
	awsFundingUsed?: string;
}

export interface APNEngagement {
	engagementId: string;
	arn: string;
	catalog: string;
	createdAt: string;
	createdBy: string;
	title: string;
	description: string;
	memberCount: number;
	customerCompanyName?: string;
	customerCountry?: string;
	customerIndustry?: string;
	customerWebsite?: string;
	projectTitle?: string;
	projectDescription?: string;
	targetCompletionDate?: string;
}

export interface APNEngagementInvitation {
	invitationId: string;
	arn: string;
	catalog: string;
	engagementId: string;
	engagementTitle: string;
	engagementDescription: string;
	invitationDate: string;
	invitationMessage?: string;
	status: string;
	customerCompanyName: string;
	customerCountry: string;
	customerIndustry?: string;
	customerWebsite?: string;
	projectTitle: string;
	projectDescription?: string;
	targetCompletionDate?: string;
	expectedMonthlySpend?: number;
	currencyCode?: string;
	senderCompanyName: string;
	senderAwsAccountId: string;
	receiverAlias?: string;
	receiverAwsAccountId?: string;
	receiverResponsibilities?: string[];
}

type PaginationKey = Record<string, string | number>;

export class APNRepository {
	constructor(
		private readonly ddb: DynamoDBDocumentClient,
		private readonly opportunitiesTableName: string,
		private readonly engagementsTableName: string,
		private readonly invitationsTableName: string,
	) {}

	private decodeLastKey(lastKey?: string | null): PaginationKey | undefined {
		if (!lastKey) return undefined;
		try {
			return JSON.parse(
				Buffer.from(lastKey, "base64").toString("utf-8"),
			) as PaginationKey;
		} catch {
			return undefined;
		}
	}

	private encodeLastKey(lastKey?: PaginationKey): string | null {
		if (!lastKey) return null;
		return Buffer.from(JSON.stringify(lastKey), "utf-8").toString("base64");
	}

	// ============ Transform Functions ============

	private transformOpportunity(raw: Record<string, any>): APNOpportunity {
		const owner = raw.OpportunityTeam?.find(
			(t: any) => t.BusinessTitle === "OpportunityOwner",
		);
		const expectedSpend = raw.Project?.ExpectedCustomerSpend?.[0];

		return {
			opportunityId: raw.Id || raw.opportunityId,
			arn: raw.Arn,
			catalog: raw.Catalog,
			createdDate: raw.CreatedDate,
			lastModifiedDate: raw.LastModifiedDate,
			customerCompanyName: raw.Customer?.Account?.CompanyName || "",
			customerIndustry: raw.Customer?.Account?.Industry || "",
			customerCity: raw.Customer?.Account?.Address?.City,
			customerCountry: raw.Customer?.Account?.Address?.CountryCode || "",
			customerWebsite: raw.Customer?.Account?.WebsiteUrl,
			projectTitle: raw.Project?.Title || "",
			projectDescription: raw.Project?.CustomerBusinessProblem,
			customerUseCase: raw.Project?.CustomerUseCase,
			deliveryModels: raw.Project?.DeliveryModels,
			awsProducts: raw.RelatedEntityIdentifiers?.AwsProducts,
			solutions: raw.RelatedEntityIdentifiers?.Solutions,
			stage: raw.LifeCycle?.Stage || "",
			reviewStatus: raw.LifeCycle?.ReviewStatus || "",
			targetCloseDate: raw.LifeCycle?.TargetCloseDate,
			expectedMonthlySpend: expectedSpend?.Amount
				? Number(expectedSpend.Amount)
				: undefined,
			currencyCode: expectedSpend?.CurrencyCode,
			ownerEmail: owner?.Email,
			ownerName: owner ? `${owner.FirstName} ${owner.LastName}` : undefined,
			opportunityType: raw.OpportunityType,
			campaignName: raw.Marketing?.CampaignName,
			awsFundingUsed: raw.Marketing?.AwsFundingUsed,
		};
	}

	private transformEngagement(raw: Record<string, any>): APNEngagement {
		const customerProject = raw.Contexts?.[0]?.Payload?.CustomerProject;

		return {
			engagementId: raw.Id || raw.engagementId,
			arn: raw.Arn,
			catalog: raw.Catalog || "AWS",
			createdAt: raw.CreatedAt,
			createdBy: raw.CreatedBy,
			title: raw.Title || "",
			description: raw.Description || "",
			memberCount: raw.MemberCount || 0,
			customerCompanyName: customerProject?.Customer?.CompanyName,
			customerCountry: customerProject?.Customer?.CountryCode,
			customerIndustry: customerProject?.Customer?.Industry,
			customerWebsite: customerProject?.Customer?.WebsiteUrl,
			projectTitle: customerProject?.Project?.Title,
			projectDescription: customerProject?.Project?.BusinessProblem,
			targetCompletionDate: customerProject?.Project?.TargetCompletionDate,
		};
	}

	private transformInvitation(
		raw: Record<string, any>,
	): APNEngagementInvitation {
		const oppInvite = raw.Payload?.OpportunityInvitation;
		const expectedSpend = oppInvite?.Project?.ExpectedCustomerSpend?.[0];

		return {
			invitationId: raw.Id || raw.invitationId,
			arn: raw.Arn,
			catalog: raw.Catalog || "AWS",
			engagementId: raw.EngagementId,
			engagementTitle: raw.EngagementTitle || "",
			engagementDescription: raw.EngagementDescription || "",
			invitationDate: raw.InvitationDate,
			invitationMessage: raw.InvitationMessage,
			status: raw.Status || "",
			customerCompanyName: oppInvite?.Customer?.CompanyName || "",
			customerCountry: oppInvite?.Customer?.CountryCode || "",
			customerIndustry: oppInvite?.Customer?.Industry,
			customerWebsite: oppInvite?.Customer?.WebsiteUrl,
			projectTitle: oppInvite?.Project?.Title || "",
			projectDescription: oppInvite?.Project?.BusinessProblem,
			targetCompletionDate: oppInvite?.Project?.TargetCompletionDate,
			expectedMonthlySpend: expectedSpend?.Amount
				? Number(expectedSpend.Amount)
				: undefined,
			currencyCode: expectedSpend?.CurrencyCode,
			senderCompanyName: raw.SenderCompanyName || "",
			senderAwsAccountId: raw.SenderAwsAccountId || "",
			receiverAlias: raw.Receiver?.Account?.Alias,
			receiverAwsAccountId: raw.Receiver?.Account?.AwsAccountId,
			receiverResponsibilities: oppInvite?.ReceiverResponsibilities,
		};
	}

	// ============ List Methods ============

	async listOpportunities(
		params: APNListParams,
	): Promise<APNPaginatedResult<APNOpportunity>> {
		const limit = params.limit || 20;
		const filterExpressions: string[] = [];
		const expressionAttributeValues: Record<string, any> = {};
		const expressionAttributeNames: Record<string, string> = {};

		if (params.stage) {
			filterExpressions.push("LifeCycle.Stage = :stage");
			expressionAttributeValues[":stage"] = params.stage;
		}

		if (params.status) {
			filterExpressions.push("LifeCycle.ReviewStatus = :reviewStatus");
			expressionAttributeValues[":reviewStatus"] = params.status;
		}

		const command = new ScanCommand({
			TableName: this.opportunitiesTableName,
			Limit: limit,
			ExclusiveStartKey: this.decodeLastKey(params.last_key),
			FilterExpression:
				filterExpressions.length > 0
					? filterExpressions.join(" AND ")
					: undefined,
			ExpressionAttributeValues:
				Object.keys(expressionAttributeValues).length > 0
					? expressionAttributeValues
					: undefined,
			ExpressionAttributeNames:
				Object.keys(expressionAttributeNames).length > 0
					? expressionAttributeNames
					: undefined,
		});

		const result = await this.ddb.send(command);
		const items = (result.Items || []).map((item) =>
			this.transformOpportunity(item),
		);
		const nextCursor = this.encodeLastKey(result.LastEvaluatedKey);

		// For total count, we'd need a separate count scan or maintain a counter
		// For now, estimate based on hasMore
		const hasMore = !!result.LastEvaluatedKey;
		const count = items.length;

		return {
			items,
			total: result.ScannedCount || count,
			totalPages: Math.ceil((result.ScannedCount || count) / limit),
			pageSize: limit,
			hasMore,
			nextCursor,
			count,
		};
	}

	async listEngagements(
		params: APNListParams,
	): Promise<APNPaginatedResult<APNEngagement>> {
		const limit = params.limit || 20;

		const command = new ScanCommand({
			TableName: this.engagementsTableName,
			Limit: limit,
			ExclusiveStartKey: this.decodeLastKey(params.last_key),
		});

		const result = await this.ddb.send(command);
		const items = (result.Items || []).map((item) =>
			this.transformEngagement(item),
		);
		const nextCursor = this.encodeLastKey(result.LastEvaluatedKey);

		const hasMore = !!result.LastEvaluatedKey;
		const count = items.length;

		return {
			items,
			total: result.ScannedCount || count,
			totalPages: Math.ceil((result.ScannedCount || count) / limit),
			pageSize: limit,
			hasMore,
			nextCursor,
			count,
		};
	}

	async listEngagementInvitations(
		params: APNListParams,
	): Promise<APNPaginatedResult<APNEngagementInvitation>> {
		const limit = params.limit || 20;
		const filterExpressions: string[] = [];
		const expressionAttributeValues: Record<string, any> = {};

		if (params.status) {
			filterExpressions.push("#status = :status");
			expressionAttributeValues[":status"] = params.status;
		}

		const command = new ScanCommand({
			TableName: this.invitationsTableName,
			Limit: limit,
			ExclusiveStartKey: this.decodeLastKey(params.last_key),
			FilterExpression:
				filterExpressions.length > 0
					? filterExpressions.join(" AND ")
					: undefined,
			ExpressionAttributeValues:
				Object.keys(expressionAttributeValues).length > 0
					? expressionAttributeValues
					: undefined,
			ExpressionAttributeNames: params.status
				? { "#status": "Status" }
				: undefined,
		});

		const result = await this.ddb.send(command);
		const items = (result.Items || []).map((item) =>
			this.transformInvitation(item),
		);
		const nextCursor = this.encodeLastKey(result.LastEvaluatedKey);

		const hasMore = !!result.LastEvaluatedKey;
		const count = items.length;

		return {
			items,
			total: result.ScannedCount || count,
			totalPages: Math.ceil((result.ScannedCount || count) / limit),
			pageSize: limit,
			hasMore,
			nextCursor,
			count,
		};
	}
}
