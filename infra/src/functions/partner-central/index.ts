import type { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { PartnerRepository } from "src/repos/partner-central.repository";
import { createLogger } from "../shared/logger";
import { err, ok } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

type LambdaEvent =
	| { type: "listOpportunities"; catalog?: string }
	| { type: "getOpportunity"; id: string; catalog?: string }
	| { type: "getAllOpportunities"; catalog?: string }
	| { type: "listEngagements"; catalog?: string }
	| { type: "getEngagement"; id: string; catalog?: string }
	| { type: "getAllEngagements"; catalog?: string }
	| {
			type: "listEngagementInvitations";
			participantType?: "SENDER" | "RECEIVER";
			catalog?: string;
	  }
	| { type: "getEngagementInvitation"; id: string; catalog?: string }
	| {
			type: "getAllInvitations";
			participantType?: "SENDER" | "RECEIVER";
			catalog?: string;
	  };

const logger = createLogger("partner-central");

const _handler: APIGatewayProxyHandler = async (
	event,
): Promise<APIGatewayProxyResult> => {
	try {
		const body: LambdaEvent = JSON.parse(event.body || "{}");
		const repo = new PartnerRepository(process.env.ROLE_ARN!);
		console.log(process.env.ROLE_ARN);
		await repo.init();

		switch (body.type) {
			case "listOpportunities":
				return ok(await repo.listOpportunities(body.catalog));

			case "getOpportunity":
				return ok(await repo.getOpportunity(body.id, body.catalog));

			case "getAllOpportunities":
				return ok(await repo.getAllOpportunities(body.catalog));

			case "listEngagements":
				return ok(await repo.listEngagements(body.catalog));

			case "getEngagement":
				return ok(await repo.getEngagement(body.id, body.catalog));

			case "getAllEngagements":
				return ok(await repo.getAllEngagements(body.catalog));

			case "listEngagementInvitations":
				return ok(
					await repo.listEngagementInvitations(
						body.catalog,
						body.participantType,
					),
				);

			case "getEngagementInvitation":
				return ok(await repo.getEngagementInvitation(body.id, body.catalog));

			case "getAllInvitations":
				return ok(
					await repo.getAllInvitations(body.catalog, body.participantType),
				);

			default:
				return err("Unknown type", 400);
		}
	} catch (e: any) {
		logger.error(e.message || "Internal server error");
		return err(e.message || "Internal server error");
	}
};

export const handler = withPermissions(_handler);
