import { SquidService, executable } from '@squidcloud/backend'
import type { HubSpotDeal, HubSpotDealListParams, HubSpotSearchRequest, LinkDealToLoopRequest, Loop } from '@enterprise/common'

const HUBSPOT_BASE = 'https://api.hubapi.com'

export class HubspotService extends SquidService {
  private apiKey(): string {
    const key = process.env.HUBSPOT_PRIVATE_APP_TOKEN || ''
    if (!key) throw new Error('Missing HUBSPOT_PRIVATE_APP_TOKEN')
    return key
  }

  private async hsFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey()}`,
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HubSpot error ${res.status}: ${text}`)
    }
    return res.json()
  }

  @executable()
  async listDeals(params: HubSpotDealListParams = {}): Promise<{ results: HubSpotDeal[]; paging?: any }> {
    const sp = new URLSearchParams()
    if (params.limit) sp.set('limit', String(params.limit))
    if (params.after) sp.set('after', params.after)
    if (params.properties && params.properties.length) sp.set('properties', params.properties.join(','))
    const data = await this.hsFetch(`/crm/v3/objects/deals?${sp.toString()}`)
    let results: HubSpotDeal[] = data.results || []
    if (params.pipeline) results = results.filter((d: any) => d.properties?.pipeline === params.pipeline)
    if (params.dealstage) results = results.filter((d: any) => d.properties?.dealstage === params.dealstage)
    return { results, paging: data.paging }
  }

  @executable()
  async getDeal(dealId: string, properties?: string[]): Promise<HubSpotDeal> {
    const sp = new URLSearchParams()
    if (properties?.length) sp.set('properties', properties.join(','))
    return this.hsFetch(`/crm/v3/objects/deals/${dealId}?${sp.toString()}`)
  }

  @executable()
  async searchDeals(req: HubSpotSearchRequest, limit: number = 10): Promise<HubSpotDeal[]> {
    const body = {
      filterGroups: [{ filters: [{ propertyName: req.propertyName, operator: req.operator, value: req.value }] }],
      limit,
    }
    const data = await this.hsFetch(`/crm/v3/objects/deals/search`, { method: 'POST', body: JSON.stringify(body) })
    return data.results || []
  }

  @executable()
  async linkDealToLoop({ loop_id, deal_id }: LinkDealToLoopRequest): Promise<{ success: boolean }> {
    const loopRef = this.squid.collection<Loop>('loops').doc(loop_id)
    const loop = await loopRef.snapshot()
    if (!loop) throw new Error(`Loop ${loop_id} not found`)
    await loopRef.update({ hubspot_deal_id: deal_id } as any)
    return { success: true }
  }
}
