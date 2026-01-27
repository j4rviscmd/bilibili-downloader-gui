import type { PayloadAction } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";
import type { Input } from "@/features/video/types";

const initialState: Input = {
	url: "",
	partInputs: [],
};

/**
 * Redux slice for video download input state.
 *
 * Manages user input for video downloads including:
 * - Video URL
 * - Per-part settings (title, quality, selection)
 * - Bulk selection/deselection
 */
export const inputSlice = createSlice({
	name: "input",
	initialState,
	reducers: {
		/**
		 * Replaces the entire input state.
		 *
		 * @param _ - Previous state (unused, will be replaced)
		 * @param action - Action containing the new input
		 */
		setInput: (_, action: PayloadAction<Input>) => {
			return action.payload;
		},
		/**
		 * Updates the video URL.
		 *
		 * @param state - Current input state
		 * @param action - Action containing the new URL
		 */
		setUrl: (state, action: PayloadAction<string>) => {
			state.url = action.payload;
		},
		/**
		 * Initializes part input settings from fetched video metadata.
		 *
		 * @param state - Current input state
		 * @param action - Action containing the array of part input configurations
		 */
		initPartInputs: (
			state,
			action: PayloadAction<
				{
					cid: number;
					page: number;
					title: string;
					videoQuality: string;
					audioQuality: string;
					selected: boolean;
				}[]
			>,
		) => {
			// 既存互換: legacy quality を持つ要素が来た場合のガードは呼び出し側で保証する前提
			state.partInputs = action.payload;
		},
		/**
		 * Updates specific fields of a part input by index.
		 *
		 * @param state - Current input state
		 * @param action - Action containing the index and fields to update
		 */
		updatePartInputByIndex: (
			state,
			action: PayloadAction<{
				index: number;
				title?: string;
				videoQuality?: string;
				audioQuality?: string;
			}>,
		) => {
			const { index, title, videoQuality, audioQuality } = action.payload;
			const target = state.partInputs[index];
			if (!target) return;
			if (title !== undefined) target.title = title;
			if (videoQuality !== undefined) target.videoQuality = videoQuality;
			if (audioQuality !== undefined) target.audioQuality = audioQuality;
		},
		/**
		 * Updates the selection state of a specific part.
		 *
		 * @param state - Current input state
		 * @param action - Action containing the index and new selection state
		 */
		updatePartSelected: (
			state,
			action: PayloadAction<{ index: number; selected: boolean }>,
		) => {
			const { index, selected } = action.payload;
			const target = state.partInputs[index];
			if (target) target.selected = selected;
		},
		/**
		 * Selects all video parts for download.
		 *
		 * @param state - Current input state
		 */
		selectAll: (state) => {
			state.partInputs.forEach((p) => {
				p.selected = true;
			});
		},
		/**
		 * Deselects all video parts.
		 *
		 * @param state - Current input state
		 */
		deselectAll: (state) => {
			state.partInputs.forEach((p) => {
				p.selected = false;
			});
		},
		/**
		 * Resets the input state to initial values.
		 *
		 * Used after download completion to clear the form.
		 */
		resetInput: () => {
			return initialState;
		},
	},
});

export const {
	setInput,
	setUrl,
	initPartInputs,
	updatePartInputByIndex,
	updatePartSelected,
	selectAll,
	deselectAll,
	resetInput,
} = inputSlice.actions;
export default inputSlice.reducer;
