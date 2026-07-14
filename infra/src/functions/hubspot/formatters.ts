import { close } from "fs";
import { pipeline } from "stream";
import { pipe } from "zod";

export type ContactInfo = {
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};
export type CompanyInfo = {
  name: string;
  ownerEmail?: string;
};
export type DealFormatExtras = {
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
};

export type DealsPageFormatContext = {
  companyMap: Map<string, CompanyInfo>;
  contactMap: Map<string, ContactInfo>;
};

export function formatDeal(deal: any, extras: DealFormatExtras = {}) {
  const props = deal.properties ?? {};
  return {
    id: deal.id,
    name: props.dealname || null,
    amount: props.amount || null,
    stage: props.dealstage || null,
    ownerId: props.hubspot_owner_id || null,
    createdAt: props.createdate || null,
    updatedAt: props.lastmodifieddate || null,
    companyName: extras.companyName || null,
    contactName: extras.contactName || null,
    contactEmail: extras.contactEmail || null,
  };
}

export function formatDealsPage(page: any, ctx?: DealsPageFormatContext) {
  const deals =
    page.results?.map((deal: any) => {
      if (!ctx) {
        return formatDeal(deal);
      }

      const companyResults = deal.associations?.companies?.results;
      const contactResults = deal.associations?.contacts?.results;

      const firstCompanyId =
        companyResults &&
        Array.isArray(companyResults) &&
        companyResults.length > 0
          ? companyResults[0].id
          : undefined;

      const firstContactId =
        contactResults &&
        Array.isArray(contactResults) &&
        contactResults.length > 0
          ? contactResults[0].id
          : undefined;

      const companyName = firstCompanyId
        ? ctx.companyMap.get(firstCompanyId)
        : undefined;
      const contactInfo = firstContactId
        ? ctx.contactMap.get(firstContactId)
        : undefined;

      return formatDeal(deal, {
        // companyName,
        contactName: contactInfo?.fullName,
        contactEmail: contactInfo?.email,
      });
    }) || [];

  return {
    total: page.total || deals.length || 0,
    hasMore: !!page.paging?.next?.link,
    deals,
  };
}

//list deals from table
export type DealListFormatExtras = {
  companyName?: string | null;
  companyOwnerEmail?: string | null;
  contacts?: ContactInfo[] | null; // changed from single contactName/contactEmail
};

export function formatDealList(deal: any, extras: DealListFormatExtras = {}) {
  return {
    id: deal.dealId ?? null,
    name: deal.dealname ?? null,
    amount: deal.amount ?? null,
    phase: deal.phase ?? null,
    pipeline: deal.pipeline ?? null,
    pipeline_name: deal.pipelineName ?? null,
    stage: deal.dealstage ?? null,
    stage_name: deal.dealstageName ?? null,
    health_status: deal.health_status ?? null,
    createdate: deal.createdate ?? null,
    closedate: deal.closedate ?? null,
    lastmodifieddate: deal.hs_lastmodifieddate ?? null,
    companyName: extras.companyName ?? null,
    companyOwnerEmail: extras.companyOwnerEmail ?? null,
    // contactName: extras.contactName ?? null,
    // contactEmail: extras.contactEmail ?? null,
    contacts: extras.contacts ?? [],
    ownerName: deal.ownerName ?? null,
    ownerEmail: deal.ownerEmail ?? null,
    ownerId: deal.ownerId ?? null,
  };
}

/* Format a page of deals, using context to map company/contact IDs */
export function formatDealsListPage(page: any, ctx?: DealsPageFormatContext) {
  const deals =
    page.results?.map((deal: any) => {
      if (!ctx) return formatDealList(deal);

      const companyId = deal.companyIds?.[0];
      const companyName = companyId
        ? (ctx.companyMap.get(companyId) ?? null)
        : null;

      // Map ALL contactIds instead of just the first
      const contacts: ContactInfo[] = (deal.contactIds ?? [])
        .map((id: string) => ctx.contactMap.get(id))
        .filter(Boolean)
        .map((info: ContactInfo) => ({
          fullName: [info.fullName].filter(Boolean).join("") || null,
          email: info.email ?? null,
        }));

      const companyInfo = companyId ? ctx.companyMap.get(companyId) : null;

      return formatDealList(deal, {
        companyName: companyInfo?.name ?? null,
        companyOwnerEmail: companyInfo?.ownerEmail ?? null,
        contacts,
      });
    }) || [];

  return {
    total: page.total || deals.length || 0,
    hasMore: !!page.paging?.next?.link,
    deals,
  };
}

