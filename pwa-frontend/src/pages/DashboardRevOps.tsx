import { useState, useEffect } from 'react';
import { executable } from '../lib/squidClient';
import Loader from '@/components/Loader';

// Health status colors
const HEALTH_COLORS: any = {
  GREEN: '#4CAF50',
  YELLOW: '#FFEB3B',
  ORANGE: '#FF9800',
  RED: '#F44336'
};

// Phase background colors
const PHASE_COLORS: any = {
  LEAD: '#E8F5E9',
  DEVELOPING: '#FFF9C4',
  ACTIVELY_FUNDING: '#FFE082',
  CLOSED_WON: '#C8E6C9',
  CLOSED_LOST: '#FFCDD2',
  LAUNCHED: '#BBDEFB'
};

export default function DashboardRevOps() {
  const [dashboard, setDashboard] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const fn = executable('RevopsService', 'getRevOpsDashboard');
      const data = await fn();
      setDashboard(data);
    } catch (error: any) {
      console.error('Error loading RevOps dashboard:', error);
      setError(error.message);
      // Set empty dashboard structure
      setDashboard({
        pipeline: [
          { phase: 'LEAD', phase_label: 'Leads', deal_count: 0, total_value: 0, health_distribution: {}, deals: [] },
          { phase: 'DEVELOPING', phase_label: 'Developing Deals', deal_count: 0, total_value: 0, health_distribution: {}, deals: [] },
          { phase: 'ACTIVELY_FUNDING', phase_label: 'Actively Funding Deals', deal_count: 0, total_value: 0, health_distribution: {}, deals: [] },
          { phase: 'CLOSED_WON', phase_label: 'Closed Won (Last 30d)', deal_count: 0, total_value: 0, health_distribution: {}, deals: [] },
          { phase: 'CLOSED_LOST', phase_label: 'Closed Lost (Last 30d)', deal_count: 0, total_value: 0, health_distribution: {}, deals: [] },
          { phase: 'LAUNCHED', phase_label: 'Launched (Last 30d)', deal_count: 0, total_value: 0, health_distribution: {}, deals: [] }
        ],
        summary: {
          total_deals: 0,
          total_pipeline_value: 0,
          deals_by_phase: {},
          health_distribution: {}
        },
        recent_activity: []
      });
    } finally {
      setLoading(false);
    }
  };

  const syncHubSpot = async () => {
    try {
      // First get deals from HubSpot
      const hsService = executable('HubspotService', 'listDeals');
      const hsDeals = await hsService({ limit: 100 });

      // Then import them into RevOps
      const fn = executable('RevopsService', 'importHubSpotDeals');
      await fn(hsDeals.results);

      alert('HubSpot sync complete!');
      loadDashboard();
    } catch (error: any) {
      alert(`Sync error: ${error.message}`);
    }
  };

  if (!dashboard) return <div className='flex items-center justify-center h-full'><Loader description='Loading RevOps...' /></div>

  return (
    <div style={{ padding: '20px' }}>
      {/* Error Banner */}
      {error && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffc107',
          padding: '15px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <strong>⚠️ Backend Connection Issue</strong>
          <p style={{ margin: '5px 0 0 0', fontSize: '14px' }}>
            {error.includes('not a function')
              ? 'Squid backend not available. The layout is shown with empty data.'
              : error}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>RevOps Pipeline</h1>
        <button onClick={syncHubSpot} style={{ padding: '10px 20px' }}>
          🔄 Sync HubSpot
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '30px' }}>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>Total Deals</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{dashboard.summary.total_deals}</div>
        </div>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>Pipeline Value</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            ${(dashboard.summary.total_pipeline_value || 0).toLocaleString()}
          </div>
        </div>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>Health Status</div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <span style={{ color: HEALTH_COLORS.GREEN }}>●{dashboard.summary.health_distribution.GREEN || 0}</span>
            <span style={{ color: HEALTH_COLORS.YELLOW }}>●{dashboard.summary.health_distribution.YELLOW || 0}</span>
            <span style={{ color: HEALTH_COLORS.ORANGE }}>●{dashboard.summary.health_distribution.ORANGE || 0}</span>
            <span style={{ color: HEALTH_COLORS.RED }}>●{dashboard.summary.health_distribution.RED || 0}</span>
          </div>
        </div>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>Active Deals</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            {(dashboard.summary.deals_by_phase.DEVELOPING || 0) + (dashboard.summary.deals_by_phase.ACTIVELY_FUNDING || 0)}
          </div>
        </div>
      </div>

      {/* Pipeline by Phase */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        {dashboard.pipeline.map((phase: any) => (
          <div key={phase.phase} style={{
            background: PHASE_COLORS[phase.phase] || '#f5f5f5',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{phase.phase_label}</h2>
              <span style={{
                background: 'rgba(0,0,0,0.1)',
                padding: '4px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 'bold'
              }}>
                {phase.deal_count}
              </span>
            </div>

            <div style={{ fontSize: '14px', marginBottom: '15px', color: '#666' }}>
              <strong>${(phase.total_value || 0).toLocaleString()}</strong> total
            </div>

            {/* Health distribution */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
              {phase.health_distribution.GREEN > 0 && (
                <span style={{ fontSize: '12px', color: HEALTH_COLORS.GREEN }}>
                  ● {phase.health_distribution.GREEN}
                </span>
              )}
              {phase.health_distribution.YELLOW > 0 && (
                <span style={{ fontSize: '12px', color: HEALTH_COLORS.YELLOW }}>
                  ● {phase.health_distribution.YELLOW}
                </span>
              )}
              {phase.health_distribution.ORANGE > 0 && (
                <span style={{ fontSize: '12px', color: HEALTH_COLORS.ORANGE }}>
                  ● {phase.health_distribution.ORANGE}
                </span>
              )}
              {phase.health_distribution.RED > 0 && (
                <span style={{ fontSize: '12px', color: HEALTH_COLORS.RED }}>
                  ● {phase.health_distribution.RED}
                </span>
              )}
            </div>

            {/* Deal list */}
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {phase.deals.length === 0 ? (
                <div style={{
                  background: 'white',
                  padding: '30px 20px',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#999'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '10px' }}>📭</div>
                  <div style={{ fontSize: '14px' }}>No deals in this phase</div>
                </div>
              ) : phase.deals.map((deal: any) => (
                <div
                  key={deal.id}
                  onClick={() => setSelectedDeal(deal)}
                  style={{
                    background: 'white',
                    padding: '12px',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                    borderLeft: `4px solid ${HEALTH_COLORS[deal.health_status] || '#ccc'}`,
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                    {deal.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {deal.company && <span>{deal.company} • </span>}
                    {deal.amount > 0 && <span>${deal.amount.toLocaleString()}</span>}
                  </div>
                  {deal.stage && (
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                    {deal.stage}
                  </div>
                )}
              </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Deal Detail Modal */}
      {selectedDeal && (
        <div
          onClick={() => setSelectedDeal(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '30px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}
          >
            <h2>{selectedDeal.name}</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' }}>
              <div>
                <strong>Company:</strong> {selectedDeal.company || 'N/A'}
              </div>
              <div>
                <strong>Amount:</strong> ${(selectedDeal.amount || 0).toLocaleString()}
              </div>
              <div>
                <strong>Phase:</strong> {selectedDeal.phase}
              </div>
              <div>
                <strong>Stage:</strong> {selectedDeal.stage || 'N/A'}
              </div>
              <div>
                <strong>Health:</strong>{' '}
                <span style={{ color: HEALTH_COLORS[selectedDeal.health_status] }}>
                  ● {selectedDeal.health_status}
                </span>
              </div>
              <div>
                <strong>Priority:</strong> {selectedDeal.priority || 'N/A'}
              </div>
              <div>
                <strong>Confidence:</strong> {selectedDeal.confidence_score || 'N/A'}%
              </div>
              <div>
                <strong>Owner:</strong> {selectedDeal.owner_email || 'Unassigned'}
              </div>
            </div>

            {selectedDeal.description && (
              <div style={{ marginTop: '20px' }}>
                <strong>Description:</strong>
                <p>{selectedDeal.description}</p>
              </div>
            )}

            {selectedDeal.tags && selectedDeal.tags.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <strong>Tags:</strong>{' '}
                {selectedDeal.tags.map((tag: string) => (
                  <span key={tag} style={{
                    background: '#e0e0e0',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    marginRight: '5px'
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {selectedDeal.custom_fields && Object.keys(selectedDeal.custom_fields).length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <strong>Custom Fields:</strong>
                <pre style={{ background: '#f5f5f5', padding: '10px', borderRadius: '4px', fontSize: '12px' }}>
                  {JSON.stringify(selectedDeal.custom_fields, null, 2)}
                </pre>
              </div>
            )}

            <button
              onClick={() => setSelectedDeal(null)}
              style={{
                marginTop: '20px',
                padding: '10px 20px',
                background: '#333',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
