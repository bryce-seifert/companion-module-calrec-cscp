import { EventEmitter } from 'node:events'
import fastJsonPatch, { type Operation } from 'fast-json-patch'
import WebSocket from 'ws'

const { applyPatch } = fastJsonPatch

export interface CalrecGraphQLClientOptions {
	host: string
	port?: number
	username: string
	password: string
	log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

/** Snapshot of a single fader's state, mirroring the fields the module tracks. */
export interface GraphQLFaderState {
	faderNumber: number
	label: string
	/** Fader level in tenths of a dB (console-native scale; +10 dB = 100). */
	levelTenthDb: number
	isCut: boolean
	isPfl: boolean
	hasPath: boolean
	/** Path identifier (e.g. "CH/23/0"), used to address the path in some mutations. */
	pathId?: string
	faderId?: string
}

interface Subscription {
	query: string
	variables: Record<string, unknown>
	document: unknown
	onDocument: (document: unknown) => void
}

interface WsMessage {
	type: string
	id?: string
	payload?: NextPayload
}

interface NextPayload {
	data?: { operations?: Operation[] } & Record<string, unknown>
	errors?: Array<{ message?: string }>
}

interface FaderEntry {
	faderNumber: number
	faderLayer?: { faderSubLayer?: FaderSubLayerDoc | null } | null
}

interface FaderSubLayerDoc {
	faderId?: string | null
	path?: {
		info?: { path?: string; name?: string; label?: string; type?: string } | null
		fader?: { level?: number; isCut?: boolean; isOpen?: boolean } | null
		apfl?: { isPflActive?: boolean } | null
	} | null
}

interface LevelQueue {
	/** dB the fader should end up at once every queued step has been applied. */
	target: number
	pending: number
	chain: Promise<void>
}

const PROTOCOL = 'graphql-transport-ws'

/** Usable range of the console fader law, in dB. */
export const FADER_MIN_DB = -90
export const FADER_MAX_DB = 10

/** The console mixes RFC-6902 pointers (`/faders/0`) with non-standard `/faders[0]`; normalize the latter. */
function normalizePointer(op: Operation): Operation {
	const fix = (p: string) => p.replace(/\[(\d+)\]/g, '/$1')
	const next = { ...op, path: fix(op.path) } as Operation & { from?: string }
	if (typeof next.from === 'string') next.from = fix(next.from)
	return next
}

/**
 * Mutations answer with `MutationResult { result: String }`. The console isn't consistent about what a
 * success string looks like, so only flag results that clearly report a failure.
 */
function failedMutationResult(data: unknown): string | undefined {
	const record = data as Record<string, { result?: unknown } | undefined> | undefined
	if (!record || typeof record !== 'object') return undefined
	for (const value of Object.values(record)) {
		const result = value?.result
		if (typeof result === 'string' && /fail|error|denied|invalid|reject|unauthori[sz]ed/i.test(result)) {
			return result
		}
	}
	return undefined
}

/** WebSocket transport for the Calrec GraphQL API; unwraps the patch envelope and emits fader change events. */
export class CalrecGraphQLClient extends EventEmitter {
	private readonly host: string
	private readonly port: number
	private readonly username: string
	private readonly password: string
	private readonly log: NonNullable<CalrecGraphQLClientOptions['log']>

	private ws?: WebSocket
	private token?: string
	private closing = false
	private reconnectTimer?: NodeJS.Timeout
	private nextRequestId = 0
	/** True after we've already warned about a reconnect failure (avoid log spam while retrying). */
	private reconnectFailureLogged = false

	private readonly subscriptions = new Map<string, Subscription>()
	private readonly pendingRequests = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void }
	>()

	/** Latest known per-fader state, keyed by 0-based fader number. */
	public readonly faders = new Map<number, GraphQLFaderState>()
	/** Total faders reported by the mixer (`mixer.constants.numberOfFaders`). */
	public numberOfFaders = 0
	public numberOfSections = 8
	public numberOfFadersPerSection = 6
	private subscribedSections = 0
	/** In-flight/queued relative level steps, keyed by fader number. */
	private readonly levelQueues = new Map<number, LevelQueue>()

