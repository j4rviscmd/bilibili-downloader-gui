// Utility functions for video feature
// NOTE: Keep logic lightweight; do not duplicate complex validation.

// Remove characters we forbid in schema; unify case & trim.
// Windows forbidden: \\ / : * ? " < > |
// Non-Windows (mac/Linux): /
// Since we don't know OS synchronously, remove broad superset except colon when maybe allowed? We mirror formSchema default.
const FORBIDDEN_SUPERSET = /[\\/:*?"<>|]/g

export const normalizeFilename = (name: string): string => {
  return name.trim().toLowerCase().replace(FORBIDDEN_SUPERSET, '')
}
