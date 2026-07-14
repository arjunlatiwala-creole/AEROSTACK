#!/usr/bin/env node
/**
 * Data Tools MCP Server
 * 
 * Calculators and data analysis tools from Claude artifacts
 * - Financial calculators (ROI, burn rate, runway)
 * - Team metrics (velocity, capacity, utilization)
 * - Data segmentation (cohort analysis, filtering)
 * - Quick insights (trends, anomalies, summaries)
 * 
 * Accessible via:
 * - Web UI at /data-tools
 * - Slack commands /aerostack calc
 * - MCP API for AI agents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Data analysis tools implementation
const dataTools = {
  /**
   * Calculate financial metrics (ROI, burn rate, runway)
   */
  async calculateFinancials(params: {
    metric_type: 'roi' | 'burn_rate' | 'runway' | 'ltv_cac' | 'arr_growth';
    data: Record<string, number>;
    period?: string;
  }) {
    const { metric_type, data, period } = params;
    
    const calculations: Record<string, any> = {
      roi: () => {
        const gain = data.revenue - data.cost;
        const roi = (gain / data.cost) * 100;
        return {
          roi_percentage: roi.toFixed(2),
          gain: gain.toFixed(2),
          interpretation: roi > 0 ? 'Positive ROI' : 'Negative ROI',
          recommendation: roi < 20 ? 'Consider optimization' : 'Good performance'
        };
      },
      
      burn_rate: () => {
        const monthly_burn = data.expenses - data.revenue;
        const runway_months = data.cash_balance / monthly_burn;
        return {
          monthly_burn: monthly_burn.toFixed(2),
          runway_months: runway_months.toFixed(1),
          cash_balance: data.cash_balance.toFixed(2),
          alert: runway_months < 6 ? 'Critical: Less than 6 months runway' : 'Healthy runway',
          recommendation: runway_months < 12 ? 'Consider fundraising or cost reduction' : 'Good position'
        };
      },
      
      runway: () => {
        const months = data.cash_balance / data.monthly_burn;
        const weeks = (months * 4.33).toFixed(1);
        return {
          runway_months: months.toFixed(1),
          runway_weeks: weeks,
          zero_date: new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: months > 12 ? 'healthy' : months > 6 ? 'caution' : 'critical'
        };
      },
      
      ltv_cac: () => {
        const ltv = data.avg_revenue_per_customer * data.avg_customer_lifetime_months;
        const ratio = ltv / data.cac;
        return {
          ltv: ltv.toFixed(2),
          cac: data.cac.toFixed(2),
          ltv_cac_ratio: ratio.toFixed(2),
          interpretation: ratio > 3 ? 'Excellent' : ratio > 1 ? 'Acceptable' : 'Poor',
          recommendation: ratio < 3 ? 'Improve retention or reduce CAC' : 'Strong unit economics'
        };
      },
      
      arr_growth: () => {
        const growth = ((data.current_arr - data.previous_arr) / data.previous_arr) * 100;
        const monthly_growth = growth / 12;
        return {
          arr_growth_percentage: growth.toFixed(2),
          monthly_growth_rate: monthly_growth.toFixed(2),
          current_arr: data.current_arr.toFixed(2),
          previous_arr: data.previous_arr.toFixed(2),
          status: growth > 100 ? 'hypergrowth' : growth > 50 ? 'high_growth' : 'steady'
        };
      }
    };
    
    const result = calculations[metric_type]();
    return {
      metric_type,
      period: period || 'current',
      calculated_at: new Date().toISOString(),
      ...result
    };
  },

  /**
   * Calculate team velocity and capacity metrics
   */
  async calculateTeamMetrics(params: {
    metric_type: 'velocity' | 'capacity' | 'utilization' | 'throughput';
    loops?: Array<{ effort_score: number; duration_days: number; status: string }>;
    team_size?: number;
    sprint_days?: number;
    completed_points?: number;
    available_hours?: number;
    worked_hours?: number;
  }) {
    const { metric_type, loops, team_size, sprint_days, completed_points, available_hours, worked_hours } = params;
    
    const calculations: Record<string, any> = {
      velocity: () => {
        const completed = loops?.filter(l => l.status === 'COMPLETED') || [];
        const total_points = completed.reduce((sum, l) => sum + (l.effort_score || 0), 0);
        const avg_velocity = completed.length > 0 ? total_points / completed.length : 0;
        
        return {
          total_completed: completed.length,
          total_points: total_points,
          average_velocity: avg_velocity.toFixed(2),
          points_per_sprint: sprint_days ? (total_points / (completed.length * sprint_days / 14)).toFixed(2) : null,
          trend: completed.length > 5 ? 'stable' : 'insufficient_data'
        };
      },
      
      capacity: () => {
        const total_capacity = (team_size || 0) * (sprint_days || 10) * 6; // 6 hours productive per day
        const capacity_per_person = (sprint_days || 10) * 6;
        
        return {
          team_size: team_size || 0,
          sprint_days: sprint_days || 10,
          total_capacity_hours: total_capacity,
          capacity_per_person_hours: capacity_per_person,
          estimated_story_points: (total_capacity / 8).toFixed(1), // 8 hours per point
          recommendation: 'Plan for 80% of capacity to account for meetings and overhead'
        };
      },
      
      utilization: () => {
        const utilization_rate = ((worked_hours || 0) / (available_hours || 1)) * 100;
        
        return {
          available_hours: available_hours || 0,
          worked_hours: worked_hours || 0,
          utilization_percentage: utilization_rate.toFixed(2),
          status: utilization_rate > 90 ? 'overutilized' : utilization_rate > 70 ? 'optimal' : 'underutilized',
          recommendation: utilization_rate > 85 ? 'Risk of burnout - reduce load' : 
                         utilization_rate < 60 ? 'Capacity available for more work' : 
                         'Healthy utilization'
        };
      },
      
      throughput: () => {
        const completed = loops?.filter(l => l.status === 'COMPLETED') || [];
        const avg_cycle_time = completed.length > 0 ? 
          completed.reduce((sum, l) => sum + (l.duration_days || 0), 0) / completed.length : 0;
        
        return {
          items_completed: completed.length,
          average_cycle_time_days: avg_cycle_time.toFixed(1),
          throughput_per_week: completed.length > 0 ? (7 / avg_cycle_time).toFixed(2) : 0,
          status: avg_cycle_time < 7 ? 'fast' : avg_cycle_time < 14 ? 'normal' : 'slow'
        };
      }
    };
    
    const result = calculations[metric_type]();
    return {
      metric_type,
      calculated_at: new Date().toISOString(),
      ...result
    };
  },

  /**
   * Segment and analyze data by various dimensions
   */
  async segmentData(params: {
    data: Array<Record<string, any>>;
    segment_by: string;
    metrics?: string[];
    filters?: Record<string, any>;
  }) {
    const { data, segment_by, metrics, filters } = params;
    
    // Apply filters
    let filtered_data = data;
    if (filters) {
      filtered_data = data.filter(item => {
        return Object.entries(filters).every(([key, value]) => {
          if (Array.isArray(value)) {
            return value.includes(item[key]);
          }
          return item[key] === value;
        });
      });
    }
    
    // Segment data
    const segments: Record<string, any[]> = {};
    filtered_data.forEach(item => {
      const segment_value = item[segment_by] || 'unknown';
      if (!segments[segment_value]) {
        segments[segment_value] = [];
      }
      segments[segment_value].push(item);
    });
    
    // Calculate metrics for each segment
    const segment_analysis = Object.entries(segments).map(([segment_value, items]) => {
      const analysis: any = {
        segment: segment_value,
        count: items.length,
        percentage: ((items.length / filtered_data.length) * 100).toFixed(2)
      };
      
      // Calculate requested metrics
      if (metrics) {
        metrics.forEach(metric => {
          const values = items.map(item => item[metric]).filter(v => typeof v === 'number');
          if (values.length > 0) {
            analysis[`${metric}_sum`] = values.reduce((a, b) => a + b, 0).toFixed(2);
            analysis[`${metric}_avg`] = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
            analysis[`${metric}_min`] = Math.min(...values).toFixed(2);
            analysis[`${metric}_max`] = Math.max(...values).toFixed(2);
          }
        });
      }
      
      return analysis;
    });
    
    return {
      segment_by,
      total_records: data.length,
      filtered_records: filtered_data.length,
      segments: segment_analysis.sort((a, b) => b.count - a.count),
      filters_applied: filters || {},
      calculated_at: new Date().toISOString()
    };
  },

  /**
   * Generate quick insights from data (trends, anomalies, summaries)
   */
  async generateInsights(params: {
    data: Array<Record<string, any>>;
    insight_type: 'trends' | 'anomalies' | 'summary' | 'comparison';
    time_field?: string;
    value_field?: string;
    compare_periods?: { current: string; previous: string };
  }) {
    const { data, insight_type, time_field, value_field, compare_periods } = params;
    
    const insights: Record<string, any> = {
      trends: () => {
        if (!time_field || !value_field) {
          return { error: 'time_field and value_field required for trends' };
        }
        
        // Sort by time
        const sorted = [...data].sort((a, b) => 
          new Date(a[time_field]).getTime() - new Date(b[time_field]).getTime()
        );
        
        const values = sorted.map(item => item[value_field]).filter(v => typeof v === 'number');
        
        if (values.length < 2) {
          return { trend: 'insufficient_data' };
        }
        
        // Simple linear trend
        const first_half_avg = values.slice(0, Math.floor(values.length / 2))
          .reduce((a, b) => a + b, 0) / Math.floor(values.length / 2);
        const second_half_avg = values.slice(Math.floor(values.length / 2))
          .reduce((a, b) => a + b, 0) / (values.length - Math.floor(values.length / 2));
        
        const change = ((second_half_avg - first_half_avg) / first_half_avg) * 100;
        
        return {
          trend: change > 10 ? 'increasing' : change < -10 ? 'decreasing' : 'stable',
          change_percentage: change.toFixed(2),
          first_period_avg: first_half_avg.toFixed(2),
          second_period_avg: second_half_avg.toFixed(2),
          data_points: values.length
        };
      },
      
      anomalies: () => {
        if (!value_field) {
          return { error: 'value_field required for anomalies' };
        }
        
        const values = data.map(item => item[value_field]).filter(v => typeof v === 'number');
        
        if (values.length < 3) {
          return { anomalies: [] };
        }
        
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const std_dev = Math.sqrt(
          values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
        );
        
        const anomalies = data
          .map((item, index) => ({
            index,
            value: item[value_field],
            z_score: Math.abs((item[value_field] - mean) / std_dev),
            item
          }))
          .filter(a => a.z_score > 2) // More than 2 standard deviations
          .sort((a, b) => b.z_score - a.z_score);
        
        return {
          anomalies_found: anomalies.length,
          mean: mean.toFixed(2),
          std_dev: std_dev.toFixed(2),
          anomalies: anomalies.slice(0, 10).map(a => ({
            value: a.value,
            z_score: a.z_score.toFixed(2),
            severity: a.z_score > 3 ? 'high' : 'medium'
          }))
        };
      },
      
      summary: () => {
        const numeric_fields = Object.keys(data[0] || {}).filter(key => 
          typeof data[0][key] === 'number'
        );
        
        const summary: any = {
          total_records: data.length,
          fields: {}
        };
        
        numeric_fields.forEach(field => {
          const values = data.map(item => item[field]).filter(v => typeof v === 'number');
          if (values.length > 0) {
            summary.fields[field] = {
              sum: values.reduce((a, b) => a + b, 0).toFixed(2),
              avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
              min: Math.min(...values).toFixed(2),
              max: Math.max(...values).toFixed(2),
              count: values.length
            };
          }
        });
        
        return summary;
      },
      
      comparison: () => {
        if (!compare_periods || !time_field || !value_field) {
          return { error: 'compare_periods, time_field, and value_field required' };
        }
        
        const current_data = data.filter(item => item[time_field] >= compare_periods.current);
        const previous_data = data.filter(item => 
          item[time_field] >= compare_periods.previous && 
          item[time_field] < compare_periods.current
        );
        
        const current_values = current_data.map(item => item[value_field]).filter(v => typeof v === 'number');
        const previous_values = previous_data.map(item => item[value_field]).filter(v => typeof v === 'number');
        
        const current_sum = current_values.reduce((a, b) => a + b, 0);
        const previous_sum = previous_values.reduce((a, b) => a + b, 0);
        const change = previous_sum > 0 ? ((current_sum - previous_sum) / previous_sum) * 100 : 0;
        
        return {
          current_period: {
            count: current_data.length,
            sum: current_sum.toFixed(2),
            avg: current_values.length > 0 ? (current_sum / current_values.length).toFixed(2) : 0
          },
          previous_period: {
            count: previous_data.length,
            sum: previous_sum.toFixed(2),
            avg: previous_values.length > 0 ? (previous_sum / previous_values.length).toFixed(2) : 0
          },
          change_percentage: change.toFixed(2),
          trend: change > 0 ? 'growth' : change < 0 ? 'decline' : 'stable'
        };
      }
    };
    
    const result = insights[insight_type]();
    return {
      insight_type,
      calculated_at: new Date().toISOString(),
      ...result
    };
  }
};

