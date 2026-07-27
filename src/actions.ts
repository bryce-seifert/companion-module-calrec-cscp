import type { CompanionActionDefinitions } from '@companion-module/base'
import { channelLevelToDb } from './conversions.js'
import type { CalrecInstance } from './main.js'

export function GetActions(instance: CalrecInstance): CompanionActionDefinitions {
	return {
		set_fader_level_unified: {
			name: 'Set Fader Level (0-1023)',
			options: [
				{
					type: 'number',
					label: 'Fader ID',
					id: 'faderId',
					default: 1,
					min: 1,
					max: 256,
				},
				{ type: 'checkbox', label: 'Main', id: 'isMain', default: false },
				{
					type: 'number',
					label: 'Level (0-1023)',
					id: 'level',
					default: 768,
					min: 0,
					max: 1023,
					range: true,
				},
			],
			callback: async (action) => {
				const faderId = (action.options.faderId as number) - 1 // UI (1-based) -> protocol (0-based)
				const level = action.options.level as number

				try {
					await instance.client.setFaderLevelDb(faderId, channelLevelToDb(level))
					instance.log('debug', `Set fader ${faderId + 1} level to ${level}`)
				} catch (e: unknown) {
					instance.log(
						'error',
						`Failed to set fader ${faderId + 1} level: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			},
		},
		set_fader_level_db_unified: {
			name: 'Set Fader Level (dB)',
			options: [
				{
					type: 'number',
					label: 'Fader ID',
					id: 'faderId',
					default: 1,
					min: 1,
					max: 256,
				},
				{ type: 'checkbox', label: 'Main', id: 'isMain', default: false },
				{
					type: 'number',
					label: 'Level (dB)',
					id: 'levelDb',
					default: 0,
					min: -90,
					max: 10,
				},
			],
			callback: async (action) => {
				const faderId = (action.options.faderId as number) - 1
				const levelDb = action.options.levelDb as number

				try {
					await instance.client.setFaderLevelDb(faderId, levelDb)
					instance.log('debug', `Set fader ${faderId + 1} level to ${levelDb} dB`)
				} catch (e: unknown) {
					instance.log(
						'error',
						`Failed to set fader ${faderId + 1} level: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			},
		},
		set_fader_pfl_unified: {
			name: 'Set Fader PFL',
			options: [
				{
					type: 'number',
					label: 'Fader ID',
					id: 'faderId',
					default: 1,
					min: 1,
					max: 256,
				},
				{ type: 'checkbox', label: 'Main', id: 'isMain', default: false },
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'On (PFL)' },
						{ id: 'off', label: 'Off (Not PFL)' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (action) => {
				const faderId = (action.options.faderId as number) - 1
				const state = action.options.state as string

				try {
					let targetPfl: boolean
					if (state === 'toggle') {
						const currentState = instance.faderStates.get(faderId)
						targetPfl = currentState ? !currentState.isPfl : true
					} else {
						targetPfl = state === 'on'
					}

					await instance.client.setFaderPfl(faderId, targetPfl)
					instance.log('debug', `Set fader ${faderId + 1} PFL to ${targetPfl}`)
				} catch (e: unknown) {
					instance.log('error', `Failed to set fader ${faderId + 1} PFL: ${e instanceof Error ? e.message : String(e)}`)
				}
			},
		},
		set_fader_cut_unified: {
			name: 'Set Fader Cut',
			options: [
				{
					type: 'number',
					label: 'Fader ID',
					id: 'faderId',
					default: 1,
					min: 1,
					max: 256,
				},
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'On (Cut)' },
						{ id: 'off', label: 'Off (Not Cut)' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (action) => {
				const faderId = (action.options.faderId as number) - 1
				const state = action.options.state as string

				try {
					let targetCut: boolean
					if (state === 'toggle') {
						const currentState = instance.faderStates.get(faderId)
						targetCut = currentState ? !currentState.isCut : true
					} else {
						targetCut = state === 'on'
					}

					await instance.client.setFaderCut(faderId, targetCut)
					instance.log('debug', `Set fader ${faderId + 1} cut to ${targetCut}`)
				} catch (e: unknown) {
					instance.log('error', `Failed to set fader ${faderId + 1} cut: ${e instanceof Error ? e.message : String(e)}`)
				}
			},
		},

		fader_level_up: {
			name: 'Fader Level Up (dB)',
			options: [
				{
					type: 'number',
					label: 'Fader ID',
					id: 'faderId',
					default: 1,
					min: 1,
					max: 256,
				},
				{
					type: 'number',
					label: 'Step (dB)',
					id: 'stepDb',
					default: 1,
					min: 0.1,
					max: 10,
				},
			],
			callback: async (action) => {
				const faderId = (action.options.faderId as number) - 1
				const stepDb = action.options.stepDb as number

				try {
					const newDb = await instance.client.adjustFaderLevelDb(faderId, stepDb)
					instance.log('debug', `Increased fader ${faderId + 1} level by ${stepDb} dB to ${newDb} dB`)
				} catch (e: unknown) {
					instance.log(
						'error',
						`Failed to increase fader ${faderId + 1} level: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			},
		},
		fader_level_down: {
			name: 'Fader Level Down (dB)',
			options: [
				{
					type: 'number',
					label: 'Fader ID',
					id: 'faderId',
					default: 1,
					min: 1,
					max: 256,
				},
				{
					type: 'number',
					label: 'Step (dB)',
					id: 'stepDb',
					default: 1,
					min: 0.1,
					max: 10,
				},
			],
			callback: async (action) => {
				const faderId = (action.options.faderId as number) - 1
				const stepDb = action.options.stepDb as number

				try {
					const newDb = await instance.client.adjustFaderLevelDb(faderId, -stepDb)
					instance.log('debug', `Decreased fader ${faderId + 1} level by ${stepDb} dB to ${newDb} dB`)
				} catch (e: unknown) {
					instance.log(
						'error',
						`Failed to decrease fader ${faderId + 1} level: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			},
		},
	}
}
