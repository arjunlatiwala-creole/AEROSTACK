// APN (AWS Partner Network) Types

// ============ Opportunity Types ============

export interface APNOpportunity {
	opportunityId: string;
	arn: string;
	catalog: string;
	createdDate: string;
	lastModifiedDate: string;

	// Customer Info
	customerCompanyName: string;
	customerIndustry: string;
	customerCity?: string;
	customerCountry: string;
	customerWebsite?: string;

	// Project Info
	projectTitle: string;
	projectDescription?: string;
	customerUseCase?: string;
	deliveryModels?: string[];
	awsProducts?: string[];
	solutions?: string[];

	// Lifecycle
	stage: string;
	reviewStatus: string;
	targetCloseDate?: string;

	// Financial
	expectedMonthlySpend?: number;
	currencyCode?: string;

	// Team
	ownerEmail?: string;
	ownerName?: string;
	opportunityType?: string;

	// Marketing
	campaignName?: string;
	awsFundingUsed?: string;
}

// ============ Engagement Types ============

export interface APNEngagement {
	engagementId: string;
	arn: string;
	catalog: string;
	createdAt: string;
	createdBy: string;

	title: string;
	description: string;
	memberCount: number;

	// Customer Project Context
	customerCompanyName?: string;
	customerCountry?: string;
	customerIndustry?: string;
	customerWebsite?: string;

	projectTitle?: string;
	projectDescription?: string;
	targetCompletionDate?: string;
}

// ============ Engagement Invitation Types ============

export type APNInvitationStatus =
	| "PENDING"
	| "ACCEPTED"
	| "REJECTED"
	| "EXPIRED";

export interface APNEngagementInvitation {
	invitationId: string;
	arn: string;
	catalog: string;

	engagementId: string;
	engagementTitle: string;
	engagementDescription: string;

	invitationDate: string;
	invitationMessage?: string;
	status: APNInvitationStatus;

	// Customer Info
	customerCompanyName: string;
	customerCountry: string;
	customerIndustry?: string;
	customerWebsite?: string;

	// Project Info
	projectTitle: string;
	projectDescription?: string;
	targetCompletionDate?: string;
	expectedMonthlySpend?: number;
	currencyCode?: string;

	// Sender Info
	senderCompanyName: string;
	senderAwsAccountId: string;

	// Receiver Info
	receiverAlias?: string;
	receiverAwsAccountId?: string;

	// Responsibilities
	receiverResponsibilities?: string[];

	// Contacts
	senderContacts?: Array<{
		firstName: string;
		lastName: string;
		email: string;
		businessTitle: string;
	}>;
}

// ============ List Parameters ============

export interface APNListParams {
	limit?: number;
	last_key?: string | null;
	stage?: string;
	status?: string;
	search?: string;
}

// ============ Paginated Result ============

export interface APNPaginatedResult<T> {
	items: T[];
	total: number;
	totalPages: number;
	pageSize: number;
	hasMore: boolean;
	nextCursor: string | null;
	count: number;
}

// ============ Constants ============

export const OPPORTUNITY_STAGES = [
	"Prospect",
	"Qualified",
	"Technical Validation",
	"Business Validation",
	"Committed",
	"Launched",
	"Closed Lost",
] as const;

export const OPPORTUNITY_REVIEW_STATUSES = [
	"Pending Submission",
	"Submitted",
	"In Review",
	"Approved",
	"Rejected",
	"Action Required",
] as const;

export const INVITATION_STATUSES: APNInvitationStatus[] = [
	"PENDING",
	"ACCEPTED",
	"REJECTED",
	"EXPIRED",
];
