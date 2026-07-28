import type { CalrecInstance } from './main.js'

type VariableValue = string | number | undefined

interface VariableState {
	/** Every variable id declared to Companion so far. */
	declared: Set<string>
	/** Last value sent per variable, so unchanged values aren't re-sent. */
	cache: Map<string, VariableValue>
	/** Values changed since the last flush. */
	pending: Map<string, VariableValue>
	/** Whether `declared` grew since the last flush. */
	declarationsChanged: boolean
	timer?: NodeJS.Timeout
}

const states = new WeakMap<CalrecInstance, VariableState>()

/**
 * Coalescing window. Fader state arrives as a burst of subscription frames on connect — flushing per
 * variable means hundreds of definition updates, so batch them. Short enough to be imperceptible on a
 * live fader move.
 */
const FLUSH_MS = 50

function getState(instance: CalrecInstance): VariableState {
	let state = states.get(instance)
	if (!state) {
		state = { declared: new Set(), cache: new Map(), pending: new Map(), declarationsChanged: false }
		states.set(instance, state)
	}
	return state
}

/** Queue a variable value, declaring the variable to Companion if it's new. Flushed as a batch. */
export function setVariableWithDeclaration(instance: CalrecInstance, variableId: string, value: VariableValue): void {
	const state = getState(instance)
	if (state.cache.get(variableId) === value) return // no change
	state.cache.set(variableId, value)
	state.pending.set(variableId, value)

	if (!state.declared.has(variableId)) {
		state.declared.add(variableId)
		state.declarationsChanged = true
	}

	if (!state.timer) {
		state.timer = setTimeout(() => flushVariables(instance), FLUSH_MS)
	}
}

/** Push every queued declaration and value to Companion in one update each. */
export function flushVariables(instance: CalrecInstance): void {
	const state = states.get(instance)
	if (!state) return

	if (state.timer) {
		clearTimeout(state.timer)
		state.timer = undefined
	}

	if (state.declarationsChanged) {
		state.declarationsChanged = false
		instance.setVariableDefinitions([...state.declared].map((id) => ({ variableId: id, name: id.replace(/_/g, ' ') })))
	}

	if (state.pending.size > 0) {
		instance.setVariableValues(Object.fromEntries(state.pending))
		state.pending.clear()
	}
}

/** Drop all variable bookkeeping and cancel any pending flush. */
export function resetVariables(instance: CalrecInstance): void {
	const state = states.get(instance)
	if (state?.timer) clearTimeout(state.timer)
	states.delete(instance)
}