// Format a single deal's details

export type DealExtras = {
  companies?: any[];
  contacts?: any[];
};
export function format(deal: any, extras: DealExtras = {}) {
  return {
    id: deal.id ?? deal.dealId ?? null,
    name: deal.properties?.dealname ?? deal.dealname ?? null,
    amount: deal.properties?.amount ?? deal.amount ?? null,
    phase: deal.properties?.phase ?? deal.phase ?? null,
    pipeline: deal.properties?.pipeline ?? deal.pipeline ?? null,
    pipeline_name: deal.properties?.pipelineName ?? deal.pipelineName ?? null,
    stage: deal.properties?.dealstage ?? deal.dealstage ?? null,
    stage_name: deal.properties?.dealstageName ?? deal.dealstageName ?? null,
    health_status: deal.properties?.health_status ?? deal.health_status ?? null,
    createdate: deal.properties?.createdate ?? deal.createdate ?? null,
    closedate: deal.properties?.closedate ?? deal.closedate ?? null,
    lastmodifieddate:
      deal.properties?.hs_lastmodifieddate ?? deal.hs_lastmodifieddate ?? null,

    // 🔽 NEW
    companies: extras.companies ?? [],
    contacts: extras.contacts ?? [],
  };
}

export function formatDealPage(page: any, ctx?: DealsPageFormatContext) {
  const deals =
    page.results?.map((deal: any) => {
      if (!ctx) return formatDeal(deal);

      const companyResults = deal.associations?.companies?.results || [];
      const contactResults = deal.associations?.contacts?.results || [];

      const companies = companyResults
        .map((c: any) => ctx.companyMap.get(c.id))
        .filter(Boolean);

      const contacts = contactResults
        .map((c: any) => ctx.contactMap.get(c.id))
        .filter(Boolean);

      return format(deal, {
        companies,
        contacts,
      });
    }) || [];

  return {
    total: page.total || deals.length || 0,
    hasMore: !!page.paging?.next?.link,
    deals,
  };
}
export function formatCompany(c: any) {
  return {
    id: c.companyId ?? c.id ?? null,
    name: c.name ?? null,
    domain: c.domain ?? null,
    ownerEmail: c.ownerEmail ?? c.owner_email ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    industry: c.industry ?? null,
    ownerName: c.ownerName ?? null,
    createdAt: c.createdAt ?? c.createdate ?? null,
    lastModified: c.hs_lastmodifieddate ?? null,
  };
}

export function formatContact(c: any) {
  return {
    id: c.contactId ?? c.id ?? null,
    firstName: c.firstname ?? null,
    lastName: c.lastname ?? null,
    fullName: [c.firstname, c.lastname].filter(Boolean).join(" "),
    email: c.email ?? null,
    createdAt: c.createdAt ?? c.createdate ?? null,
    lastModified: c.lastmodifieddate ?? null,
  };
}

export function formatSingleDeal(deal: any, extras: DealExtras = {}) {
  return {
    id: deal.dealId ?? null,
    name: deal.dealname ?? null,
    amount: deal.amount ?? null,
    phase: deal.phase ?? null,
    pipeline: deal.pipeline ?? null,
    pipeline_name: deal.pipelineName ?? null,
    stage: deal.dealstage ?? null,
    stage_name: deal.dealstageName ?? null,
    health_status: deal.health_status ?? null,
    createdate: deal.createdate ?? null,
    closedate: deal.closedate ?? null,
    lastmodifieddate: deal.hs_lastmodifieddate ?? null,
    ownerName: deal.ownerName ?? null,
    ownerEmail: deal.ownerEmail ?? null,
    ownerId: deal.ownerId ?? null,

    // first company's owner email
    // companyOwnerEmail:
    //   extras.companies?.[0]?.ownerEmail ??
    //   extras.companies?.[0]?.owner_email ??
    //   null,

    companies: (extras.companies ?? []).map(formatCompany),
    contacts: (extras.contacts ?? []).map(formatContact),
  };
}
