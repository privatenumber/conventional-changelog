export function get (context, path) {
  const parts = path.split('.')

  return parts.reduce(
    (context, key) => context ? context[key] : context,
    context
  )
}

export function set (context, path, value) {
  const parts = Array.isArray(path) ? path.slice() : path.split('.')
  const key = parts.shift()

  if (!key) {
    return context
  }

  return {
    ...context,
    [key]: parts.length ? set(context[key], parts, value) : value
  }
}
