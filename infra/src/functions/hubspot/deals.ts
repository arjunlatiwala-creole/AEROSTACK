import type { Client } from "@hubspot/api-client";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";
import {
	type CompanyInfo,
	type ContactInfo,
	type DealsPageFormatContext,
	formatDeal,
	formatDealsPage,
} from "./formatters";
import { getClient } from "./shared";

// ---- Helper functions ----

const fullName = (props: { firstname?: string; lastname?: string } = {}) =>
	[props.firstname, props.lastname].filter(Boolean).join(" ");

// ---- Lambdas ----

const _listDeals: APIGatewayProxyHandler = async (event) => {
	const logger = createLogger("listDeals");
	try {
		const authResult = authorizeUser(event, UserRole.ENGINEER);
		if (isAuthError(authResult)) {
			return authResult.error;
		}

		const { user } = authResult;
		logger.info(`listDeals accessed by role=${user.role}`);

		const client: Client = await getClient();
		const limit = parseInt(event.queryStringParameters?.limit || "100", 10);
		const after = event.queryStringParameters?.after || undefined;


		// 1) get deals with associations
		const dealsPage = await client.crm.deals.basicApi.getPage(
			limit,
			after,
			undefined,
			undefined,
			["companies", "contacts"],
			false,
		);
		const propertiesResponse =
			await client.crm.properties.coreApi.getAll("deals");
		const properties = propertiesResponse;
		console.dir(properties, { depth: null, colors: true });

		logger.info(`listDeals fetched ${dealsPage.results.length} deals`);

		// 2) collect IDs
		const companyIds = new Set<string>();
		const contactIds = new Set<string>();

		dealsPage.results.forEach((deal) => {
			// Access the results array within the association response
			const companyAssocs = deal.associations?.companies?.results;
			const contactAssocs = deal.associations?.contacts?.results;

			if (companyAssocs && Array.isArray(companyAssocs)) {
				companyAssocs.forEach((a) => companyIds.add(a.id));
			}

			if (contactAssocs && Array.isArray(contactAssocs)) {
				contactAssocs.forEach((a) => contactIds.add(a.id));
			}
		});

		// 3) batch fetch companies
		const companyMap: Map<string, CompanyInfo> = new Map();
		if (companyIds.size > 0) {
			const companiesRes = await client.crm.companies.batchApi.read({
				inputs: Array.from(companyIds).map((id) => ({ id })),
				properties: ["name"],
				propertiesWithHistory: [],
			});
			companiesRes.results.forEach((c) => {
				companyMap.set(c.id, { name: c.properties?.name ?? "" });
			});
		}

		// 4) batch fetch contacts
		const contactMap: Map<string, ContactInfo> = new Map();
		if (contactIds.size > 0) {
			const contactsRes = await client.crm.contacts.batchApi.read({
				inputs: Array.from(contactIds).map((id) => ({ id })),
				properties: ["firstname", "lastname", "email"],
				propertiesWithHistory: [],
			});
			contactsRes.results.forEach((ct) => {
				const props = ct.properties ?? {};
				contactMap.set(ct.id, {
					fullName: fullName({
						firstname: props.firstname || "",
						lastname: props.lastname || "",
					}),
					email: props.email || "",
				});
			});
		}

		const ctx: DealsPageFormatContext = { companyMap, contactMap };

		// 5) format
		const formattedData = formatDealsPage(dealsPage, ctx);

		// Add next cursor for pagination
		const nextAfter = dealsPage.paging?.next?.after || null;
		const response = {
			...formattedData,
			next: formattedData.hasMore ? nextAfter : null,
		};

		return ok(response);
	} catch (e: any) {
		logger.error("listDeals error:", e);
		return err(e?.message ?? "Internal error");
	}
};
export const listDeals = withPermissions(_listDeals);

const _getDeal: APIGatewayProxyHandler = async (event) => {
	const logger = createLogger("getDeal");

	try {
		const authResult = authorizeUser(event, UserRole.ENGINEER);
		if (isAuthError(authResult)) {
			return authResult.error;
		}

		const { user } = authResult;

		const id = event.pathParameters?.id;
		if (!id) {
			return err("ID required", 400);
		}

		logger.info(`getDeal accessed by role=${user.role}`);

		const client: Client = await getClient();

		// 1) deal with associations
		const deal = await client.crm.deals.basicApi.getById(id, undefined, [
			"companies",
			"contacts",
		]);

		// 2) resolve first company + contact
		let companyName: string | undefined;
		let contactName: string | undefined;
		let contactEmail: string | undefined;

		// Access results array safely
		const companyResults = deal.associations?.companies?.results;
		const contactResults = deal.associations?.contacts?.results;

		const companyId =
			companyResults &&
				Array.isArray(companyResults) &&
				companyResults.length > 0
				? companyResults[0].id
				: undefined;

		const contactId =
			contactResults &&
				Array.isArray(contactResults) &&
				contactResults.length > 0
				? contactResults[0].id
				: undefined;

		if (companyId) {
			const company = await client.crm.companies.basicApi.getById(companyId, [
				"name",
			]);
			companyName = company.properties?.name || "";
		}

		if (contactId) {
			const contact = await client.crm.contacts.basicApi.getById(contactId, [
				"firstname",
				"lastname",
				"email",
			]);
			const props = contact.properties ?? {};
			contactName = fullName({
				firstname: props.firstname || "",
				lastname: props.lastname || "",
			});
			contactEmail = props.email || "";
		}

		const formattedData = formatDeal(deal, {
			companyName,
			contactName,
			contactEmail,
		});

		return ok(formattedData);
	} catch (e: any) {
		logger.error("getDeal error:", e);
		return err(e?.message ?? "Internal error");
	}
};
export const getDeal = withPermissions(_getDeal);
