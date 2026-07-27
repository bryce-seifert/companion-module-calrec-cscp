import type { SomeCompanionConfigField } from '@companion-module/base'

export interface CalrecConfig {
	host: string
	port: number
	username: string
}

export interface CalrecSecrets {
	password: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Calrec Assist IP',
			width: 8,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Target Port',
			width: 4,
			default: 80,
			min: 1,
			max: 65535,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 6,
			default: 'Engineer',
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 6,
		},
	]
}
