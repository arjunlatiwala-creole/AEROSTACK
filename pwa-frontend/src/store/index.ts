import { configureStore } from '@reduxjs/toolkit'
import loopsReducer from '../features/loops/loops.slice'
import moodleReducer from '../features/moodle/moodle.slice'

export const store = configureStore({
  reducer: {
    loops: loopsReducer,
    moodle: moodleReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
