import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { RootState } from '../../store';
import { getMoodleCourses } from '@/api/loops';
import type { AerostackLoops } from '@enterprise/common';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface MoodleState {
  courses: AerostackLoops.MoodleCourse[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null; // epoch ms
}

const initialState: MoodleState = {
  courses: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
};

/**
 * Fetch Moodle courses.
 * - If courses are cached and still within TTL, returns cached data immediately (no network call).
 * - Pass `{ forceRefresh: true }` to bust the cache (e.g. after a bulk assign).
 */
export const fetchMoodleCourses = createAsyncThunk(
  'moodle/fetchCourses',
  async (_: void | undefined, { getState }) => {
    const state = (getState() as RootState).moodle;
    return getMoodleCourses();
  },
  {
    // Skip if cache is still fresh AND not forced
    condition: (arg, { getState }) => {
      const state = (getState() as RootState).moodle;
      if (state.loading) return false; // already in flight
      if (!state.lastFetchedAt) return true; // never fetched
      const age = Date.now() - state.lastFetchedAt;
      return age >= CACHE_TTL_MS; // only fetch if cache expired
    },
  },
);

/**
 * Force-refresh: busts the cache unconditionally.
 * Use this after a successful bulk assign.
 */
export const refreshMoodleCourses = createAsyncThunk(
  'moodle/refreshCourses',
  async () => getMoodleCourses(true),
);

const moodleSlice = createSlice({
  name: 'moodle',
  initialState,
  reducers: {
    /** Manually invalidate the cache (next fetchMoodleCourses will re-fetch). */
    invalidateCache(state) {
      state.lastFetchedAt = null;
    },
  },
  extraReducers: (builder) => {
    // ── fetchMoodleCourses (cache-aware) ──────────────────────────────────
    builder
      .addCase(fetchMoodleCourses.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMoodleCourses.fulfilled, (state, action) => {
        state.loading = false;
        state.courses = action.payload;
        state.lastFetchedAt = Date.now();
      })
      .addCase(fetchMoodleCourses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? 'Failed to load Moodle courses';
      });

    // ── refreshMoodleCourses (force, bypasses condition) ─────────────────
    builder
      .addCase(refreshMoodleCourses.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(refreshMoodleCourses.fulfilled, (state, action) => {
        state.loading = false;
        state.courses = action.payload;
        state.lastFetchedAt = Date.now();
      })
      .addCase(refreshMoodleCourses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? 'Failed to refresh Moodle courses';
      });
  },
});

export const { invalidateCache } = moodleSlice.actions;

// Selectors
export const selectMoodleCourses = (state: RootState) => state.moodle.courses;
export const selectMoodleLoading  = (state: RootState) => state.moodle.loading;
export const selectMoodleError    = (state: RootState) => state.moodle.error;
export const selectMoodleCacheAge = (state: RootState) =>
  state.moodle.lastFetchedAt ? Date.now() - state.moodle.lastFetchedAt : null;

export default moodleSlice.reducer;
