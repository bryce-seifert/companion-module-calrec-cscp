import { combineRgb, type CompanionButtonPresetDefinition } from '@companion-module/base'
import type { CalrecInstance } from './main.js'

const COLOR_BLACK = combineRgb(0, 0, 0)
const COLOR_WHITE = combineRgb(255, 255, 255)
const COLOR_PFL = combineRgb(0, 200, 0)
const COLOR_CUT = combineRgb(200, 0, 0)
const COLOR_DARK_GREY = combineRgb(30, 30, 30)

export function GetPresets(instance: CalrecInstance): {
	[id: string]: CompanionButtonPresetDefinition
} {
	const maxFaderCount = instance.getMaxFaderCount()
	const presets: { [id: string]: CompanionButtonPresetDefinition } = {}

	// Pad so categories sort numerically.
	const padWidth = String(maxFaderCount).length

	for (let n = 1; n <= maxFaderCount; n++) {
		const category = `Fader ${String(n).padStart(padWidth, '0')}`

		presets[`fader_${n}_label`] = {
			type: 'button',
			category,
			name: `Fader ${n} Label`,
			style: {
				text: `$(label:fader_${n}_label)`,
				size: '14',
				color: COLOR_WHITE,
				bgcolor: COLOR_DARK_GREY,
			},
			feedbacks: [],
			steps: [{ down: [], up: [] }],
		}

		presets[`fader_${n}_level`] = {
			type: 'button',
			category,
			name: `Fader ${n} Level`,
			style: {
				text: `$(label:fader_${n}_level_db)dB`,
				size: '18',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			feedbacks: [],
			steps: [{ down: [], up: [] }],
		}

		presets[`fader_${n}_down3`] = {
			type: 'button',
			category,
			name: `Fader ${n} -3dB`,
			style: {
				text: '-3dB',
				size: '18',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'fader_level_down', options: { faderId: n, stepDb: 3 } }],
					up: [],
				},
			],
		}

		presets[`fader_${n}_up3`] = {
			type: 'button',
			category,
			name: `Fader ${n} +3dB`,
			style: {
				text: '+3dB',
				size: '18',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'fader_level_up', options: { faderId: n, stepDb: 3 } }],
					up: [],
				},
			],
		}

		presets[`fader_${n}_rotary`] = {
			type: 'button',
			category,
			name: `Fader ${n} Rotary`,
			previewStyle: {
				text: `Level Adjust (Rotary Knob)`,
				size: 12,
			},
			style: {
				text: `$(label:fader_${n}_level_db)dB`,
				size: '14',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			options: { rotaryActions: true },
			feedbacks: [],
			steps: [
				{
					down: [],
					up: [],
					rotate_left: [{ actionId: 'fader_level_down', options: { faderId: n, stepDb: 1 } }],
					rotate_right: [{ actionId: 'fader_level_up', options: { faderId: n, stepDb: 1 } }],
				},
			],
		}

		presets[`fader_${n}_pfl`] = {
			type: 'button',
			category,
			name: `Fader ${n} PFL`,
			style: {
				text: 'PFL',
				size: '18',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			feedbacks: [{ feedbackId: 'fader_pfl_state', options: { faderId: n }, style: { bgcolor: COLOR_PFL } }],
			steps: [
				{
					down: [{ actionId: 'set_fader_pfl_unified', options: { faderId: n, isMain: false, state: 'toggle' } }],
					up: [],
				},
			],
		}

		presets[`fader_${n}_cut`] = {
			type: 'button',
			category,
			name: `Fader ${n} Cut`,
			style: {
				text: 'CUT',
				size: '18',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			feedbacks: [{ feedbackId: 'fader_cut_state', options: { faderId: n }, style: { bgcolor: COLOR_CUT } }],
			steps: [
				{
					down: [{ actionId: 'set_fader_cut_unified', options: { faderId: n, state: 'toggle' } }],
					up: [],
				},
			],
		}
	}

	return presets
}
