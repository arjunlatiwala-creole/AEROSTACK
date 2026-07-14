// Aerostack V1 Velocity Calculation Utility
// Implements weighted 90-day rolling average for velocity scoring

import { VelocityWindow, VelocityCalculation } from '../types/aerostack';

export interface CompletedLoop {
  loop_id: string;
  loop_score: number;
  actual_completion_date: string;
  category: string;
  credit_share: number;
}

export interface VelocityConfig {
  enableMspConsistencyFloor?: boolean;
  mspFloorMultiplier?: number; // Default 0.8
}

/**
 * Calculate velocity windows for a person based on completed loops
 */
export function calculateVelocityWindows(
  completedLoops: CompletedLoop[],
  asOfDate: Date = new Date()
): VelocityWindow[] {
  const windows: VelocityWindow[] = [];
  
  // Define the three 30-day windows
  const windowConfigs = [
    { days: 30, weight: 0.5 },   // W0: Last 0-30 days
    { days: 60, weight: 0.3 },   // W1: Last 31-60 days  
    { days: 90, weight: 0.2 },   // W2: Last 61-90 days
  ];

  windowConfigs.forEach((config, index) => {
    const windowEnd = new Date(asOfDate);
    const windowStart = new Date(asOfDate);
    
    if (index === 0) {
      // W0: 0-30 days ago
      windowStart.setDate(asOfDate.getDate() - 30);
    } else if (index === 1) {
      // W1: 31-60 days ago
      windowStart.setDate(asOfDate.getDate() - 60);
      windowEnd.setDate(asOfDate.getDate() - 30);
    } else {
      // W2: 61-90 days ago
      windowStart.setDate(asOfDate.getDate() - 90);
      windowEnd.setDate(asOfDate.getDate() - 60);
    }

    // Filter loops completed in this window
    const windowLoops = completedLoops.filter(loop => {
      const completionDate = new Date(loop.actual_completion_date);
      return completionDate >= windowStart && completionDate <= windowEnd;
    });

    // Calculate weighted average score for this window
    const totalWeightedScore = windowLoops.reduce((sum, loop) => {
      return sum + (loop.loop_score * loop.credit_share);
    }, 0);

    const totalCreditShare = windowLoops.reduce((sum, loop) => {
      return sum + loop.credit_share;
    }, 0);

    const average_score = totalCreditShare > 0 ? totalWeightedScore / totalCreditShare : 0;

    windows.push({
      window_start: windowStart.toISOString().split('T')[0],
      window_end: windowEnd.toISOString().split('T')[0],
      average_score,
      weight: config.weight,
    });
  });

  return windows;
}

/**
 * Calculate velocity score from velocity windows
 */
export function calculateVelocityScore(windows: VelocityWindow[]): number {
  return windows.reduce((velocity, window) => {
    return velocity + (window.average_score * window.weight);
  }, 0);
}

/**
 * Apply MSP consistency floor if enabled and person has MSP category loops
 */
export function applyMspConsistencyFloor(
  velocity: number,
  completedLoops: CompletedLoop[],
  config: VelocityConfig = {}
): number {
  if (!config.enableMspConsistencyFloor) return velocity;

  const mspLoops = completedLoops.filter(loop => loop.category === 'MSP');
  if (mspLoops.length === 0) return velocity;

  // Calculate 90-day average for MSP loops
  const totalWeightedScore = mspLoops.reduce((sum, loop) => {
    return sum + (loop.loop_score * loop.credit_share);
  }, 0);

  const totalCreditShare = mspLoops.reduce((sum, loop) => {
    return sum + loop.credit_share;
  }, 0);

  if (totalCreditShare === 0) return velocity;

  const avg90d = totalWeightedScore / totalCreditShare;
  const floorMultiplier = config.mspFloorMultiplier ?? 0.8;
  const consistencyFloor = avg90d * floorMultiplier;

  return Math.max(velocity, consistencyFloor);
}

/**
 * Complete velocity calculation for a person
 */
export function calculatePersonVelocity(
  completedLoops: CompletedLoop[],
  config: VelocityConfig = {},
  asOfDate: Date = new Date()
): VelocityCalculation {
  // Filter loops to last 90 days
  const cutoffDate = new Date(asOfDate);
  cutoffDate.setDate(asOfDate.getDate() - 90);
  
  const recentLoops = completedLoops.filter(loop => {
    const completionDate = new Date(loop.actual_completion_date);
    return completionDate >= cutoffDate;
  });

  // Calculate velocity windows
  const windows = calculateVelocityWindows(recentLoops, asOfDate);
  
  // Calculate base velocity score
  let velocity_score = calculateVelocityScore(windows);
  
  // Apply MSP consistency floor if applicable
  let msp_consistency_floor: number | undefined;
  if (config.enableMspConsistencyFloor) {
    const originalVelocity = velocity_score;
    velocity_score = applyMspConsistencyFloor(velocity_score, recentLoops, config);
    if (velocity_score > originalVelocity) {
      msp_consistency_floor = velocity_score;
    }
  }

  return {
    person_id: recentLoops[0]?.loop_id.split('-')[0] || '', // Placeholder - should be passed in
    windows,
    velocity_score: Math.round(velocity_score * 1000) / 1000, // Round to 3 decimal places
    msp_consistency_floor,
  };
}

/**
 * Batch calculate velocities for multiple people
 */
export function calculateBatchVelocities(
  loopsByPerson: Record<string, CompletedLoop[]>,
  config: VelocityConfig = {},
  asOfDate: Date = new Date()
): Record<string, VelocityCalculation> {
  const results: Record<string, VelocityCalculation> = {};
  
  Object.entries(loopsByPerson).forEach(([personId, loops]) => {
    const calculation = calculatePersonVelocity(loops, config, asOfDate);
    calculation.person_id = personId;
    results[personId] = calculation;
  });
  
  return results;
}

/**
 * Helper to format velocity score for display
 */
export function formatVelocityScore(score: number): string {
  return score.toFixed(2);
}

/**
 * Helper to get velocity trend (comparing current vs previous period)
 */
export function getVelocityTrend(
  currentVelocity: number,
  previousVelocity: number
): 'up' | 'down' | 'stable' {
  const threshold = 0.1; // 10% change threshold
  const percentChange = Math.abs(currentVelocity - previousVelocity) / previousVelocity;
  
  if (percentChange < threshold) return 'stable';
  return currentVelocity > previousVelocity ? 'up' : 'down';
}