	constructor(options: CalrecGraphQLClientOptions) {
		super()
		this.host = options.host
		this.port = options.port && options.port > 0 ? options.port : 80
		this.username = options.username
		this.password = options.password
		this.log = options.log ?? (() => {})
	}

	public get isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN
	}

	private get httpUrl(): string {
		return `http://${this.host}:${this.port}/graphql`
	}

	private get wsUrl(): string {
		return `ws://${this.host}:${this.port}/graphql`
	}

	async connect(): Promise<void> {
		this.closing = false
		this.reconnectFailureLogged = false
		try {
			this.token = await this.login()
			await this.openSocket()
		} catch (e) {
			if (!this.closing) this.scheduleReconnect()
			throw e
		}
	}

	disconnect(): void {
		this.closing = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
		this.subscriptions.clear()
		this.failPendingRequests('Connection closed')
		if (this.ws) {
			try {
				this.ws.close()
			} catch {
				// ignore
			}
			this.ws = undefined
		}
	}

	private async login(): Promise<string> {
		const res = await fetch(this.httpUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: 'mutation($u:String!,$p:String!){ login(username:$u,password:$p){ result token } }',
				variables: { u: this.username, p: this.password },
			}),
			signal: AbortSignal.timeout(8000),
		})
		if (!res.ok) throw new Error(`Login HTTP ${res.status}`)
		const json = (await res.json()) as { data?: { login?: { result?: string; token?: string } } }
		const token = json.data?.login?.token
		if (!token) throw new Error('Login failed: no token returned (check username/password)')
		return token
	}

	private async openSocket(): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(this.wsUrl, PROTOCOL)
			this.ws = ws
			let settled = false
			const ackTimeout = setTimeout(() => {
				if (!settled) {
					settled = true
					try {
						ws.close()
					} catch {
						// ignore
					}
					reject(new Error('Timed out waiting for connection_ack'))
				}
			}, 8000)

			ws.on('open', () => {
				ws.send(
					JSON.stringify({
						type: 'connection_init',
						payload: {
							'enable-batching': true,
							'panel-type': 'UNKNOWN_PANEL',
							Authorization: `Bearer ${this.token}`,
						},
					}),
				)
			})

			ws.on('message', (raw) => {
				for (const msg of this.unwrap(raw)) {
					if (!msg) continue
					switch (msg.type) {
						case 'connection_ack':
							clearTimeout(ackTimeout)
							this.log('info', 'GraphQL connection acknowledged')
							this.emit('connect')
							if (!settled) {
								settled = true
								resolve()
							}
							this.onReady()
							break
						case 'connection_error':
							if (!settled) {
								settled = true
								reject(new Error(`connection_error ${JSON.stringify(msg.payload)}`))
							}
							break
						case 'ping':
							ws.send(JSON.stringify({ type: 'pong' }))
							break
						case 'next':
							this.handleNext(msg.id, msg.payload)
							break
						case 'error':
							this.handleError(msg.id, msg.payload)
							break
						case 'complete':
							this.handleComplete(msg.id)
							break
						default:
							break
					}
				}
			})

			ws.on('error', (err: Error) => {
				this.log('error', `WebSocket error: ${err.message}`)
				if (!settled) {
					settled = true
					reject(err)
				}
			})

			ws.on('close', () => {
				this.failPendingRequests('Connection closed')
				this.emit('disconnect')
				if (!this.closing) this.scheduleReconnect()
			})
		})
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer || this.closing) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			void (async () => {
				try {
					if (!this.reconnectFailureLogged) {
						this.log('info', 'Reconnecting to Calrec console...')
					}
					this.token = await this.login()
					await this.openSocket()
				} catch (e) {
					if (!this.reconnectFailureLogged) {
						this.reconnectFailureLogged = true
						this.log('warn', `Reconnect failed: ${e instanceof Error ? e.message : String(e)} (retrying every 3s)`)
					}
					this.scheduleReconnect()
				}
			})()
		}, 3000)
	}

	/** Unwrap the server's JSON-Patch envelope into the real graphql-transport-ws messages. */
	private unwrap(raw: WebSocket.RawData): WsMessage[] {
		let env: { operations?: Array<{ value: WsMessage }> } & Partial<WsMessage>
		try {
			const text = Buffer.isBuffer(raw)
				? raw.toString()
				: Array.isArray(raw)
					? Buffer.concat(raw).toString()
					: Buffer.from(raw).toString()
			env = JSON.parse(text)
		} catch {
			return []
		}
		if (Array.isArray(env.operations)) return env.operations.map((op) => op.value)
		return [env as WsMessage]
	}

	/** Settle every in-flight one-shot rather than making callers wait out the 5 s timer. */
	private failPendingRequests(reason: string): void {
		for (const [id, pending] of this.pendingRequests) {
			this.pendingRequests.delete(id)
			pending.reject(new Error(reason))
		}
		this.levelQueues.clear()
	}

	private onReady(): void {
		// (Re)subscribe to every surface section so we track all faders.
		this.faders.clear()
		this.subscribedSections = 0
		this.subscribeMixerConstants()
		this.ensureSectionSubscriptions()
		this.emit('ready')
	}

	private send(message: unknown): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message))
		}
	}

	private subscribe(query: string, variables: Record<string, unknown>, onDocument: (doc: unknown) => void): string {
		const id = `sub_${++this.nextRequestId}`
		this.subscriptions.set(id, { query, variables, document: undefined, onDocument })
		this.send({ id, type: 'subscribe', payload: { query, variables } })
		return id
	}

	/** Run a one-shot operation (mutation/query) and resolve with its data. */
	private async request(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
		const id = `req_${++this.nextRequestId}`
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('Not connected to console')
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pendingRequests.delete(id)) {
					this.emit('requestTimeout')
					reject(new Error('Request timed out (console did not answer)'))
				}
			}, 5000)

			this.pendingRequests.set(id, {
				resolve: (value) => {
					clearTimeout(timer)
					this.emit('requestSuccess')
					resolve(value)
				},
				reject: (err) => {
					clearTimeout(timer)
					reject(err)
				},
			})

			this.log('debug', `-> ${id} ${query} ${JSON.stringify(variables)}`)
			this.send({ id, type: 'subscribe', payload: { query, variables } })
		})
	}

	private handleNext(id: string | undefined, payload: NextPayload | undefined): void {
		if (!id) return
		const pending = this.pendingRequests.get(id)
		if (pending) {
			this.pendingRequests.delete(id)
			// Stop the server-side operation; one-shots only ever need the first frame.
			this.send({ id, type: 'complete' })
			this.log('debug', `<- ${id} ${JSON.stringify(payload)}`)
			const requestError = payload?.errors?.[0]?.message
			if (requestError) {
				pending.reject(new Error(requestError))
				return
			}
			const data = this.reduceData(undefined, payload)
			const failure = failedMutationResult(data)
			if (failure) {
				pending.reject(new Error(`Console rejected the request: ${failure}`))
				return
			}
			pending.resolve(data)
			return
		}
		const sub = this.subscriptions.get(id)
		if (!sub) {
			this.log('debug', `Unmatched next frame for id ${id}`)
			return
		}
		const errorMessage = payload?.errors?.[0]?.message
		// NO_PATH is expected for unassigned surface faders; don't treat it as an error.
		if (errorMessage && errorMessage !== 'NO_PATH') {
			this.log('debug', `Subscription ${id} error: ${errorMessage}`)
		}
		sub.document = this.reduceData(sub.document, payload)
		sub.onDocument(sub.document)
	}

	/** Apply a `next` payload's data operations (or plain data) onto the running document. */
	private reduceData(document: unknown, payload: NextPayload | undefined): unknown {
		const ops = payload?.data?.operations
		if (Array.isArray(ops)) {
			const base = document === undefined ? {} : document
			try {
				return applyPatch(base, ops.map(normalizePointer), false, false).newDocument
			} catch (e) {
				this.log('debug', `Patch apply failed: ${e instanceof Error ? e.message : String(e)}`)
				return base
			}
		}
		return payload?.data ?? document
	}

	private handleError(id: string | undefined, payload: NextPayload | undefined): void {
		if (!id) return
		const message = payload?.errors?.[0]?.message ?? JSON.stringify(payload)
		const pending = this.pendingRequests.get(id)
		if (pending) {
			this.pendingRequests.delete(id)
			pending.reject(new Error(message))
			return
		}
		this.log(
			'debug',
			`Error frame for ${this.subscriptions.has(id) ? 'subscription' : 'unmatched id'} ${id}: ${message}`,
		)
	}

	private handleComplete(id: string | undefined): void {
		if (!id) return
		const pending = this.pendingRequests.get(id)
		if (pending) {
			// Completed without ever sending data — settle rather than leaving the caller hanging.
			this.pendingRequests.delete(id)
			pending.reject(new Error('Console closed the request without a response'))
		}
	}

	private subscribeMixerConstants(): void {
		const query = 'subscription{ mixer{ constants{ numberOfFaders numberOfSections numberOfFadersPerSection } } }'
		this.subscribe(query, {}, (doc) => {
			const c = (
				doc as {
					mixer?: {
						constants?: {
							numberOfFaders?: number
							numberOfSections?: number
							numberOfFadersPerSection?: number
						}
					}
				}
			)?.mixer?.constants
			if (!c) return

			let changed = false
			if (typeof c.numberOfFaders === 'number' && c.numberOfFaders !== this.numberOfFaders) {
				this.numberOfFaders = c.numberOfFaders
				changed = true
			}
			if (typeof c.numberOfSections === 'number' && c.numberOfSections !== this.numberOfSections) {
				this.numberOfSections = c.numberOfSections
				changed = true
			}
			if (
				typeof c.numberOfFadersPerSection === 'number' &&
				c.numberOfFadersPerSection !== this.numberOfFadersPerSection
			) {
				this.numberOfFadersPerSection = c.numberOfFadersPerSection
				changed = true
			}

			this.ensureSectionSubscriptions()

			if (changed) {
				this.emit('mixerConstants', {
					numberOfFaders: this.numberOfFaders,
					numberOfSections: this.numberOfSections,
					numberOfFadersPerSection: this.numberOfFadersPerSection,
				})
			}
		})
	}

	/** Subscribe to any sections not yet covered after mixer constants arrive/update. */
	private ensureSectionSubscriptions(): void {
		while (this.subscribedSections < this.numberOfSections) {
			this.subscribeSection(this.subscribedSections)
			this.subscribedSections++
		}
	}

	private static readonly FADER_SELECTION =
		'faderNumber faderLayer{ faderSubLayer{ faderId path{ info{ path name label type } fader(cutMode: FADER){ level isCut isOpen } apfl{ isPflActive } } } }'

	private subscribeSection(section: number): void {
		const query = `subscription($s:Int!,$slot:Int!){ faders(layer: SCRATCH, sectionId:$s, slotId:$slot){ ${CalrecGraphQLClient.FADER_SELECTION} } }`
		this.subscribe(query, { s: section, slot: 0 }, (doc) => {
			const list = (doc as { faders?: FaderEntry[] })?.faders
			if (!Array.isArray(list)) return
			for (const entry of list) {
				if (entry && typeof entry.faderNumber === 'number') this.applyFaderEntry(entry)
			}
		})
	}

	/** Diff a fader entry against known state and emit change events for what moved. */
	private applyFaderEntry(entry: FaderEntry): void {
		const faderNumber: number = entry.faderNumber
		const sub = entry.faderLayer?.faderSubLayer
		const info = sub?.path?.info
		const pathFader = sub?.path?.fader
		const next: GraphQLFaderState = {
			faderNumber,
			hasPath: !!info?.path,
			label: info?.name || info?.label || '',
			levelTenthDb: typeof pathFader?.level === 'number' ? pathFader.level : 0,
			isCut: !!pathFader?.isCut,
			isPfl: !!sub?.path?.apfl?.isPflActive,
			pathId: info?.path ?? undefined,
			faderId: sub?.faderId ?? undefined,
		}

		const prev = this.faders.get(faderNumber)
		this.faders.set(faderNumber, next)

		if (!prev || prev.label !== next.label) this.emit('faderLabelChange', faderNumber, next.label)
		if (!prev || prev.levelTenthDb !== next.levelTenthDb) this.emit('faderLevelChange', faderNumber, next.levelTenthDb)
		if (!prev || prev.isCut !== next.isCut) this.emit('faderCutChange', faderNumber, next.isCut)
		if (!prev || prev.isPfl !== next.isPfl) this.emit('faderPflChange', faderNumber, next.isPfl)
	}

	// --- Mutations -----------------------------------------------------------

	/** Set a fader to an absolute level. `db` is in dB; the console scale is tenths of a dB. */
	async setFaderLevelDb(faderNumber: number, db: number): Promise<void> {
		const state = this.requireFader(faderNumber)
		// Address by both faderNumber and path: some consoles only resolve the target from the path.
		await this.request(
			'mutation($n:Int,$p:String,$a:Int){ updateFader(faderNumber:$n, path:$p, level_Action:{ absolute:$a }){ result } }',
			{ n: faderNumber, p: state.pathId, a: Math.round(db * 10) },
		)
	}

	/**
	 * Nudge a fader by `stepDb`, relative to the console's reported level. Steps for the same fader are
	 * queued and coalesced, so a burst of rotary ticks compounds instead of racing on a stale level.
	 */
	async adjustFaderLevelDb(
		faderNumber: number,
		stepDb: number,
		minDb = FADER_MIN_DB,
		maxDb = FADER_MAX_DB,
	): Promise<number> {
		const state = this.requireFader(faderNumber)
		const queued = this.levelQueues.get(faderNumber)
		const currentDb = queued ? queued.target : state.levelTenthDb / 10
		const target = Math.min(maxDb, Math.max(minDb, currentDb + stepDb))

		if (queued) {
			queued.target = target
			queued.pending++
			queued.chain = queued.chain.catch(() => {}).then(async () => this.writeQueuedLevel(faderNumber))
			await queued.chain
		} else {
			const entry: LevelQueue = { target, pending: 1, chain: Promise.resolve() }
			this.levelQueues.set(faderNumber, entry)
			entry.chain = this.writeQueuedLevel(faderNumber)
			await entry.chain
		}
		return target
	}

	/** Write the queued target for a fader, but only for the last step in a burst. */
	private async writeQueuedLevel(faderNumber: number): Promise<void> {
		const entry = this.levelQueues.get(faderNumber)
		if (!entry) return
		entry.pending--
		if (entry.pending > 0) return // a later step supersedes this one
		try {
			await this.setFaderLevelDb(faderNumber, entry.target)
		} finally {
			if (entry.pending === 0) this.levelQueues.delete(faderNumber)
		}
	}

	/** Fader state as reported by the console, or an explanation of why the fader can't be driven. */
	private requireFader(faderNumber: number): GraphQLFaderState {
		const state = this.faders.get(faderNumber)
		if (!state) {
			throw new Error(
				`Fader ${faderNumber + 1} is not reported by the console (mixer reports ${this.numberOfFaders} faders)`,
			)
		}
		if (!state.pathId) throw new Error(`Fader ${faderNumber + 1} has no path assigned`)
		return state
	}

	async setFaderCut(faderNumber: number, isCut: boolean): Promise<void> {
		const state = this.requireFader(faderNumber)
		if (state.isCut === isCut) return // already in the desired state
		await this.toggleUserControl('PATH_CUT_UNCUT', 50, state)
	}

	async setFaderPfl(faderNumber: number, isPfl: boolean): Promise<void> {
		const state = this.requireFader(faderNumber)
		if (state.isPfl === isPfl) return
		await this.toggleUserControl('PFL', 30, state)
	}

	/** Cut and PFL are fader-strip function buttons; a single PRESS toggles them. */
	private async toggleUserControl(type: string, index: number, state: GraphQLFaderState): Promise<void> {
		await this.request(
			'mutation($t:UserControlsEnum!,$i:Int,$p:String,$f:String,$a:ButtonAction){ toggleUserControl(type:$t, index:$i, path:$p, faderId:$f, action:$a){ result } }',
			{ t: type, i: index, p: state.pathId, f: state.faderId, a: 'PRESS' },
		)
	}
}
