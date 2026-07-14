import {
	GetEngagementCommand,
	GetEngagementInvitationCommand,
	GetOpportunityCommand,
	ListEngagementInvitationsCommand,
	ListEngagementsCommand,
	ListOpportunitiesCommand,
	PartnerCentralSellingClient,
} from "@aws-sdk/client-partnercentral-selling";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

/**
 * Simplified Partner Repository for Co-Sell and Funding Data
 *
 * Core Focus (like Suger.io):
 * - Opportunities (co-sell deals)
 * - Engagements (active partnerships)
 * - Engagement Invitations (incoming co-sell requests)
 *
 * This covers:
 * ✅ Co-sell pipeline tracking
 * ✅ Deal management
 * ✅ Partner referrals
 * ✅ Revenue/funding opportunities
 */
export class PartnerRepository {
	private client!: PartnerCentralSellingClient;

	constructor(
		private roleArn: string,
		private region = "us-east-1",
	) {}

	public async init() {
		const sts = new STSClient({ region: this.region });
		const assumed = await sts.send(
			new AssumeRoleCommand({
				RoleArn: this.roleArn,
				RoleSessionName: "PartnerCentralSession",
			}),
		);

		const creds = assumed.Credentials!;
		this.client = new PartnerCentralSellingClient({
			region: this.region,
			credentials: {
				accessKeyId: creds.AccessKeyId!,
				secretAccessKey: creds.SecretAccessKey!,
				sessionToken: creds.SessionToken!,
			},
		});
	}

	// ===== OPPORTUNITIES (Co-Sell Deals) =====

	/**
	 * List all co-sell opportunities with pagination
	 * This is the PRIMARY source of co-sell pipeline and funding data
	 */
	public async listOpportunities(
		catalog = "AWS",
		maxResults = 100,
		nextToken?: string,
	): Promise<{ opportunities: any[]; nextToken?: string }> {
		const resp = await this.client.send(
			new ListOpportunitiesCommand({
				Catalog: catalog,
				MaxResults: maxResults,
				NextToken: nextToken,
			}),
		);
		return {
			opportunities: resp.OpportunitySummaries || [],
			nextToken: resp.NextToken,
		};
	}

	/**
	 * Get detailed opportunity information including:
	 * - Deal size/value
	 * - Customer info
	 * - Stage/status
	 * - Expected close date
	 * - Products involved
	 */
	public async getOpportunity(id: string, catalog = "AWS"): Promise<any> {
		const resp = await this.client.send(
			new GetOpportunityCommand({ Identifier: id, Catalog: catalog }),
		);
		return resp;
	}

	/**
	 * Get all opportunities with automatic pagination
	 * Use this for dashboard/reporting on all co-sell deals
	 */
	public async getAllOpportunities(catalog = "AWS"): Promise<any[]> {
		const allOpportunities: any[] = [];
		let nextToken: string | undefined;

		do {
			const result = await this.listOpportunities(catalog, 100, nextToken);
			allOpportunities.push(...result.opportunities);
			nextToken = result.nextToken;
		} while (nextToken);

		return allOpportunities;
	}

	// ===== ENGAGEMENTS (Active Partnerships) =====

	/**
	 * List all active engagements (accepted co-sell partnerships)
	 */
	public async listEngagements(
		catalog = "AWS",
		maxResults = 100,
		nextToken?: string,
	): Promise<{ engagements: any[]; nextToken?: string }> {
		const resp = await this.client.send(
			new ListEngagementsCommand({
				Catalog: catalog,
				MaxResults: maxResults,
				NextToken: nextToken,
			}),
		);
		return {
			engagements: resp.EngagementSummaryList || [],
			nextToken: resp.NextToken,
		};
	}

	/**
	 * Get detailed engagement information
	 */
	public async getEngagement(id: string, catalog = "AWS"): Promise<any> {
		const resp = await this.client.send(
			new GetEngagementCommand({ Identifier: id, Catalog: catalog }),
		);
		return resp;
	}

	/**
	 * Get all engagements with automatic pagination
	 */
	public async getAllEngagements(catalog = "AWS"): Promise<any[]> {
		const allEngagements: any[] = [];
		let nextToken: string | undefined;

		do {
			const result = await this.listEngagements(catalog, 100, nextToken);
			allEngagements.push(...result.engagements);
			nextToken = result.nextToken;
		} while (nextToken);

		return allEngagements;
	}

	// ===== ENGAGEMENT INVITATIONS (Incoming Referrals) =====

	/**
	 * List engagement invitations (co-sell referrals from AWS)
	 * participantType:
	 * - "RECEIVER" = invitations you received from AWS (default)
	 * - "SENDER" = invitations you sent to AWS
	 */
	public async listEngagementInvitations(
		catalog = "AWS",
		participantType: "SENDER" | "RECEIVER" = "RECEIVER",
		maxResults = 100,
		nextToken?: string,
	): Promise<{ invitations: any[]; nextToken?: string }> {
		const resp = await this.client.send(
			new ListEngagementInvitationsCommand({
				Catalog: catalog,
				ParticipantType: participantType,
				MaxResults: maxResults,
				NextToken: nextToken,
			}),
		);
		return {
			invitations: resp.EngagementInvitationSummaries || [],
			nextToken: resp.NextToken,
		};
	}

	/**
	 * Get engagement invitation details
	 */
	public async getEngagementInvitation(
		identifier: string,
		catalog = "AWS",
	): Promise<any> {
		const resp = await this.client.send(
			new GetEngagementInvitationCommand({
				Identifier: identifier,
				Catalog: catalog,
			}),
		);
		return resp;
	}

	/**
	 * Get all invitations with automatic pagination
	 */
	public async getAllInvitations(
		catalog = "AWS",
		participantType: "SENDER" | "RECEIVER" = "RECEIVER",
	): Promise<any[]> {
		const allInvitations: any[] = [];
		let nextToken: string | undefined;

		do {
			const result = await this.listEngagementInvitations(
				catalog,
				participantType,
				100,
				nextToken,
			);
			allInvitations.push(...result.invitations);
			nextToken = result.nextToken;
		} while (nextToken);

		return allInvitations;
	}
}
