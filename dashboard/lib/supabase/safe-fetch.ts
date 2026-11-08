// Supabase returns bigint columns as JSON numbers, which JavaScript rounds above 2^53.
// This wraps fetch so any 16+ digit number in a JSON response is turned into a string first.
export const safeFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)

  if (res.status === 204 || res.status === 205 || res.status === 304) return res
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) return res

  const text = await res.text()
  const fixed = text.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"')

  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(fixed, { status: res.status, statusText: res.statusText, headers })
}
