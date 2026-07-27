import type {
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
} from '@companion-module/base'
import type { CalrecConfig, CalrecSecrets } from './config.js'

/** Older configs stored password in the main config object. */
type LegacyConfig = CalrecConfig & { password?: string }

export const UpgradeScripts: CompanionStaticUpgradeScript<CalrecConfig, CalrecSecrets>[] = [
	/** Migrate from CSCP/TCP to GraphQL-over-WebSocket: port 23 -> 80, add username/password. */
	function migrateToGraphQL(
		_context: CompanionUpgradeContext<CalrecConfig>,
		props: CompanionStaticUpgradeProps<CalrecConfig, CalrecSecrets>,
	): CompanionStaticUpgradeResult<CalrecConfig, CalrecSecrets> {
		const config: LegacyConfig | null = props.config
		if (!config) {
			return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
		}

		let changed = false
		if (config.port === undefined || config.port === 23) {
			config.port = 80
			changed = true
		}
		if (config.username === undefined) {
			config.username = 'Engineer'
			changed = true
		}
		if (config.password === undefined) {
			config.password = ''
			changed = true
		}

		return {
			updatedConfig: changed ? config : null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},

	/** Move password from config into the secrets object. */
	function migratePasswordToSecrets(
		_context: CompanionUpgradeContext<CalrecConfig>,
		props: CompanionStaticUpgradeProps<CalrecConfig, CalrecSecrets>,
	): CompanionStaticUpgradeResult<CalrecConfig, CalrecSecrets> {
		const config: LegacyConfig | null = props.config
		const secrets: CalrecSecrets = { ...(props.secrets ?? { password: '' }) }

		let configChanged = false
		let secretsChanged = false

		if (config && typeof config.password === 'string') {
			if (!secrets.password) {
				secrets.password = config.password
				secretsChanged = true
			}
			delete config.password
			configChanged = true
		}

		if (secrets.password === undefined) {
			secrets.password = ''
			secretsChanged = true
		}

		return {
			updatedConfig: configChanged ? config : null,
			updatedSecrets: secretsChanged ? secrets : null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
]
