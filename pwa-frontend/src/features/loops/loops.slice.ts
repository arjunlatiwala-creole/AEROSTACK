import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import type { Loop, CreateLoopRequest, ScoreOutcomeRequest, LoopListParams } from '@enterprise/common'
import * as api from './loops.api'

export interface LoopsState {
  items: Loop[]
  loading: boolean
  error: string | null
}

const initialState: LoopsState = {
  items: [],
  loading: false,
  error: null,
}

export const fetchLoops = createAsyncThunk('loops/fetch', async (params?: LoopListParams) => {
  return api.listLoops(params)
})

export const addLoop = createAsyncThunk('loops/add', async (req: CreateLoopRequest) => {
  const res = await api.createLoop(req)
  return res
})

export const scoreOutcome = createAsyncThunk('loops/scoreOutcome', async (req: ScoreOutcomeRequest, { dispatch }) => {
  await api.scoreOutcome(req)
  await dispatch(fetchLoops())
  return true
})

const loopsSlice = createSlice({
  name: 'loops',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchLoops.pending, state => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchLoops.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload
      })
      .addCase(fetchLoops.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to load loops'
      })
  },
})

export default loopsSlice.reducer
