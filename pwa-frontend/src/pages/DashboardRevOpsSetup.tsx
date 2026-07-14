import React, { useState } from 'react';
import { executable } from '../lib/squidClient';

export default function DashboardRevOpsSetup() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const createSampleDeals = async () => {
    setLoading(true);
    setMessage('Creating sample deals in local MongoDB...');
    
    try {
      const createDeal = executable('RevopsLocalService', 'createLocalDeal');
      
      // Create sample deals
      const deals = [
        {
          name: 'Acme Corp - Platform License',
          company: 'Acme Corp',
          phase: 'LEAD',
          stage: 'New Lead',
          amount: 50000,
          priority: 2,
          confidence_score: 30,
          owner_email: 'will@enterprise.io',
          health_status: 'GREEN'
        },
        {
          name: 'Beta Industries - Consulting',
          company: 'Beta Industries',
          phase: 'DEVELOPING',
          stage: 'Proposal',
          amount: 75000,
          priority: 1,
          confidence_score: 65,
          owner_email: 'will@enterprise.io',
          health_status: 'YELLOW'
        },
        {
          name: 'Gamma Tech - Enterprise Deal',
          company: 'Gamma Tech',
          phase: 'ACTIVELY_FUNDING',
          stage: 'Closing',
          amount: 250000,
          priority: 1,
          confidence_score: 90,
          owner_email: 'will@enterprise.io',
          health_status: 'GREEN'
        }
      ];
      
      for (const deal of deals) {
        await createDeal(deal);
      }
      
      setMessage('✅ Sample deals created successfully!');
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message}`);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>RevOps Dashboard Setup</h1>
      
      <div style={{ marginTop: '30px', padding: '20px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2>Quick Setup - Local Dev</h2>
        <p>Create sample deals in your local MongoDB container:</p>
        
        <button
          onClick={createSampleDeals}
          disabled={loading}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: '15px'
          }}
        >
          {loading ? 'Creating...' : 'Create Sample Deals (Local MongoDB)'}
        </button>
        
        {message && (
          <div style={{ marginTop: '20px', padding: '15px', background: 'white', borderRadius: '6px' }}>
            {message}
          </div>
        )}
      </div>

      <div style={{ marginTop: '30px', padding: '20px', background: '#e3f2fd', borderRadius: '8px' }}>
        <h3>📍 Local Development Mode</h3>
        <p>Using local MongoDB at <code>localhost:27017</code></p>
        <ul>
          <li>✅ Backend running on port 8020</li>
          <li>✅ MongoDB container running</li>
          <li>✅ Data stored locally in <code>mongodata/</code></li>
          <li>✅ Developer ID routes to local backend</li>
        </ul>
      </div>
    </div>
  );
}

