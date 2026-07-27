/** Protocol level (0-1023) <-> dB conversion, per the Calrec CSCP level-to-dB table. */

type ConversionPoint = [level: number, db: number]

const MAIN_FADER_MAP: ConversionPoint[] = [
	[0, -100],
	[40, -100],
	[80, -70],
	[162, -50],
	[519, -20],
	[760, -10],
	[1004, 0],
	[1023, 0],
]

const CHANNEL_FADER_MAP: ConversionPoint[] = [
	[0, -100],
	[40, -100],
	[41, -100],
	[80, -60],
	[81, -60],
	[162, -40],
	[163, -40],
	[221, -35],
	[281, -30],
	[340, -25],
	[400, -20],
	[519, -10],
	[639, -5],
	[760, 0],
	[761, 0],
	[1004, 10],
	[1023, 10],
]

function interpolate(value: number, map: ConversionPoint[], fromIndex: 0 | 1, toIndex: 0 | 1): number {
	let p1 = map[0]
	let p2 = map[map.length - 1]
	for (let i = 0; i < map.length - 1; i++) {
		if (value >= map[i][fromIndex] && value <= map[i + 1][fromIndex]) {
			p1 = map[i]
			p2 = map[i + 1]
			break
		}
	}
	if (value < p1[fromIndex]) return p1[toIndex]
	if (value > p2[fromIndex]) return p2[toIndex]
	const fromRange = p2[fromIndex] - p1[fromIndex]
	if (fromRange === 0) return p1[toIndex]
	const toRange = p2[toIndex] - p1[toIndex]
	const result = p1[toIndex] + ((value - p1[fromIndex]) / fromRange) * toRange
	return toIndex === 0 ? Math.round(result) : result
}

export function channelLevelToDb(level: number): number {
	return interpolate(level, CHANNEL_FADER_MAP, 0, 1)
}

export function dbToChannelLevel(db: number): number {
	return interpolate(db, CHANNEL_FADER_MAP, 1, 0)
}

export function mainLevelToDb(level: number): number {
	return interpolate(level, MAIN_FADER_MAP, 0, 1)
}

export function dbToMainLevel(db: number): number {
	return interpolate(db, MAIN_FADER_MAP, 1, 0)
}
