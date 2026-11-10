/**
 * Node-sheet validation for the dashboard's race sheet paste box.
 *
 * Mirrors the bot's `bot/node_sheet.py::parse_nodesheet` so a sheet that the dashboard accepts
 * behaves exactly like one the bot accepts:
 * - the whole payload is rejected only when it (or the optional `nodes` wrapper) is not an object;
 * - a single malformed node is skipped with a warning and the remaining nodes stay usable;
 * - node keys are `lap.node` strings (a key without a dot has no lap context).
 */
export interface NodeSheetNode {
  ofa: string
  dyp: string
  je: string
}

export interface ParsedNodeSheet {
  nodes: Record<string, NodeSheetNode>
  warnings: string[]
}

export const NODE_FIELDS = ['ofa', 'dyp', 'je'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseNodeSheet(payload: unknown): ParsedNodeSheet {
  if (!isPlainObject(payload)) {
    throw new Error('Invalid sheet: expected an object keyed by `lap.node`.')
  }
  const wrapper = payload.nodes ?? payload
  if (!isPlainObject(wrapper)) {
    throw new Error("Invalid sheet: expected 'nodes' to be an object keyed by `lap.node`.")
  }

  const nodes: Record<string, NodeSheetNode> = {}
  const warnings: string[] = []

  for (const [rawKey, rawNode] of Object.entries(wrapper)) {
    const key = String(rawKey).trim()
    if (!key || !key.includes('.')) {
      warnings.push(`node \`${rawKey}\` skipped: expected a \`lap.node\` key`)
      continue
    }
    if (!isPlainObject(rawNode)) {
      warnings.push(`node \`${key}\` skipped: task must be an object`)
      continue
    }
    const missing = NODE_FIELDS.filter((field) => !(field in rawNode))
    if (missing.length > 0) {
      warnings.push(`node \`${key}\` skipped: missing ${missing.join(', ')}`)
      continue
    }
    if (!NODE_FIELDS.every((field) => typeof rawNode[field] === 'string')) {
      warnings.push(`node \`${key}\` skipped: ofa, dyp and je must be strings`)
      continue
    }
    nodes[key] = {
      ofa: rawNode.ofa as string,
      dyp: rawNode.dyp as string,
      je: rawNode.je as string,
    }
  }

  return { nodes, warnings }
}
