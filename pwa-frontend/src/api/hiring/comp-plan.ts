import { hiringApiClient } from "@/api/client";

export interface CompPlan {
    compPlanId: string;
    candidateId: string;
    status: string;
    candidateName: string;
    jobTitle: string;
    department: string;
    startDate: string | null;
    countryCode: string;

    // Block 1: Base
    baseSalary: number;
    baseCurrency: string;
    baseFrequency: string;

    // Block 2: Variable
    variableType: string;
    variableAmount: number;
    variableFrequency: string;
    variableDescription: string;

    // Block 3: MBOs
    mboTargetAmount: number;
    mboFrequency: string;
    mboDescription: string;

    // Block 4: Equity
    equityShares: number;
    equityType: string;
    equityVestingMonths: number;
    equityCliffMonths: number;
    equityStrikePrice: number;

    // Block 5: Profits Interest
    profitsInterestPercent: number;
    profitsInterestVestingMonths: number;
    profitsInterestCliffMonths: number;

    // Block 6: Benefits
    healthBenefits: boolean;
    healthEmployerContribution: number;
    ptoDays: number;
    otherBenefits: string;

    // Calculated
    totalAnnualComp: number;
    totalMonthlyComp: number;
    totalPackageValue: number;

    notes: string;
    createdAt: string;
    updatedAt: string;
}

export const getCompPlan = async (candidateId: string) => {
    const response = await hiringApiClient.get(
        `/people-ops/hiring/candidates/${candidateId}/comp-plan`,
    );
    return response.data;
};

export const createCompPlan = async (
    candidateId: string,
    payload: Partial<CompPlan>,
) => {
    const response = await hiringApiClient.post(
        `/people-ops/hiring/candidates/${candidateId}/comp-plan`,
        payload,
    );
    return response.data;
};

export const updateCompPlan = async (
    candidateId: string,
    payload: Partial<CompPlan>,
) => {
    const response = await hiringApiClient.put(
        `/people-ops/hiring/candidates/${candidateId}/comp-plan`,
        payload,
    );
    return response.data;
};

export const pushToDeel = async (
    candidateId: string,
    payload: { contractType: string; payScale?: string },
) => {
    const response = await hiringApiClient.post(
        `/people-ops/hiring/candidates/${candidateId}/push-to-deel`,
        payload,
    );
    return response.data;
};
