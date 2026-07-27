import { InstanceBase, InstanceStatus, runEntrypoint, type SomeCompanionConfigField } from '@companion-module/base'
import { GetActions } from './actions.js'
import { GetConfigFields, type CalrecConfig, type CalrecSecrets } from './config.js'
import { dbToChannelLevel } from './conversions.js'
import { GetFeedbacks } from './feedbacks.js'
import { CalrecGraphQLClient } from './graphql-client.js'
import { GetPresets } from './presets.js'
import { UpgradeScripts } from './upgrades.js'
import { setVariableWithDeclaration } from './variables.js'

interface FaderState {
	/** Console-native level in tenths of a dB (+10 dB = 100). */
	levelTenthDb: number
	/** 0-1023 protocol level kept for variable continuity with the old CSCP module. */
	level: number
	levelDb: string
	isCut: boolean
	isPfl: boolean
	label: string
}

export class CalrecInstance extends InstanceBase<CalrecConfig, CalrecSecrets> {
	public config!: CalrecConfig
	public secrets!: CalrecSecrets
	public client!: CalrecGraphQLClient
	public faderStates: Map<number, FaderState> = new Map()

	async init(config: CalrecConfig, _isFirstInit: boolean, secrets: CalrecSecrets): Promise<void> {
		this.log('info', 'init() called')
		try {
			this.updateStatus(InstanceStatus.Connecting)
			await this.configUpdated(config, secrets)
			this.log('info', 'init() completed successfully')
		} catch (e: unknown) {
			this.log('error', `init() failed: ${e instanceof Error ? e.message : String(e)}`)
			throw e
		}
	}

	async destroy(): Promise<void> {
		if (this.client) {
			this.client.disconnect()
		}
		this.updateStatus(InstanceStatus.Disconnected)
		this.log('debug', 'destroy')
	}

	async configUpdated(config: CalrecConfig, secrets: CalrecSecrets): Promise<void> {
		this.log('info', 'configUpdated() called')
		this.config = config
		this.secrets = secrets
		this.updateStatus(InstanceStatus.Connecting)

		// Actions are fixed; presets/feedbacks wait for mixer.constants.numberOfFaders.
		this.setActionDefinitions(GetActions(this))
		this.setFeedbackDefinitions(GetFeedbacks(this))
		this.setPresetDefinitions(GetPresets(this))

		if (this.client) {
			this.client.disconnect()
		}

		this.client = new CalrecGraphQLClient({
			host: this.config.host,
			port: this.config.port,
			username: this.config.username,
			password: this.secrets.password ?? '',
			log: (level, message) => this.log(level, message),
		})

		this.setupEventListeners()

		// Connect in the background so init() returns promptly (Companion times out a slow init()).
		this.client.connect().catch((e: unknown) => {
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Failed to connect')
			this.log('error', `Connection failed: ${e instanceof Error ? e.message : String(e)}`)
		})
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	private setupEventListeners(): void {
		this.client.on('connect', () => {
			this.log('info', 'Connected to Calrec console')
			this.updateStatus(InstanceStatus.Ok)
		})

		this.client.on('disconnect', () => {
			this.updateStatus(InstanceStatus.Disconnected)
		})

		// A single unanswered request isn't a broken connection; the action logs its own error.
		this.client.on('requestTimeout', () => {
			if (!this.client.isConnected) {
				this.updateStatus(InstanceStatus.ConnectionFailure, 'Request timed out')
			}
		})

		this.client.on('requestSuccess', () => {
			this.updateStatus(InstanceStatus.Ok)
		})

		this.client.on('mixerConstants', ({ numberOfFaders }: { numberOfFaders: number }) => {
			if (numberOfFaders > 0) {
				this.log('info', `Mixer reported ${numberOfFaders} faders`)
				this.setPresetDefinitions(GetPresets(this))
				this.setFeedbackDefinitions(GetFeedbacks(this))
			}
		})

		this.client.on('faderLevelChange', (faderId: number, levelTenthDb: number) => {
			const db = levelTenthDb / 10
			const state = this.getOrInitFaderState(faderId)
			state.levelTenthDb = levelTenthDb
			state.level = dbToChannelLevel(db)
			state.levelDb = db.toFixed(1)
			this.faderStates.set(faderId, state)
			setVariableWithDeclaration(this, `fader_${faderId + 1}_level`, state.level)
			setVariableWithDeclaration(this, `fader_${faderId + 1}_level_db`, state.levelDb)
		})

		this.client.on('faderCutChange', (faderId: number, isCut: boolean) => {
			const state = this.getOrInitFaderState(faderId)
			state.isCut = isCut
			this.faderStates.set(faderId, state)
			setVariableWithDeclaration(this, `fader_${faderId + 1}_cut`, isCut ? 'Cut' : 'On')
			this.checkFeedbacks('fader_cut_state')
		})

		this.client.on('faderPflChange', (faderId: number, isPfl: boolean) => {
			const state = this.getOrInitFaderState(faderId)
			state.isPfl = isPfl
			this.faderStates.set(faderId, state)
			setVariableWithDeclaration(this, `fader_${faderId + 1}_pfl`, isPfl ? 'On' : 'Off')
			this.checkFeedbacks('fader_pfl_state')
		})

		this.client.on('faderLabelChange', (faderId: number, label: string) => {
			const state = this.getOrInitFaderState(faderId)
			state.label = label
			this.faderStates.set(faderId, state)
			setVariableWithDeclaration(this, `fader_${faderId + 1}_label`, label)
		})
	}

	/** Fader count from the mixer; 0 until `mixer.constants` has been received. */
	public getMaxFaderCount(): number {
		return this.client?.numberOfFaders ?? 0
	}

	private getOrInitFaderState(faderId: number): FaderState {
		let state = this.faderStates.get(faderId)
		if (!state) {
			state = {
				levelTenthDb: 0,
				level: 0,
				levelDb: '-∞',
				isCut: false,
				isPfl: false,
				label: '',
			}
			this.faderStates.set(faderId, state)
		}
		return state
	}
}

runEntrypoint(CalrecInstance, UpgradeScripts)
