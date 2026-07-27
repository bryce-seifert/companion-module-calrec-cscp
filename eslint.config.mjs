import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

const customConfig = [
	...baseConfig,
	{
		rules: {
			// Node16/ESM resolution is handled by TypeScript; this rule false-positives on .js imports.
			'n/no-missing-import': 'off',
		},
	},
]

export default customConfig