// Create MCP server
const server = new Server(
  {
    name: 'data-tools-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'calculate_financials',
        description: 'Calculate financial metrics: ROI, burn rate, runway, LTV/CAC, ARR growth',
        inputSchema: {
          type: 'object',
          properties: {
            metric_type: {
              type: 'string',
              enum: ['roi', 'burn_rate', 'runway', 'ltv_cac', 'arr_growth'],
              description: 'Type of financial metric to calculate'
            },
            data: {
              type: 'object',
              description: 'Input data for calculation (varies by metric type)',
              additionalProperties: { type: 'number' }
            },
            period: {
              type: 'string',
              description: 'Time period for the calculation (optional)'
            }
          },
          required: ['metric_type', 'data']
        }
      },
      {
        name: 'calculate_team_metrics',
        description: 'Calculate team performance metrics: velocity, capacity, utilization, throughput',
        inputSchema: {
          type: 'object',
          properties: {
            metric_type: {
              type: 'string',
              enum: ['velocity', 'capacity', 'utilization', 'throughput'],
              description: 'Type of team metric to calculate'
            },
            loops: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  effort_score: { type: 'number' },
                  duration_days: { type: 'number' },
                  status: { type: 'string' }
                }
              },
              description: 'Array of loop data for velocity/throughput calculations'
            },
            team_size: {
              type: 'number',
              description: 'Number of team members'
            },
            sprint_days: {
              type: 'number',
              description: 'Length of sprint in days'
            },
            completed_points: {
              type: 'number',
              description: 'Story points completed'
            },
            available_hours: {
              type: 'number',
              description: 'Total available hours'
            },
            worked_hours: {
              type: 'number',
              description: 'Actual hours worked'
            }
          },
          required: ['metric_type']
        }
      },
      {
        name: 'segment_data',
        description: 'Segment and analyze data by dimensions (category, status, owner, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { type: 'object' },
              description: 'Array of data records to segment'
            },
            segment_by: {
              type: 'string',
              description: 'Field to segment by (e.g., category, status, owner)'
            },
            metrics: {
              type: 'array',
              items: { type: 'string' },
              description: 'Numeric fields to calculate metrics for (sum, avg, min, max)'
            },
            filters: {
              type: 'object',
              description: 'Filters to apply before segmentation',
              additionalProperties: true
            }
          },
          required: ['data', 'segment_by']
        }
      },
      {
        name: 'generate_insights',
        description: 'Generate quick insights: trends, anomalies, summaries, period comparisons',
        inputSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { type: 'object' },
              description: 'Array of data records to analyze'
            },
            insight_type: {
              type: 'string',
              enum: ['trends', 'anomalies', 'summary', 'comparison'],
              description: 'Type of insight to generate'
            },
            time_field: {
              type: 'string',
              description: 'Field containing time/date values (for trends/comparison)'
            },
            value_field: {
              type: 'string',
              description: 'Field containing numeric values to analyze'
            },
            compare_periods: {
              type: 'object',
              properties: {
                current: { type: 'string' },
                previous: { type: 'string' }
              },
              description: 'Date ranges for comparison (ISO format)'
            }
          },
          required: ['data', 'insight_type']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    
    switch (name) {
      case 'calculate_financials':
        result = await dataTools.calculateFinancials(args as any);
        break;
      
      case 'calculate_team_metrics':
        result = await dataTools.calculateTeamMetrics(args as any);
        break;
      
      case 'segment_data':
        result = await dataTools.segmentData(args as any);
        break;
      
      case 'generate_insights':
        result = await dataTools.generateInsights(args as any);
        break;
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Data Tools MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
